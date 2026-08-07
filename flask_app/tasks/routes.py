from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, json
import os
from ..models import *

tasks_bp = Blueprint('tasks', __name__, static_folder='../static')


@tasks_bp.route('/')
def tasks_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/tasks.html')