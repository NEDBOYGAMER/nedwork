from flask import Blueprint, render_template, request

# Create the blueprint
main_bp = Blueprint('main', __name__)

@main_bp.route("/")
def index():
    return render_template('index.html')

@main_bp.route('/register')
def register():
    return render_template('register.html')

@main_bp.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@main_bp.route('/settings')
def settings():
    return render_template('settings.html')