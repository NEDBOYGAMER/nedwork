"""Verification that EVERY cookie the app issues or clears carries the
Secure flag unconditionally - over https AND over plain http (the point:
no scheme sniffing is left anywhere; the app fails closed if it is ever
served insecurely). Covers site login/logout and admin login/logout via
the raw Set-Cookie headers. Temp DB, Flask test client."""
import os, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User
from flask_app.admin.routes import ADMIN_COOKIE

app = create_app()
app.config["TESTING"] = True
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    u = User.query.filter_by(username="flagcheck").first()
    if u is None:
        u = User(username="flagcheck", email="flagcheck@test.local")
        u.set_password("flagcheck-pw")
        u.generate_key()
        db.session.add(u); db.session.flush()
        u.grant_permission("core")
        db.session.commit()
    from flask_app.models import AdminCredential
    cred = AdminCredential.query.get(1)
    cred.set_password("flagcheck-admin-pw")
    db.session.commit()

failures = []

def check(name, cond, extra=""):
    print(f"{'OK  ' if cond else 'FAIL'}  {name}{'  ' + extra if extra else ''}")
    if not cond:
        failures.append(name)

def issued(response):
    """[(name, full_header), ...] for every Set-Cookie in the response"""
    out = []
    for h in response.headers.getlist("Set-Cookie"):
        out.append((h.split("=", 1)[0].strip().lower(), h))
    return out

def check_secure(r, want_names, label):
    """every wanted cookie present AND its Set-Cookie carries Secure"""
    got = issued(r)
    for name in want_names:
        headers = [h for (n, h) in got if n == name.lower()]
        if not headers:
            check(f"{label}: {name} Set-Cookie present", False,
                  f"headers: {[n for n, _ in got]}")
            continue
        attrs = headers[0].split(";")[1:]
        check(f"{label}: {name} issued Secure",
              any(a.strip().lower() == "secure" for a in attrs))

def jar_get(client, name):
    """werkzeug test client: _cookies is a (domain, path, name)->Cookie map"""
    for (domain, path, key), cookie in client._cookies.items():
        if key == name:
            return cookie.value
    return ""

# ---- https flow: full issue + clear paths
POST = "https://localhost"
c = app.test_client()

r = c.get("/auth/login", base_url=POST)
check_secure(r, ["csrf_token"], "https GET /auth/login")

r = c.post("/auth/api/login", json={"username": "flagcheck",
                                    "password": "flagcheck-pw"}, base_url=POST)
check("https site login ok", r.status_code == 200)
check_secure(r, ["session_id"], "https site login")

# the csrf cookie only re-issues while absent - read it from the jar
csrf = jar_get(c, "csrf_token")
check("csrf token stored", bool(csrf))

r = c.post("/auth/logout", data={"csrf_token": csrf}, base_url=POST)
check("https form-POST logout ok", r.status_code == 302)
check_secure(r, ["session_id", "csrf_token"], "https logout clear")

# ---- admin console flow (fresh csrf: site logout just cleared it)
r = c.post("/admin/api/login", json={"password": "flagcheck-admin-pw"},
           base_url=POST)
check("https admin login ok", r.status_code == 200)
check_secure(r, [ADMIN_COOKIE], "https admin login")

c.get("/admin", base_url=POST)   # console visit re-issues csrf_token
admin_csrf = jar_get(c, "csrf_token")
check("csrf re-issued for console POST", bool(admin_csrf))
r = c.post("/admin/api/logout", headers={"X-CSRF-Token": admin_csrf},
           base_url=POST)
check("https admin logout ok", r.status_code == 200, f"got {r.status_code}")
check_secure(r, [ADMIN_COOKIE, "csrf_token"], "https admin logout clear")

# ---- plain http flow: proves the Secure flag is unconditional
r = app.test_client().get("/auth/login", base_url="http://localhost")
check("http GET works (no TLS here)", r.status_code == 200)
check_secure(r, ["csrf_token"], "plain http GET /auth/login")

r = app.test_client().post("/auth/api/login", json={"username": "flagcheck",
                                                    "password": "flagcheck-pw"},
                           base_url="http://localhost")
check("plain http login still answers (login is scheme-independent)",
      r.status_code == 200)
check_secure(r, ["session_id"], "plain http site login")

print("\n" + ("PASS: all cookie issue/clear paths unconditionally Secure"
              if not failures else f"FAILED: {failures}"))
sys.exit(1 if failures else 0)
