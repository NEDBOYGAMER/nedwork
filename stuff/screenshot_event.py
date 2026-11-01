"""Screenshot the events detail page for visual verification."""
import sys
import tempfile
import threading
import time
import os

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User

app = create_app()
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    u = User(username="browser", email="b@t.local")
    u.set_password("browser-pw")
    u.generate_key()
    db.session.add(u)
    db.session.commit()
    u.grant_permission("core")
    db.session.commit()

from waitress import serve

PORT = 5058
server = threading.Thread(
    target=lambda: serve(app, host="127.0.0.1", port=PORT), daemon=True)
server.start()
time.sleep(1.0)

from playwright.sync_api import sync_playwright

BASE = f"http://127.0.0.1:{PORT}"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(f"{BASE}/auth/login")
    page.wait_for_load_state("networkidle")
    page.fill("#username", "browser")
    page.fill("#password", "browser-pw")
    with page.expect_navigation(timeout=8000):
        page.click("button.btn-primary")
    page.goto(f"{BASE}/events/")
    page.wait_for_load_state("networkidle")
    page.click("#newEventBtn")
    page.fill("#eventTitle", "Movie Night at Rico's")
    page.fill("#eventSubtitle", "Popcorn, blankets, and terrible movies")
    page.select_option("#eventTemplate", "movie_night")
    page.click("#eventSaveBtn")
    page.wait_for_url("**/events/1/", timeout=8000)
    time.sleep(2.0)
    # fill notes + add members/chat so the page looks lived-in
    page.fill(".notes-editor textarea", "Bring snacks and blankets! Sofa has room for 4.")
    page.locator(".module-add-row button", has_text="Members").click()
    time.sleep(1.0)
    page.locator(".module-add-row button", has_text="Chat").click()
    time.sleep(1.0)
    page.fill(".chat-form input", "Who's bringing the popcorn?")
    page.locator(".chat-form button", has_text="Send").click()
    time.sleep(1.5)
    page.screenshot(path="stuff/events_detail.png", full_page=True)
    print("screenshot saved: stuff/events_detail.png")
    browser.close()
