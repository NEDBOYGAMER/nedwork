"""Check the standalone admin login page (admin/login.html) at phone
widths: no horizontal scroll, card fits the viewport, no overflow."""
import os, sys, tempfile, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tmp = tempfile.mkdtemp()
import flask
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)
from flask_app import create_app
app = create_app()
app.config["TESTING"] = True
with app.app_context():
    from flask_app.models import db
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()

from waitress import serve
import threading
PORT = 5069
threading.Thread(target=lambda: serve(app, host="127.0.0.1", port=PORT, threads=4),
                 daemon=True).start()
time.sleep(1.0)
BASE = f"http://127.0.0.1:{PORT}"
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    ok = True
    for vp in (390, 320, 360):
        m = b.new_page(viewport={"width": vp, "height": 700})
        m.goto(f"{BASE}/admin"); m.wait_for_load_state("networkidle")
        time.sleep(0.4)
        r = m.evaluate("""() => {
            const c = document.querySelector('.admin-login');
            const cr = c.getBoundingClientRect();
            const doc = document.documentElement;
            return {
              hScroll: doc.scrollWidth > doc.clientWidth + 1,
              cardW: Math.round(cr.width),
              cardLeft: Math.round(cr.left),
              cardRight: Math.round(cr.right),
              vw: doc.clientWidth
            };
        }""")
        fits = not r["hScroll"] and r["cardLeft"] >= 0 and r["cardRight"] <= r["vw"] + 1
        ok = ok and fits
        print(f"vp {vp}: hScroll={r['hScroll']} card=[{r['cardLeft']}..{r['cardRight']}] "
              f"w={r['cardW']} vw={r['vw']} -> {'OK' if fits else 'FAIL'}")
        m.close()
    b.close()
sys.exit(0 if ok else 1)