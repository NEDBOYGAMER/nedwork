from flask import request, Blueprint, jsonify, render_template, make_response, redirect, url_for
import re
from markupsafe import escape
from ..models import *
from .. import db
from .. import MIN_PASSWORD_LENGTH
from ..account import purge_user
from .decorators import permission_required, API
from . import throttle
from datetime import *


def _too_many(seconds):
    """429 with a Retry-After header — same message as a wrong password
    would be a lie, so the caller is told plainly to wait."""
    response = jsonify({
        "success": False,
        "error": "Too many failed attempts — try again later"
    }), 429
    resp = make_response(*response)
    resp.headers["Retry-After"] = str(max(1, seconds))
    return resp

auth_bp = Blueprint("auth", __name__, static_folder='../static')


@auth_bp.route("/login", methods=["GET"])
def login_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return render_template('auth/login.html')

    if user.must_change_password:
        return redirect(url_for('auth.change_password_page'))

    return redirect(url_for('dashboard.dashboard'))


@auth_bp.route("/change-password", methods=["GET"])
def change_password_page():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return redirect(url_for('auth.login_page'))

    if not user.must_change_password:
        return redirect(url_for('dashboard.dashboard'))

    return render_template('auth/change_password.html')


@auth_bp.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or request.form
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip()

    if not username or not password:
        return jsonify({"success": False, "error": "Username and password are required"}), 400

    if not 3 <= len(username) <= 32 or not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
        return jsonify({
            "success": False,
            "error": "Username must be 3-32 characters: letters, numbers, dots, underscores or dashes"
        }), 400

    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({
            "success": False,
            "error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        }), 400

    # the admin is not a user ("reserved") — nobody can register it or
    # collide with the console credential over the name
    if username.lower() == "admin":
        return jsonify({"success": False, "error": "Username not available"}), 409

    existing_user = User.query.filter_by(username=username).first()

    if existing_user:
        return jsonify({
            "success": False,
            "error": "Username already exists"
        }), 409

    # pending requests reserve the name until an admin decides
    if PendingLogin.query.filter_by(name=username).first():
        return jsonify({
            "success": False,
            "error": "A request for this username is already waiting for approval"
        }), 409

    if email == "":
        email = username + "@nedwork.ch"

    # registering is now a REQUEST: credentials are stored as submitted
    # (hash included) and an admin promotes the row to a real account
    pending = PendingLogin(name=username, email=email, requested_at=datetime.now(timezone.utc))
    pending.set_password(password)
    db.session.add(pending)
    db.session.commit()

    # fire-and-forget admin notification (a mail problem must never
    # delay or break this response)
    try:
        from ..notify import make_token, notify, base_url
        link = f"{base_url()}notify/pending/{pending.id}?t={make_token(pending.id)}"
        when = pending.requested_at.strftime("%d.%m.%Y %H:%M") if pending.requested_at else ""
        # every user-supplied field is escaped: this body is HTML mail
        safe_user = escape(username)
        safe_email = escape(email)
        when_txt = escape(when)
        notify(
            f"New registration request: {username}",
            f"<p><b>{safe_user}</b> ({safe_email}) requested access on {when_txt}.</p>"
            f"<p><a href=\"{escape(link)}\" style=\"display:inline-block;padding:14px 26px;"
            f"background:#2E7D46;color:#ffffff;border-radius:12px;"
            f"font-weight:700;text-decoration:none;\">Open request</a></p>",
            f"{username} ({email}) requested access on {when}.\n"
            f"Open the request: {link}",
        )
    except Exception:
        pass

    return jsonify({
        "success": True,
        "pending": True,
        "message": "Request submitted — an admin needs to approve it before you can log in"
    })


@auth_bp.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"success": False, "error": "Missing username or password"}), 400

    username = data["username"]
    ip = throttle.client_ip(request)
    wait = throttle.retry_after("user", ip, username)
    if wait:
        return _too_many(wait)

    user = User.query.filter_by(username=username).first()

    if not user or not user.check_password(data["password"]):
        if not throttle.fail("user", ip, username):
            return _too_many(throttle.retry_after("user", ip, username))

        pending = PendingLogin.query.filter_by(
            name=data["username"]
        ).first() if data.get("username") else None

        if pending is not None:
            return jsonify({
                "success": False,
                "error": "Account is waiting for admin approval — you can't log in yet"
            }), 403

        return jsonify({"success": False, "error": "User doesnt exist or password is wrong"}), 401

    throttle.clear("user", username)

    session = Session(
        user_id = user.id,
        expires = datetime.now(timezone.utc) + timedelta(days=7)
    )
    session.create_session_id()

    db.session.add(session)
    db.session.commit()

    response = make_response({
        "success": True,
        "must_change_password": bool(user.must_change_password),
        # admins are operators, not normal users — they land in the console
        "is_admin": user.is_admin(),
    })

    response.set_cookie(
        "session_id",
        session.session_id,
        httponly=True,
        secure=True,
        samesite="Lax",
        max_age=60*60*24*7
    )
    return response



