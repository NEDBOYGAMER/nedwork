from flask import Blueprint, render_template, request, jsonify, redirect, url_for, jsonify, current_app, json
import os
from ..models import *

app_corner_bp = Blueprint('app_corner', __name__, static_folder='../static')

@app_corner_bp.route('/')
def app_corner_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/app_corner.html')



@app_corner_bp.route('/api/apps-data')
def get_apps_data():
    json_path = os.path.join(current_app.root_path, 'data', 'apps.json')
    with open(json_path, 'r') as f:
        data = json.load(f)
    return jsonify(data)



