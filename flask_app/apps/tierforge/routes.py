import io
import os
import re
import secrets
import shutil
import threading
import time
import uuid
import zipfile
from datetime import datetime, timedelta

import requests

from flask import Blueprint, request, jsonify, redirect, url_for, send_file, abort, current_app

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

from ... import db
from ...models import (
    Session, User, TierForgeSession, TierForgeSessionMember,
)
from ...auth.decorators import login_required, permission_required, API
from ...notifications import notify_user

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

# ZIP upload caps — "Upload images" also accepts an archive full of images.
# The archive is expanded in memory (never extracted to disk), every entry
# still goes through the normal normalize/thumbnail pipeline, and these
# caps bound a malicious archive: entry count + uncompressed byte totals
# (zip bomb), plus the per-image pixel cap above.
ZIP_MAGIC = b"PK\x03\x04"
MAX_ZIP_ENTRIES = 500
MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024          # 50 MB per file
MAX_ZIP_TOTAL_BYTES = 250 * 1024 * 1024         # 250 MB per archive
ZIP_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp",
                  ".bmp", ".tif", ".tiff")

# TierMaker import caps — a big template can carry hundreds of items; keep
# the import bounded so a paste can't turn into an hours-long scrape.
MAX_IMPORT_ITEMS = 500

# Multiplayer session caps. A session board is client-authored JSON, so
# everything that goes into it is re-validated and bounded here.
SESSION_MODES = ("coop", "split")
SESSION_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_SESSION_IMAGES = 1000
MAX_SESSION_TIERS = 60
MAX_SESSION_TITLE = 80
TIER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_SESSION_REMOVE = 200

# Member caps per mode (host included). Split-screen is designed for three
# people; co-op is a shared board that stays usable up to ten.
SESSION_MAX_MEMBERS = {"coop": 10, "split": 3}

# Image sizes selectable inside a session. The setting is shared by the
# whole session (stored on the board), unlike the local-only prefs.
SESSION_IMAGE_SIZES = (72, 120, 180, 260)
DEFAULT_SESSION_SETTINGS = {"poolImgSize": 120, "tierImgSize": 120}

# Open sessions with no join/board activity for this long are auto-ended
# lazily when any token holder touches them (see _maybe_end_idle).
SESSION_IDLE_TTL = timedelta(hours=6)

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


def _store_image(user, raw, original_name):
    """Normalize + thumbnail one image and write both copies, returning the
    API result entry. The single write path shared by uploads and ZIP
    entries; PIL re-encoding is the real content check (extension/MIME is
    never trusted)."""
    full_bytes = _normalize_to_jpeg(raw, FULL_MAX_DIM, FULL_QUALITY)
    thumb_bytes = _normalize_to_jpeg(raw, THUMB_MAX_DIM, THUMB_QUALITY)

    image_id = uuid.uuid4().hex
    orig_path, thumb_path = _safe_image_paths(user, image_id)
    with open(orig_path, "wb") as f:
        f.write(full_bytes)
    with open(thumb_path, "wb") as f:
        f.write(thumb_bytes)

    # Display name is basename-only (same rule as ZIP entries); the stored
    # filename is our uuid either way.
    display_name = re.split(r"[\\/]", original_name or "")[-1] or "image"

    return {
        "id": image_id,
        "name": _strip_ext(display_name),
        "thumbUrl": url_for("tierforge.get_image", image_id=image_id, variant="thumb"),
        "fullUrl": url_for("tierforge.get_image", image_id=image_id, variant="full"),
    }


def _is_zip(raw):
    # Magic bytes, not the filename extension: a renamed file still gets
    # treated correctly, and a fake .zip that isn't one falls through to
    # the normal image path (and fails there).
    return raw[:4] == ZIP_MAGIC


def _safe_zip_entry_name(name):
    """Return a safe basename for an image entry, or None to skip it.

    Nothing is ever extracted to disk (entries are read into memory and
    stored under our own uuid filenames), so this is defense-in-depth:
    reject traversal/absolute paths, directories, hidden/resource-fork
    junk (__MACOSX, ._*, .DS_Store) and non-image extensions."""
    normalized = (name or "").replace("\\", "/")
    if not normalized or normalized.endswith("/"):
        return None
    if "__MACOSX/" in normalized or normalized.startswith("__MACOSX"):
        return None
    # Zip-slip / absolute-path / drive-letter shapes
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        return None
    if any(part == ".." for part in normalized.split("/")):
        return None
    base = normalized.rsplit("/", 1)[-1]
    if base in ("", ".", "..") or base.startswith("."):
        return None
    if "\x00" in base or ":" in base:
        return None
    if not base.lower().endswith(ZIP_IMAGE_EXTS):
        return None
    return base


