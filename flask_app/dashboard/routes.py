from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from ..models import *

dashboard_bp = Blueprint('dashboard', __name__, static_folder='../static')

@dashboard_bp.route('/')
def dashboard():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/dashboard.html')


@dashboard_bp.route('/api/list/owned', methods=['GET'])
def list_owned_dashboards():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    return jsonify({
        "dashboards": [dashboard.name for dashboard in user.dashboards]
    })


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

    return jsonify({"error": "Dashboard not found"}), 404


@dashboard_bp.route('/api/update/update_widget', methods=['POST'])
def widget_update():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')


    data = request.get_json()
    if not data or "widgets" not in data:
        return jsonify({"error": "Missing 'widgets' data in request body"}), 400
    

    new_widgets = data["widgets"]
    dashboardname = data["name"]

    for dashboard in user.dashboards:
        if dashboard.name == dashboardname:

            dashboard.widgets = new_widgets
            db.session.commit()
            return jsonify({
                "success": True,
                "name": dashboard.name,
                "widgets": dashboard.widgets
            })

    return jsonify({"error": "Dashboard not found"}), 404