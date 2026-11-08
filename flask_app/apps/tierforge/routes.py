import io
import os
import re
import shutil
import uuid

import requests

from flask import Blueprint, request, jsonify, redirect, url_for, send_file, abort, current_app

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from ...models import Session
from ...auth.decorators import login_required, permission_required, API

# NOTE ON REGISTRATION: this blueprint is meant to be mounted at
# url_prefix='/apps/tierforge' (same convention as the colors app), e.g.
#
#   from .apps.tierforge.routes import tierforge_bp
#   app.register_blueprint(tierforge_bp, url_prefix='/apps/tierforge')
#
# It works alongside the generic apps_bp static-file route
# ('/<app_name>/<path:filename>') because Werkzeug ranks a rule with a
# typed <image_id>/<variant> segment above a trailing <path:filename>
# wildcard, so /apps/tierforge/images/<id>/thumb resolves here rather
# than falling into the static-file catch-all — just double check this
# against however apps_bp is actually registered in your app factory.

tierforge_bp = Blueprint('tierforge', __name__)


# ------------------------------------------------------------------
# storage layout
#
# Every user gets a plain folder on disk:
#   <UPLOAD_ROOT>/<user_id>/<image_id>.orig   -- normalized "full" copy
#   <UPLOAD_ROOT>/<user_id>/<image_id>.thumb  -- small JPEG for on-screen display
#
# No DB table is needed for this: the image_id (a uuid4 hex, doubling as
# the filename) is the only handle the frontend needs. Which images
# belong to which tier lives entirely in the browser (IndexedDB autosave
# / exported .tierforge file) — this module is deliberately a dumb image
# store: upload in, thumbnail + full out, delete on request.
# ------------------------------------------------------------------
# Under instance/data/ (private) — NOT next to this file: the app folder is
# shared with the /apps/<name>/<file> route, so uploads there would be
# readable without the tierforge permission. Resolved lazily because the
# blueprint is imported before an app context exists.
_UPLOAD_ROOT_ENV = os.environ.get("TIERFORGE_UPLOAD_ROOT")


def _upload_root():
    return _UPLOAD_ROOT_ENV or os.path.join(
        current_app.instance_path, "data", "tierforge_uploads")


def _migrate_legacy_uploads():
    """The old location was inside this package (publicly reachable).
    Move any leftover files to the private root once, at first use."""
    legacy = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_uploads")
    if not os.path.isdir(legacy):
        return
    root = _upload_root()
    os.makedirs(root, exist_ok=True)
    for name in os.listdir(legacy):
        src, dst = os.path.join(legacy, name), os.path.join(root, name)
        try:
            if os.path.exists(dst):
                shutil.rmtree(src) if os.path.isdir(src) else os.remove(src)
            else:
                shutil.move(src, dst)
        except OSError:
            pass

# Thumbnails are what gets painted for every card, on every render and
# every drag — keep them small. "Full" is only decoded one image at a
# time (right-click preview, Save/export), so it can afford to be much
# bigger, but it's still re-encoded/capped rather than stored raw: a
# 4000x3000 phone photo serves just as well at 2400px on the long edge
# for on-screen viewing, at a fraction of the disk + transfer cost.
THUMB_MAX_DIM = 480
THUMB_QUALITY = 78
FULL_MAX_DIM = 2400
FULL_QUALITY = 90

MAX_IMAGE_PIXELS = 50_000_000      # decompression-bomb guard (decode only)
IMAGE_ID_RE = re.compile(r"^[0-9a-f]{32}$")

# TierMaker import caps — a big template can carry hundreds of items; keep
# the import bounded so a paste can't turn into an hours-long scrape.
MAX_IMPORT_ITEMS = 500

# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------

def _user_dir(user):
    _migrate_legacy_uploads()
    path = os.path.join(_upload_root(), str(user.id))
    os.makedirs(path, exist_ok=True)
    return path


def _safe_image_paths(user, image_id):
    """Resolve (orig_path, thumb_path) for image_id.

    Only accepts something that looks exactly like one of our own uuid4
    hex ids — anything else (including '../' traversal attempts) is
    rejected outright, before it ever touches the filesystem.
    """
    if not image_id or not IMAGE_ID_RE.match(image_id):
        return None, None
    base = _user_dir(user)
    return (
        os.path.join(base, f"{image_id}.orig"),
        os.path.join(base, f"{image_id}.thumb"),
    )


def _normalize_to_jpeg(image_bytes, max_dim, quality):
    """Decode with Pillow, fix EXIF rotation, flatten any transparency onto
    white (JPEG has no alpha channel), downscale to max_dim on the long
    edge, and re-encode as JPEG.

    Used for both the "full" copy and the thumbnail — same function,
    different max_dim/quality — so there's exactly one image-decoding
    path in this module to reason about, instead of two.
    """
    img = Image.open(io.BytesIO(image_bytes))
    # decompression-bomb guard: a tiny file can decode to a huge bitmap
    if img.width * img.height > MAX_IMAGE_PIXELS:
        raise ValueError("image dimensions too large")
    img = ImageOps.exif_transpose(img)

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")

    if img.width > max_dim or img.height > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _strip_ext(filename):
    return re.sub(r"\.[^.\\/]+$", "", filename or "image")


