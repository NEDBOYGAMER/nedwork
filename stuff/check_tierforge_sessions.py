"""API smoke test for TierForge multiplayer sessions.

Runs against a throwaway instance dir / DB (the live app.db is never
touched). Three logged-in users walk the whole link-session flow:

  upload -> create co-op session -> guest joins -> session-scoped image
  route (member / non-member / unknown id) -> stale-version 409 -> push ->
  leave / end -> split session (shared catalog, per-member ranking) ->
  account purge cleans hosted sessions and the member's split board entry.

Usage:  python stuff/check_tierforge_sessions.py
"""
import io
import os
import re
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""  # email must stay a silent no-op

# Isolate the DB + upload root through the app instance path. The Flask
# swap must happen before importing the factory (same pattern as the
# events smoke).
tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from PIL import Image  # noqa: E402

from flask_app import create_app  # noqa: E402
from flask_app.models import (  # noqa: E402
    db, User, TierForgeSession, TierForgeSessionMember,
)

app = create_app()
app.config["TESTING"] = True

FAILS = []
PASSES = []


def check(name, cond, detail=""):
    if cond:
        PASSES.append(name)
        print(f"  ok  {name}")
    else:
        FAILS.append(f"{name} — {detail}")
        print(f"FAIL  {name} — {detail}")


PASSWORD = "smoke-password"
TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")


class Browser:
    """A logged-in browser profile: own test client + CSRF token."""

    def __init__(self, username):
        self.client = app.test_client()
        r = self.client.get("/auth/login")
        cookie = r.headers.get("Set-Cookie", "")
        self.csrf = cookie.split("csrf_token=")[1].split(";")[0] \
            if "csrf_token=" in cookie else ""
        r = self.client.post("/auth/api/login",
                             json={"username": username, "password": PASSWORD})
        if r.status_code != 200:
            print(f"  (login {username}: {r.status_code} {r.get_json()})")
        self.username = username

    def req(self, method, path, json=None, expect=200, name=None):
        r = self.client.open(path, method=method, json=json,
                             headers={"X-CSRF-Token": self.csrf})
        label = name or f"{method} {path}"
        check(label, r.status_code == expect,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        try:
            return r.get_json() or {}
        except Exception:
            return {}

    def upload(self, name="sess-img.png"):
        buf = io.BytesIO()
        Image.new("RGB", (24, 24), (180, 60, 60)).save(buf, format="PNG")
        buf.seek(0)
        r = self.client.post(
            "/apps/tierforge/images",
            data={"images": (buf, name)},
            content_type="multipart/form-data",
            headers={"X-CSRF-Token": self.csrf},
        )
        check(f"upload {name}", r.status_code == 200,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        body = r.get_json() or {}
        return (body.get("images") or [{}])[0]


with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()

    ids = {}
    for name in ("sess_host", "sess_guest", "sess_third", "sess_noperm"):
        u = User(username=name, email=f"{name}@test.local")
        u.set_password(PASSWORD)
        u.generate_key()
        db.session.add(u)
        db.session.flush()
        u.grant_permission("core")
        if name != "sess_noperm":
            u.grant_permission("tierforge")
        ids[name] = u.id
    db.session.commit()

HOST_ID = ids["sess_host"]
GUEST_ID = ids["sess_guest"]
THIRD_ID = ids["sess_third"]

host = Browser("sess_host")
guest = Browser("sess_guest")
third = Browser("sess_third")
noperm = Browser("sess_noperm")

print("== page gate + identity injection ==")
r = host.client.get("/apps/tierforge")
html = r.get_data(as_text=True)
check("app page renders for a permitted user", r.status_code == 200,
      f"got {r.status_code}")
compact = html.replace(" ", "")
check("page embeds the signed-in user id + name",
      f'"id":{HOST_ID}' in compact
      and '"username":"sess_host"' in compact,
      compact[:300])
r = app.test_client().get("/apps/tierforge")
check("anonymous page redirects to login",
      r.status_code == 302 and "/auth/login" in r.headers.get("Location", ""),
      f"got {r.status_code} {r.headers.get('Location', '')}")
r = noperm.client.get("/apps/tierforge")
check("page denied without the tierforge permission", r.status_code == 403,
      f"got {r.status_code}")
r = app.test_client().get("/apps/tierforge/tierforge.html")
check("direct .html request redirects through the gate",
      r.status_code == 302, f"got {r.status_code}")
r = app.test_client().get("/apps/tierforge/app.js")
check("app JS asset stays public", r.status_code == 200,
      f"got {r.status_code}")

print("== co-op session ==")
img = host.upload()
check("uploaded image has an id", bool(img.get("id")), str(img))
ref = {"id": img["id"], "owner": HOST_ID, "name": img["name"]}
tiers = [{"id": "s1", "label": "S", "color": "#e63946", "images": [ref]}]

created = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke co-op",
    "catalog": [ref], "tiers": tiers, "pool": [],
}, expect=201, name="host creates co-op session")
token = created.get("token", "")
check("token is 32 lowercase hex chars", bool(TOKEN_RE.match(token)), token)
check("host id + mode + open status",
      created.get("hostId") == HOST_ID
      and created.get("mode") == "coop"
      and created.get("status") == "open", str(created))
