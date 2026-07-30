from flask import Blueprint, request, jsonify, redirect, url_for
from sqlalchemy.orm.attributes import flag_modified

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