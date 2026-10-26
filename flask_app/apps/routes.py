from flask import Blueprint, render_template, abort, send_from_directory, redirect, url_for, request
import os

from ..models import Session
from ..permissions import required_permissions_for

apps_bp = Blueprint(
    'apps',
    __name__,
    template_folder='.',    # Tells Flask to look inside flask_app/apps/ for templates
    static_folder='.'
)

# The app's HTML page is the true gate: the catalog decides which
# permission it takes (empty list = public), unknown apps are locked by
# default (login + "core"). Static JS/CSS next to the page stays public —
# it holds no user data; the APIs inside each app enforce their own
# permissions. The .html files themselves go through the same gate as
# the page route (they used to leak through the static catch-all).


def _page_gate(app_name):
    """The one permission gate for app pages — used by the page route
    AND by the static catch-all (for *.html requests), so both doors
    always agree. Returns None when access is allowed, else the
    redirect/403 response to send."""
    required = required_permissions_for(app_name)
    if not required:
        return None

    valid, user = Session.check(request.cookies.get("session_id"))
    if not valid:
        return redirect(url_for("auth.login_page"))
    if not user.has_any(required):
        return render_template("auth/forbidden.html"), 403
    return None


@apps_bp.route('/<app_name>')
def dynamic_app(app_name):
    template_relative_path = f"{app_name}/{app_name}.html"

    template_full_path = os.path.join(apps_bp.root_path, template_relative_path)

    if not os.path.exists(template_full_path):
        abort(404)

    denied = _page_gate(app_name)
    if denied is not None:
        return denied

    return render_template(template_relative_path, app_name=app_name)

@apps_bp.route('/<app_name>/<path:filename>')
def app_static(app_name, filename):
    # *.html is a page request, not an asset: the raw HTML of a
    # client-side app would otherwise bypass the page's permission gate
    if filename.lower().endswith(".html"):
        template_relative_path = f"{app_name}/{app_name}.html"
        template_full_path = os.path.join(apps_bp.root_path, template_relative_path)
        if not os.path.exists(template_full_path):
            abort(404)

        denied = _page_gate(app_name)
        if denied is not None:
            return denied

        return redirect(url_for("apps.dynamic_app", app_name=app_name))

    # static assets are shared between public and gated apps intentionally
    app_folder = os.path.join(apps_bp.root_path, app_name)
    file_path = os.path.join(app_folder, filename)


    if not os.path.exists(file_path):
        abort(404)

    return send_from_directory(app_folder, filename)
