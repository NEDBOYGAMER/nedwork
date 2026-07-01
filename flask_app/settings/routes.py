from flask import Blueprint, render_template

settings_bp = Blueprint('settings', __name__, static_folder='../static')

@settings_bp.route('/')
def settings():
    return render_template('main/settings.html')