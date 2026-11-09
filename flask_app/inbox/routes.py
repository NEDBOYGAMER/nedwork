"""Inbox — the /notifications page and its JSON API.

The Notification model and every writer live in flask_app/notifications.py;
this module is only the page, the list read, and the per-type action
annotation. The folder is named `inbox` because `flask_app/notifications.py`
already owns that module name.

Actions are derived from LIVE state at read time, never stored on the row:
a friend request that was already accepted elsewhere comes back with no
button instead of a dead one.
"""
from flask import Blueprint, jsonify, render_template, request

from ..models import *   # Notification, Friendship, SocialGroupMember, User
from ..auth.decorators import permission_required, PAGE, API
from ..notifications import (
    notifications_for_user, mark_read, notification_to_dict,
    scan_reminders, scan_task_deadlines,
)

inbox_bp = Blueprint('inbox', __name__)

EVENT_TYPES = {"event", "event_published", "event_reminder", "event_announcement",
               "member_added", "date_finalized", "date_changed",
               "ride_cancelled"}
TASK_TYPES = {"task", "task_deadline"}
SOCIAL_TYPES = {"friend_accepted", "group_joined", "group_denied",
                "group_added", "group_removed"}


def _actor_id(name):
    if not name:
        return None
    user = User.query.filter_by(username=name).first()
    return user.id if user else None


def _action_for(user, n):
    """What the viewer can do about this notification right now."""
    p = n.payload or {}
    t = n.type

    if t == "friend_request":
        sender = _actor_id(p.get("actor"))
        if sender and Friendship.query.filter_by(
                request_sender_id=sender, request_receiver_id=user.id,
                status="pending").first():
            return {"kind": "friend_request", "user_id": sender}
        return None

    if t == "group_join_request":
        group_id = p.get("group_id")
        sender = _actor_id(p.get("actor"))
        if not group_id or not sender:
            return None
        req = SocialGroupMember.query.filter_by(
            group_id=group_id, user_id=sender, status="pending").first()
        if req:
            return {"kind": "group_request", "group_id": group_id,
                    "member_id": req.id}
        return None

    if t in EVENT_TYPES:
        return {"kind": "event", "event_id": p.get("event_id")} \
            if p.get("event_id") else None

    if t in TASK_TYPES:
        return {"kind": "task", "task_id": p.get("task_id")} \
            if p.get("task_id") else None

    if t in SOCIAL_TYPES:
        return {"kind": "social"}

    if t in ("tierforge_join_request", "tierforge_invite_approved"):
        token = p.get("session_token")
        if token:
            return {"kind": "tierforge", "session_token": token}
        return None

    return None


# ------------------------------------------------------------------ page
@inbox_bp.route('/')
@permission_required("core", PAGE)
def inbox_page(user):
    return render_template('main/notifications.html', user_id=user.id)


# ------------------------------------------------------------------- api
#   GET  /notifications/api/list   -> latest 50 + unread + per-row action
#   GET  /notifications/api/unread -> unread count (the sidenav dot polls it)
#   POST /notifications/api/read   -> mark ids or all read
#
# Both reads piggyback the reminder scans: there is no scheduler, so the
# poll IS the tick (same pattern as /events/api/notifications).

@inbox_bp.route('/api/list')
@permission_required("core", API)
def api_list(user):
    scan_reminders(user)
    scan_task_deadlines(user)
    rows, unread = notifications_for_user(user)
    return jsonify({
        "notifications": [
            {**notification_to_dict(n), "action": _action_for(user, n)}
            for n in rows
        ],
        "unread": unread,
    })


@inbox_bp.route('/api/unread')
@permission_required("core", API)
def api_unread(user):
    scan_reminders(user)
    scan_task_deadlines(user)
    return jsonify({"unread": Notification.query.filter_by(
        user_id=user.id, read=False).count()})


@inbox_bp.route('/api/read', methods=['POST'])
@permission_required("core", API)
def api_read(user):
    payload = request.get_json(silent=True) or {}
    mark_read(user, ids=payload.get("ids"), all=bool(payload.get("all")))
    return jsonify({"ok": True, "unread": Notification.query.filter_by(
        user_id=user.id, read=False).count()})
