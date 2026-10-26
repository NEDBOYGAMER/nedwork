from flask import Blueprint, render_template
from ..models import *
from ..auth.decorators import permission_required, PAGE

event_manager_bp = Blueprint('event_manager', __name__, static_folder='../static')
@event_manager_bp.route('/')
@permission_required("core", PAGE)
def index(user):
    return "Event Manager Dashboard"
