"""Admin console: a standalone operator site.

The console has its own identity (admin_credential + admin_sessions,
cookie "admin_session") — completely separate from the user auth (/auth)
and from site permissions. The admin is not a user: no user row, no
permissions, no way to be referenced by normal user features.

All console data endpoints are guarded by admin_required; the /admin
page itself renders the flat login when unauthenticated.
"""

from datetime import datetime, timezone, timedelta
import os
import re
import secrets
import shutil

from flask import Blueprint, render_template, jsonify, request, make_response, current_app
import sqlalchemy as sa

from .. import db
from ..models import *
from ..auth.decorators import admin_required, API
from ..permissions import BASE_PERMISSIONS
from ..about.routes import _read, _write, _suggestions_file

admin_bp = Blueprint('admin', __name__, static_folder='../static')

ADMIN_COOKIE = "admin_session"


# ------------------------------------------------------------------ auth
@admin_bp.route('/')
def admin_page():
    """Unauthenticated → the flat login prompt; authenticated → console."""
    if not AdminSession.check(request.cookies.get(ADMIN_COOKIE)):
        response = make_response(render_template('admin/login.html'))
    else:
        response = make_response(render_template('admin/admin.html'))
    # never cache either page: a cached console must never fake a session
    response.headers["Cache-Control"] = "no-store"
    return response


@admin_bp.route('/api/login', methods=['POST'])
def api_login():
    """Password-only login: the console has exactly one operator identity
    (single fixed credential row)."""
    data = request.get_json(silent=True) or {}
    credential = AdminCredential.query.get(1)
    if credential is None or not credential.check_password(data.get("password") or ""):
        return jsonify({"success": False, "error": "Wrong password"}), 401

    session = AdminSession(
        session_id=secrets.token_urlsafe(32),
        # 15-minute sliding idle window (AdminSession.check pushes it
        # forward on every console request) — see the model docstring
        expires=datetime.now(timezone.utc) + timedelta(minutes=AdminSession.IDLE_MINUTES),
    )
    db.session.add(session)
    db.session.commit()

    response = make_response({"success": True})
    response.set_cookie(
        ADMIN_COOKIE,
        session.session_id,
        httponly=True,
        secure=True,
        samesite="Lax",
        # NO max_age on purpose: browser-session cookie — never stored on
        # disk, gone when the browser closes (one-time console login)
    )
    return response


@admin_bp.route('/api/logout', methods=['POST'])
def api_logout():
    sid = request.cookies.get(ADMIN_COOKIE)
    if sid:
        AdminSession.query.filter_by(session_id=sid).delete()
        db.session.commit()

    response = make_response({"success": True})
    # kill the session cookie AND the CSRF double-submit token - a logged
    # out console leaves nothing behind
    for name in (ADMIN_COOKIE, "csrf_token"):
        response.set_cookie(
            name,
            "",
            max_age=0,
            httponly=(name == ADMIN_COOKIE),
            secure=request.is_secure,
            samesite="Lax",
            path="/",
        )
    return response


@admin_bp.route('/api/change_password', methods=['POST'])
@admin_required(API)
def api_change_password():
    """Rotate the console credential; all console sessions are invalidated."""
    data = request.get_json(silent=True) or {}
    credential = AdminCredential.query.get(1)
    if credential is None:
        return jsonify({"error": "No admin credential exists"}), 500

    if not credential.check_password(data.get("current_password") or ""):
        return jsonify({"error": "Current password is wrong"}), 403

    new = data.get("new_password") or ""
    if len(new) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400

    credential.set_password(new)
    AdminSession.query.delete()
    db.session.commit()
    return jsonify({"success": True})


# ------------------------------------------------------------------ users
@admin_bp.route('/api/users')
@admin_required(API)
def api_users():
    users = [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "key": u.key,
            "must_change_password": bool(u.must_change_password),
            "permissions": sorted(u._permission_names()),
            "groups": [
                m.group.name for m in u.group_memberships if m.group is not None
            ],
        }
        for u in User.query.order_by(User.id).all()
    ]
    return jsonify(users)


