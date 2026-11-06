"""One-off: boot the app, screenshot the socials page (friends + groups)
and the events restructured view (description under hero + info row)."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User, Friendship, SocialGroup, SocialGroupMember
from datetime import datetime
app = create_app()
app.config["TESTING"] = True
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    users = {}
    for name in ("shot", "buddy"):
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
    # a friend + an incoming request for visual content
    users["shot"].friends.append(users["buddy"])
    db.session.add(Friendship(request_sender_id=users["buddy"].id,
                              request_receiver_id=users["shot"].id,
                              status="pending"))
    # a group with the shot user as owner + a pending join request
    g = SocialGroup.query.filter_by(name="Movie Crew").first()
    if g is None:
        g = SocialGroup(name="Movie Crew", description="Weekend films",
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
PORT = 5063
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(f"{BASE}/auth/login"); page.wait_for_load_state("networkidle")
    page.fill("#username", "shot"); page.fill("#password", "shot-pw")
    with page.expect_navigation():
        page.click("button.btn-primary")

    # socials — friends tab
    page.goto(f"{BASE}/socials/"); page.wait_for_load_state("networkidle")
    time.sleep(0.6)
    page.screenshot(path=os.path.join(out, "socials_friends.png"), full_page=True)
    # groups tab
    page.click("[data-view='groups']"); time.sleep(0.6)
    page.screenshot(path=os.path.join(out, "socials_groups.png"), full_page=True)
    # group detail modal
    page.click("#groupsList .group-tile .btn"); time.sleep(0.6)
    page.screenshot(path=os.path.join(out, "socials_group_detail.png"))
    page.keyboard.press("Escape"); time.sleep(0.3)

    # events view: create an event with description + location, then view it
    page.goto(f"{BASE}/events/"); page.wait_for_load_state("networkidle")
    page.click("#newEventBtn"); time.sleep(0.3)
    page.fill("#eventTitle", "Game Night")
    page.fill("#eventSubtitle", "Round 3 of the tournament")
    page.select_option("#eventTemplate", "movie_night")
    with page.expect_navigation():
        page.click("#eventSaveBtn")
    page.wait_for_load_state("networkidle"); time.sleep(0.6)
    if "/events/" not in page.url or page.url.rstrip("/").endswith("/events"):
        raise SystemExit("create did not navigate to the detail page: " + page.url)
    # add description + location content via the API to keep the script simple
    page.evaluate("""async () => {
        const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token=')).split('=')[1];
        const data = await (await fetch('/events/api/events/' + window.EVENT_ID + '/data')).json();
        for (const m of data.modules) {
            if (m.type === 'description') {
                await fetch('/events/api/modules/' + m.id + '/content', {
                    method: 'PATCH', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf},
                    body: JSON.stringify({text: 'Bring snacks and your best dice. We start sharp at eight — latecomers referee.'})});
            }
            if (m.type === 'location') {
                await fetch('/events/api/modules/' + m.id + '/content', {
                    method: 'PATCH', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf},
                    body: JSON.stringify({address: '12 Boardwalk Ave', lat: 47.3769, lng: 8.5417})});
            }
        }
    }""")
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.5)
    page.screenshot(path=os.path.join(out, "events_view_restructure.png"), full_page=True)
    # mobile — fresh page, log in directly
    m = b.new_page(viewport={"width": 390, "height": 844})
    m.goto(f"{BASE}/auth/login"); m.wait_for_load_state("networkidle")
    m.fill("#username", "shot"); m.fill("#password", "shot-pw")
    with m.expect_navigation():
        m.click("button.btn-primary")
    m.goto(page.url); m.wait_for_load_state("networkidle"); time.sleep(1.2)
    m.screenshot(path=os.path.join(out, "events_view_mobile.png"), full_page=True)
    b.close()
print("shots saved")
