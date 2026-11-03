"""Verification for the POST + CSRF logout: a stray GET can't log anyone
out (405), a tokenless POST is refused (403), a form-POST with the correct
CSRF token logs out and clears the cookies. Temp DB; uses the Flask test
client (the CSRF path is hook-level, test client included)."""
import os, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User
app = create_app()
app.config["TESTING"] = True
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    u = User.query.filter_by(username="logout").first()
    if u is None:
        u = User(username="logout", email="logout@test.local")
        u.set_password("logout-pw")
        u.generate_key()
        db.session.add(u); db.session.flush()
        u.grant_permission("core")
    db.session.commit()

c = app.test_client()
failures = []

def jar_get(client, name):
    """werkzeug test client: _cookies is a (domain, path, name)->Cookie map"""
    for (domain, path, key), cookie in client._cookies.items():
        if key == name and domain in ("localhost", "127.0.0.1"):
            return cookie.value
    return ""

def check(name, cond):
    print(f"{'OK  ' if cond else 'FAIL'}  {name}")
    if not cond:
        failures.append(name)

# ---- login, obtain csrf cookie
r = c.post("/auth/api/login", json={"username": "logout", "password": "logout-pw"})
check("login works", r.status_code == 200)
csrf = jar_get(c, "csrf_token")
check("csrf token cookie issued", bool(csrf))
session_id = jar_get(c, "session_id")
check("session cookie issued", bool(session_id))

# ---- GET must NOT log out
r = c.get("/auth/logout")
check(f"GET /aa/logout -> 405 (got {r.status_code})", r.status_code == 405)
check("GET did not kill the session", jar_get(c, "session_id") == session_id)
r = c.get("/auth/api/who")
check("still logged in after GET", r.status_code == 200)

# ---- tokenless POST refused
olds = jar_get(c, "session_id")
r = c.post("/auth/logout", data={})
check(f"POST without token -> 403 (got {r.status_code})", r.status_code == 403)
check("tokenless POST did not kill the session",
      jar_get(c, "session_id") == olds)

# ---- POST with wrong token refused
olds = jar_get(c, "session_id")
r = c.post("/auth/logout", data={"csrf_token": "wrong" * 16})
check(f"POST wrong token -> 403 (got {r.status_code})", r.status_code == 403)
check("wrong-token POST did not kill the session",
      jar_get(c, "session_id") == olds)

# ---- form-POST with the correct token -> logout
r = c.post("/auth/logout", data={"csrf_token": csrf})
check(f"POST correct token -> 302 to login (got {r.status_code})",
      r.status_code == 302)
check("session cookie cleared", not jar_get(c, "session_id"))
check("csrf cookie cleared", not jar_get(c, "csrf_token"))
r = c.get("/auth/api/who")
check("who says anonymous after logout", r.status_code == 401)

# ---- fetch-style POST with header token still works (login again first)
r = c.post("/auth/api/login", json={"username": "logout", "password": "logout-pw"})
check("re-login works", r.status_code == 200)
h = {"X-CSRF-Token": jar_get(c, "csrf_token")}
r = c.post("/auth/api/logout", headers=h)
check(f"POST /aa/logout with header token -> 302 (got {r.status_code})",
      r.status_code == 302)

print("\n" + ("PASS: logout CSRF behavior verified"
              if not failures else f"FAILED: {failures}"))
sys.exit(1 if failures else 0)