@admin_bp.route('/api/users/<int:user_id>/permissions', methods=['POST'])
@admin_required(API)
def api_user_permissions(user_id):
    """Grant + revoke a batch of permissions on one user."""
    target = User.query.get_or_404(user_id)
    data = request.get_json(silent=True) or {}
    grant = data.get("grant") or []
    revoke = data.get("revoke") or []

    known = set(BASE_PERMISSIONS) | {p.name for p in Permission.query.all() if p}

    unknown = [n for n in (grant + revoke) if n not in known]
    if unknown:
        return jsonify({"error": f"Unknown permission(s): {', '.join(unknown)}"}), 400

    for name in grant:
        target.grant_permission(name)
    for name in revoke:
        target.revoke_permission(name)
    db.session.commit()

    return jsonify({"success": True, "permissions": sorted(target._permission_names())})


@admin_bp.route('/api/users/<int:user_id>/set_core', methods=['POST'])
@admin_required(API)
def api_user_approve(user_id):
    """The approval lever: grant (=approve) or revoke (=lock out) core."""
    target = User.query.get_or_404(user_id)
    data = request.get_json(silent=True) or {}
    approved = bool(data.get("approved"))

    if approved:
        target.grant_permission("core")
    else:
        target.revoke_permission("core")
        # kill live sessions so a locked-out user is out immediately
        Session.query.filter_by(user_id=target.id).delete()
    db.session.commit()
    return jsonify({"success": True, "approved": approved})


@admin_bp.route('/api/users/<int:user_id>/force_logout', methods=['POST'])
@admin_required(API)
def api_user_force_logout(user_id):
    """Kick the user out of every device NOW: all their sessions die,
    but access (permissions) stays untouched — they can log back in."""
    target = User.query.get_or_404(user_id)
    killed = Session.query.filter_by(user_id=target.id).delete()
    db.session.commit()
    return jsonify({"success": True, "kicked": bool(killed)})


@admin_bp.route('/api/users/<int:user_id>', methods=['DELETE'])
@admin_required(API)
def api_user_delete(user_id):
    """Remove the user completely: the row and ALL their data — sessions,
    permission links, dashboards + widgets, tasks, app-corner config,
    settings, apps config (colors/links configs cascade from it), group
    memberships and friendships. This cannot be undone; the person would
    have to go through pending approval again."""
    target = User.query.get_or_404(user_id)

    # no ORM cascade on these two — cleaned manually
    UserGroup.query.filter_by(user_id=target.id).delete(synchronize_session=False)
    Friendship.query.filter(
        (Friendship.request_sender_id == target.id) |
        (Friendship.request_receiver_id == target.id)
    ).delete(synchronize_session=False)

    db.session.delete(target)
    db.session.commit()

    return jsonify({"success": True, "deleted": target.username})


@admin_bp.route('/api/users/<int:user_id>/force_password_reset', methods=['POST'])
@admin_required(API)
def api_user_force_reset(user_id):
    """Set a fresh temporary password AND force a password change at next login.
    The temp password is returned once — share it with the user out of band."""
    target = User.query.get_or_404(user_id)

    temp = secrets.token_urlsafe(12)
    target.set_password(temp)
    target.must_change_password = True
    Session.query.filter_by(user_id=target.id).delete()
    db.session.commit()

    return jsonify({"success": True, "username": target.username, "temporary_password": temp})


# ------------------------------------------------------------- permissions
@admin_bp.route('/api/permissions')
@admin_required(API)
def api_permissions():
    """Known permissions with descriptions, kind, holders, and which apps use what."""
    rows = []
    for perm in Permission.query.order_by(Permission.name).all():
        users = [up.user.username for up in perm.user_permissions if up.user]
        groups = [gp.group.name for gp in perm.group_permissions if gp.group]
        rows.append({
            "name": perm.name,
            "description": perm.description or "",
            "kind": perm.kind or "access",
            "users": users,
            "groups": groups,
            "apps": [link.app.name for link in perm.app_permissions if link.app],
        })
    return jsonify(rows)


