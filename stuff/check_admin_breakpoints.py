"""Regression sweep across breakpoints for the admin console: confirm the
§9 (<=480px) change didn't alter >=860px / 700px behaviour. Checks no
horizontal page scroll on every tab at 1280, 860, 701, 700, 481, 480, 320."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User, UserGroup, Group, PendingLogin
from werkzeug.security import generate_password_hash
app = create_app()
app.config["TESTING"] = True
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    for name in ("shot", "buddy", "third"):
        u = User.query.filter_by(username=name).first()
        if u is None:
            u = User(username=name, email=f"{name}@test.local")
            u.set_password("shot-pw"); u.generate_key()
            db.session.add(u); db.session.flush()
            u.grant_permission("core")
    if PendingLogin.query.count() == 0:
        db.session.add(PendingLogin(
            name="waiter", email="waiter@test.local",
            password_hash=generate_password_hash("whatever"),
            requested_at=db.func.now()))
    g = Group(name="Shot Crew")
    db.session.add(g); db.session.flush()
    for u in User.query.all():
        db.session.add(UserGroup(user_id=u.id, group_id=g.id, role="owner"))
    db.session.commit()
    from flask_app.models import AdminCredential
    cred = AdminCredential.query.first()
    cred.set_password("shot-admin-pw")
    db.session.commit()

from waitress import serve
import threading
PORT = 5068
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

TABS = ["pending", "users", "apps", "permissions", "groups",
        "suggestions", "changelog", "settings"]
VIEWPORTS = [1280, 860, 701, 700, 481, 480, 320]

with sync_playwright() as p:
    b = p.chromium.launch()
    failures = []
    print(f"{'vp':<5} " + "  ".join(f"{t[:4]:<6}" for t in TABS))
    for vp in VIEWPORTS:
        m = b.new_page(viewport={"width": vp, "height": 844})
        m.goto(f"{BASE}/admin"); m.wait_for_load_state("networkidle")
        m.fill("#admin-login-password", "shot-admin-pw")
        m.click("#admin-login-btn")
        m.wait_for_load_state("networkidle")
        time.sleep(0.6)
        row = []
        for tab in TABS:
            m.click(f'.nav-link[data-tab="{tab}"]')
            time.sleep(0.4)
            hs = m.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            row.append("OK" if not hs else "HSCROLL")
            if hs:
                failures.append((vp, tab))
        print(f"{vp:<5} " + "  ".join(f"{c:<6}" for c in row))
        m.close()
    b.close()

print("\n" + ("PASS: no horizontal scroll at any tested breakpoint"
              if not failures else f"FAIL at: {failures}"))
sys.exit(1 if failures else 0)