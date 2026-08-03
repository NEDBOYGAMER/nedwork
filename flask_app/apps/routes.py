from flask import Blueprint, render_template, request, redirect, url_for, abort, send_from_directory
import os
from ..models import *


apps_bp = Blueprint(
    'apps', 
    __name__, 
    template_folder='.',    # Tells Flask to look inside flask_app/apps/ for templates
    static_folder='.'
)

@apps_bp.route('/<app_name>')
def dynamic_app(app_name):

    template_relative_path = f"{app_name}/{app_name}.html"
    
    template_full_path = os.path.join(apps_bp.root_path, template_relative_path)

    print(f"--> [DEBUG] Looking for template at: {template_full_path}")
    print(f"--> [DEBUG] File exists? {os.path.exists(template_full_path)}")

    if not os.path.exists(template_full_path):
        print(f"--> [ERROR] File not found, returning 404!")
        abort(404)

    return render_template(template_relative_path, app_name=app_name)

@apps_bp.route('/<app_name>/<path:filename>')
def app_static(app_name, filename):
    app_folder = os.path.join(apps_bp.root_path, app_name)
    file_path = os.path.join(app_folder, filename)
    
    if not os.path.exists(file_path):
        abort(404)
        
    return send_from_directory(app_folder, filename)