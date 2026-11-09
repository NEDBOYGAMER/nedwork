"""Browser smoke for the /notifications inbox.

Throwaway DB + waitress + headless Chromium. Verifies the dot on the
sidenav, the rendered rows, the accept-friend button actually settling the
request, the unread filter, and that no console/page errors fire.

Usage:  python stuff/check_inbox_browser.py
"""
import os
import sys
import tempfile
import threading
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""

tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User, Friendship  # noqa: E402
from flask_app.notifications import notify_user  # noqa: E402

app = create_app()
app.config["TESTING"] = True

PW = "browser-pw"
with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    users = {}
    for name in ("bob", "alice"):
        u = User(username=name, email=f"{name}@test.local")
        u.set_password(PW)
        u.generate_key()
        db.session.add(u)
        db.session.flush()
        u.grant_permission("core")
        users[name] = u
    db.session.commit()
    db.session.add(Friendship(request_sender_id=users["alice"].id,
                              request_receiver_id=users["bob"].id,
                              status="pending"))
    notify_user(users["bob"], "friend_request",
                {"actor": "alice", "title": "alice"})
    notify_user(users["bob"], "event_reminder",
                {"event_id": 1, "title": "Housewarming"})
    notify_user(users["bob"], "task_deadline",
                {"task_id": 1, "title": "Send the form"})
    db.session.commit()

from waitress import serve  # noqa: E402

PORT = 5059   # 5061 is a Chromium-blocked unsafe port (SIP-TLS)
BASE = f"http://127.0.0.1:{PORT}"

FAILS = []


def check(name, cond, detail=""):
    print(f"{'  ok' if cond else 'FAIL'}  {name}" + ("" if cond else f" — {detail}"))
    if not cond:
        FAILS.append(name)


threading.Thread(
    target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
    daemon=True).start()
time.sleep(1.0)

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/auth/login")
    page.wait_for_load_state("networkidle")
    page.fill("#username", "bob")
    page.fill("#password", PW)
    with page.expect_navigation():
        page.click("button.btn-primary")

    # the dot on the dashboard
    page.wait_for_selector("#notifications-dot", state="visible", timeout=5000)
    check("sidenav dot visible when unread", page.locator("#notifications-dot").is_visible())

    page.click("#notifications-btn")
    page.wait_for_url(f"{BASE}/notifications/")
    page.wait_for_selector(".inbox-item", timeout=5000)
    time.sleep(0.3)

    check("three rows rendered", page.locator(".inbox-item").count() == 3,
          str(page.locator(".inbox-item").count()))
    check("dot is active on this page",
          "active" in (page.get_attribute("#notifications-btn", "class") or ""))
    check("friend request has an Accept button",
          page.locator(".inbox-item button:has-text('Accept friend')").count() == 1)
    check("event row has View event",
          page.locator(".inbox-item button:has-text('View event')").count() == 1)
    check("task row has View task",
          page.locator(".inbox-item button:has-text('View task')").count() == 1)

    page.click(".inbox-item button:has-text('Accept friend')")
    time.sleep(0.8)
    check("accept button gone after accepting",
          page.locator(".inbox-item button:has-text('Accept friend')").count() == 0)
    with app.app_context():
        f = Friendship.query.filter_by(status="accepted").first()
        check("friendship accepted server-side", f is not None)

    page.click("[data-filter='unread']")
    time.sleep(0.2)
    check("rows stay unread until marked",
          page.locator(".inbox-item.is-unread").count() == 2,
          str(page.locator(".inbox-item.is-unread").count()))

    page.click("[data-filter='all']")
    page.click("#markAllBtn")
    time.sleep(0.8)
    check("all read clears the dot at once",
          not page.locator("#notifications-dot").is_visible())
    page.click("[data-filter='unread']")
    time.sleep(0.2)
    check("unread filter now empty",
          page.locator(".inbox-empty").count() == 1)

    page.screenshot(path=os.path.join(tmp, "inbox.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.reload()
    page.wait_for_selector(".inbox-item", timeout=5000)
    time.sleep(0.3)
    check("no horizontal overflow on phone",
          page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
          page.evaluate("document.documentElement.scrollWidth + ' > ' + window.innerWidth"))

    print("  console/page errors:", errors[:5] or "none")
    check("no JS errors", not errors, str(errors[:3]))
    browser.close()

print()
if FAILS:
    print(f"{len(FAILS)} FAILED:")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all browser checks passed")
