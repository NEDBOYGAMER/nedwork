"""Shared route guards.

`login_required(mode)` wraps a view function: it validates the session
cookie first and, when valid, injects the logged-in `User` into the view
as a keyword argument (`user=user`). All view signatures protected by
this decorator therefore take (or at least accept) a `user` parameter.

Modes - they exist because different frontends expect different
"not logged in" shapes; each preserved exactly as it behaved before:

- "page"      → redirect to /login          (HTML pages navigated top-level)
- "api"       → JSON 401 {"error": ...}     (endpoints whose JS handles 401)
- "redirect"  → redirect to /login          (fetch endpoints whose JS follows
                                              the redirect automatically)
- "render"    → render login.html directly  (dashboard APIs, legacy)

`permission_required(required, mode)` layers authorization on top: after
the session check it verifies the user holds ANY of the named
permissions. `required=[]` means public.

`admin_required(mode)` is the console's own guard: it validates the
separate `admin_session` cookie (AdminSession). The site admin is not a
user and holds no site permissions.
"""

from functools import wraps

from flask import jsonify, redirect, render_template, request, url_for

from ..models import Session, AdminSession

PAGE = "page"
API = "api"
REDIRECT = "redirect"
RENDER = "render"


def _denied(mode):
    if mode == API:
        return jsonify({"error": "unauthorized"}), 401
    if mode == RENDER:
        return render_template("auth/login.html")
    return redirect(url_for("auth.login_page"))


def _denied_permission(mode, endpoint=None):
    """Like _denied, but for a logged-in user lacking the permission."""
    if mode == API:
        return jsonify({"error": "forbidden"}), 403
    if mode == REDIRECT:
        return redirect(url_for("auth.login_page"))
    # never link the dashboard from the dashboard's own denial: that
    # would loop straight back onto this page (no exit).
    on_dashboard = endpoint == "dashboard.dashboard"
    return render_template(
        "auth/forbidden.html", on_dashboard=on_dashboard
    ), 403


def _denied_admin(mode):
    """Unauthenticated console access. The /admin page itself renders the
    flat login; APIs answer 401."""
    if mode == API:
        return jsonify({"error": "unauthorized"}), 401
    return redirect(url_for("admin.admin_page"))


def admin_required(mode=PAGE):
    """Console guard - separate from the user auth in every way.

    Validates the `admin_session` cookie against AdminSession; on failure
    pages bounce to /admin (which shows the flat login) and APIs return
    401. Injects nothing into the view: the console has no user identity.
    """
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not AdminSession.check(request.cookies.get("admin_session")):
                return _denied_admin(mode)
            return view(*args, **kwargs)
        return wrapper
    return decorator


def login_required(mode=PAGE):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            valid, user = Session.check(request.cookies.get("session_id"))
            if not valid:
                return _denied(mode)
            if "user" not in kwargs:
                kwargs["user"] = user
            return view(*args, **kwargs)
        return wrapper
    return decorator


def permission_required(required, mode=PAGE):
    """`required` is one permission name or a list of names (any-of).
    An empty list allows everyone - even anonymous visitors."""
    requirements = [required] if isinstance(required, str) else list(required or [])

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            user = None
            if requirements:
                valid, user = Session.check(request.cookies.get("session_id"))
                if not valid:
                    return _denied(mode)
                if not user.has_any(requirements):
                    return _denied_permission(mode, request.endpoint)
            if user is not None and "user" not in kwargs:
                kwargs["user"] = user
            return view(*args, **kwargs)
        return wrapper
    return decorator
