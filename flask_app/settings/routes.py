from flask import Blueprint, render_template, current_user, jsonify
from ..models import *

settings_bp = Blueprint('settings', __name__, static_folder='../static')

@settings_bp.route('/')
def settings():
    return render_template('main/settings.html')

from sqlalchemy.inspection import inspect

@settings_bp.route("/settings/get_config")
def get_config():

    if not current_user.is_authenticated:
        # Return model defaults
        data = {}
        mapper = inspect(SettingsConfig)

        for column in mapper.columns:
            if column.name in ("id", "user_id"):
                continue

            default = column.default.arg if column.default is not None else None
            data[column.name] = default

        return jsonify(data)

    settings = current_user.settings_configs

    if settings is None:
        settings = SettingsConfig(user=current_user)
        db.session.add(settings)
        db.session.commit()

    return jsonify(settings.to_dict())