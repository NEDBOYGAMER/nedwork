"""One-off: screenshot the events view mode as a *guest* (non-host) —
no Edit pill, no host-only hints. Reuses the seeded Movie Night data."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from datetime import datetime
from flask_app.models import db, User, Event, EventMember, EventModule
app = create_app()
app.config["TESTING"] = True
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    host = User(username="gshot-host", email="gshot-host@test.local")
    host.set_password("pw")
    host.generate_key()
    guest = User(username="gshot-guest", email="gshot-guest@test.local")
    guest.set_password("pw")
    guest.generate_key()
    db.session.add_all([host, guest]); db.session.flush()
    host.grant_permission("core"); guest.grant_permission("core")
    ev = Event(host_id=host.id, title="Movie Night at Lena's",
               subtitle="Snacks at my place — bring a friend",
               status="published",
               event_date=datetime(2026, 11, 14, 19, 30))
    db.session.add(ev); db.session.flush()
    db.session.add(EventMember(event_id=ev.id, user_id=host.id, role="host"))
    db.session.add(EventMember(event_id=ev.id, user_id=guest.id, role="member"))
    # mirror the server's create seeding: fixed members + movie_night specs
    db.session.add(EventModule(event_id=ev.id, type="members",
                               position=0, config={}))
    for i, t in enumerate(["description", "image", "location", "doodle",
                           "bring", "rides"]):
        db.session.add(EventModule(event_id=ev.id, type=t,
                                   position=i + 1, config={}))
    db.session.commit()
    evd = ev.id
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
    page.fill("#username", "gshot-guest"); page.fill("#password", "pw")
    with page.expect_navigation():
        page.click("button.btn-primary")
    page.goto(f"{BASE}/events/{evd}/")
    page.wait_for_load_state("networkidle"); time.sleep(1.2)
    # fill some content as the host first (guest can't)
    page.close()
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(f"{BASE}/auth/login"); page.wait_for_load_state("networkidle")
    page.fill("#username", "gshot-host"); page.fill("#password", "pw")
    with page.expect_navigation():
        page.click("button.btn-primary")
    page.goto(f"{BASE}/events/{evd}/")
    page.wait_for_load_state("networkidle"); time.sleep(1.0)
    page.evaluate("""async () => {
        const snap = await fetch('/events/api/events/%d/data', {credentials:'same-origin'}).then(r=>r.json());
        const desc = snap.modules.find(m => m.type === 'description');
        await fetch(`/events/api/modules/${desc.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({text: 'We watch Arrival, then order pizza.'})});
        const img = snap.modules.find(m => m.type === 'image');
        await fetch(`/events/api/modules/${img.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({url: '/static/img/about/header_img.png', caption: 'One of the posters'})});
        const chat = await fetch('/events/api/events/%d/modules', {method:'POST',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({type: 'chat'})}).then(r=>r.json());
        await fetch(`/events/api/modules/${chat.module.id}/chat`,
            {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({text: 'I can bring the projector cable.'})});
    }""" % (evd, evd))
    page.close()
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(f"{BASE}/auth/login"); page.wait_for_load_state("networkidle")
    page.fill("#username", "gshot-guest"); page.fill("#password", "pw")
    with page.expect_navigation():
        page.click("button.btn-primary")
    page.goto(f"{BASE}/events/{evd}/")
    page.wait_for_load_state("networkidle"); time.sleep(1.2)
    page.screenshot(path=os.path.join(out, "view-guest.png"), full_page=True)
    b.close()
print("done")