@auth_bp.route("/api/who", methods=["GET"])
def who():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return jsonify({"user": None}), 401

    return jsonify({
        "user": user.username,
        # the admin is not a user and cannot be one: this stays False for
        # every account (kept for JS compatibility)
        "is_admin": False,
        "permissions": sorted(user._permission_names()),
        "must_change_password": bool(user.must_change_password),
    })




@auth_bp.route("/api/change_password", methods=["POST"])
def change_password():
    valid, user = Session.check(request.cookies.get("session_id"))

    if not valid:
        return jsonify({"user": None, "error": "Not logged in"}), 401

    data = request.get_json(silent=True) or {}

    if not user.check_password(data.get("current_password") or ""):
        return jsonify({"success": False, "error": "Current password is wrong"}), 400

    new_password = data.get("new_password") or ""
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"success": False,
                        "error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}), 400

    user.set_password(new_password)
    user.must_change_password = False
    # a password change ends every other session: a stolen cookie must not
    # outlive the reset. This session survives so the user isn't bounced.
    db.session.query(Session).filter(
        Session.user_id == user.id,
        Session.session_id != request.cookies.get("session_id"),
    ).delete(synchronize_session=False)
    db.session.commit()

    return jsonify({"success": True})


def _perform_logout():
    """Shared logout: kill the session row, clear the session cookie AND
    the CSRF double-submit token, land on the login page."""
    session = Session.query.filter_by(
        session_id=request.cookies.get("session_id")
    ).first()

    if session is not None:
        db.session.delete(session)
        db.session.commit()

    response = make_response(redirect(url_for("auth.login_page")))
    for name in ("session_id", "csrf_token"):
        response.set_cookie(
            name,
            "",
            max_age=0,
            httponly=(name == "session_id"),
            # clear-flags match the unconditional Secure the cookies are
            # issued with (login sets session_id Secure, the CSRF hook
            # sets csrf_token Secure) so the browser reliably drops them
            secure=True,
            samesite="Lax",
            path="/"
        )
    return response


@auth_bp.route("/api/delete_account", methods=["POST"])
@permission_required("core", API)
def delete_account(user):
    """Permanently delete the signed-in user and everything they own."""
    purge_user(user)
    db.session.commit()
    return _perform_logout()


@auth_bp.route("/api/logout", methods=["POST"])
def logout():
    """API logout (fetch-based callers; csrf.js adds the X-CSRF-Token
    header). The sidenav uses the form-POST route below."""
    return _perform_logout()


@auth_bp.route("/logout", methods=["POST"])
def logout_page():
    """Form-POST logout for the sidenav (CSRF token rides in a hidden
    form field — server-rendered, no JS involved). GET never logs out:
    a stray third-party link can't end the session anymore; it answers
    405 instead."""
    return _perform_logout()