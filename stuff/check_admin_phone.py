"""Programmatic verification of the admin console §9 (<=480px) phone CSS.

Asserts per tab at 390px:
  - no horizontal page scroll (document.scrollWidth <= viewport)
  - content doesn't sit under the rail (rail right edge <= content left edge)
  - tables scroll inside their cards, not off-page (card scrollWidth/right)
Prints measurements per tab so regressions are easy to eyeball too.
"""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
from flask_app.models import db, User, UserGroup, Group, PendingLogin
from werkzeug.security import generate_password_hash
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
    if PendingLogin.query.count() == 0:
        db.session.add(PendingLogin(
            name="waiter",
            email="waiter@test.local",
            password_hash=generate_password_hash("whatever"),
            requested_at=db.func.now()))
    g = Group(name="Shot Crew")
    db.session.add(g); db.session.flush()
    for u in users.values():
        db.session.add(UserGroup(user_id=u.id, group_id=g.id, role="owner"))
    db.session.commit()
    from flask_app.models import AdminCredential
    cred = AdminCredential.query.first()
    cred.set_password("shot-admin-pw")
    db.session.commit()

from waitress import serve
import threading
PORT = 5066
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

TABS = ["pending", "users", "apps", "permissions", "groups",
        "suggestions", "changelog", "settings"]
CHECKS = """
() => {
  const doc = document.documentElement;
  const rail = document.querySelector('.admin-rail');
  const main = document.querySelector('.admin-main');
  const railR = rail ? rail.getBoundingClientRect().right : 0;
  const mainL = main ? main.getBoundingClientRect().left : 0;
  let cards = [...document.querySelectorAll('.admin-card')].map(c => {
    const r = c.getBoundingClientRect();
    const csw = c.scrollWidth, ccw = c.clientWidth;
    return { scroll: csw - ccw, right: Math.round(r.right), vw: doc.clientWidth };
  });
  const worstCard = cards.sort((a, b) => b.scroll - a.scroll)[0] || null;
  return {
    scrollW: doc.scrollWidth, clientW: doc.clientWidth,
    hScroll: doc.scrollWidth > doc.clientWidth + 1,
    railR: Math.round(railR), mainL: Math.round(mainL),
    railOverlaps: railR > mainL + 1,
    worstCardScroll: worstCard ? worstCard.scroll : 0,
    cardBeyondViewport: worstCard ? worstCard.right > worstCard.vw + 1 : false
  };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    m = b.new_page(viewport={"width": 390, "height": 844})
    m.goto(f"{BASE}/admin"); m.wait_for_load_state("networkidle")
    time.sleep(0.5)
    login_ok = m.is_visible("#admin-login-password")
    m.fill("#admin-login-password", "shot-admin-pw")
    m.click("#admin-login-btn")
    m.wait_for_load_state("networkidle")
    time.sleep(0.8)
    failures = []
    print(f"{'tab':<13} {'hScroll':<8} {'railOverlap':<12} {'cardScroll':<11} {'cardBeyondVw':<12}")
    for tab in TABS:
        m.click(f'.nav-link[data-tab="{tab}"]')
        time.sleep(0.8)
        r = m.evaluate(CHECKS)
        ok = not r["hScroll"] and not r["railOverlaps"] and not r["cardBeyondViewport"]
        if not ok:
            failures.append(tab)
        print(f"{tab:<13} {str(r['hScroll']):<8} {str(r['railOverlaps']):<12} "
              f"{r['worstCardScroll']:<11} {str(r['cardBeyondViewport']):<12}")
    b.close()

print("\n" + ("PASS: no phone-layout failures" if not failures
              else f"FAIL on: {', '.join(failures)}"))
sys.exit(1 if failures else 0)