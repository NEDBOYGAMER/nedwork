"""One-off: mobile (390px) screenshots of the socials page — friends tab,
groups tab, group detail modal — to verify the ≤640px rules that were
never screenshot-checked."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User, Friendship, SocialGroup, SocialGroupMember
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
    db.session.commit()
    users["shot"].friends.append(users["buddy"])
    users["shot"].friends.append(users["third"])
    db.session.add(Friendship(request_sender_id=users["buddy"].id,
                              request_receiver_id=users["shot"].id,
                              status="pending"))
    g = SocialGroup.query.filter_by(name="Movie Crew").first()
    if g is None:
        g = SocialGroup(name="Movie Crew",
                        description="Weekend films and long debates",
                        join_code="TESTCODE")
        db.session.add(g); db.session.flush()
        db.session.add(SocialGroupMember(group_id=g.id,
                                         user_id=users["shot"].id,
                                         role="owner", status="active"))
        db.session.add(SocialGroupMember(group_id=g.id,
                                         user_id=users["buddy"].id,
                                         status="pending"))
    db.session.commit()

from waitress import serve
import threading
PORT = 5064
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    m = b.new_page(viewport={"width": 390, "height": 844})
    m.goto(f"{BASE}/auth/login"); m.wait_for_load_state("networkidle")
    m.fill("#username", "shot"); m.fill("#password", "shot-pw")
    with m.expect_navigation():
        m.click("button.btn-primary")

    m.goto(f"{BASE}/socials/"); m.wait_for_load_state("networkidle")
    time.sleep(0.6)
    m.screenshot(path=os.path.join(out, "socials_mobile_friends.png"),
                 full_page=True)
    m.click("[data-view='groups']"); time.sleep(0.6)
    m.screenshot(path=os.path.join(out, "socials_mobile_groups.png"),
                 full_page=True)
    m.click("#groupsList .group-tile .btn"); time.sleep(0.6)
    m.screenshot(path=os.path.join(out, "socials_mobile_group_detail.png"))
    b.close()
print("mobile shots saved")