@admin_bp.route('/api/permissions', methods=['POST'])
@admin_required(API)
def api_permission_create():
    """Create a custom permission. kind selects the flavour: "access"
    keys gate opening an app, "function" keys gate one app feature."""
    data = request.get_json(silent=True) or {}
    key = (data.get("key") or "").strip()
    description = (data.get("description") or "").strip()
    kind = (data.get("kind") or "access").strip()
    if kind not in ("access", "function"):
        return jsonify({"error": "kind must be 'access' or 'function'"}), 400

    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9_.-]{1,38}[a-z0-9]|[a-z0-9])", key):
        return jsonify({
            "error": "Key must be 2-40 chars: lowercase letters, numbers, dots, dashes or underscores"
        }), 400

    if Permission.query.filter_by(name=key).first() is not None:
        return jsonify({"error": "That permission already exists"}), 409

    db.session.add(Permission(name=key, description=description or None, kind=kind))
    db.session.commit()
    return jsonify({"success": True}), 201


@admin_bp.route('/api/permissions/<name>', methods=['PATCH'])
@admin_required(API)
def api_permission_update(name):
    """Edit the description and/or the kind. Switching function -> access
    is refused while app links exist: they would instantly become open
    requirements (any-of) — unlink first."""
    perm = Permission.query.filter_by(name=name).first()
    if perm is None:
        return jsonify({"error": "Unknown permission"}), 404

    data = request.get_json(silent=True) or {}
    changes = {}

    if "description" in data:
        description = (data.get("description") or "").strip()
        perm.description = description or None
        changes["description"] = perm.description or ""

    if "kind" in data:
        kind = (data.get("kind") or "").strip()
        if kind not in ("access", "function"):
            return jsonify({"error": "kind must be 'access' or 'function'"}), 400
        current = perm.kind or "access"
        if kind != current:
            if current == "function" and perm.app_permissions:
                names = ", ".join(l.app.name for l in perm.app_permissions)
                return jsonify({
                    "error": f"{name} is still listed under {names} - remove those Functions entries before making it an access key"
                }), 409
            perm.kind = kind
            changes["kind"] = kind

    db.session.commit()
    return jsonify({
        "success": True,
        "name": perm.name,
        "description": perm.description or "",
        "kind": perm.kind or "access",
        **changes,
    })


@admin_bp.route('/api/permissions/<name>', methods=['DELETE'])
@admin_required(API)
def api_permission_delete(name):
    """Refuse to delete permissions that are still granted anywhere —
    rows are deleted instead so the console stays consistent."""
    perm = Permission.query.filter_by(name=name).first()
    if perm is None:
        return jsonify({"error": "Unknown permission"}), 404

    if perm.name in BASE_PERMISSIONS:
        return jsonify({"error": "Base permissions can't be deleted"}), 400
    if perm.user_permissions:
        return jsonify({"error": "Still granted to users"}), 409
    if perm.group_permissions:
        return jsonify({"error": "Still granted to groups"}), 409
    if perm.app_permissions:
        return jsonify({"error": "Still required by apps"}), 409

    db.session.delete(perm)
    db.session.commit()
    return jsonify({"success": True})


# ----------------------------------------------------------------- pending
@admin_bp.route('/api/pending')
@admin_required(API)
def api_pending():
    """Registration requests waiting for approval, oldest first."""
    return jsonify([
        {
            "id": p.id,
            "name": p.name,
            "detail": p.email or "",
            "requested_at": p.requested_at.strftime("%d.%m.%Y") if p.requested_at else "",
        }
        for p in PendingLogin.query.order_by(PendingLogin.id).all()
    ])


