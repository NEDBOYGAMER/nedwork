"""One-off: boot the app, create a Movie Night, screenshot the reworked
view mode (desktop no-image / hero / mobile) for visual review."""
import os, sys, tempfile, time
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
    u = User(username="shot", email="shot@test.local")
    u.set_password("shot-pw")
    u.generate_key()
    db.session.add(u)
    db.session.flush()
    u.grant_permission("core")
    db.session.commit()
from waitress import serve
import threading
PORT = 5059
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
    time.sleep(0.5)
    page.goto(f"{BASE}/events/")
    page.wait_for_load_state("networkidle"); time.sleep(0.5)
    page.click("#newEventBtn")
    page.fill("#eventTitle", "Movie Night at Lena's")
    page.fill("#eventSubtitle", "Snacks at my place — bring a friend")
    page.select_option("#eventTemplate", "movie_night")
    page.click("#eventSaveBtn")
    page.wait_for_url(f"{BASE}/events/1/")
    time.sleep(1.2)
    # set doodle date + description + image via the API (host = me)
    page.evaluate("""async () => {
        const snap = await fetch('/events/api/events/1/data', {credentials:'same-origin'}).then(r=>r.json());
        const desc = snap.modules.find(m => m.type === 'description');
        await fetch(`/events/api/modules/${desc.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({text: 'We watch Arrival, then order pizza. The projector is in the living room, bring a blanket.'})});
        const img = snap.modules.find(m => m.type === 'image');
        await fetch(`/events/api/modules/${img.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({url: '/static/img/about/header_img.png', caption: 'One of the posters'})});
        await fetch('/events/api/events/1', {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({event_date: '2026-11-14T19:30'})});
        const chat = await fetch('/events/api/events/1/modules', {method:'POST',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({type: 'chat'})}).then(r=>r.json());
        await fetch(`/events/api/modules/${chat.module.id}/chat`,
            {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
             body: JSON.stringify({text: 'I can bring the projector cable.'})});
        await fetch('/events/api/events/1/publish', {method:'POST', credentials:'same-origin'});
    }""")
    # the SPA only re-renders on a poller cycle — reload to see the mutations
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    page.screenshot(path=os.path.join(out, "view-hero.png"), full_page=True)
    page.locator(".event-hero").screenshot(path=os.path.join(out, "crop-hero.png"))
    page.locator(".event-chat").screenshot(path=os.path.join(out, "crop-chat.png"))
    # remove the image again → no-image hero variant
    page.evaluate("""async () => {
        const snap = await fetch('/events/api/events/1/data', {credentials:'same-origin'}).then(r=>r.json());
        const img = snap.modules.find(m => m.type === 'image');
        await fetch(`/events/api/modules/${img.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({url: ''})});
    }""")
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    page.screenshot(path=os.path.join(out, "view-noimg.png"), full_page=True)
    # mobile with hero back
    page.set_viewport_size({"width": 390, "height": 844})
    time.sleep(0.8)
    page.evaluate("""async () => {
        const snap = await fetch('/events/api/events/1/data', {credentials:'same-origin'}).then(r=>r.json());
        const img = snap.modules.find(m => m.type === 'image');
        await fetch(`/events/api/modules/${img.id}/content`, {method:'PATCH',
            credentials:'same-origin', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({url: '/static/img/about/header_img.png'})});
    }""")
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    page.locator(".event-hero").screenshot(path=os.path.join(out, "crop-hero-mobile.png"))
    b.close()
print("done")
