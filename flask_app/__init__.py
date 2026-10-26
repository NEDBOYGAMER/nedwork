from flask import Flask, g, jsonify, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
import hmac
import os
import secrets
import shutil

db = SQLAlchemy()

# PWA tags injected into pages that lack them. The favicon lives OUTSIDE the
# blob and is injected separately (guarded): pages that declare their own icon
# (admin -> admin.ico) must never receive a second, later-declared icon —
# some engines pick the last rel="icon", which broke the admin tab icon.
_PWA_HEAD_TAGS = (
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="color-scheme" content="dark light">'
    '<meta name="theme-color" content="#16161A">'
    '<link rel="manifest" href="/manifest.json">'
    '<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">'
)
_PWA_ICON_TAG = '<link rel="icon" href="/favicon.ico" sizes="any">'

_CSRF_SCRIPT_TAG = '<script src="/static/js/global/csrf.js"></script>'
_TOAST_SCRIPT_TAG = '<script src="/static/js/global/toast.js"></script>'
# site-styled confirm/prompt/alert replacing the native browser boxes —
# same injection strategy: every HTML page gets it, so app pages (which
# do not extend base.html) share one implementation too
_DIALOGS_CSS_TAG = ('<link rel="stylesheet" '
                    'href="/static/css/global/dialogs.css">')
_DIALOGS_SCRIPT_TAG = '<script src="/static/js/global/dialogs.js"></script>'

# Endpoints that may be POSTed without a logged-in session (and whose only
# purpose is to build one) can never carry a CSRF token, so they are exempt.
_CSRF_EXEMPT = {"auth.login", "auth.register", "admin.api_login",
                 # the email decision page authorizes via its HMAC
                 # token instead of CSRF (password-reset pattern)
                 "notify.decide_page", "notify.decide"}

# Methods that change state on the server.
_CSRF_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# One number for every password-setting path (register, change-password,
# admin console) so the rules can't drift apart. Length only: length beats
# a composition checklist, and users are not asked to spell it out.
MIN_PASSWORD_LENGTH = 4

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
    # nginx in front of this app allows 20 GB per request; cap every route
    # here. The two uploads that legitimately need more raise the limit for
    # themselves in lift_upload_cap() below.
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
    # request.max_content_length = None falls back to the config above, so
    # "no limit" has to be spelled out as a number:
    upload_max = 20 * 1024 ** 3   # nginx client_max_body_size 20g

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
    def lift_upload_cap():
        # These two uploads deliberately exceed the global 16 MB cap (nginx
        # still enforces client_max_body_size). It has to be lifted here:
        # csrf_protect() below parses the form body, and the limit is
        # enforced at parse time — raising it inside the view would be too
        # late for anything over 16 MB.
        if request.endpoint in ("tierforge.upload_images",
                                "colors.palette_from_image"):
            request.max_content_length = upload_max

    @app.before_request
    def csrf_protect():
        if request.method not in _CSRF_METHODS:
            return
        if (request.endpoint or "") in _CSRF_EXEMPT:
            return
        cookie_token = request.cookies.get("csrf_token", "")
        header_token = request.headers.get("X-CSRF-Token", "")
        form_token = request.form.get("csrf_token", "")
        # double-submit: cookie must match either the header (csrf.js
        # fetch/XHR patch) or a server-rendered form field (plain HTML
        # forms, e.g. the sidenav logout — no JS involved)
        supplied = header_token or form_token
        if not (
            cookie_token
            and supplied
            and hmac.compare_digest(cookie_token, supplied)
        ):
            return jsonify({"error": "CSRF token missing or invalid"}), 403

    @app.after_request
    def static_assets_revalidate(response):
        # JS/CSS ship with no build step and no version query — without an
        # explicit policy browsers may heuristically cache them for days
        # and keep serving stale assets after a deploy. no-cache forces a
        # revalidate on every load; unchanged files answer with a 304.
        path = request.path
        if path.endswith((".js", ".css")) and (
            path.startswith("/static/") or path.startswith("/apps/")
        ):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.after_request
    def security_headers(response):
        """Baseline hardening. CSP is deliberately not set: the pages rely
        on inline <script>/onclick and many third-party hosts (fonts, maps,
        widgets), so a real policy is its own piece of work."""
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy",
                                    "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return response

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
                # Secure unconditionally (fail-closed): the real host is
                # always HTTPS, and browsers allow Secure cookies on
                # localhost dev. request.is_secure would depend on
                # X-Forwarded-Proto handling of the TLS proxy — a
                # dependency we removed instead of trusting.
                secure=True,
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
                # Never inject a favicon into a page that already declares one
                # (admin pages use admin.ico) — a second, later-declared
                # rel="icon" wins in some engines and breaks the tab icon.
                if 'rel="icon"' not in html:
                    html = html.replace("</head>", _PWA_ICON_TAG + "</head>", 1)
                    changed = True
                # Load the CSRF fetch/XHR patch on every HTML page — including
                # pages that do not extend base.html (apps, about).
                if "csrf.js" not in html:
                    html = html.replace("</head>", _CSRF_SCRIPT_TAG + "</head>", 1)
                    changed = True
                # same for the toast helper: page scripts call window.toast,
                # and app/admin pages do not load the events UI module
                if "global/toast.js" not in html:
                    html = html.replace("</head>", _TOAST_SCRIPT_TAG + "</head>", 1)
                    changed = True
                # site-styled dialogs replace native confirm/prompt/alert
                if "global/dialogs.js" not in html:
                    html = html.replace("</head>",
                                        _DIALOGS_CSS_TAG + _DIALOGS_SCRIPT_TAG +
                                        "</head>", 1)
                    changed = True
                if changed:
                    response.set_data(html)
        return response

    return app
