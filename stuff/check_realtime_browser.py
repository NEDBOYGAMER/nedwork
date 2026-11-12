"""End-to-end browser smoke for Socials + Events realtime updates."""
import os
import socket
import sys
import tempfile
import threading
import time
import logging

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""
tmp = tempfile.mkdtemp()
db_file = os.path.join(tmp, "app.db")
os.environ["NEDWORK_DB_PATH"] = db_file
os.environ["NEDWORK_WS_SWEEP_SECONDS"] = "0.25"

import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User, EventModule  # noqa: E402

app = create_app()
app.config["TESTING"] = True

with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    for name in ("alice", "bob"):
        user = User.query.filter_by(username=name).first()
        if user is None:
            user = User(username=name, email=f"{name}@test.local")
            user.set_password("smoke-password")
            user.generate_key()
            db.session.add(user)
            db.session.flush()
            user.grant_permission("core")
    db.session.commit()
    bob_id = User.query.filter_by(username="bob").first().id


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


APP_PORT = free_port()
WS_PORT = free_port()
BASE = f"http://127.0.0.1:{APP_PORT}"

from waitress import serve  # noqa: E402
from flask_app.ws.server import run_server  # noqa: E402

logging.getLogger("websockets").setLevel(logging.CRITICAL)
threading.Thread(
    target=lambda: serve(app, host="127.0.0.1", port=APP_PORT, threads=4),
    daemon=True).start()
threading.Thread(
    target=run_server, args=("127.0.0.1", WS_PORT), daemon=True).start()
if not wait_for_port(APP_PORT) or not wait_for_port(WS_PORT):
    print("FAIL: app or relay did not start")
    sys.exit(1)

FAILS = []


def check(name, cond, detail=""):
    print(f"{'  ok' if cond else 'FAIL'}  {name}"
          + ("" if cond else f" — {detail}"))
    if not cond:
        FAILS.append(name)


def login(page, username):
    page.goto(f"{BASE}/auth/login")
    page.wait_for_load_state("networkidle")
    page.fill("#username", username)
    page.fill("#password", "smoke-password")
    with page.expect_navigation():
        page.click("button.btn-primary")


from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    context1 = browser.new_context()
    context2 = browser.new_context()
    for context in (context1, context2):
        context.add_init_script(
            f"window.NEDWORK_WS_URL = 'ws://127.0.0.1:{WS_PORT}/ws/notifications';")
    page1 = context1.new_page()
    page2 = context2.new_page()
    errors = []
    for page in (page1, page2):
        page.on("console", lambda m: errors.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

    login(page1, "alice")
    login(page2, "bob")

    page1.goto(f"{BASE}/socials/")
    page2.goto(f"{BASE}/socials/")
    page1.wait_for_load_state("networkidle")
    page2.wait_for_load_state("networkidle")
    time.sleep(0.5)

    page1.evaluate("""async () => {
        const r = await fetch('/socials/api/friends', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username: 'bob'}),
        });
        return r.status;
    }""")
    page2.wait_for_function(
        "() => document.getElementById('incomingList')?.innerText.includes('alice')",
        timeout=5000)
    check("friend request appears live", True)

    page2.goto(f"{BASE}/events/")
    page2.wait_for_load_state("networkidle")
    time.sleep(0.5)

    event = page1.evaluate("""async () => {
        const r = await fetch('/events/api/events', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title: 'Live smoke', template: 'game_night'}),
        });
        return await r.json();
    }""")
    event_id = event["event"]["id"]
    page1.evaluate(f"""async () => {{
        const r = await fetch('/events/api/events/{event_id}/members', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{user_ids: [{bob_id}]}}),
        }});
        return r.status;
    }}""")
    page2.wait_for_function(
        "() => document.body.innerText.includes('Live smoke')", timeout=5000)
    check("event invite appears live in the list", True)

    with app.app_context():
        chat_id = EventModule.query.filter_by(
            event_id=event_id, type="chat").first().id

    page2.goto(f"{BASE}/events/{event_id}/")
    page2.wait_for_load_state("networkidle")
    time.sleep(0.5)

    page2.evaluate(f"""async () => {{
        const r = await fetch('/events/api/events/{event_id}/rsvp', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{rsvp: 'attending'}}),
        }});
        return r.status;
    }}""")
    page2.wait_for_selector(".chat-form input", timeout=5000)
    page2.fill(".chat-form input", "draft message")
    page2.focus(".chat-form input")

    page1.evaluate(f"""async () => {{
        const r = await fetch('/events/api/modules/{chat_id}/chat', {{
            method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{text: 'hello live'}}),
        }});
        return r.status;
    }}""")
    page2.wait_for_function(
        "() => document.getElementById('chatLog')?.innerText.includes('hello live')",
        timeout=5000)
    check("event chat appears live", True)
    check("chat composer keeps its draft",
          page2.input_value(".chat-form input") == "draft message",
          page2.input_value(".chat-form input"))

    check("no console/page errors", not errors, str(errors[:3]))
    browser.close()

print(f"\n{len(FAILS)} failed")
if FAILS:
    for name in FAILS:
        print("FAILED:", name)
    sys.exit(1)
