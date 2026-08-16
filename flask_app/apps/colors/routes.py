import base64
import io
import json
import os
import re

from flask import Blueprint, request, jsonify, redirect, url_for
from sqlalchemy.orm.attributes import flag_modified

try:
    import requests
except ImportError:
    requests = None

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from ...models import *
from ... import db

colors_bp = Blueprint('colors', __name__)


# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------

def _require_user():
    """Returns the logged-in User, or None if the session is invalid."""
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return None
    return user


def _get_or_create_colors_config(user):
    """Every user gets exactly one AppsConfig + ColorsConfig row, created lazily.

    Note: `colors_config` is a relationship, not a physical column on
    apps_configs — the foreign key lives on the colors_configs side
    (colors_configs.apps_config_id), which is why you won't see a
    colors_config column when browsing the apps_configs table directly."""
    apps_config = user.apps_config
    if apps_config is None:
        apps_config = AppsConfig(user_id=user.id)
        db.session.add(apps_config)
        db.session.flush()  # assign apps_config.id before we reference it

    if apps_config.colors_config is None:
        colors_config = ColorsConfig(apps_config_id=apps_config.id, palette={})
        db.session.add(colors_config)
        apps_config.colors_config = colors_config
        db.session.flush()

    return apps_config.colors_config


def _is_valid_name_part(part):
    """A single Library / Project / Palette segment: non-empty, no '/',
    no leading/trailing whitespace, reasonable length. Spaces and any
    capitalisation are allowed."""
    return (
        isinstance(part, str)
        and 0 < len(part) <= 60
        and "/" not in part
        and part.strip() == part
    )


def _parse_full_name(name):
    """Validates 'Library/Project/Palette' and returns the 3 parts, or None."""
    if not isinstance(name, str):
        return None
    parts = name.split("/")
    if len(parts) != 3 or not all(_is_valid_name_part(p) for p in parts):
        return None
    return parts


def _is_valid_palette(palette):
    if not isinstance(palette, list) or not palette:
        return False
    for c in palette:
        if not isinstance(c, dict) or "hex" not in c:
            return False
        if not isinstance(c["hex"], str) or not c["hex"].startswith("#"):
            return False
    return True


# ------------------------------------------------------------------
# AI palette extraction (image -> color palette)
#
# The heavy lifting is done server-side: the image is base64-encoded and
# posted to the colorpalette-generator model on the Open WebUI server, so
# the API key never has to live in the browser. Override via env vars if
# you want to rotate the key/model without touching code.
# ------------------------------------------------------------------
AI_API_URL = "https://ai.nedwork.ch/api/chat/completions"
AI_API_KEY = os.environ.get("COLORS_AI_API_KEY", "sk-a50ab4e057a64f229fd3f122db69b0db")
AI_MODEL = os.environ.get("COLORS_AI_MODEL", "colorpalette-generator")
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


def _clamp_color_count(value, default=5):
    """Coerce whatever the client sent into an int in [1, 12]."""
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = default
    return max(1, min(12, count))


def _sniff_mime(image_bytes):
    """Detect image type from magic bytes (works even without Pillow)."""
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return None


def _prepare_image(image_bytes):
    """Normalize any uploaded image into a compact JPEG.

    The working Python test always sends 'data:image/jpeg;base64,...'.
    Forwarding the browser's raw mime (webp/png/octet-stream) is what made
    Open WebUI answer 400. With Pillow installed, every upload is re-encoded
    to a small, orientation-corrected JPEG — identical in shape to the test.
    Without Pillow, only JPEG/PNG pass through.
    """
    if HAS_PIL:
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img = ImageOps.exif_transpose(img)   # respect EXIF orientation
            img = img.convert("RGB")             # drop alpha/CMYK quirks
            img.thumbnail((1024, 1024))          # cap size, shrink payload
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return "image/jpeg", buf.getvalue()
        except Exception:
            pass  # fall through to magic-byte sniffing on the raw bytes

    mime = _sniff_mime(image_bytes)
    if mime == "image/jpeg":
        return "image/jpeg", image_bytes     # exactly the test case
    if mime == "image/png":
        return "image/png", image_bytes      # PNG passthrough w/o Pillow
    raise ValueError(
        "Unsupported image format. Install Pillow on the server to accept "
        "any image type; otherwise please upload a JPEG or PNG."
    )


def _extract_hex_palette(content):
    """Pull hex colors out of the model's reply.

    The model is asked to return the palette as hex codes; it usually comes
    back as a JSON/Python list of strings like ["#FF0000", ...], but it can
    also be free text. Try a strict JSON parse first, then fall back to
    scanning for any hex-looking tokens."""
    if not isinstance(content, str):
        return []

    try:
        data = json.loads(content)
        if isinstance(data, list):
            out = []
            for item in data:
                if isinstance(item, str) and re.fullmatch(r"#?[0-9a-fA-F]{6}", item.strip()):
                    out.append(item.strip())
                elif isinstance(item, dict) and isinstance(item.get("hex"), str):
                    out.append(item["hex"].strip())
            if out:
                return out
    except (ValueError, TypeError):
        pass

    # fallback: scan for 6-digit hex tokens anywhere in the text
    return re.findall(r"#?[0-9a-fA-F]{6}(?![0-9a-fA-F])", content)


