from flask import Blueprint, render_template

dashboard_bp = Blueprint('dashboard', __name__, static_folder='../static')

@dashboard_bp.route('/')
def dashboard():
    return render_template('main/dashboard.html')