from flask import Blueprint, render_template

event_manager_bp = Blueprint('event_manager', __name__, static_folder='../static')
@event_manager_bp.route('/')
def index():
    return "Event Manager Dashboard"