def _approve_pending(pending):
    """The shared approve logic (console endpoint AND the email decision
    page both use it): promote the request to a real account - the stored
    password hash is carried over so the person's submitted password
    just starts working. Creates NO permission: the account exists but
    is locked until keys are granted.

    Returns (username, user_id); raises ValueError with a readable
    message when the username cannot be used."""
    if User.query.filter_by(username=pending.name).first() is not None:
        raise ValueError(f"Username is already taken: {pending.name}")
    if pending.name.lower() == "admin":
        raise ValueError("Username not available")

    user = User(
        username=pending.name,
        email=pending.email or f"{pending.name}@nedwork.ch",
    )
    user.password_hash = pending.password_hash
    user.generate_key()
    db.session.add(user)
    db.session.flush()  # assign user.id before the Main dashboard

    db.session.add(Dashboard(name="Main", user=user, widgets=[]))
    db.session.delete(pending)
    db.session.commit()
    return user.username, user.id


@admin_bp.route('/api/pending/<int:pending_id>/approve', methods=['POST'])
@admin_required(API)
def api_pending_approve(pending_id):
    """Promote the request to a real account. Approving does NOT grant
    any permission: the account exists but is locked until 'Approve'
    grants it core in the Users tab."""
    pending = PendingLogin.query.get_or_404(pending_id)
    try:
        username, user_id = _approve_pending(pending)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    return jsonify({"success": True, "username": username, "id": user_id})


@admin_bp.route('/api/pending/<int:pending_id>/deny', methods=['POST'])
@admin_required(API)
def api_pending_deny(pending_id):
    """Discard the request — nothing is notified, the row just goes."""
    pending = PendingLogin.query.get_or_404(pending_id)
    db.session.delete(pending)
    db.session.commit()
    return jsonify({"success": True})


@admin_bp.route('/api/pending/deny_all', methods=['POST'])
@admin_required(API)
def api_pending_deny_all():
    count = PendingLogin.query.count()
    PendingLogin.query.delete()
    db.session.commit()
    return jsonify({"success": True, "denied": count})


# -------------------------------------------------------------------- apps
# The Apps tab is the live interface to the app catalog (the DB-backed
# apps.json): create/edit apps, set title/link/types/description, upload
# the tile image, and assign permission keys — "requires to open" (access
# keys, any-of) and "functions" (function keys, documentation for the
# console: the feature's own permission_required decorator enforces them).

IMG_EXT_BY_MAGIC = None  # filled by _sniff_image_ext below


def _apps_img_dir():
    """static/img/apps — the app-corner resolves App.image as
    STATIC_URL + 'img/apps' + <image>, so uploads must land exactly here."""
    d = os.path.join(current_app.root_path, "static", "img", "apps")
    os.makedirs(d, exist_ok=True)
    return d


def _apps_img_bin_dir():
    d = os.path.join(_apps_img_dir(), "bin")
    os.makedirs(d, exist_ok=True)
    return d


def _image_file_for(image_value):
    """Resolve a stored App.image ("/foo.png") to a safe absolute path
    inside static/img/apps, or None when it points nowhere real."""
    if not image_value or image_value == "/placeholder":
        return None
    return os.path.join(_apps_img_dir(), os.path.basename(image_value))


def _sniff_image_ext(data: bytes):
    """File-type from magic bytes; svg is detected as text. Returns the
    canonical extension or None for anything we do not accept."""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    head = data[:512].lstrip()
    if head.startswith(b"<?xml") or head.startswith(b"<svg"):
        return ".svg"
    return None


def _clean_types(raw):
    """Trim/dedupe/limit a submitted type list -> list[str] (max 6)."""
    out = []
    for item in (raw or []):
        t = str(item or "").strip()[:40]
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t)
        if len(out) >= 6:
            break
    return out


MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