def _prettify_name(filename):
    """TierMaker item filename -> a presentable label. The API only hands
    out filenames ('adventurercookiepng.png'), so the name is a best-effort
    prettify: split camelCase/digit boundaries, drop a trailing format word,
    title-case. Lowercase concatenated words ('adventurercookiepng') can't
    be split without a dictionary — they get a capital first letter only."""
    stem = _strip_ext(filename or "")
    stem = stem.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+", stem)
    if len(parts) <= 1 and not parts[0][0].isupper():
        parts = [stem]
    if len(parts) == 1:
        trimmed = re.sub(r"(png|jpe?g|gif|webp)$", "", parts[0], flags=re.I)
        if trimmed:
            parts[0] = trimmed
    if parts and parts[-1].lower() in ("png", "jpg", "jpeg", "gif", "webp"):
        parts = parts[:-1]
    text = " ".join(p.capitalize() for p in parts).strip()
    return text[:120] or stem or "image"


def _prettify_title(slug):
    """Template slug -> a readable title: 'cookie-run-kingdom-cookies-
    tier-list-1325477' -> 'Cookie Run Kingdom Cookies Tier List'."""
    words = [w for w in re.split(r"[-_]", slug or "")
             if w and not w.isdigit()]
    return " ".join(w.capitalize() for w in words)[:200] or slug or "Imported list"


def _default_import_tiers():
    """The TierMaker API carries no tier labels/colors — a fresh template
    defaults to the familiar S–F ladder (mirrors TierForge's defaults)."""
    return [
        {"label": "S", "color": "#e63946"},
        {"label": "A", "color": "#f4a261"},
        {"label": "B", "color": "#e9c46a"},
        {"label": "C", "color": "#57cc99"},
        {"label": "D", "color": "#4ea8de"},
        {"label": "F", "color": "#6c757d"},
    ]


# ------------------------------------------------------------------
# routes
# ------------------------------------------------------------------

@tierforge_bp.route("/images", methods=["POST"])
@permission_required("tierforge", API)
def upload_images(user):
    """Accepts one or more files under the 'images' field in a single
    multipart POST (the frontend batches a whole file-picker selection
    into one request rather than one request per file — far fewer round
    trips for a big upload). For each file: normalize + thumbnail
    server-side and store both; the browser only ever gets URLs back,
    never image bytes it has to decode itself for the on-screen grid.
    """

    if not HAS_PIL:
        return jsonify({"error": "Pillow is not installed on the server"}), 500

    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "No images uploaded"}), 400

    user_dir = _user_dir(user)
    results = []
    errors = []

    for file in files:
        original_name = file.filename or "image"
        try:
            raw = file.read()
            if not raw:
                raise ValueError("empty file")

            full_bytes = _normalize_to_jpeg(raw, FULL_MAX_DIM, FULL_QUALITY)
            thumb_bytes = _normalize_to_jpeg(raw, THUMB_MAX_DIM, THUMB_QUALITY)

            image_id = uuid.uuid4().hex
            orig_path, thumb_path = _safe_image_paths(user, image_id)
            with open(orig_path, "wb") as f:
                f.write(full_bytes)
            with open(thumb_path, "wb") as f:
                f.write(thumb_bytes)

            results.append({
                "id": image_id,
                "name": _strip_ext(original_name),
                "thumbUrl": url_for("tierforge.get_image", image_id=image_id, variant="thumb"),
                "fullUrl": url_for("tierforge.get_image", image_id=image_id, variant="full"),
            })
        except Exception as exc:
            errors.append({"name": original_name, "error": str(exc)})

    status = 200 if results else 400
    return jsonify({"images": results, "errors": errors}), status


@tierforge_bp.route("/images/<image_id>/<variant>", methods=["GET"])
@permission_required("tierforge", API)
def get_image(user, image_id, variant):
    """Serves either the thumbnail or the full-resolution copy.

    Both are immutable once written (a fresh id is minted per upload, we
    never overwrite an existing one) so they're safe to cache hard on the
    client — this matters most for the thumbnail, since it's the one
    re-requested on every reload/reconnect.
    """

    if variant not in ("thumb", "full"):
        abort(404)

    orig_path, thumb_path = _safe_image_paths(user, image_id)
    if orig_path is None:
        abort(404)

    path = thumb_path if variant == "thumb" else orig_path
    if not os.path.isfile(path):
        abort(404)

    response = send_file(path, mimetype="image/jpeg", conditional=True)
    response.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return response


