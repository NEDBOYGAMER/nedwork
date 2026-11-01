"""One-off: boot the app, build a Movie Night with location + members +
doodle + chat, screenshot the reworked view (two-col members, quadratic
map, two-col doodle, hero flush to the sidenav). Throwaway DB."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    users = {}
    for name in ("shot", "pal1", "pal2", "pal3", "pal4"):
        u = User(username=name, email=f"{name}@test.local")
        u.set_password("shot-pw")
        u.generate_key()
        db.session.add(u)
        db.session.flush()
        u.grant_permission("core")
        users[name] = u.id
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

CSRF = None

def jfetch(page, path, method="GET", body=None):
    return page.evaluate("""async ([path, method, body, csrf]) => {
        const r = await fetch(path, {method, credentials:'same-origin',
            headers:{'Content-Type':'application/json', 'X-CSRF-Token': csrf},
            body: body ? JSON.stringify(body) : undefined});
        return {status: r.status, data: await r.json().catch(() => ({}))};
    }""", [path, method, body, CSRF])

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.goto(f"{BASE}/auth/login"); page.wait_for_load_state("networkidle")
    page.fill("#username", "shot"); page.fill("#password", "shot-pw")
    with page.expect_navigation():
        page.click("button.btn-primary")
    time.sleep(0.5)
    CSRF = page.evaluate("() => document.cookie.split('; ').find(c => c.startsWith('csrf_token=')).split('=')[1]")

    page.goto(f"{BASE}/events/")
    page.wait_for_load_state("networkidle"); time.sleep(0.5)
    page.click("#newEventBtn")
    page.fill("#eventTitle", "Movie Night at Lena's")
    page.fill("#eventSubtitle", "Snacks at my place — bring a friend")
    page.select_option("#eventTemplate", "movie_night")
    page.click("#eventSaveBtn")
    page.wait_for_url(f"{BASE}/events/1/")
    time.sleep(1.2)

    r = jfetch(page, "/events/api/events/1/data")
    mods = r["data"]["modules"]

    # members: add 5 so the two-column list has something to show
    jfetch(page, "/events/api/events/1/members", "POST",
           {"user_ids": [users[k] for k in ("pal1", "pal2", "pal3", "pal4")]})
    # location: address + coords -> map renders
    loc = next(m for m in mods if m["type"] == "location")
    jfetch(page, f"/events/api/modules/{loc['id']}/content", "PATCH",
           {"address": "Kunstmuseum Basel, Picassoplatz 1, 4051 Basel",
            "lat": 47.5596, "lng": 7.5886, "note": "Meet at the main entrance."})
    # doodle: date mode with 6 candidate days -> two columns fill
    doodle = next(m for m in mods if m["type"] == "doodle")
    jfetch(page, f"/events/api/modules/{doodle['id']}/options", "POST",
           {"days": ["2026-11-13", "2026-11-14", "2026-11-15",
                      "2026-11-20", "2026-11-21", "2026-11-22"]})
    # description + image + chat
    desc = next(m for m in mods if m["type"] == "description")
    jfetch(page, f"/events/api/modules/{desc['id']}/content", "PATCH",
           {"text": "We watch Arrival, then order pizza. Bring a blanket."})
    img = next(m for m in mods if m["type"] == "image")
    jfetch(page, f"/events/api/modules/{img['id']}/content", "PATCH",
           {"url": "/static/img/about/header_img.png"})
    chat = jfetch(page, "/events/api/events/1/modules", "POST",
                  {"type": "chat"})
    jfetch(page, f"/events/api/modules/{chat['data']['module']['id']}/chat",
           "POST", {"text": "I can bring the projector cable."})
    jfetch(page, "/events/api/events/1/publish", "POST")
    jfetch(page, "/events/api/events/1", "PATCH",
           {"event_date": "2026-11-14T19:30"})

    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.5)
    # horizontal-scrollbar check (hero breakout must not leak)
    overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    print("desktop overflow-x px:", overflow)
    page.screenshot(path=os.path.join(out, "ev5-full.png"), full_page=True)
    page.locator(".event-info-row").screenshot(path=os.path.join(out, "ev5-info-row.png"))
    page.locator(".doodle-table").screenshot(path=os.path.join(out, "ev5-doodle.png"))

    # mobile: one-column members + doodle, full-width square map
    page.set_viewport_size({"width": 390, "height": 844})
    time.sleep(0.8)
    page.reload(); page.wait_for_load_state("networkidle"); time.sleep(1.2)
    overflow_m = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    print("mobile overflow-x px:", overflow_m)
    page.screenshot(path=os.path.join(out, "ev5-mobile.png"), full_page=True)
    b.close()
print("done")