check("host is sole active member",
      [m.get("role") for m in created.get("members", [])] == ["host"],
      str(created.get("members")))
check("board starts at version 1", created.get("version") == 1,
      str(created.get("version")))

r = guest.req("GET", f"/apps/tierforge/sessions/{token}", expect=403,
              name="guest cannot read before joining")
r = guest.req("POST", f"/apps/tierforge/sessions/{token}/join",
              name="guest joins via invite link")
joined_version = r.get("version")
check("guest join bumps version", joined_version == 2, str(joined_version))
check("two active members",
      len(r.get("members", [])) == 2, str(r.get("members")))

thumb_path = (f"/apps/tierforge/sessions/{token}/images/"
              f"{HOST_ID}/{img['id']}/thumb")
r = guest.client.get(thumb_path)
check("member loads host image through session route",
      r.status_code == 200 and r.mimetype == "image/jpeg",
      f"got {r.status_code} {r.mimetype}")
r = third.client.get(thumb_path)
check("non-member cannot load session image", r.status_code == 403,
      f"got {r.status_code}")
r = guest.client.get(
    f"/apps/tierforge/sessions/{token}/images/{HOST_ID}/{'0' * 32}/full")
check("unknown image id 404s even for a member", r.status_code == 404,
      f"got {r.status_code}")

guest_tiers = [{
    "id": "g1", "label": "A", "color": "#f4a261",
    "images": [{"id": img["id"], "owner": HOST_ID, "name": img["name"]}],
}]
pushed = guest.req("POST", f"/apps/tierforge/sessions/{token}/board", json={
    "base_version": joined_version,
    "catalog": [ref],
    "tiers": guest_tiers,
    "pool": [],
}, name="guest pushes co-op board")
check("push bumps version", pushed.get("version") == joined_version + 1,
      str(pushed.get("version")))
check("guest ranking is visible",
      (pushed.get("board") or {}).get("coop", {}).get("tiers", [{}])[0]
      .get("label") == "A", str(pushed.get("board")))

r = host.req("POST", f"/apps/tierforge/sessions/{token}/board", json={
    "base_version": joined_version,
    "catalog": [ref], "tiers": tiers, "pool": [],
}, expect=409, name="stale base_version answers 409")
check("409 carries the current session",
      (r.get("session") or {}).get("version") == joined_version + 1,
      str(r.get("session", {}).get("version")))
latest = r.get("session", {}).get("version")
host.req("POST", f"/apps/tierforge/sessions/{token}/board", json={
    "base_version": latest, "catalog": [ref],
    "tiers": tiers, "pool": [],
}, name="retry with fresh version succeeds")

r = host.req("GET", f"/apps/tierforge/sessions/{token}",
             name="host polls current board")
check("host sees guest's ranking",
      r.get("board", {}).get("coop", {}).get("tiers", [{}])[0]
      .get("label") == "S", str(r.get("board")))

guest.req("POST", f"/apps/tierforge/sessions/{token}/leave",
          name="guest leaves")
guest.req("GET", f"/apps/tierforge/sessions/{token}", expect=403,
          name="left guest loses access")
host.req("POST", f"/apps/tierforge/sessions/{token}/leave", expect=400,
         name="host cannot leave (must end)")

ended = host.req("POST", f"/apps/tierforge/sessions/{token}/end",
                 name="host ends session")
check("ended status retained",
      ended.get("status") == "ended", str(ended.get("status")))
host.req("GET", f"/apps/tierforge/sessions/{token}",
         name="ended session stays readable for the host")
guest.req("POST", f"/apps/tierforge/sessions/{token}/join", expect=410,
          name="join after end answers 410")
host.req("POST", f"/apps/tierforge/sessions/{token}/board", json={
    "base_version": ended.get("version"), "catalog": [ref],
    "tiers": tiers, "pool": [],
}, expect=410, name="push after end answers 410")

