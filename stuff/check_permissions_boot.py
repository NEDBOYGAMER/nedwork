"""Verification for the DB-authoritative permission kind model:
- boot 1 seeds BASE_PERMISSIONS with the right kinds;
- deliberate DB edits (kind flip + new row) survive a second boot
  (ensure_permissions is create-missing only, never resets);
- gating follows the DB: a function-kind link does not lock an app;
- the admin API refuses kind changes via PATCH (delete + recreate is
  the only rekindling path), refuses deleting a granted base key, and
  still works for description edits and function-kind creates.
Temp instance dir, two app boots + test client."""
import os, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User

failures = []

def check(name, cond, extra=""):
    print(f"{'OK  ' if cond else 'FAIL'}  {name}{'  ' + extra if extra else ''}")
    if not cond:
        failures.append(name)

# ---- boot 1
app1 = create_app()
app1.config["TESTING"] = True
with app1.app_context():
    db.create_all()
    from flask_app import permissions as perms
    perms.ensure_all()

    check("core seeded as access", perms.permission_kind("core") == "access")
    check("tierforge seeded as access", perms.permission_kind("tierforge") == "access")
    check("colors_ai seeded as function", perms.permission_kind("colors_ai") == "function")

    from flask_app.models import AdminCredential
    cred = AdminCredential.query.get(1)
    cred.set_password("boot-check-pw")

    # deliberate "real DB" edits the next boot must NOT undo
    tf = perms.Permission.query.filter_by(name="tierforge").first()
    tf.kind = "function"
    tf.description = "mutated desc"
    db.session.add(perms.Permission(name="testperm", description="my key", kind="access"))
    db.session.commit()

    tf_app = perms.App.query.filter_by(slug="tierforge").first()
    check("tierforge app catalog row exists", tf_app is not None)
    check("app links key tierforge",
          tf_app and any(l.permission.name == "tierforge"
                         for l in tf_app.permissions))

    # grant a base key so the DELETE-refusal path has something to refuse
    u = User(username="permcheck", email="permcheck@test.local")
    u.set_password("permcheck-pw")
    u.generate_key()
    db.session.add(u); db.session.flush()
    u.grant_permission("core")
    db.session.commit()

# ---- boot 2 on the same instance dir
app2 = create_app()
app2.config["TESTING"] = True
with app2.app_context():
    db.create_all()
    from flask_app import permissions as perms
    perms.ensure_all()

    check("kind mutation survives boot 2 (function)",
          perms.permission_kind("tierforge") == "function")
    p = perms.Permission.query.filter_by(name="tierforge").first()
    check("description mutation survives boot 2", p.description == "mutated desc")
    custom = perms.Permission.query.filter_by(name="testperm").first()
    check("custom key survives boot 2 untouched",
          custom is not None and custom.kind == "access"
          and custom.description == "my key")
    check("core untouched by ensure", perms.permission_kind("core") == "access")

    # gating follows the DB: function-kind links never lock an app
    check("tierforge app no longer requires tierforge (function link filtered)",
          perms.required_permissions_for("tierforge") == [])

# ---- admin API: create attrs + kind-refuse + delete-refuse
# base_url https per request: the admin_session cookie is always issued
# with secure=True, the plain-http test jar would never send it back
c = app2.test_client()
HTTPS = {"base_url": "https://localhost"}
r = c.post("/admin/api/login", json={"password": "boot-check-pw"}, **HTTPS)
check("admin login ok", r.status_code == 200)
csrf = "test-csrf-token"
c.set_cookie("csrf_token", csrf)
H = {"X-CSRF-Token": csrf}

def jar_has(name):
    if name in ("csrf_token",):
        return True
    for (d, pa, k), ck in c._cookies.items():
        if k == name:
            return True
    return False

check("admin session cookie present", jar_has("admin_session"))

r = c.post("/admin/api/permissions", json={
    "key": "apitest_fn", "description": "api-made function key",
    "kind": "function"}, headers=H, **HTTPS)
check("create function key via API -> 201", r.status_code == 201, f"got {r.status_code}")

with app2.app_context():
    p = perms.Permission.query.filter_by(name="apitest_fn").first()
    check("API create stored kind=function", p is not None and p.kind == "function")

r = c.post("/admin/api/permissions", json={
    "key": "bad_kind", "kind": "banana"}, headers=H, **HTTPS)
check("create with invalid kind -> 400", r.status_code == 400)

r = c.patch("/admin/api/permissions/testperm", json={
    "kind": "function", "description": "NOPE"}, headers=H, **HTTPS)
check("PATCH kind change refused -> 400", r.status_code == 400,
      f"got {r.status_code} {r.get_json()}")
check("refusal message points at sections", "section" in (r.get_json() or {}).get("error", ""))

with app2.app_context():
    p = perms.Permission.query.filter_by(name="testperm").first()
    check("refused PATCH changed nothing (atomic)",
          p.kind == "access" and p.description == "my key")

r = c.patch("/admin/api/permissions/testperm", json={
    "description": "edited desc"}, headers=H, **HTTPS)
check("description-only PATCH works", r.status_code == 200 and
      r.get_json().get("description") == "edited desc")

with app2.app_context():
    p = perms.Permission.query.filter_by(name="testperm").first()
    check("description edit persisted", p.description == "edited desc")

# route contract: base keys are hard-protected (400) before grant checks
r = c.delete("/admin/api/permissions/core", headers=H, **HTTPS)
check("DELETE base key refused -> 400", r.status_code == 400,
      f"got {r.status_code}")

# a granted custom key: refused with 409 until its grant is removed
with app2.app_context():
    u = User.query.filter_by(username="permcheck").first()
    u.grant_permission("testperm")
    db.session.commit()
r = c.delete("/admin/api/permissions/testperm", headers=H, **HTTPS)
check("DELETE granted custom key refused -> 409", r.status_code == 409,
      f"got {r.status_code}")

with app2.app_context():
    p = perms.Permission.query.filter_by(name="testperm").first()
    check("refused DELETE left the row", p is not None)

with app2.app_context():
    u = User.query.filter_by(username="permcheck").first()
    u.revoke_permission("testperm")
    db.session.commit()
r = c.delete("/admin/api/permissions/testperm", headers=H, **HTTPS)
check("DELETE ungranted custom key works", r.status_code == 200,
      f"got {r.status_code}")

print("\n" + ("PASS: permission kind model verified"
              if not failures else f"FAILED: {failures}"))
sys.exit(1 if failures else 0)