@tierforge_bp.route("/images/<image_id>", methods=["DELETE"])
@permission_required("tierforge", API)
def delete_image(user, image_id):
    """Removes both copies of an image. Called by the frontend whenever an
    image is actually removed (not just moved between tiers/pool) or when
    a loaded .tierforge file replaces the whole board — best-effort, so a
    missing file is not an error."""

    orig_path, thumb_path = _safe_image_paths(user, image_id)
    if orig_path is None:
        return jsonify({"error": "Invalid image id"}), 400

    for path in (orig_path, thumb_path):
        try:
            os.remove(path)
        except OSError:
            pass

    return jsonify({"status": "ok"})


# ------------------------------------------------------------------
# TierMaker import
#
# A template page (https://tiermaker.com/create/<slug>) is server-rendered
# without a login wall and carries two values in a script block:
#   baseTierImagePath = "/images/chart/chart/<slug>"
#   dateLastEdited    = "YYYY-MM-DD HH:MM:SS"
# The item list comes from a plain JSON API:
#   /api/?type=templates-v2&id=<slug>&lastEdited=<date>
# -> ["<slug>", "file1.png", "file2.png", ...]   (index 0 is the slug;
#    variation templates may use {"id","src"} objects instead of strings)
# Each filename is downloaded and pushed through the exact same normalize/
# thumbnail pipeline as an upload, so imported images are indistinguishable
# from uploaded ones to the rest of the app.
# ------------------------------------------------------------------

_IMPORT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/120.0 Safari/537.36")


@tierforge_bp.route("/import", methods=["POST"])
@permission_required("tierforge", API)
def import_tiermaker(user):
    if not HAS_PIL:
        return jsonify({"error": "Pillow is not installed on the server"}), 500

    payload = request.get_json(silent=True) or {}
    url = str(payload.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    # SSRF guard: only http(s) to tiermaker.com itself — the server will
    # follow this URL, so it must never point anywhere else.
    try:
        parsed = requests.utils.urlparse(url)
    except ValueError:
        parsed = None
    if parsed is None or parsed.scheme not in ("http", "https"):
        return jsonify({"error": "url must be an http(s) link"}), 400
    host = (parsed.hostname or "").lower()
    if host != "tiermaker.com" and not host.endswith(".tiermaker.com"):
        return jsonify({"error": "only tiermaker.com links are allowed"}), 400

    headers = {"User-Agent": _IMPORT_UA}
    try:
        resp = requests.get(url, timeout=15, headers=headers)
        resp.raise_for_status()
        html = resp.text
    except requests.RequestException:
        return jsonify({"error": "could not fetch that page"}), 502

    base_match = re.search(r'baseTierImagePath\s*=\s*"([^"]+)"', html)
    date_match = re.search(r'dateLastEdited\s*=\s*"([^"]*)"', html)
    if base_match is None or date_match is None:
        return jsonify({"error": "not a TierMaker template page"}), 400
    base_path = base_match.group(1).rstrip("/")
    slug = base_path.rsplit("/", 1)[-1]

    api_url = ("https://tiermaker.com/api/?type=templates-v2&id="
               + requests.utils.quote(slug) + "&lastEdited="
               + requests.utils.quote(date_match.group(1)) + "&variation=")
    try:
        resp = requests.get(api_url, timeout=15, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError):
        return jsonify({"error": "could not load the list data"}), 502

    filenames = []
    if isinstance(data, list):
        for entry in data[1:]:
            if isinstance(entry, str):
                filenames.append(entry)
            elif isinstance(entry, dict):
                src = entry.get("src")
                if src:
                    filenames.append(src)
    if not filenames:
        return jsonify({"error": "no images found in that list"}), 400
    filenames = filenames[:MAX_IMPORT_ITEMS]

    user_dir = _user_dir(user)
    results, errors = [], []
    for filename in filenames:
        try:
            if filename.startswith("http://") or filename.startswith("https://"):
                image_url = filename
            else:
                image_url = "https://tiermaker.com" + base_path + "/" + filename
            r = requests.get(image_url, timeout=15, headers=headers)
            r.raise_for_status()
            raw = r.content
            if not raw:
                raise ValueError("empty file")

            full_bytes = _normalize_to_jpeg(raw, FULL_MAX_DIM, FULL_QUALITY)
            thumb_bytes = _normalize_to_jpeg(raw, THUMB_MAX_DIM, THUMB_QUALITY)

            image_id = uuid.uuid4().hex
            orig_path, thumb_path = _safe_image_paths(user, image_id)
            with open(orig_path, "wb") as f:
                f.write(full_bytes)
            with open(thumb_path, "wb") as f:
                f.write(thumb_bytes)

            results.append({
                "id": image_id,
                "name": _prettify_name(filename),
                "thumbUrl": url_for("tierforge.get_image",
                                    image_id=image_id, variant="thumb"),
                "fullUrl": url_for("tierforge.get_image",
                                   image_id=image_id, variant="full"),
            })
        except Exception as exc:
            errors.append({"name": filename, "error": str(exc)})

    if not results:
        return jsonify({"error": "none of the images could be imported",
                        "errors": errors}), 400

    return jsonify({
        "title": _prettify_title(slug),
        "tiers": _default_import_tiers(),
        "pool": results,
        "errors": errors,
    })