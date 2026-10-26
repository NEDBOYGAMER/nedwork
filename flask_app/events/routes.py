from flask import Blueprint, render_template, redirect, url_for
from ..models import *
from ..auth.decorators import permission_required, PAGE

events_bp = Blueprint('events', __name__, static_folder='../static')


@events_bp.route('/')
@permission_required("core", PAGE)
def events_page(user):
    return render_template('main/events.html')
