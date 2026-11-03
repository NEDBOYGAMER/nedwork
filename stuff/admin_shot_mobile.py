"""One-off: mobile (390px) screenshots of the admin console — login page +
every tab — to verify the §9 (<=480px) phone rules that were never
screenshot-checked. Also takes 1280px reference shots so the >=860px
breakpoints can be eyeballed for regressions."""
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
    users = {}
    for name in ("shot", "buddy", "third"):
        u = User.query.filter_by(username=name).first()
        if u is None:
            u = User(username=name, email=f"{name}@test.local")
            u.set_password("shot-pw")
            u.generate_key()
            db.session.add(u)
            db.session.flush()
            u.grant_permission("core")
        users[name] = u
    if PendingLogin.query.count() == 0:
        db.session.add(PendingLogin(
            name="waiter",
            email="waiter@test.local",
            password_hash=generate_password_hash("whatever"),
            requested_at=db.func.now()))
    g = Group.query.filter_by(name="Shot Crew").first()
    if g is None:
        g = Group(name="Shot Crew")
        db.session.add(g)
        db.session.flush()
        for u in users.values():
            db.session.add(UserGroup(user_id=u.id, group_id=g.id, role="owner"))
    db.session.commit()
    from flask_app.models import AdminCredential
    cred = AdminCredential.query.first()
    cred.set_password("shot-admin-pw")
    db.session.commit()

from waitress import serve
import threading
PORT = 5065
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(out, exist_ok=True)
TABS = ["pending", "users", "apps", "permissions", "groups",
        "suggestions", "changelog", "settings"]

with sync_playwright() as p:
    b = p.chromium.launch()

    # 390px phone pass
    m = b.new_page(viewport={"width": 390, "height": 844})
    m.goto(f"{BASE}/admin"); m.wait_for_load_state("networkidle")
    time.sleep(0.6)
    m.screenshot(path=os.path.join(out, "admin_mobile_login.png"), full_page=True)
    m.fill("#admin-login-password", "shot-admin-pw")
    m.click("#admin-login-btn")
    m.wait_for_load_state("networkidle")
    time.sleep(0.8)
    for tab in TABS:
        m.click(f'.nav-link[data-tab="{tab}"]')
        time.sleep(0.8)
        m.screenshot(path=os.path.join(out, f"admin_mobile_{tab}.png"),
                     full_page=True)

    # 1280px regression reference
    d = b.new_page(viewport={"width": 1280, "height": 800})
    d.goto(f"{BASE}/admin"); d.wait_for_load_state("networkidle")
    time.sleep(0.6)
    d.screenshot(path=os.path.join(out, "admin_desktop_login.png"), full_page=True)
    d.fill("#admin-login-password", "shot-admin-pw")
    d.click("#admin-login-btn")
    d.wait_for_load_state("networkidle")
    time.sleep(0.8)
    for tab in TABS:
        d.click(f'.nav-link[data-tab="{tab}"]')
        time.sleep(0.7)
        d.screenshot(path=os.path.join(out, f"admin_desktop_{tab}.png"),
                     full_page=True)
    b.close()
print("admin shots saved")