"""Browser-level smoke test for the restructured Events site (§1-§7).

Boots the app on a temp DB (flask.Flask monkeypatch BEFORE imports),
drives headless Chromium through: login -> create event -> view mode ->
edit mode (module cards + sticky bar + doodle calendar + save) -> back to
view -> invite link landing page (§7 GET /events/invite/<token>) -> guest
join flow. Captures console errors, page errors, and failed requests.
"""
import os
import sys
import tempfile
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""  # emails must be a silent no-op here

tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User  # noqa: E402

app = create_app()
app.config["TESTING"] = True

with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    u = User(username="browser", email="browser@test.local")
    u.set_password("browser-pw")
    u.generate_key()
    db.session.add(u)
    db.session.flush()
    u.grant_permission("core")
    guest = User(username="guest", email="guest@test.local")
    guest.set_password("browser-pw")
    guest.generate_key()
    db.session.add(guest)
    db.session.flush()
    guest.grant_permission("core")
    db.session.commit()

from waitress import serve  # noqa: E402

PORT = 5057
BASE = f"http://127.0.0.1:{PORT}"

FAILS = []
PASSES = []


def check(name, cond, detail=""):
    if cond:
        PASSES.append(name)
        print(f"  ok  {name}")
    else:
        FAILS.append(f"{name} — {detail}")
        print(f"FAIL  {name} — {detail}")


import threading  # noqa: E402
server = threading.Thread(
    target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
    daemon=True)
