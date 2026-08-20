import io
import os
import re
import uuid

from flask import Blueprint, request, jsonify, redirect, url_for, send_file, abort

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from ...models import Session

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
UPLOAD_ROOT = os.environ.get(
    "TIERFORGE_UPLOAD_ROOT",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "_uploads"),
)

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

MAX_IMAGE_BYTES = 15 * 1024 * 1024  # 15 MB per uploaded file
IMAGE_ID_RE = re.compile(r"^[0-9a-f]{32}$")


# ------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------

def _require_user():
    """Returns the logged-in User, or None if the session is invalid."""
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return None
    return user


def _user_dir(user):
    path = os.path.join(UPLOAD_ROOT, str(user.id))
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


# ------------------------------------------------------------------
# routes
# ------------------------------------------------------------------

@tierforge_bp.route("/images", methods=["POST"])
def upload_images():
    """Accepts one or more files under the 'images' field in a single
    multipart POST (the frontend batches a whole file-picker selection
    into one request rather than one request per file — far fewer round
    trips for a big upload). For each file: normalize + thumbnail
    server-side and store both; the browser only ever gets URLs back,
    never image bytes it has to decode itself for the on-screen grid.
    """
    user = _require_user()
    if user is None:
        return jsonify({"error": "Not authenticated"}), 401

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
            if len(raw) > MAX_IMAGE_BYTES:
                raise ValueError("file too large (max 15 MB)")

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
def get_image(image_id, variant):
    """Serves either the thumbnail or the full-resolution copy.

    Both are immutable once written (a fresh id is minted per upload, we
    never overwrite an existing one) so they're safe to cache hard on the
    client — this matters most for the thumbnail, since it's the one
    re-requested on every reload/reconnect.
    """
    user = _require_user()
    if user is None:
        return jsonify({"error": "Not authenticated"}), 401

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
def delete_image(image_id):
    """Removes both copies of an image. Called by the frontend whenever an
    image is actually removed (not just moved between tiers/pool) or when
    a loaded .tierforge file replaces the whole board — best-effort, so a
    missing file is not an error."""
    user = _require_user()
    if user is None:
        return jsonify({"error": "Not authenticated"}), 401

    orig_path, thumb_path = _safe_image_paths(user, image_id)
    if orig_path is None:
        return jsonify({"error": "Invalid image id"}), 400

    for path in (orig_path, thumb_path):
        try:
            os.remove(path)
        except OSError:
            pass

    return jsonify({"status": "ok"})