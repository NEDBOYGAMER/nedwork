from flask import Flask, g, jsonify, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
import hmac
import os
import secrets
import shutil

db = SQLAlchemy()

_PWA_HEAD_TAGS = (
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="color-scheme" content="dark light">'
    '<meta name="theme-color" content="#16161A">'
    '<link rel="manifest" href="/manifest.json">'
    '<link rel="icon" href="/favicon.ico" sizes="any">'
    '<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">'
)

_CSRF_SCRIPT_TAG = '<script src="/static/js/global/csrf.js"></script>'

# Endpoints that may be POSTed without a logged-in session (and whose only
# purpose is to build one) can never carry a CSRF token, so they are exempt.
_CSRF_EXEMPT = {"auth.login", "auth.register", "admin.api_login",
                 # the email decision page authorizes via its HMAC
                 # token instead of CSRF (password-reset pattern)
                 "notify.decide_page", "notify.decide"}

# Methods that change state on the server.
_CSRF_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# While a user still owes a password change (bootstrapped admin first
# login, or admin-forced reset), EVERYTHING except the change-password
# page, its API and logout is locked behind a redirect.
_FORCE_PW_EXEMPT = {
    "auth.change_password",
    "auth.change_password_page",
    "auth.logout",
    "static",
}


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    os.makedirs(app.instance_path, exist_ok=True)
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(app.instance_path, 'app.db')}"

    db.init_app(app)

    from flask_app.blueprint_imports.main import register_all_blueprints
    from flask_app.blueprint_imports.apps import register_all_blueprints as register_app_blueprints

    register_all_blueprints(app)
    register_app_blueprints(app)

    # one-time data migration: the suggestions store used to live inside
    # static/ (anyone could read it at /static/data/suggestions.json). It
    # now belongs to instance/data/; move any legacy file out on startup.
    _legacy_suggestions = os.path.join(app.static_folder, "data", "suggestions.json")
    if os.path.exists(_legacy_suggestions):
        _target_dir = os.path.join(app.instance_path, "data")
        os.makedirs(_target_dir, exist_ok=True)
        _target = os.path.join(_target_dir, "suggestions.json")
        if os.path.exists(_target):
            os.remove(_legacy_suggestions)
        else:
            shutil.move(_legacy_suggestions, _target)

    @app.before_request
    def redirect_until_password_changed():
        endpoint = request.endpoint or ""
        from flask_app.models import Session
        valid, user = Session.check(request.cookies.get("session_id"))
        # stash for the sidenav context processor + the no-store header
        g.nav_logged_in = valid
        g.nav_username = user.username if valid else ""
        if endpoint in _FORCE_PW_EXEMPT or endpoint.endswith(".static"):
            return
        if valid and user.must_change_password:
            return redirect(url_for("auth.change_password_page"))

    @app.context_processor
    def inject_nav_state():
        """The sidenav partial renders session-aware: Account/Logout while
        logged in, a Login button once logged out (a static Logout button
        used to make logging out look like it did nothing)."""
        return {
            "nav_logged_in": getattr(g, "nav_logged_in", False),
            "nav_username": getattr(g, "nav_username", ""),
        }

    @app.before_request
    def csrf_protect():
        if request.method not in _CSRF_METHODS:
            return
        if (request.endpoint or "") in _CSRF_EXEMPT:
            return
        cookie_token = request.cookies.get("csrf_token", "")
        header_token = request.headers.get("X-CSRF-Token", "")
        if not (
            cookie_token
            and header_token
            and hmac.compare_digest(cookie_token, header_token)
        ):
            return jsonify({"error": "CSRF token missing or invalid"}), 403

    @app.after_request
    def inject_pwa_head(response):
        # a logged-in page must never be cacheable - a cached dashboard
        # would fake a session after logout (same class of bug the admin
        # console had)
        if response.headers.get("Content-Type", "").startswith("text/html"):
            if getattr(g, "nav_logged_in", False):
                response.headers["Cache-Control"] = "no-store"

        if response.status_code != 200:
            return response

        # Issue a CSRF token to every browser that does not have one yet.
        # It is deliberately readable by JS (it is double-submit protection,
        # not a secret) — csrf.js echoes it back via the X-CSRF-Token header.
        if "csrf_token" not in request.cookies:
            response.set_cookie(
                "csrf_token",
                secrets.token_hex(32),
                samesite="Lax",
                secure=request.is_secure,
                path="/",
            )

        content_type = response.headers.get("Content-Type", "")
        if (
            content_type.startswith("text/html")
            and not response.direct_passthrough
        ):
            html = response.get_data(as_text=True)
            if "</head>" in html:
                changed = False
                if 'rel="manifest"' not in html:
                    html = html.replace("</head>", _PWA_HEAD_TAGS + "</head>", 1)
                    changed = True
                # Load the CSRF fetch/XHR patch on every HTML page — including
                # pages that do not extend base.html (apps, about).
                if "csrf.js" not in html:
                    html = html.replace("</head>", _CSRF_SCRIPT_TAG + "</head>", 1)
                    changed = True
                if changed:
                    response.set_data(html)
        return response

    return app
