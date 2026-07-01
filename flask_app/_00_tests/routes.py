from flask import Blueprint, render_template, jsonify, request
from flask_app.models import *

tests_bp = Blueprint('tests', __name__, static_folder='../static')

@tests_bp.route('/')
@tests_bp.route('/database_test')
def tests():
    return render_template('main/database_test.html')


@tests_bp.route('/api/v1/test-users')
def get_test_users_api():
    # 1. Fetch data from database
    users = User.query.all()
    dashboards = Dashboard.query.all()
    
    # 2. Serialize into a list of dicts (Industry Standard)
    user_list = []
    for user in users:
        user_list.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "groups": [membership.group.name for membership in user.group_memberships], # Grabs relation data
            "dashboards": [dashboard.name for dashboard in dashboards if dashboard.user_id == user.id]
        })
        
    # 3. Return JSON response
    return jsonify(user_list)

@tests_bp.route('/api/v1/group/<group_name>', methods=['GET'])
def get_group_data(group_name):
    group = Group.query.filter_by(name=group_name).first()
    
    if not group:
        return jsonify({"error": "Group not found"}), 404
    
    user_list = []
    for membership in group.user_memberships:
        user_list.append({
            "name": membership.user.username,
            "role": membership.role
        })

    return jsonify({
        "id": group.id,
        "name": group.name,
        "users": user_list
    })
