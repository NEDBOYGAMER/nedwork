from flask import Blueprint, render_template, jsonify
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
    
    # 2. Serialize into a list of dicts (Industry Standard)
    user_list = []
    for user in users:
        user_list.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "groups": [group.name for group in user.groups] # Grabs relation data
        })
        
    # 3. Return JSON response
    return jsonify(user_list)