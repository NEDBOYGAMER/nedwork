from flask import Blueprint, render_template, request, jsonify, redirect, url_for, current_app, json
import os
from ..models import *

events_bp = Blueprint('events', __name__, static_folder='../static')


@events_bp.route('/')
def events_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    return render_template('main/events.html')