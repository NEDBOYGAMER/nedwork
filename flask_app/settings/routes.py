from flask import Blueprint, render_template, jsonify, request
from ..models import *

settings_bp = Blueprint('settings', __name__, static_folder='../static')

@settings_bp.route('/')
def settings():
    return render_template('main/settings.html')

from sqlalchemy.inspection import inspect



@settings_bp.route('/api/save', methods=["POST"])
def save_settings():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    data = request.get_json()

    user.settings_config.to_var(data)
    db.session.commit()

    return jsonify({"success": True}), 200

@settings_bp.route('/api/load')
def load_settings():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    if not user.settings_config:
        user.settings_config = SettingsConfig()
        db.session.commit()

    settings = user.settings_config.to_dict()

    return jsonify({
        "success": True,
        "settings": settings
    })