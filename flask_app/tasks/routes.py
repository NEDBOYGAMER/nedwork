from flask import Blueprint, render_template, request, jsonify, redirect, url_for
from ..models import *

tasks_bp = Blueprint('tasks', __name__, static_folder='../static')


@tasks_bp.route('/')
def tasks_page():
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return redirect(url_for('auth.login_page'))
    return render_template('main/tasks.html')


def _task_to_dict(task):
    return {
        "id":            task.id,
        "name":          task.name,
        "text":          task.text,
        "importance":    task.importance,
        "private":       task.private,
        "done":          task.done,
        "tags":          task.tags or [],
        "subtasks":      task.subtasks or [],
        "deadline":      task.deadline.isoformat()  if task.deadline      else None,
        "created_at":    task.created_at.isoformat() if task.created_at    else None,
        "last_updated_at": task.last_updated_at.isoformat() if task.last_updated_at else None,
        "completed_at":  task.completed_at.isoformat() if task.completed_at else None,
    }


@tasks_bp.route('/api/get_tasks', methods=['GET'])
def list_owned_dashboards():
    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return jsonify({"error": "unauthorized"}), 401

    tasks = [_task_to_dict(t) for t in user.tasks]
    return jsonify({"tasks": tasks})