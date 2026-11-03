from flask import Blueprint, render_template, jsonify, request
from ..models import *
from ..auth.decorators import permission_required, PAGE, RENDER

settings_bp = Blueprint('settings', __name__, static_folder='../static')

@settings_bp.route('/')
@permission_required("core", PAGE)
def settings(user):
    return render_template('main/settings.html', username=user.username)


@settings_bp.route('/api/save', methods=["POST"])
@permission_required("core", RENDER)
def save_settings(user):
    data = request.get_json()

    if user.settings_config is None:
        user.settings_config = SettingsConfig(user_id=user.id)

    # only accept a real boolean for the toggle (strings would be truthy)
    if isinstance(data, dict) and "notify_events" in data \
            and not isinstance(data["notify_events"], bool):
        data.pop("notify_events")

    user.settings_config.to_var(data)
    db.session.commit()

    return jsonify({"success": True}), 200

@settings_bp.route('/api/load')
@permission_required("core", RENDER)
def load_settings(user):
    if not user.settings_config:
        user.settings_config = SettingsConfig()
        db.session.commit()

    settings = user.settings_config.to_dict()

    return jsonify({
        "success": True,
        "settings": settings
    })
