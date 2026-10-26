"""Site-wide permission layer.

Permissions are named strings stored in the `permissions` table and
attached to users (user_permissions) or to groups (group_permissions) —
see models.py.

The site admin is NOT part of this system: the console operator is a
standalone identity (admin_credential + admin_sessions, guarded by the
admin_session cookie) and can never be granted site permissions.

This module owns the *catalog* rules (which app needs which permission,
sourced from data/apps.json), the boot-time seed/bootstrap
(ensure_permissions + ensure_admin_credential).

Catalog rules:
- an app entry's "permissions" list is what a user needs (any-of)
- letters like "core" mean login + site membership (revocable approval)
- an empty list means the page is public (no login needed)
- an app NOT present in the catalog is locked by default → ["core"]
"""

import json
import os
import secrets

from flask import current_app

from . import db
from .models import AdminCredential, App, AppPermission, Permission, User

# ------------------------------------------------------- known permissions
# Seeded on boot so the admin panel always has the fixed set available.
# kind: "access" keys gate opening an app (any-of); "function" keys gate
# one feature inside an app (the endpoint's own decorator enforces it).
BASE_PERMISSIONS = {
    "core": ("Dashboard, tasks, events, appstore + everything else not gated further", "access"),
    "tierforge": ("Access to the TierForge app", "access"),
    "colors_ai": ("Access to the Colors app's AI palette generator", "function"),
}


# -------------------------------------------------------------- app access
def load_apps():
    """The appstore catalog — DB-backed now (App model). Rows are seeded
    from data/apps.json on first boot; the console manages them from there.
    Returned in the legacy apps.json entry shape so all consumers keep
    the same contract."""
    return [a.to_dict() for a in App.query.order_by(App.id).all()]


def required_permissions_for(app_name):
    """Permissions needed to open /apps/<app_name> (any-of, implied admin).
    Unknown apps are locked by default: login + core membership required.

    Function-kind permission links are filtered out: a function key (like
    colors_ai) gates ONE feature inside the app, never the app itself."""
    if app_name is None:
        return ["core"]
    for app in load_apps():
        url_name = (app.get("url") or "").lstrip("/")
        if url_name == app_name:
            required = [
                name for name in (app.get("permissions") or [])
                if permission_kind(name) == "access"
            ]
            return required
    return ["core"]


def permission_kind(name):
    """The kind ("access" | "function") of a permission key; unknown
    names count as "access" so gating stays closed by default."""
    perm = Permission.query.filter_by(name=name).first()
    return (perm.kind if perm is not None and perm.kind else "access") or "access"


def catalog_for(user):
    """apps.json entries annotated with a per-user "locked" flag.
    Anonymous visitors get lock=True for everything but public apps.

    Function-kind links never count towards locking (see
    required_permissions_for) — they gate features, not the app."""
    held = set()
    if user is not None:
        held = user._permission_names()
    out = []
    for app in load_apps():
        required = [
            name for name in (app.get("permissions") or [])
            if permission_kind(name) == "access"
        ]
        app = dict(app)
        if not required:
            app["locked"] = False
        else:
            app["locked"] = user is None or not any(n in held for n in required)
        out.append(app)
    return out


# --------------------------------------------------------------- bootstrap
def ensure_permissions():
    """Create the seeded Permission rows and keep their canonical values
    (description, kind) in sync — BASE_PERMISSIONS is owned by the seed."""
    for name, (description, kind) in BASE_PERMISSIONS.items():
        perm = Permission.query.filter_by(name=name).first()
        if perm is None:
            db.session.add(Permission(name=name, description=description, kind=kind))
        else:
            if not perm.description:
                perm.description = description
            if perm.kind != kind:
                perm.kind = kind
    db.session.commit()


def ensure_apps():
    """Seed the app catalog from data/apps.json — ONLY when the apps
    table is still empty, so console-made changes are never overwritten."""
    if App.query.first() is not None:
        return

    path = os.path.join(current_app.root_path, "data", "apps.json")
    with open(path, "r", encoding="utf-8") as f:
        seed = json.load(f)

    for entry in seed:
        app = App(
            id=entry["id"],
            name=entry["name"],
            slug=(entry.get("url") or "").lstrip("/") or entry["name"].lower(),
            image=entry.get("image"),
            url=entry.get("url"),
            type=entry.get("type"),
            description=entry.get("description"),
        )
        db.session.add(app)
        db.session.flush()
        app.set_types([entry.get("type")] if entry.get("type") else [])
        for perm_name in entry.get("permissions") or []:
            perm = Permission.query.filter_by(name=perm_name).first()
            if perm is None:
                perm = Permission(name=perm_name)
                db.session.add(perm)
                db.session.flush()
            db.session.add(AppPermission(app_id=app.id, permission_id=perm.id))
    db.session.commit()
    print("[bootstrap] app catalog seeded from data/apps.json", flush=True)

def ensure_admin_credential():
    """Create the console credential on first boot.

    The admin is not a user: the credential lives in admin_credential
    (single fixed row) and admin_sessions — completely separate from the
    users table and site permissions. Whoever watches the console at
    first boot sees the one-time password and should change it under
    Settings in the console afterwards.
    """
    credential = AdminCredential.query.get(1)
    if credential is not None:
        return

    password = secrets.token_urlsafe(16)
    credential = AdminCredential(id=1)
    credential.set_password(password)
    db.session.add(credential)
    db.session.commit()
    print(
        "\n"
        "============================================================\n"
        "  Bootstrap: admin console credential created\n"
        "  (the admin has no user account)\n"
        f"  password: {password}\n"
        "  log in at /admin — one-time print, change it in Settings\n"
        "============================================================\n",
        flush=True,
    )


def ensure_all():
    ensure_permissions()
    ensure_admin_credential()
    ensure_apps()