def _expand_zip(user, raw):
    """Expand an in-memory archive into stored images.

    Returns (results, errors) in the same shape as the upload loop. Caps:
    entry count, per-entry size and total uncompressed size are checked
    from the central directory AND enforced on the actual read (a lying
    header must not be able to inflate memory)."""
    results, errors = [], []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            if len(entries) > MAX_ZIP_ENTRIES:
                return [], [{
                    "name": "archive.zip",
                    "error": f"too many files (max {MAX_ZIP_ENTRIES})",
                }]

            declared_total = 0
            read_total = 0
            for info in entries:
                name = _safe_zip_entry_name(info.filename)
                if name is None:
                    continue
                if info.file_size > MAX_ZIP_ENTRY_BYTES:
                    errors.append({"name": name, "error": "file too large"})
                    continue
                declared_total += info.file_size
                if declared_total > MAX_ZIP_TOTAL_BYTES:
                    errors.append({"name": name,
                                   "error": "archive exceeds the size limit"})
                    break
                try:
                    # +1 byte detects an entry that lies about its size
                    with archive.open(info) as fh:
                        entry = fh.read(MAX_ZIP_ENTRY_BYTES + 1)
                    if len(entry) > MAX_ZIP_ENTRY_BYTES:
                        raise ValueError("file too large")
                    if not entry:
                        raise ValueError("empty file")
                    # Enforce the total on the bytes actually read too — the
                    # central directory's file_size can lie.
                    read_total += len(entry)
                    if read_total > MAX_ZIP_TOTAL_BYTES:
                        errors.append({"name": name,
                                       "error": "archive exceeds the size limit"})
                        break
                    results.append(_store_image(user, entry, name))
                except Exception as exc:
                    errors.append({"name": name, "error": str(exc)})
    except zipfile.BadZipFile:
        errors.append({"name": "archive.zip", "error": "invalid zip file"})
    if not results and not errors:
        # Nothing usable in the archive (only folders/non-images, or empty):
        # report it instead of silently adding zero images.
        errors.append({
            "name": "archive.zip",
            "error": "no valid images found in the archive",
        })
    return results, errors


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
# multiplayer sessions
#
# A session is a capability link (the 32-char token) plus a client-authored
# board. The board shape:
#   catalog -- shared image refs [{id, owner, name}]
#   coop    -- {"tiers": [...], "pool": [refs]} for one-screen editing
#   split   -- {user_id: {"tiers": [...], "pool_order": [refs]}} for
#              split-screen editing: same image set, one ranking per member
#
# Every write carries the client's base_version; a mismatch answers 409 with
# the current state. The client re-pulls for the fresh version and retries
# once, so concurrent edits resolve as whole-board last-write-wins rather
# than interleaving two people's drags into a broken board.
# ------------------------------------------------------------------

def _clean_wire_ref(raw):
    """Validate/trim one {id, owner, name} image reference, or None."""
    if not isinstance(raw, dict):
        return None
    image_id = str(raw.get("id") or "")
    if not IMAGE_ID_RE.match(image_id):
        return None
    try:
        owner = int(raw.get("owner"))
    except (TypeError, ValueError):
        return None
    if owner <= 0:
        return None
    name = str(raw.get("name") or "image")[:200]
    return {"id": image_id, "owner": owner, "name": name}


