"""The email decision page: approve/deny a registration request from a
deep link in the notification email - no console login needed.

Authorization is the HMAC token in the link (notify.make_token), the
same trust pattern as password-reset links - which is why both routes
are in the app's _CSRF_EXEMPT list. The pending row is DELETED on any
decision, so every link is single-use by nature.
"""

from flask import Blueprint, jsonify, render_template, request

from . import db
from .models import Dashboard, PendingLogin, Permission, User
from .notify import make_token, token_ok
from .admin.routes import _approve_pending

notify_bp = Blueprint('notify', __name__)


def _page(pending):
    """The decision page body shared by the valid GET render."""
    perms = [{
        "name": p.name,
        "description": p.description or "",
        "kind": p.kind or "access",
        "selected": p.name == "core",
    } for p in Permission.query.order_by(Permission.name).all()]
    return render_template(
        "notify/decide.html",
        pending=pending,
        requested=pending.requested_at.strftime("%d.%m.%Y %H:%M") if pending.requested_at else "",
        token=make_token(pending.id),
        perms=perms,
    )


@notify_bp.route('/pending/<int:pending_id>', methods=['GET'])
def decide_page(pending_id):
    """The mobile decision page from the registration email."""
    token = request.args.get("t", "")
    if not token_ok(pending_id, token):
        return _invalid()
    pending = PendingLogin.query.get(pending_id)
    if pending is None:
        return _invalid()
    return _page(pending)


@notify_bp.route('/pending/<int:pending_id>/decide', methods=['POST'])
def decide(pending_id):
    """Approve or deny the request. The token (sent by the page) is the
    authorization. approve = console logic + grant EXACTLY the submitted
    keys (unknown key -> 400, grant nothing). deny = the row just goes."""
    data = request.get_json(silent=True) or {}
    if not token_ok(pending_id, data.get("token")):
        return jsonify({"success": False, "error": "invalid link"}), 403

    pending = PendingLogin.query.get(pending_id)
    if pending is None:
        return jsonify({"success": False, "error": "This request was already handled"}), 404

    action = (data.get("action") or "").strip()
    if action == "deny":
        db.session.delete(pending)
        db.session.commit()
        return jsonify({"success": True, "action": "deny"})

    if action != "approve":
        return jsonify({"success": False, "error": "unknown action"}), 400

    # validate every submitted key BEFORE touching anything: one unknown
    # key must mean 400 and grant nothing
    names = [str(n).strip() for n in (data.get("permissions") or []) if str(n).strip()]
    known = {p.name for p in Permission.query.all()}
    unknown = [n for n in names if n not in known]
    if unknown:
        return jsonify({"success": False, "error": f"Unknown permission(s): {', '.join(unknown)}"}), 400

    try:
        username, user_id = _approve_pending(pending)
    except ValueError as exc:
        # e.g. the username was taken while the email sat unopened - the
        # row stays so the decision can still be made in the console
        db.session.rollback()
        return jsonify({"success": False, "error": str(exc)}), 409

    user = User.query.get(user_id)
    for name in names:
        user.grant_permission(name)
    db.session.commit()

    return jsonify({"success": True, "action": "approve", "username": username,
                    "granted": names})


def _invalid():
    return render_template("notify/invalid.html"), 200