print("== split-screen session ==")
split = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "split", "title": "Smoke split",
    "catalog": [ref], "tiers": tiers, "pool": [],
}, expect=201, name="host creates split session")
stoken = split.get("token", "")
check("split token valid", bool(TOKEN_RE.match(stoken)), stoken)

rtype = split.get("board", {}).get("split", {}).get(str(HOST_ID), {})
check("host split entry created with their ranking",
      bool(rtype.get("tiers")), str(rtype))

guest_split = guest.req("POST", f"/apps/tierforge/sessions/{stoken}/join",
                        name="guest joins split session")
gversion = guest_split.get("version")
check("guest split entry exists",
      str(GUEST_ID) in (guest_split.get("board", {}).get("split") or {}),
      str(guest_split.get("board", {}).get("split")))

guest.req("POST", f"/apps/tierforge/sessions/{stoken}/board", json={
    "base_version": gversion,
    "catalog": [],
    "my_tiers": [{
        "id": "gs", "label": "S", "color": "#e63946",
        "images": [ref],
    }],
    "my_pool_order": [],
}, name="guest pushes only their own split ranking")

state = host.req("GET", f"/apps/tierforge/sessions/{stoken}",
                 name="host polls split state")
catalog = state.get("board", {}).get("catalog") or []
check("split catalog preserved when a member sends none",
      any(c["id"] == img["id"] and c["owner"] == HOST_ID for c in catalog),
      str(catalog))
check("guest ranking stored under their user id",
      bool(state.get("board", {}).get("split", {})
           .get(str(GUEST_ID), {}).get("tiers")),
      str(state.get("board", {}).get("split")))

r = guest.client.get(thumb_path.replace(token, stoken))
check("split member loads session image", r.status_code == 200,
      f"got {r.status_code}")

print("== delete model: split (host-only) ==")
guest.req("POST", f"/apps/tierforge/sessions/{stoken}/remove", json={
    "refs": [{"owner": HOST_ID, "id": img["id"]}],
}, expect=403, name="split guest cannot delete shared images")

removed_state = host.req("POST", f"/apps/tierforge/sessions/{stoken}/remove",
                         json={"refs": [{"owner": HOST_ID,
                                         "id": img["id"]}]},
                         name="split host deletes a shared image")
dboard = removed_state.get("board") or {}
check("removed image leaves the split catalog",
      all(c["id"] != img["id"] for c in dboard.get("catalog") or []),
      str(dboard.get("catalog")))
check("removed image stripped from the guest ranking",
      all(r["id"] != img["id"]
          for t in ((dboard.get("split") or {}).get(str(GUEST_ID), {})
                    .get("tiers") or [])
          for r in t.get("images") or []),
      str(dboard.get("split")))
check("tombstone recorded in the board",
      any(c["id"] == img["id"] for c in dboard.get("removed") or []),
      str(dboard.get("removed")))

stale = guest.req("POST", f"/apps/tierforge/sessions/{stoken}/board", json={
    "base_version": removed_state.get("version"),
    "catalog": [ref],
    "my_tiers": guest_tiers,
    "my_pool_order": [],
}, name="guest pushes a stale board after the delete")
stale_board = stale.get("board") or {}
check("stale split push cannot resurrect a deleted image",
      all(c["id"] != img["id"]
          for c in stale_board.get("catalog") or []),
      str(stale_board.get("catalog")))
check("stale split push keeps the tombstone",
      any(c["id"] == img["id"] for c in stale_board.get("removed") or []),
      str(stale_board.get("removed")))

print("== delete model: co-op (any member) ==")
coop_del = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke co-op delete",
    "catalog": [ref], "tiers": tiers, "pool": [],
}, expect=201, name="host creates a delete-test co-op session")
dtoken = coop_del.get("token", "")
guest.req("POST", f"/apps/tierforge/sessions/{dtoken}/join",
          name="guest joins delete-test co-op session")
removed = guest.req("POST", f"/apps/tierforge/sessions/{dtoken}/remove",
                    json={"refs": [{"owner": HOST_ID, "id": img["id"]}]},
                    name="co-op guest deletes a shared image")
coop_board = removed.get("board") or {}
check("co-op delete empties the shared catalog",
      (coop_board.get("catalog") or []) == [],
      str(coop_board.get("catalog")))
check("co-op delete empties the shared rankings",
      all(not t.get("images")
          for t in (coop_board.get("coop") or {}).get("tiers") or []),
      str(coop_board.get("coop")))

