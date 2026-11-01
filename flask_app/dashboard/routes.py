from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from ..models import *
from ..auth.decorators import login_required, permission_required, PAGE, API, REDIRECT, RENDER
from ..permissions import catalog_for

dashboard_bp = Blueprint('dashboard', __name__, static_folder='../static')

@dashboard_bp.route('/')
@permission_required("core", PAGE)
def dashboard(user):
    return render_template('main/dashboard.html')


@dashboard_bp.route('/api/list/owned', methods=['GET'])
@permission_required("core", RENDER)
def list_owned_dashboards(user):
    dashboards = [dashboard.name for dashboard in user.dashboards]


    # ensures everyobe gets a dashboard created when first entering
    if len(dashboards) == 0:
        new_dashboard = Dashboard(
            name="Main",
            user_id=user.id,
            widgets=[]
        )

        db.session.add(new_dashboard)
        db.session.commit()
        dashboards.append(new_dashboard.name)


    return jsonify({
        "dashboards": dashboards
    })


@dashboard_bp.route('/api/create', methods=['POST'])
@permission_required("core", RENDER)
def create_dashboard(user):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "Dashboard name is required"}), 400

    # the model column is String(20) - reject instead of silently truncating
    if len(name) > 20:
        return jsonify({"error": "Dashboard name is too long (max 20 characters)"}), 400

    # dashboard lookups go by per-user name, so duplicates would break switching
    if any(dashboard.name == name for dashboard in user.dashboards):
        return jsonify({"error": "A dashboard with this name already exists"}), 409

    new_dashboard = Dashboard(
        name=name,
        user_id=user.id,
        widgets=[]
    )
    db.session.add(new_dashboard)
    db.session.commit()

    return jsonify({
        "name": new_dashboard.name,
        "dashboards": [dashboard.name for dashboard in user.dashboards]
    })


@dashboard_bp.route('/api/load/<dashboardname>', methods=['GET'])
@permission_required("core", RENDER)
def load_dashboard(dashboardname, user):

    for dashboard in user.dashboards:
        if dashboard.name == dashboardname:
            return jsonify({
                "name": dashboard.name,
                "widgets": dashboard.widgets
            })

    return jsonify({"error": "Dashboard not found"}), 404


@dashboard_bp.route('/api/update/update_widget', methods=['POST'])
@permission_required("core", RENDER)
def widget_update(user):
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


@dashboard_bp.route('/api/apps')
@permission_required("core", API)
def apps_data(user):
    """Serve the app catalog with a per-user "locked" flag so widgets and
    the app corner can hide what the user has no permission for."""
    return jsonify(catalog_for(user))
