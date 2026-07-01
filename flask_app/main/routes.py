from flask import Blueprint, render_template, url_for, redirect, send_from_directory, current_app
import os

main_bp = Blueprint('main', __name__)

@main_bp.route("/")
def index():
    return redirect(url_for('auth.login_page'))


@main_bp.route('/favicon.ico')
def favicon():
    return send_from_directory(
        os.path.join(current_app.root_path, 'static'),
        'favicon.ico',
        mimetype='image/vnd.microsoft.icon'
    )