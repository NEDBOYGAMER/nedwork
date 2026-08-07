from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, json
import os
from ..models import *

app_corner_bp = Blueprint('app_corner', __name__, static_folder='../static')


def _config_to_dict(config):
    """Serialize an AppCornerConfig row into the shape the frontend expects."""
    return {
        "shelves": config.shelves or [],
        "show_recent": config.show_recent,
        "recent_apps": config.recent_apps or [],
        "favorited_apps": config.favorited_apps or [],
        "disabled_apps": config.disabled_apps or [],
        "disabled_shelves": config.disabled_shelves or [],
    }


def _get_or_create_config(user):
    config = getattr(user, "app_corner_configs", None)

    if config is None:
        config = AppCornerConfig(
            user_id=user.id,
            shelves=[],
            show_recent=True,
            recent_apps=[],
            favorited_apps=[],
            disabled_apps=[],
            disabled_shelves=[],
        )
        db.session.add(config)
        db.session.commit()

    return config


@app_corner_bp.route('/')
def app_corner_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/app_corner.html')


@app_corner_bp.route('/api/apps-data')
def get_apps_data():
    json_path = os.path.join(current_app.root_path, 'data', 'apps.json')
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except Exception:
        return jsonify({"error": "Apps data not found"}), 404


@app_corner_bp.route('/api/user_preferences')
def get_user_preferences():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    config = _get_or_create_config(user)
    return jsonify(_config_to_dict(config))


@app_corner_bp.route('/api/update_user_preferences', methods=["POST"])
def update_user_preferences():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid or missing JSON body"}), 400

    config = _get_or_create_config(user)

    config.shelves = data.get("shelves", config.shelves)
    config.show_recent = data.get("show_recent", config.show_recent)
    config.recent_apps = data.get("recent_apps", config.recent_apps)
    config.favorited_apps = data.get("favorited_apps", config.favorited_apps)
    config.disabled_apps = data.get("disabled_apps", config.disabled_apps)
    config.disabled_shelves = data.get("disabled_shelves", config.disabled_shelves)

    db.session.commit()

    return jsonify(_config_to_dict(config))