def _normalise_hex_list(colors, target_count):
    """Dedupe + normalise raw hex tokens to uppercase '#RRGGBB', capped at target_count."""
    palette = []
    seen = set()
    for c in colors:
        c = c.strip().upper()
        if not c.startswith("#"):
            c = "#" + c
        if len(c) == 7 and c not in seen:
            seen.add(c)
            palette.append(c)
        if len(palette) >= target_count:
            break
    return palette


def _generate_palette_from_image(image_bytes, mime_type, number):
    """POST the image to the colorpalette-generator model, return raw hex tokens.
    Mirrors the working Python test request exactly."""
    if requests is None:
        raise RuntimeError("The 'requests' library is not installed on the server.")

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "model": AI_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"The number is {number}. "
                                "Analyze the image and generate a color palette "
                                "that fits it. Return the palette as hex codes.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                    },
                ],
            }
        ],
        "temperature": 0.7,
    }

    resp = requests.post(
        AI_API_URL,
        headers={
            "Authorization": f"Bearer {AI_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=90,
    )

    if not resp.ok:
        # Open WebUI puts the real reason in the JSON error body — surface it
        # instead of a bare "400 Client Error" (it also uses 400 for an
        # unknown model name, so this reveals the exact cause).
        detail = resp.text[:400]
        try:
            body = resp.json()
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict):
                    detail = err.get("message") or detail
                elif err:
                    detail = str(err) or detail
                detail = body.get("message") or detail
        except Exception:
            pass
        raise RuntimeError(f"AI gateway error {resp.status_code}: {detail}")

    data = resp.json()

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(f"Unexpected AI response: {str(data)[:200]}")

    return _extract_hex_palette(content)


# ------------------------------------------------------------------
# routes
# ------------------------------------------------------------------

@colors_bp.route("/list", methods=["GET"])
def list_palettes():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    colors_config = _get_or_create_colors_config(user)
    db.session.commit()

    return jsonify({"palettes": colors_config.palette or {}})


@colors_bp.route("/save", methods=["POST"])
def save_colors():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    name = data.get("name")  # "Library/Project/Palette"
    palette = data.get("palette")

    parts = _parse_full_name(name)
    if parts is None:
        return jsonify({
            "error": "Name must be 'Library/Project/Palette' — each part "
                     "non-empty, no leading/trailing spaces, and no '/'."
        }), 400

    if not _is_valid_palette(palette):
        return jsonify({"error": "Palette must be a non-empty list of {hex, locked} colors"}), 400

    colors_config = _get_or_create_colors_config(user)
    if colors_config.palette is None:
        colors_config.palette = {}

    full_name = "/".join(parts)
    colors_config.palette[full_name] = palette
    flag_modified(colors_config, "palette")
    db.session.commit()

    return jsonify({"status": "ok", "name": full_name})


@colors_bp.route("/delete", methods=["POST"])
def delete_colors():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided"}), 400

    name = data.get("name")
    if not name or not isinstance(name, str):
        return jsonify({"error": "Missing name"}), 400

    colors_config = _get_or_create_colors_config(user)
    palette_dict = colors_config.palette or {}

    removed = False

    # Exact palette match ("Library/Project/Palette")
    if name in palette_dict:
        del palette_dict[name]
        removed = True
    else:
        # Otherwise treat `name` as a Library or Library/Project prefix
        # and bulk-delete everything under it.
        prefix = name.rstrip("/") + "/"
        for key in list(palette_dict.keys()):
            if key.startswith(prefix):
                del palette_dict[key]
                removed = True

    if not removed:
        return jsonify({"error": "Not found"}), 404

    flag_modified(colors_config, "palette")
    db.session.commit()

    return jsonify({"status": "ok"})


@colors_bp.route("/palette-from-image", methods=["POST"])
def palette_from_image():
    user = _require_user()
    if user is None:
        return redirect(url_for('auth.login_page'))

    file = request.files.get("image")
    if file is None or not file.filename:
        return jsonify({"error": "No image uploaded"}), 400

    number = _clamp_color_count(request.form.get("number"))

    image_bytes = file.read()
    if not image_bytes:
        return jsonify({"error": "Uploaded image is empty"}), 400
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 10 MB)"}), 400

    # normalise to JPEG (or pass through JPEG/PNG) so the request has
    # exactly the same shape as the working Python test
    try:
        mime_type, image_bytes = _prepare_image(image_bytes)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        raw_colors = _generate_palette_from_image(image_bytes, mime_type, number)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:  # network / upstream API errors
        return jsonify({"error": f"AI palette generation failed: {exc}"}), 502

    palette = _normalise_hex_list(raw_colors, number)
    if not palette:
        return jsonify({"error": "The AI returned no usable colors"}), 502

    return jsonify({"status": "ok", "number": number, "palette": palette})