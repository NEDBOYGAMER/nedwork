from flask import Blueprint, render_template, url_for, redirect

main_bp = Blueprint('main', __name__)

@main_bp.route("/")
def index():
    return redirect(url_for('auth.login_page'))