server.start()
time.sleep(1.0)

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    console_errors = []
    page_errors = []
    failed_req = []
    page.on("console", lambda m: console_errors.append(m.text)
            if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("response", lambda r: failed_req.append(f"{r.status} {r.url}")
            if r.status >= 400 else None)

    # login (form is JS-built with #username/#password ids)
    page.goto(f"{BASE}/auth/login")
    page.wait_for_load_state("networkidle")
    page.fill("#username", "browser")
    page.fill("#password", "browser-pw")
    with page.expect_navigation():
        page.click("button.btn-primary")
    time.sleep(0.5)
    check("login lands on dashboard", "/dashboard" in page.url, page.url)

    # -- create event via the modal -------------------------------------
    page.goto(f"{BASE}/events/")
    page.wait_for_load_state("networkidle")
    time.sleep(0.5)
    check("New event button visible on list", page.locator("#newEventBtn").is_visible(), "")
    page.click("#newEventBtn")
    page.fill("#eventTitle", "Browser Test Event")
    page.select_option("#eventTemplate", "movie_night")
    page.click("#eventSaveBtn")
    page.wait_for_url(f"{BASE}/events/1/")
    print("  after create, url:", page.url)
    try:
        page.wait_for_selector(".event-section", timeout=5000)
    except Exception:
        print("  !! event sections never appeared")
        print("  console errors so far:", console_errors[:10])
        print("  page errors so far:", page_errors[:10])
        print("  failed requests so far:", failed_req[:10])
        print("  container text:", repr(page.inner_text("#container")[:300]))
        browser.close()
        sys.exit(1)
    time.sleep(0.3)

    # -- view mode (draft) ----------------------------------------------
    view_text = page.inner_text("#container")
    check("view shows title", "Browser Test Event" in view_text, view_text[:200])
    check("view shows draft banner", "Draft" in view_text, view_text[:200])
    check("view shows Edit button (host)",
          page.locator(".event-header a", has_text="Edit").count() == 1,
          view_text[:200])
    # back button in the template header (rendered server-side, §6)
    check("view has back button", page.locator(".events-back").count() == 1, "")
    check("view has event sections (unboxed page)",
          page.locator(".event-section").count() >= 5
          and page.locator(".module-card").count() == 0,
          str(page.locator(".event-section").count()))
    # the banner text mentions "Publish from Edit" — a text check would
    # false-positive; assert there is no actual Publish *button*
    check("no publish button in view mode",
          page.locator("#container button", has_text="Publish").count() == 0, "")
    check("no 'Add a module' in view mode", "Add a module" not in view_text, "")
    # add-members moved to edit mode (§2 of the rework) — never in view
    check("no 'Add members' in view mode",
          page.locator("#container button", has_text="Add members").count() == 0, "")

    # -- edit mode -------------------------------------------------------
    page.click(".event-header a:has-text('Edit')")
    page.wait_for_url(f"{BASE}/events/1/edit/")
    time.sleep(1.0)
    edit_text = page.inner_text("#container")
    check("edit page header", "Edit event" in edit_text, edit_text[:200])
    check("edit shows module cards",
          page.locator(".edit-module-card").count() >= 6,
          str(page.locator(".edit-module-card").count()))
    check("sticky save bar present", page.locator(".edit-sticky-bar").count() == 1, "")
    check("sticky bar has Save changes",
          page.locator(".edit-sticky-bar button", has_text="Save changes").count() == 1, "")
    check("sticky bar has Cancel",
          page.locator(".edit-sticky-bar button", has_text="Cancel").count() == 1, "")
    check("add-module picker present", "Add a module" in edit_text, edit_text[:400])
    check("Add members card present in edit mode",
          page.locator(".edit-module-card button", has_text="Add members").count() == 1,
          edit_text[:400])
    check("non-fixed cards have delete + drag grip",
          page.locator('.edit-module-card button[title="Delete module"]').count() >= 5
          and page.locator('.edit-module-card button[title="Drag to reorder"]').count() >= 5,
          str(page.locator('.edit-module-card button[title="Delete module"]').count()))
    # fixed cards (Title) render no toolbar at all
    check("Title card is fixed (no move arrows)",
          page.locator(".edit-module-card").first.locator(
              ".edit-module-nav").count() == 0, "")

    # doodle: calendar in date mode
    cal = page.locator(".doodle-cal")
    check("doodle calendar visible in date mode", cal.count() == 1,
          edit_text[:400])
    page.locator(".doodle-cal-day:not(.doodle-cal-blank)", has_text="14").first.click()
    time.sleep(0.2)
    check("picked day gets is-picked class",
          page.locator(".doodle-cal-day.is-picked").count() == 1, "")

    # switch doodle to time mode -> slot list appears (mode = card picker)
    page.locator(".doodle-mode-card", has_text="Pick a time").click()
    time.sleep(0.3)
    check("time mode shows slot list",
          page.locator(".doodle-slot-list").count() == 1, "")

    # back to date mode and re-pick the day (mode switch resets fields view)
    page.locator(".doodle-mode-card", has_text="Pick days").click()
    time.sleep(0.3)

    # description text into the draft
    page.locator(".edit-module-card", has_text="Description").locator(
        "textarea").fill("Snacks at my place")
    time.sleep(0.2)

    # save — should land back in view mode
    page.click(".edit-sticky-bar button:has-text('Save changes')")
    try:
        page.wait_for_url(f"{BASE}/events/1/", timeout=6000)
    except Exception:
        print("  !! save did not navigate back")
        print("  console errors:", console_errors[:10])
        print("  page errors:", page_errors[:10])
        print("  failed requests:", failed_req[:10])
        print("  toasts:", repr(page.inner_text("#toastContainer")[:300])
              if page.locator("#toastContainer").count() else "(none)")
        browser.close()
        sys.exit(1)
    time.sleep(1.0)
    view_text = page.inner_text("#container")
    check("saved draft persisted (title unchanged)", "Browser Test Event" in view_text,
          view_text[:200])
    check("description saved", "Snacks at my place" in view_text, view_text[:400])

    # doodle options set via calendar? (date mode saved days -> options)
    check("doodle option date shown in view",
          page.locator(".doodle-row").count() >= 1,
          view_text[:600])

    # -- cancel button returns to view ----------------------------------
    page.click(".event-header a:has-text('Edit')")
    page.wait_for_url(f"{BASE}/events/1/edit/")
    time.sleep(0.8)
    page.click(".edit-sticky-bar button:has-text('Cancel')")
    page.wait_for_url(f"{BASE}/events/1/")
    check("cancel returns to view", "/edit/" not in page.url, page.url)

    # -- publish from edit (unpublish action visible after publish) ------
    page.click(".event-header a:has-text('Edit')")
    page.wait_for_url(f"{BASE}/events/1/edit/")
    time.sleep(0.8)
    check("Unpublish button appears once published",
          page.locator(".edit-sticky-bar button", has_text="Unpublish").count() == 1,
          "")

    # -- §7: invite landing page ----------------------------------------
    # host rotates the invite link (members module button in view mode)
    page.click(".edit-sticky-bar button:has-text('Cancel')")
    page.wait_for_url(f"{BASE}/events/1/")
    time.sleep(1.0)
    token = page.evaluate("""async () => {
        const res = await fetch('/events/api/events/1/invite', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: '{}',
        });
        const data = await res.json();
        return res.ok ? data.token : null;
    }""")
    check("invite token obtained", bool(token and len(token) >= 32), str(token))

    # anonymous visitor opens the invite link — invite.js bounces them to
    # login with a ?next= so they come straight back (assert the redirect)
    guest_page = browser.new_page()
    guest_page.goto(f"{BASE}/events/invite/{token}")
    guest_page.wait_for_url("**/auth/login**", timeout=8000)
    from urllib.parse import unquote  # noqa: E402
    check("anonymous invite visit bounces to login",
          unquote(guest_page.url).endswith(f"next=/events/invite/{token}"),
          guest_page.url)

    # guest logs in from the invite page → redirected back, can join
    guest_page.goto(f"{BASE}/auth/login")
    guest_page.wait_for_load_state("networkidle")
    guest_page.fill("#username", "guest")
    guest_page.fill("#password", "browser-pw")
    with guest_page.expect_navigation():
        guest_page.click("button.btn-primary")
    guest_page.goto(f"{BASE}/events/invite/{token}")
    guest_page.wait_for_load_state("networkidle")
    time.sleep(0.5)
    join_btn = guest_page.locator("#inviteJoinBtn")
    check("Join button enabled for logged-in guest",
          join_btn.count() == 1 and join_btn.is_enabled(), "")
    join_btn.click()
    guest_page.wait_for_url(f"{BASE}/events/1/")
    time.sleep(1.0)
    member_text = guest_page.inner_text("#container")
    check("guest sees the event after joining",
          "Browser Test Event" in member_text, member_text[:200])
    check("guest listed as member",
          guest_page.locator(".member-row", has_text="guest").count() >= 1,
          member_text[:400])

    # invalid token → same page, error state
    bad = browser.new_page()
    bad.goto(f"{BASE}/events/invite/not-a-real-token")
    time.sleep(0.3)
    bad_text = bad.inner_text(".invite-card")
    check("invalid token shows error page",
          "doesn't work" in bad_text or "invalid" in bad_text.lower(),
          bad_text[:200])

    print("\nconsole errors:", len(console_errors))
    for e in console_errors[:10]:
        print("  [console]", e[:200])
    print("page errors:", len(page_errors))
    for e in page_errors[:10]:
        print("  [pageerror]", e[:300])
    print("failed requests:", len(failed_req))
    for r in failed_req[:10]:
        print("  [req]", r[:200])

    check("no console errors", len(console_errors) == 0, str(console_errors[:5]))
    check("no page errors", len(page_errors) == 0, str(page_errors[:5]))
    check("no failed requests (beyond expected)",
          len(failed_req) == 0, str(failed_req[:5]))

    browser.close()

print(f"\n{len(PASSES)} passed, {len(FAILS)} failed")
for f in FAILS:
    print("FAILED:", f)
sys.exit(1 if FAILS else 0)