def _clean_catalog(raw):
    """Validated, de-duplicated catalog list (None for a malformed value)."""
    if not isinstance(raw, list):
        return None
    out, seen = [], set()
    for entry in raw[:MAX_SESSION_IMAGES]:
        ref = _clean_wire_ref(entry)
        if ref is None:
            continue
        key = (ref["owner"], ref["id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(ref)
    return out


def _clean_ref_list(raw):
    if not isinstance(raw, list):
        return None
    out = []
    for entry in raw[:MAX_SESSION_IMAGES]:
        ref = _clean_wire_ref(entry)
        if ref is not None:
            out.append(ref)
    return out


def _clean_tiers(raw):
    if not isinstance(raw, list):
        return None
    out = []
    seen_ids = set()
    for idx, tier in enumerate(raw[:MAX_SESSION_TIERS]):
        if not isinstance(tier, dict):
            continue
        label = str(tier.get("label") or "?")[:4].upper() or "?"
        color = str(tier.get("color") or "#6c757d")
        if not HEX_COLOR_RE.match(color):
            color = "#6c757d"
        tier_id = str(tier.get("id") or "")
        if not TIER_ID_RE.match(tier_id) or tier_id in seen_ids:
            tier_id = f"t{idx}"
            while tier_id in seen_ids:
                tier_id += "_"
        seen_ids.add(tier_id)
        images = _clean_ref_list(tier.get("images")) or []
        out.append({
            "id": tier_id,
            "label": label,
            "color": color,
            "images": images,
        })
    return out


def _clean_session_settings(raw):
    """Validated shared session image sizes; unknown/invalid values fall
    back to the defaults so a bad push can't break every member's board."""
    settings = dict(DEFAULT_SESSION_SETTINGS)
    if not isinstance(raw, dict):
        return settings
    for key in ("poolImgSize", "tierImgSize"):
        try:
            value = int(raw.get(key))
        except (TypeError, ValueError):
            continue
        if value in SESSION_IMAGE_SIZES:
            settings[key] = value
    return settings


def _session_member_count(session, statuses=("active",)):
    return TierForgeSessionMember.query.filter(
        TierForgeSessionMember.session_id == session.id,
        TierForgeSessionMember.status.in_(statuses)).count()


def _session_member_cap(session):
    return SESSION_MAX_MEMBERS.get(session.mode, SESSION_MAX_MEMBERS["coop"])


def _merge_catalog(catalog, tiers, pool):
    """Build the shared image set: the incoming catalog plus every ref still
    placed on a board (so a client that omits the catalog can't lose images).
    Insertion order is preserved (catalog first, then new refs)."""
    seen = {}
    for ref in (catalog or []):
        seen.setdefault((ref["owner"], ref["id"]), ref)
    for tier in (tiers or []):
        for ref in tier.get("images") or []:
            seen.setdefault((ref["owner"], ref["id"]), ref)
    for ref in (pool or []):
        seen.setdefault((ref["owner"], ref["id"]), ref)
    return list(seen.values())


def _catalog_keys(catalog):
    return {(ref["owner"], ref["id"]) for ref in catalog}


def _only_in_catalog(refs, catalog_keys):
    return [ref for ref in refs
            if (ref["owner"], ref["id"]) in catalog_keys]


def _without(refs, exclude_keys):
    return [ref for ref in refs
            if (ref["owner"], ref["id"]) not in exclude_keys]


def _get_session_by_token(token):
    if not token or not SESSION_TOKEN_RE.match(token):
        return None
    session = TierForgeSession.query.filter_by(token=token).first()
    if session is not None:
        _maybe_end_idle(session)
    return session


def _session_member_row(session, user):
    return TierForgeSessionMember.query.filter_by(
        session_id=session.id, user_id=user.id).first()


def _active_member(session, user):
    member = _session_member_row(session, user)
    if member is None or member.status != "active":
        return None
    return member


def _require_open_host_session(user, token):
    """Shared guard for host-only membership management endpoints."""
    session = _get_session_by_token(token)
    if session is None:
        return None, (jsonify({"error": "session not found"}), 404)
    if session.host_id != user.id:
        return None, (jsonify({"error": "only the host can manage members"}),
                      403)
    if session.status != "open":
        return None, (jsonify({"error": "this session has ended",
                               "session": _session_dict(session)}), 410)
    return session, None


def _session_dict(session):
    rows = sorted(
        session.members,
        key=lambda m: (m.role != "host",
                       m.joined_at or datetime.min, m.id),
    )
    members = []
    pending = []
    for row in rows:
        if row.status == "pending":
            pending.append({
                "userId": row.user_id,
                "username": (row.user.username if row.user
                             else f"user {row.user_id}"),
            })
            continue
        if row.status != "active":
            continue
        members.append({
            "userId": row.user_id,
            "username": row.user.username if row.user else f"user {row.user_id}",
            "role": row.role,
        })
    return {
        "token": session.token,
        "mode": session.mode,
        "title": session.title,
        "status": session.status,
        "version": session.version,
        "hostId": session.host_id,
        "members": members,
        "pending": pending,
        "board": session.board or {},
    }


def _bump_session(session, board):
    session.board = board
    session.version = (session.version or 0) + 1
    session.updated_at = db.func.now()


def _maybe_end_idle(session):
    """Lazily end a session with no join/board activity for SESSION_IDLE_TTL.

    Called by every session route so abandoned open sessions disappear
    without a scheduler."""
    if session.status != "open":
        return False
    last = session.updated_at or session.created_at
    if last is None or datetime.utcnow() - last < SESSION_IDLE_TTL:
        return False
    session.status = "ended"
    session.version = (session.version or 0) + 1
    session.updated_at = db.func.now()
    db.session.commit()
    return True


def _session_references_image(session, owner_id, image_id):
    """The image route only serves bytes that are actually part of the
    session board — a member can't walk the upload tree with guessed ids."""
    board = session.board or {}

    def refs():
        for ref in board.get("catalog") or []:
            yield ref
        coop = board.get("coop") or {}
        for tier in coop.get("tiers") or []:
            for ref in tier.get("images") or []:
                yield ref
        for ref in coop.get("pool") or []:
            yield ref
        for entry in (board.get("split") or {}).values():
            if not isinstance(entry, dict):
                continue
            for tier in entry.get("tiers") or []:
                for ref in tier.get("images") or []:
                    yield ref
            for ref in entry.get("pool_order") or []:
                yield ref

    for ref in refs():
        if not isinstance(ref, dict) or ref.get("id") != image_id:
            continue
        try:
            if int(ref.get("owner")) == owner_id:
                return True
        except (TypeError, ValueError):
            continue
    return False


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

            if _is_zip(raw):
                zip_results, zip_errors = _expand_zip(user, raw)
                results.extend(zip_results)
                errors.extend(zip_errors)
            else:
                results.append(_store_image(user, raw, original_name))
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


@tierforge_bp.route("/sessions", methods=["POST"])
@permission_required("tierforge", API)
def create_session(user):
    """Start a multiplayer session from the caller's current board. The
    invite link is the returned token — holding it = direct join."""
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode")
    if mode not in SESSION_MODES:
        return jsonify({"error": "mode must be 'coop' or 'split'"}), 400

    title = str(payload.get("title") or "").strip()[:MAX_SESSION_TITLE]
    title = title or "TierForge session"

    catalog = _clean_catalog(payload.get("catalog")) or []
    tiers = _clean_tiers(payload.get("tiers")) or []
    pool = _clean_ref_list(payload.get("pool")) or []
    catalog = _merge_catalog(catalog, tiers, pool)
    catalog_keys = _catalog_keys(catalog)
    # keep the tier structure but drop refs that aren't in the catalog
    for tier in tiers:
        tier["images"] = _only_in_catalog(tier["images"], catalog_keys)
    pool = _only_in_catalog(pool, catalog_keys)

    board = {
        "catalog": catalog,
        "coop": None,
        "split": {},
        "settings": _clean_session_settings(payload.get("settings")),
    }
    if mode == "coop":
        board["coop"] = {"tiers": tiers, "pool": pool}
    else:
        board["split"][str(user.id)] = {
            "tiers": tiers,
            "pool_order": pool,
        }

    session = TierForgeSession(
        token=secrets.token_hex(16),
        host_id=user.id,
        mode=mode,
        title=title,
        status="open",
        version=1,
        board=board,
    )
    db.session.add(session)
    db.session.flush()
    db.session.add(TierForgeSessionMember(
        session_id=session.id, user_id=user.id,
        role="host", status="active"))
    db.session.commit()
    return jsonify(_session_dict(session)), 201


@tierforge_bp.route("/sessions/<token>", methods=["GET"])
@permission_required("tierforge", API)
def get_session(user, token):
    """Poll endpoint: current board + metadata for any member. Ended
    sessions stay readable so clients can show the final state."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if _active_member(session, user) is None:
        return jsonify({"error": "not a member of this session"}), 403
    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/join", methods=["POST"])
@permission_required("tierforge", API)
def join_session(user, token):
    """Direct join via invite link; idempotent for existing members."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if session.status != "open":
        return jsonify({"error": "this session has ended"}), 410

    member = _session_member_row(session, user)
    if member is None:
        if _session_member_count(session) >= _session_member_cap(session):
            return jsonify({"error": "this session is full"}), 409
        db.session.add(TierForgeSessionMember(
            session_id=session.id, user_id=user.id,
            role="member", status="active"))
        if session.mode == "split":
            board = dict(session.board or {})
            split = dict(board.get("split") or {})
            split.setdefault(str(user.id), {"tiers": [], "pool_order": []})
            board["split"] = split
            _bump_session(session, board)
        else:
            session.version = (session.version or 0) + 1
            session.updated_at = db.func.now()
        db.session.commit()
    elif member.status == "pending":
        return jsonify({"error": "Your invite is waiting for host approval"}), 403
    elif member.status != "active":
        # Leaving frees the seat; re-opening the same invite link may take it
        # back, subject to the same cap as a fresh join.
        if _session_member_count(session) >= _session_member_cap(session):
            return jsonify({"error": "this session is full"}), 409
        member.status = "active"
        if session.mode == "split":
            board = dict(session.board or {})
            split = dict(board.get("split") or {})
            split.setdefault(str(user.id), {"tiers": [], "pool_order": []})
            board["split"] = split
            _bump_session(session, board)
        else:
            session.version = (session.version or 0) + 1
            session.updated_at = db.func.now()
        db.session.commit()

    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/invite", methods=["POST"])
@permission_required("tierforge", API)
def invite_session_member(user, token):
    """Host invites a friend straight into the session (no approval step)."""
    session, error = _require_open_host_session(user, token)
    if error is not None:
        return error

    payload = request.get_json(silent=True) or {}
    try:
        friend_id = int(payload.get("user_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "user_id is required"}), 400
    if friend_id == user.id:
        return jsonify({"error": "you cannot invite yourself"}), 400
    friend = db.session.get(User, friend_id)
    if friend is None:
        return jsonify({"error": "user not found"}), 404
    if friend_id not in {f.id for f in user.friends}:
        return jsonify({"error": "you can only invite friends"}), 403
    if _session_member_row(session, friend) is not None:
        return jsonify({"error": "already invited or a member"}), 409
    if _session_member_count(session, ("active", "pending")) >= \
            _session_member_cap(session):
        return jsonify({"error": "this session is full"}), 409

    # Friend invites join directly: the host explicitly picked this friend,
    # so there is no second approval step. The notification carries a
    # one-click join action instead.
    db.session.add(TierForgeSessionMember(
        session_id=session.id, user_id=friend.id,
        role="member", status="active"))
    # Being invited grants access to the TierForge app itself.
    if not friend.has_permission("tierforge"):
        friend.grant_permission("tierforge")
    if session.mode == "split":
        board = dict(session.board or {})
        split = dict(board.get("split") or {})
        split.setdefault(str(friend.id), {"tiers": [], "pool_order": []})
        board["split"] = split
        _bump_session(session, board)
    else:
        session.version = (session.version or 0) + 1
        session.updated_at = db.func.now()
    db.session.commit()
    notify_user(friend, "tierforge_join_request", payload={
        "actor": user.username,
        "session_title": session.title,
        "session_token": session.token,
    })
    return jsonify(_session_dict(session))


@tierforge_bp.route(
    "/sessions/<token>/members/<int:member_user_id>/approve",
    methods=["POST"])
@permission_required("tierforge", API)
def approve_session_member(user, token, member_user_id):
    """Host turns a pending invite into an active membership."""
    session, error = _require_open_host_session(user, token)
    if error is not None:
        return error

    member = TierForgeSessionMember.query.filter_by(
        session_id=session.id, user_id=member_user_id).first()
    if member is None:
        return jsonify({"error": "invite not found"}), 404
    if member.status == "active":
        return jsonify({"error": "already a member"}), 409
    if _session_member_count(session) >= _session_member_cap(session):
        return jsonify({"error": "this session is full"}), 409

    member.status = "active"
    if session.mode == "split":
        board = dict(session.board or {})
        split = dict(board.get("split") or {})
        split.setdefault(str(member_user_id), {"tiers": [], "pool_order": []})
        board["split"] = split
        _bump_session(session, board)
    else:
        session.version = (session.version or 0) + 1
        session.updated_at = db.func.now()
    db.session.commit()
    if member.user is not None:
        notify_user(member.user, "tierforge_invite_approved", payload={
            "actor": user.username,
            "session_title": session.title,
            "session_token": session.token,
        })
    return jsonify(_session_dict(session))


@tierforge_bp.route(
    "/sessions/<token>/members/<int:member_user_id>/deny",
    methods=["POST"])
@permission_required("tierforge", API)
def deny_session_member(user, token, member_user_id):
    """Host declines a pending invite."""
    session, error = _require_open_host_session(user, token)
    if error is not None:
        return error

    member = TierForgeSessionMember.query.filter_by(
        session_id=session.id, user_id=member_user_id).first()
    if member is None:
        return jsonify({"error": "invite not found"}), 404
    if member.status == "active":
        return jsonify({"error": "cannot deny an active member"}), 400

    invited_user = member.user
    db.session.delete(member)
    session.version = (session.version or 0) + 1
    session.updated_at = db.func.now()
    db.session.commit()
    if invited_user is not None:
        notify_user(invited_user, "tierforge_invite_denied", payload={
            "actor": user.username,
            "session_title": session.title,
        })
    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/board", methods=["POST"])
@permission_required("tierforge", API)
def push_session_board(user, token):
    """Replace this member's view of the board (whole-board LWW)."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if _active_member(session, user) is None:
        return jsonify({"error": "not a member of this session"}), 403
    if session.status != "open":
        return jsonify({"error": "this session has ended",
                        "session": _session_dict(session)}), 410

    payload = request.get_json(silent=True) or {}
    try:
        base_version = int(payload.get("base_version"))
    except (TypeError, ValueError):
        return jsonify({"error": "base_version is required"}), 400
    if base_version != session.version:
        return jsonify({"error": "stale board",
                        "session": _session_dict(session)}), 409

    board = dict(session.board or {})
    incoming_catalog = _clean_catalog(payload.get("catalog")) or []
    existing_catalog = _clean_catalog(board.get("catalog")) or []
    tombstones = _catalog_keys(_clean_catalog(board.get("removed")) or [])

    # Pushes only ever ADD to the shared catalogue: both modes union the
    # existing set with what the pusher sent, then drop tombstoned images.
    # Deletions go through the remove endpoint, so a member with a stale
    # board can neither lose nor resurrect another member's images.
    if session.mode == "coop":
        incoming_tiers = _clean_tiers(payload.get("tiers")) or []
        incoming_pool = _clean_ref_list(payload.get("pool")) or []
        if user.id == session.host_id:
            tiers = incoming_tiers
            pool = incoming_pool
        else:
            # Guests may only re-arrange images: keep the host's tier
            # structure (ids/labels/colors/order) and adopt the guest's
            # placement. This also stops a stale guest board from wiping a
            # tier the host just added.
            existing_tiers = _clean_tiers(
                (board.get("coop") or {}).get("tiers")) or []
            placement = {tier["id"]: tier["images"]
                         for tier in incoming_tiers}
            tiers = [
                {**tier, "images": placement.get(tier["id"], tier["images"])}
                for tier in existing_tiers
            ]
            pool = incoming_pool
        catalog = _merge_catalog(existing_catalog + incoming_catalog,
                                 tiers, pool)
        catalog = _without(catalog, tombstones)
        catalog_keys = _catalog_keys(catalog)
        for tier in tiers:
            tier["images"] = _only_in_catalog(tier["images"], catalog_keys)
        pool = _only_in_catalog(pool, catalog_keys)
        # Every catalog image must be either ranked or unranked, otherwise
        # a stale push could leave an image invisible on the shared board.
        tier_keys = _catalog_keys(
            [ref for tier in tiers for ref in tier["images"]])
        pool_keys = _catalog_keys(pool)
        for ref in catalog:
            key = (ref["owner"], ref["id"])
            if key not in tier_keys and key not in pool_keys:
                pool.append(ref)
                pool_keys.add(key)
        board["catalog"] = catalog
        board["coop"] = {
            "tiers": tiers,
            "pool": pool,
        }
    else:
        tiers = _clean_tiers(payload.get("my_tiers")) or []
        pool_order = _clean_ref_list(payload.get("my_pool_order")) or []
        catalog = _merge_catalog(existing_catalog + incoming_catalog, tiers,
                                 pool_order)
        catalog = _without(catalog, tombstones)
        catalog_keys = _catalog_keys(catalog)
        for tier in tiers:
            tier["images"] = _only_in_catalog(tier["images"], catalog_keys)
        board["catalog"] = catalog
        split = dict(board.get("split") or {})
        split[str(user.id)] = {
            "tiers": tiers,
            "pool_order": _only_in_catalog(pool_order, catalog_keys),
        }
        board["split"] = split

    if "settings" in payload:
        board["settings"] = _clean_session_settings(payload.get("settings"))
    else:
        board.setdefault("settings", dict(DEFAULT_SESSION_SETTINGS))

    _bump_session(session, board)
    db.session.commit()
    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/settings", methods=["POST"])
@permission_required("tierforge", API)
def update_session_settings(user, token):
    """Update the shared image sizes. Any active member may change them;
    every other member adopts the new values on their next poll."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if _active_member(session, user) is None:
        return jsonify({"error": "not a member of this session"}), 403
    if session.status != "open":
        return jsonify({"error": "this session has ended",
                        "session": _session_dict(session)}), 410

    payload = request.get_json(silent=True) or {}
    board = dict(session.board or {})
    board["settings"] = _clean_session_settings(payload)
    _bump_session(session, board)
    db.session.commit()
    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/remove", methods=["POST"])
@permission_required("tierforge", API)
def remove_session_images(user, token):
    """Delete images from the shared pool for everyone.

    Host-only in both modes (the host curates the shared catalogue; guests
    arrange images). Every removal is tombstoned in the board JSON, which
    lets ordinary pushes stay add-only — a member with a stale board can
    never resurrect a deleted image."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if _active_member(session, user) is None:
        return jsonify({"error": "not a member of this session"}), 403
    if session.status != "open":
        return jsonify({"error": "this session has ended",
                        "session": _session_dict(session)}), 410
    if session.host_id != user.id:
        return jsonify({"error": "only the host can delete shared images"}), 403

    payload = request.get_json(silent=True) or {}
    refs = (_clean_catalog(payload.get("refs")) or [])[:MAX_SESSION_REMOVE]
    if not refs:
        return jsonify({"error": "no images to remove"}), 400

    board = dict(session.board or {})
    removed = _merge_catalog(
        (_clean_catalog(board.get("removed")) or []) + refs, None, None)
    removed = removed[:MAX_SESSION_IMAGES]
    removed_keys = _catalog_keys(removed)

    board["removed"] = removed
    board["catalog"] = _without(
        _clean_catalog(board.get("catalog")) or [], removed_keys)

    coop = board.get("coop")
    if isinstance(coop, dict):
        board["coop"] = {
            "tiers": [
                {**tier,
                 "images": _without(tier.get("images") or [], removed_keys)}
                for tier in coop.get("tiers") or []
            ],
            "pool": _without(coop.get("pool") or [], removed_keys),
        }

    split = board.get("split")
    if isinstance(split, dict):
        clean_split = {}
        for uid, entry in split.items():
            if not isinstance(entry, dict):
                continue
            clean_split[uid] = {
                "tiers": [
                    {**tier,
                     "images": _without(tier.get("images") or [],
                                        removed_keys)}
                    for tier in entry.get("tiers") or []
                ],
                "pool_order": _without(entry.get("pool_order") or [],
                                       removed_keys),
            }
        board["split"] = clean_split

    _bump_session(session, board)
    db.session.commit()
    return jsonify(_session_dict(session))


@tierforge_bp.route("/sessions/<token>/leave", methods=["POST"])
@permission_required("tierforge", API)
def leave_session(user, token):
    """Members leave on their own; only the host can end the session."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    member = _session_member_row(session, user)
    if member is None:
        return jsonify({"error": "not a member of this session"}), 403
    if member.role == "host":
        return jsonify({"error": "the host must end the session"}), 400

    db.session.delete(member)
    if session.mode == "split":
        board = dict(session.board or {})
        split = dict(board.get("split") or {})
        if split.pop(str(user.id), None) is not None:
            board["split"] = split
            _bump_session(session, board)
        else:
            session.version = (session.version or 0) + 1
            session.updated_at = db.func.now()
    else:
        session.version = (session.version or 0) + 1
        session.updated_at = db.func.now()
    db.session.commit()
    return jsonify({"status": "ok"})


@tierforge_bp.route("/sessions/<token>/end", methods=["POST"])
@permission_required("tierforge", API)
def end_session(user, token):
    """Host ends the session for everyone; the row is retained (read-only
    final state) instead of deleted."""
    session = _get_session_by_token(token)
    if session is None:
        return jsonify({"error": "session not found"}), 404
    if session.host_id != user.id:
        return jsonify({"error": "only the host can end the session"}), 403
    if session.status != "ended":
        session.status = "ended"
        session.version = (session.version or 0) + 1
        db.session.commit()
    return jsonify(_session_dict(session))


@tierforge_bp.route(
    "/sessions/<token>/images/<int:owner_id>/<image_id>/<variant>",
    methods=["GET"])
@permission_required("tierforge", API)
def get_session_image(user, token, owner_id, image_id, variant):
    """Serve a member's image to every other member of the session.

    The regular image route is ownership-scoped (requester's own folder),
    which can't work for a shared board. This route resolves the owner's
    folder explicitly and only serves ids that appear in the session board,
    so membership + a real board reference are both required."""
    if variant not in ("thumb", "full"):
        abort(404)
    session = _get_session_by_token(token)
    if session is None:
        abort(404)
    if _active_member(session, user) is None:
        abort(403)
    if not image_id or not IMAGE_ID_RE.match(image_id):
        abort(404)
    if not _session_references_image(session, owner_id, image_id):
        abort(404)

    suffix = "thumb" if variant == "thumb" else "orig"
    path = os.path.join(_upload_root(), str(owner_id), f"{image_id}.{suffix}")
    if not os.path.isfile(path):
        abort(404)

    response = send_file(path, mimetype="image/jpeg", conditional=True)
    response.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return response


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

# In-memory progress for async TierMaker imports. waitress runs a single
# process, so a module-level dict is shared by every worker thread; jobs
# expire on their own so an abandoned import cannot leak memory.
_IMPORT_JOBS = {}
_IMPORT_JOBS_LOCK = threading.Lock()
_IMPORT_JOB_TTL = 600.0


def _new_import_job(user_id, total):
    job_id = uuid.uuid4().hex
    now = time.time()
    with _IMPORT_JOBS_LOCK:
        for jid, job in list(_IMPORT_JOBS.items()):
            if now - job.get("updated", now) > _IMPORT_JOB_TTL:
                _IMPORT_JOBS.pop(jid, None)
        _IMPORT_JOBS[job_id] = {
            "user_id": user_id,
            "total": total,
            "done": 0,
            "status": "working",
            "result": None,
            "error": None,
            "errors": [],
            "updated": now,
        }
    return job_id


def _bump_import_job(job_id):
    with _IMPORT_JOBS_LOCK:
        job = _IMPORT_JOBS.get(job_id)
        if job is not None:
            job["done"] = min(job["total"], job["done"] + 1)
            job["updated"] = time.time()


def _finish_import_job(job_id, result=None, error=None, errors=None):
    with _IMPORT_JOBS_LOCK:
        job = _IMPORT_JOBS.get(job_id)
        if job is None:
            return
        job["done"] = job["total"]
        job["updated"] = time.time()
        if error:
            job["status"] = "error"
            job["error"] = error
            job["errors"] = errors or []
        else:
            job["status"] = "done"
            job["result"] = result or {}


def _run_import_job(app, job_id, user_id, filenames, base_path, slug):
    """Download + process the template images in a background thread.

    A request context is gone by the time this runs, so it pushes its own
    app context; image URLs are built by hand because url_for() would need
    a request context."""
    try:
        with app.app_context():
            user = db.session.get(User, user_id)
            if user is None:
                _finish_import_job(job_id, error="user no longer exists")
                return
            headers = {"User-Agent": _IMPORT_UA}
            _user_dir(user)
            results, errors = [], []
            for filename in filenames:
                try:
                    if (filename.startswith("http://")
                            or filename.startswith("https://")):
                        image_url = filename
                    else:
                        image_url = ("https://tiermaker.com"
                                     + base_path + "/" + filename)
                    r = requests.get(image_url, timeout=15, headers=headers)
                    r.raise_for_status()
                    raw = r.content
                    if not raw:
                        raise ValueError("empty file")

                    full_bytes = _normalize_to_jpeg(
                        raw, FULL_MAX_DIM, FULL_QUALITY)
                    thumb_bytes = _normalize_to_jpeg(
                        raw, THUMB_MAX_DIM, THUMB_QUALITY)

                    image_id = uuid.uuid4().hex
                    orig_path, thumb_path = _safe_image_paths(user, image_id)
                    with open(orig_path, "wb") as f:
                        f.write(full_bytes)
                    with open(thumb_path, "wb") as f:
                        f.write(thumb_bytes)

                    results.append({
                        "id": image_id,
                        "name": _prettify_name(filename),
                        "thumbUrl": (f"/apps/tierforge/images/"
                                     f"{image_id}/thumb"),
                        "fullUrl": (f"/apps/tierforge/images/"
                                    f"{image_id}/full"),
                    })
                except Exception as exc:
                    errors.append({"name": filename, "error": str(exc)})
                finally:
                    _bump_import_job(job_id)

            if not results:
                _finish_import_job(
                    job_id, error="none of the images could be imported",
                    errors=errors)
                return
            _finish_import_job(job_id, result={
                "title": _prettify_title(slug),
                "tiers": _default_import_tiers(),
                "pool": results,
                "errors": errors,
            })
    except Exception as exc:
        _finish_import_job(job_id, error=str(exc))


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

    # The downloads can take a while (a template often has ~100 images), so
    # the work runs in a background thread and the client polls the job for
    # a real "7 of 100" progress readout.
    job_id = _new_import_job(user.id, len(filenames))
    app = current_app._get_current_object()
    threading.Thread(
        target=_run_import_job,
        args=(app, job_id, user.id, filenames, base_path, slug),
        daemon=True,
    ).start()
    return jsonify({"job": job_id, "total": len(filenames)})


@tierforge_bp.route("/import/<job_id>", methods=["GET"])
@permission_required("tierforge", API)
def import_progress(user, job_id):
    """Progress/result readout for an async import started above."""
    with _IMPORT_JOBS_LOCK:
        job = _IMPORT_JOBS.get(job_id)
        if job is None or job.get("user_id") != user.id:
            return jsonify({"error": "import not found"}), 404
        payload = {
            "status": job["status"],
            "done": job["done"],
            "total": job["total"],
        }
        if job["status"] == "error":
            payload["error"] = job["error"]
            payload["errors"] = job.get("errors") or []
        elif job["status"] == "done":
            # Keep the result readable until the TTL prune: a lost poll
            # response must not throw away a finished import.
            payload.update(job.get("result") or {})
        return jsonify(payload)