from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, json
import os
from ...models import *

colors_bp = Blueprint('colors', __name__)


@colors_bp.route("/save", methods=["POST"])
def save_colors():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    data = request.get_json()

    if not data:
        return jsonify({"error": "Palette not found"}), 404
    
    name = data.get("name") # name is "Library/Project/Palette"
    palette = data.get("palette")


    user.apps_configs.colors_configs.palette[name] = palette