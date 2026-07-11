from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from ..models import *

dashboard_bp = Blueprint('dashboard', __name__, static_folder='../static')

@dashboard_bp.route('/')
def dashboard():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/dashboard.html')


@dashboard_bp.route('/api/load/<dashboardname>', methods=['GET'])
def load_dashboard(dashboardname):
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    dashboard: Dashboard

    for dashboard in user.dashboards:
        if dashboard.name == dashboardname:
            return jsonify({
                "name": dashboard.name,
                "widgets": dashboard.widgets
            })