stale = host.req("POST", f"/apps/tierforge/sessions/{dtoken}/board", json={
    "base_version": removed.get("version"),
    "catalog": [ref], "tiers": tiers, "pool": [],
}, name="host pushes a stale board after the co-op delete")
check("stale co-op push cannot resurrect the image",
      all(c["id"] != img["id"]
          for c in (stale.get("board") or {}).get("catalog") or []),
      str((stale.get("board") or {}).get("catalog")))
host.req("POST", f"/apps/tierforge/sessions/{dtoken}/end",
         name="host ends delete-test session")

print("== live presence ==")
pres = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke presence", "catalog": [ref], "tiers": [],
    "pool": [],
}, expect=201, name="host creates presence-test session")
ptoken = pres.get("token", "")
guest.req("POST", f"/apps/tierforge/sessions/{ptoken}/join",
          name="guest joins presence-test session")
host.req("POST", f"/apps/tierforge/sessions/{ptoken}/presence", json={
    "image": {"owner": HOST_ID, "id": img["id"]}, "x": 120, "y": 80,
}, name="host posts drag presence")
snapshot = guest.req("GET", f"/apps/tierforge/sessions/{ptoken}",
                     name="guest polls drag presence")
mine = (snapshot.get("presence") or {}).get(str(HOST_ID)) or {}
check("presence carries image + cursor position + username",
      (mine.get("image") or {}).get("id") == img["id"]
      and (mine.get("image") or {}).get("owner") == HOST_ID
      and mine.get("x") == 120 and mine.get("y") == 80
      and mine.get("username") == "sess_host", str(mine))

host.req("POST", f"/apps/tierforge/sessions/{ptoken}/presence", json={
    "image": {"owner": HOST_ID, "id": "0" * 32}, "x": 10, "y": 10,
}, name="presence pointing at an off-board image")
snapshot = guest.req("GET", f"/apps/tierforge/sessions/{ptoken}",
                     name="guest re-polls presence")
mine = (snapshot.get("presence") or {}).get(str(HOST_ID)) or {}
check("off-board presence image is ignored",
      mine.get("image") is None, str(mine))

third.req("POST", f"/apps/tierforge/sessions/{ptoken}/presence", json={
    "image": None, "x": 0, "y": 0,
}, expect=403, name="non-member cannot post presence")
host.req("POST",
         "/apps/tierforge/sessions/00000000000000000000000000000000/presence",
         json={"image": None, "x": 0, "y": 0}, expect=404,
         name="unknown session presence 404s")
host.req("POST", f"/apps/tierforge/sessions/{ptoken}/end",
         name="host ends presence-test session")
snapshot = host.req("GET", f"/apps/tierforge/sessions/{ptoken}",
                    name="ended presence-test session stays readable")
check("presence cleared when the session ends",
      (snapshot.get("presence") or {}) == {},
      str(snapshot.get("presence")))

guest.req("POST", f"/apps/tierforge/sessions/{stoken}/presence", json={
    "image": None, "x": 1, "y": 1,
}, name="guest posts presence before purge")

print("== account purge ==")
guest_hosted = guest.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Guest hosted", "catalog": [], "tiers": [],
    "pool": [],
}, expect=201, name="guest creates their own session")
guest_token = guest_hosted.get("token", "")

with app.app_context():
    from flask_app.account import purge_user
    guest_user = db.session.get(User, GUEST_ID)
    purge_user(guest_user)
    db.session.commit()

    check("purged user row gone", db.session.get(User, GUEST_ID) is None)
    check("guest membership rows gone",
          TierForgeSessionMember.query.filter_by(user_id=GUEST_ID).count() == 0)
    check("guest-hosted session deleted",
          TierForgeSession.query.filter_by(token=guest_token).first() is None)
    split_row = TierForgeSession.query.filter_by(token=stoken).first()
    split_board = (split_row.board or {}).get("split") or {}
    check("purged user's split board entry removed",
          str(GUEST_ID) not in split_board, str(list(split_board.keys())))
    check("host's split board entry survives",
          str(HOST_ID) in split_board, str(list(split_board.keys())))

    from flask_app.apps.tierforge.routes import _SESSION_PRESENCE
    check("purged user's presence entries dropped",
          str(GUEST_ID) not in (_SESSION_PRESENCE.get(stoken) or {}),
          str(_SESSION_PRESENCE.get(stoken)))

host.req("POST", f"/apps/tierforge/sessions/{stoken}/end",
         name="host ends split session")

print("\n" + ("PASS: TierForge sessions verified "
              f"({len(PASSES)} checks)"
              if not FAILS else f"FAILED ({len(FAILS)}): {FAILS}"))
sys.exit(1 if FAILS else 0)
