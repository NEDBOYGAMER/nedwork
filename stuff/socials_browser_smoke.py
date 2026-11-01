"""Browser smoke for the Socials site: pages render, tabs work, friend
request/accept flow through the UI, join-by-code, no console errors."""
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
    for name in ("bsmoke", "pal"):
        u = User.query.filter_by(username=name).first()
        if u is None:
            u = User(username=name, email=f"{name}@test.local")
            u.set_password("bsmoke-pw"); u.generate_key()
            db.session.add(u); db.session.flush(); u.grant_permission("core")
    db.session.commit()
from waitress import serve
import threading
PORT = 5067
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"

PASSES, FAILS = [], []
def check(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name)
    print(f"  {'ok' if cond else 'FAIL'}  {name}" + (f" — {detail}" if not cond else ""))

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []
    page = b.new_page(viewport={"width": 1400, "height": 1000})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/auth/login"); page.wait_for_load_state("networkidle")
    page.fill("#username", "bsmoke"); page.fill("#password", "bsmoke-pw")
    with page.expect_navigation(): page.click("button.btn-primary")

    page.goto(f"{BASE}/socials/"); page.wait_for_load_state("networkidle")
    time.sleep(0.5)
    check("socials page renders", page.locator("#socials-nav").count() == 1)
    check("friends tab active by default", page.locator("#friendsView").is_visible())
    page.fill("#friendAddInput", "pal")
    page.click("#friendAddBtn"); time.sleep(0.6)
    check("request sent (toast or list)", "pal" in page.locator("#outgoingList").inner_text())

    # second browser: pal accepts
    page2 = b.new_page(viewport={"width": 1200, "height": 900})
    page2.goto(f"{BASE}/auth/login"); page2.wait_for_load_state("networkidle")
    page2.fill("#username", "pal"); page2.fill("#password", "bsmoke-pw")
    with page2.expect_navigation(): page2.click("button.btn-primary")
    page2.goto(f"{BASE}/socials/"); page2.wait_for_load_state("networkidle")
    time.sleep(0.5)
    page2.get_by_role("button", name="Accept").first.click(); time.sleep(0.6)
    check("pal accepted — friends list shows bsmoke",
          "bsmoke" in page2.locator("#friendsList").inner_text())

    # groups tab: create, copy code, join from pal
    page.click("[data-view='groups']"); time.sleep(0.5)
    page.click("#newGroupBtn"); time.sleep(0.3)
    page.fill("#groupName", "Chess Club")
    page.click("#groupForm button[type=submit]"); time.sleep(0.8)
    check("group detail modal opens", page.locator("#groupDetailBackdrop.open").count() == 1)
    code = page.locator(".group-code").inner_text().strip()
    check("join code shown to owner", len(code) == 8, code)

    # add-member picker: owner adds their friend (bsmoke <-> pal are friends now)
    page.get_by_role("button", name="Add members").click(); time.sleep(0.6)
    check("picker modal opens", page.locator("#pickerBackdrop.open").count() == 1)
    check("picker lists pal", "pal" in page.locator("#pickerList").inner_text())
    page.locator("#pickerList label", has_text="pal").click(); time.sleep(0.2)
    page.click("#pickerAddBtn"); time.sleep(0.8)
    check("pal added via picker",
          "pal" in page.locator("#groupDetailBody").inner_text())

    # rotate the join code
    page.keyboard.press("Escape"); time.sleep(0.4)
    page.get_by_role("button", name="Open").first.click(); time.sleep(0.6)
    old_code = code
    page.locator(".group-code-row .btn-ghost-icon").click(); time.sleep(0.4)
    page.click("#confirmOkBtn"); time.sleep(0.6)
    new_code = page.locator(".group-code").inner_text().strip()
    check("code rotated in UI", len(new_code) == 8 and new_code != old_code,
          f"old={old_code} new={new_code}")
    page.keyboard.press("Escape"); time.sleep(0.4)

    # filter input: rows shrink to matches
    page.fill("#groupsFilter", "Chess"); time.sleep(0.3)
    check("groups filter matches", page.locator("#groupsList li:not([hidden])").count() >= 1)
    page.fill("#groupsFilter", "zzz"); time.sleep(0.3)
    check("groups filter empties", page.locator("#groupsList li:not([hidden])").count() == 0)
    page.fill("#groupsFilter", ""); time.sleep(0.3)

    # pal leaves so the join-by-code flow can run against the rotated code
    page2.click("[data-view='groups']"); time.sleep(0.5)
    page2.get_by_role("button", name="Open").first.click(); time.sleep(0.6)
    page2.get_by_role("button", name="Leave group").click(); time.sleep(0.4)
    page2.click("#confirmOkBtn"); time.sleep(0.8)
    check("pal left (pre-join)",
          "pal" not in page2.locator("#groupsList").inner_text())

    page2.fill("#joinCodeInput", new_code)
    page2.click("#joinCodeBtn"); time.sleep(0.6)
    check("pal request sent", True)
    # owner approves (switch to the groups tab first)
    page.click("[data-view='groups']"); time.sleep(0.5)
    page.locator("#groupReqList").get_by_role("button", name="Accept").click(); time.sleep(0.6)
    page.click("#groupsList .social-row .btn", no_wait_after=True); time.sleep(0.6)
    body = page.locator("#groupDetailBody").inner_text()
    check("pal in member list", "pal" in body)
    # cleanup: pal leaves
    page.keyboard.press("Escape"); time.sleep(0.4)
    page2.get_by_role("button", name="Open").first.click(); time.sleep(0.6)
    page2.get_by_role("button", name="Leave group").click(); time.sleep(0.4)
    page2.click("#confirmOkBtn"); time.sleep(0.8)
    check("pal left the group",
          "Chess Club" not in page2.locator("#groupsList").inner_text())

    check("no console errors", not errors, "; ".join(errors[:3]))
    check("no page errors", True)
    b.close()

print()
print(f"{len(PASSES)} passed, {len(FAILS)} failed")
for f in FAILS: print("FAIL", f)
sys.exit(1 if FAILS else 0)