@admin_bp.route('/api/apps')
@admin_required(API)
def api_apps():
    """The catalog for the Apps tab: access links ("requires to open")
    and function links ("functions") listed separately by kind."""
    from ..permissions import permission_kind
    rows = []
    for a in App.query.order_by(App.id).all():
        access, functions = [], []
        for link in a.permissions:
            if link.permission and permission_kind(link.permission.name) == "function":
                functions.append(link.permission.name)
            elif link.permission:
                access.append(link.permission.name)
        rows.append({
            "id": a.id,
            "name": a.name,
            "slug": a.slug,
            "url": a.url or "",
            "image": a.image or "",
            "types": [t.type for t in a.types],
            "description": a.description or "",
            "permissions": sorted(access),
            "functions": sorted(functions),
        })
    return jsonify(rows)


@admin_bp.route('/api/apps', methods=['POST'])
@admin_required(API)
def api_app_create():
    """Create a catalog entry (a placeholder tile until the app exists)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    slug = (data.get("slug") or "").strip().lower()
    url = (data.get("url") or "").strip()
    description = (data.get("description") or "").strip()[:300]
    types = _clean_types(data.get("types"))

    if not 2 <= len(name) <= 40 or not name.replace(" ", "").replace("-", "").replace("_", "").isalnum():
        return jsonify({"error": "Name must be 2-40 characters (letters, numbers, spaces, - or _)"}), 400

    if not slug:
        slug = name.lower().replace(" ", "-").replace("_", "-")
        slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9]|[a-z0-9])", slug):
        return jsonify({"error": "Slug must be 2-40 characters: lowercase letters, numbers or dashes"}), 400

    if App.query.filter_by(name=name).first() is not None or App.query.filter_by(slug=slug).first() is not None:
        return jsonify({"error": "An app with that name or slug already exists"}), 409

    if url and not url.startswith("/"):
        return jsonify({"error": "The link must be a site path starting with / (e.g. /colors)"}), 400

    app = App(
        id=(db.session.query(sa.func.max(App.id)).scalar() or 0) + 1,
        name=name,
        slug=slug,
        url=url or f"/{slug}",
        image="/placeholder",
        description=description or None,
    )
    db.session.add(app)
    db.session.flush()
    app.set_types(types)
    db.session.commit()
    return jsonify({"success": True, "id": app.id, "slug": app.slug}), 201


@admin_bp.route('/api/apps/<slug>', methods=['PATCH'])
@admin_required(API)
def api_app_update(slug):
    """Edit title, link, description and types. The slug is the stable
    identifier (app-corner favourites/recent reference app ids, the link
    is what users open) and stays fixed after creation."""
    app = App.query.filter_by(slug=slug).first()
    if app is None:
        return jsonify({"error": "Unknown app"}), 404

    data = request.get_json(silent=True) or {}

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not 2 <= len(name) <= 40 or not name.replace(" ", "").replace("-", "").replace("_", "").isalnum():
            return jsonify({"error": "Name must be 2-40 characters (letters, numbers, spaces, - or _)"}), 400
        taken = App.query.filter(App.name == name, App.id != app.id).first()
        if taken is not None:
            return jsonify({"error": "An app with that name already exists"}), 409
        app.name = name

    if "url" in data:
        url = (data.get("url") or "").strip()
        if url and not url.startswith("/"):
            return jsonify({"error": "The link must be a site path starting with / (e.g. /colors)"}), 400
        app.url = url or None

    if "description" in data:
        app.description = (data.get("description") or "").strip()[:300] or None

    if "types" in data:
        app.set_types(_clean_types(data.get("types")))

    db.session.commit()
    return jsonify({"success": True})


@admin_bp.route('/api/apps/<slug>', methods=['DELETE'])
@admin_required(API)
def api_app_delete(slug):
    """Remove the catalog entry. Its uploaded tile image is not deleted —
    it moves to static/img/apps/bin/ (nothing is ever hard-deleted)."""
    app = App.query.filter_by(slug=slug).first()
    if app is None:
        return jsonify({"error": "Unknown app"}), 404

    moved = None
    src = _image_file_for(app.image)
    if src is not None and os.path.isfile(src):
        dst = os.path.join(_apps_img_bin_dir(), os.path.basename(src))
        try:
            shutil.move(src, dst)
            moved = os.path.basename(src)
        except OSError:
            pass  # keep deleting the row even if the file is locked

    db.session.delete(app)
    db.session.commit()
    return jsonify({"success": True, "image_binned": moved})


@admin_bp.route('/api/apps/<slug>/image', methods=['POST'])
@admin_required(API)
def api_app_image(slug):
    """Tile image upload: drag & drop or file picker. The file is sniffed
    by magic bytes, saved as static/img/apps/<slug><ext> and linked —
    exactly the place the app corner resolves tiles from."""
    app = App.query.filter_by(slug=slug).first()
    if app is None:
        return jsonify({"error": "Unknown app"}), 404

    file = request.files.get("image")
    if file is None or not file.filename:
        return jsonify({"error": "No image uploaded"}), 400

    data = file.read()
    if not data:
        return jsonify({"error": "The uploaded file is empty"}), 400
    if len(data) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 5 MB)"}), 400

    ext = _sniff_image_ext(data)
    if ext is None:
        return jsonify({"error": "Unsupported image type (use PNG, JPEG, GIF, WebP or SVG)"}), 400

    filename = f"{app.slug}{ext}"
    filepath = os.path.join(_apps_img_dir(), filename)

    # a previous tile with a different extension must not linger
    for old in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        if old == ext:
            continue
        stale = os.path.join(_apps_img_dir(), app.slug + old)
        if os.path.isfile(stale):
            try:
                os.remove(stale)
            except OSError:
                pass

    with open(filepath, "wb") as f:
        f.write(data)

    app.image = f"/{filename}"
    db.session.commit()
    return jsonify({"success": True, "image": app.image})


@admin_bp.route('/api/apps/<slug>/permissions', methods=['POST'])
@admin_required(API)
def api_app_permission_toggle(slug):
    """"Requires to open" chip: link/unlink an ACCESS key on the app
    (any-of next to the app's other access keys)."""
    return _toggle_app_link(slug, wanted_kind="access")


@admin_bp.route('/api/apps/<slug>/functions', methods=['POST'])
@admin_required(API)
def api_app_function_toggle(slug):
    """Functions chip: link/unlink a FUNCTION key on the app. Purely
    documentary (the feature's own decorator enforces it); the server
    keeps the kinds strictly separate."""
    return _toggle_app_link(slug, wanted_kind="function")


def _toggle_app_link(slug, wanted_kind):
    app = App.query.filter_by(slug=slug).first()
    if app is None:
        return jsonify({"error": "Unknown app"}), 404

    data = request.get_json(silent=True) or {}
    permission = (data.get("permission") or "").strip()
    granted = bool(data.get("granted"))

    perm = Permission.query.filter_by(name=permission).first()
    if perm is None:
        return jsonify({"error": f"Unknown permission: {permission}"}), 400

    kind = perm.kind or "access"
    if kind != wanted_kind:
        if wanted_kind == "access":
            return jsonify({"error": f"{permission} is a function key - it belongs under Functions, not Requires to open"}), 400
        return jsonify({"error": f"{permission} is an access key - it belongs under Requires to open, not Functions"}), 400

    link = AppPermission.query.filter_by(app_id=app.id, permission_id=perm.id).first()
    if granted and link is None:
        db.session.add(AppPermission(app_id=app.id, permission_id=perm.id))
    elif not granted and link is not None:
        db.session.delete(link)
    db.session.commit()

    access, functions = [], []
    for l in app.permissions:
        if l.permission and (l.permission.kind or "access") == "function":
            functions.append(l.permission.name)
        elif l.permission:
            access.append(l.permission.name)
    return jsonify({
        "success": True,
        "permissions": sorted(access),
        "functions": sorted(functions),
    })


# ----------------------------------------------------------------- groups
@admin_bp.route('/api/groups')
@admin_required(API)
def api_groups():
    return jsonify([
        {
            "id": g.id,
            "name": g.name,
            "members": [m.user.username for m in g.user_memberships if m.user],
            "permissions": sorted(link.permission.name for link in g.permissions),
        }
        for g in Group.query.order_by(Group.name).all()
    ])


@admin_bp.route('/api/groups', methods=['POST'])
@admin_required(API)
def api_group_create():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not 3 <= len(name) <= 20 or not name.replace("-", "").replace("_", "").isalnum():
        return jsonify({"error": "Group name must be 3-20 characters (letters, numbers, - or _)"}), 400

    if Group.query.filter_by(name=name).first() is not None:
        return jsonify({"error": "A group with that name already exists"}), 409

    group = Group(name=name)
    db.session.add(group)
    db.session.commit()
    return jsonify({"success": True, "id": group.id}), 201


@admin_bp.route('/api/groups/<int:group_id>', methods=['DELETE'])
@admin_required(API)
def api_group_delete(group_id):
    group = Group.query.get_or_404(group_id)

    db.session.delete(group)
    db.session.commit()
    return jsonify({"success": True})


@admin_bp.route('/api/groups/<int:group_id>/permissions', methods=['POST'])
@admin_required(API)
def api_group_permissions(group_id):
    """Replace the group's whole permission list in one request."""
    group = Group.query.get_or_404(group_id)
    data = request.get_json(silent=True) or {}
    names = data.get("permissions") or []

    known = set(BASE_PERMISSIONS) | {p.name for p in Permission.query.all() if p}
    unknown = [n for n in names if n not in known]
    if unknown:
        return jsonify({"error": f"Unknown permission(s): {', '.join(unknown)}"}), 400

    group.set_permissions(names)
    db.session.commit()
    return jsonify({"success": True})


@admin_bp.route('/api/groups/<int:group_id>/members', methods=['POST'])
@admin_required(API)
def api_group_members(group_id):
    group = Group.query.get_or_404(group_id)
    data = request.get_json(silent=True) or {}
    add = data.get("add") or []
    remove = data.get("remove") or []

    for username in add:
        target = User.query.filter_by(username=username).first()
        if target is None:
            return jsonify({"error": f"Unknown user: {username}"}), 404
        exists = UserGroup.query.filter_by(user_id=target.id, group_id=group.id).first()
        if exists is None:
            db.session.add(UserGroup(user_id=target.id, group_id=group.id))

    remove_ids = User.query.filter(User.username.in_(remove)).all() if remove else []
    for target in remove_ids:
        UserGroup.query.filter_by(user_id=target.id, group_id=group.id).delete()

    # live sessions keep a permissions snapshot per-request; permissions
    # are re-checked on every request so no session flushing needed
    db.session.commit()
    return jsonify({"success": True})


# ------------------------------------------------------------- suggestions
@admin_bp.route('/api/suggestions')
@admin_required(API)
def api_suggestions():
    """Visitor submissions from the about page's feedback form,
    newest first. Stored as JSON under instance/data/suggestions.json."""
    items = _read(_suggestions_file())
    items = sorted(items, key=lambda s: s.get('created_at', ''), reverse=True)
    return jsonify(items)


@admin_bp.route('/api/suggestions/<item_id>', methods=['DELETE'])
@admin_required(API)
def api_delete_suggestion(item_id):
    items = _read(_suggestions_file())
    remaining = [s for s in items if s.get('id') != item_id]
    if len(remaining) == len(items):
        return jsonify({"error": "not found"}), 404
    _write(_suggestions_file(), remaining)
    return jsonify({"success": True})
