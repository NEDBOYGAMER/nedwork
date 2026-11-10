from flask import Blueprint, render_template, abort, send_from_directory, redirect, url_for, request
import os
import re

from ..models import Session
from ..permissions import required_permissions_for

# No static_folder on purpose: Flask would auto-register /apps/static/<path>
# serving every file under flask_app/apps/ raw (all .py sources, app data
# JSON, uploads). The allowlisted catch-all below is the ONLY static door.
apps_bp = Blueprint(
    'apps',
    __name__,
    template_folder='.'    # Tells Flask to look inside flask_app/apps/ for templates
)

# The app's HTML page is the true gate: the catalog decides which
# permission it takes (empty list = public), unknown apps are locked by
# default (login + "core"). The .html files themselves go through the same
# gate as the page route (they used to leak through the static catch-all).

# The catch-all serves ONLY browser assets. Everything else in an app
# folder -- .py sources, data/*.json, tierforge/_uploads/ (user photos),
# townclaim/games/*.json (live games) -- is private. This is an allowlist
# on purpose: a new runtime directory must not become public by default.
ASSET_EXTS = frozenset({
    ".js", ".css", ".mjs", ".map",
    ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
})
# an app name is a folder name: no separators, no traversal, no dotfiles
APP_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# trivia ships its question bank as a runtime-fetched .json asset; no other
# app may serve .json (townclaim's games/ and data/ stay private)
JSON_ASSET_APPS = {"trivia"}


def _page_gate(app_name):
    """The one permission gate for app pages — used by the page route
    AND by the static catch-all (for *.html requests), so both doors
    always agree.

    Returns (denied_response, user): (None, user) when access is allowed,
    (response, None) when it is not. The user (or None) is passed into the
    template so self-contained app pages can identify the visitor."""
    required = required_permissions_for(app_name)
    valid, user = Session.check(request.cookies.get("session_id"))
    user = user if valid else None
    if not required:
        return None, user

    if user is None:
        return redirect(url_for("auth.login_page")), None
    if not user.has_any(required):
        return (render_template("auth/forbidden.html"), 403), None
    return None, user


@apps_bp.route('/<app_name>')
def dynamic_app(app_name):
    if not APP_NAME_RE.match(app_name):
        abort(404)

    template_relative_path = f"{app_name}/{app_name}.html"

    template_full_path = os.path.join(apps_bp.root_path, template_relative_path)

    if not os.path.exists(template_full_path):
        abort(404)

    denied, user = _page_gate(app_name)
    if denied is not None:
        return denied

    return render_template(template_relative_path, app_name=app_name,
                           user=user)

@apps_bp.route('/<app_name>/<path:filename>')
def app_static(app_name, filename):
    if not APP_NAME_RE.match(app_name):
        abort(404)

    # *.html is a page request, not an asset: the raw HTML of a
    # client-side app would otherwise bypass the page's permission gate
    if filename.lower().endswith(".html"):
        template_relative_path = f"{app_name}/{app_name}.html"
        template_full_path = os.path.join(apps_bp.root_path, template_relative_path)
        if not os.path.exists(template_full_path):
            abort(404)

        denied, _user = _page_gate(app_name)
        if denied is not None:
            return denied

        return redirect(url_for("apps.dynamic_app", app_name=app_name))

    # static assets are shared between public and gated apps intentionally
    app_folder = os.path.join(apps_bp.root_path, app_name)
    file_path = os.path.join(app_folder, filename)

    if not _is_servable_asset(filename, app_folder, file_path):
        abort(404)

    return send_from_directory(app_folder, filename)


def _is_servable_asset(filename, app_folder, file_path):
    """Allowlisted asset extension, no dotfile segments, real file, and the
    resolved path must still sit inside the app folder."""
    segments = filename.replace("\\", "/").split("/")
    if any(not seg or seg.startswith(".") for seg in segments):
        return False
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ASSET_EXTS and not (
            ext == ".json" and os.path.basename(app_folder) in JSON_ASSET_APPS):
        return False
    if not os.path.isfile(file_path):
        return False

    root = os.path.realpath(app_folder)
    resolved = os.path.realpath(file_path)
    return resolved == root or resolved.startswith(root + os.sep)
