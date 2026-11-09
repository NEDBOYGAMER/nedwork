"""API smoke test for TierForge multiplayer sessions.

Runs against a throwaway instance dir / DB (the live app.db is never
touched). Four logged-in users walk the whole link-session flow:

  upload -> create co-op session -> guest joins -> guest re-ranks only
  within the host's tier structure -> stale-version 409 -> push -> leave /
  end -> split session (shared catalog, per-member ranking, three-member
  cap, shared image sizes) -> host-only tombstoned deletions -> direct
  friend invites + inbox action ->
  account purge cleans hosted sessions and the member's split board entry.

Usage:  python stuff/check_tierforge_sessions.py
"""
import io
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta

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
    db, User, TierForgeSession, TierForgeSessionMember, Friendship,
    Notification,
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
    for name in ("sess_host", "sess_guest", "sess_third", "sess_noperm",
                 "sess_friend", "sess_friend2", "sess_friend3"):
        u = User(username=name, email=f"{name}@test.local")
        u.set_password(PASSWORD)
        u.generate_key()
        db.session.add(u)
        db.session.flush()
        u.grant_permission("core")
        if name not in ("sess_noperm", "sess_friend3"):
            u.grant_permission("tierforge")
        ids[name] = u.id
    for fname in ("sess_friend", "sess_friend2", "sess_friend3"):
        db.session.add(Friendship(
            request_sender_id=ids["sess_host"],
            request_receiver_id=ids[fname],
            status="accepted"))
    db.session.commit()

HOST_ID = ids["sess_host"]
GUEST_ID = ids["sess_guest"]
THIRD_ID = ids["sess_third"]
FRIEND_ID = ids["sess_friend"]
FRIEND2_ID = ids["sess_friend2"]
FRIEND3_ID = ids["sess_friend3"]

host = Browser("sess_host")
guest = Browser("sess_guest")
third = Browser("sess_third")
noperm = Browser("sess_noperm")
friend = Browser("sess_friend")
friend2 = Browser("sess_friend2")
friend3 = Browser("sess_friend3")

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
host.req("GET", "/apps/tierforge/import/doesnotexist", expect=404,
         name="unknown import job 404s")

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
    "id": "s1", "label": "HACK", "color": "#000000",
    "images": [{"id": img["id"], "owner": HOST_ID, "name": img["name"]}],
}, {
    "id": "g1", "label": "A", "color": "#f4a261", "images": [],
}]
pushed = guest.req("POST", f"/apps/tierforge/sessions/{token}/board", json={
    "base_version": joined_version,
    "catalog": [ref],
    "tiers": guest_tiers,
    "pool": [],
}, name="guest pushes co-op board")
check("push bumps version", pushed.get("version") == joined_version + 1,
      str(pushed.get("version")))
coop_tiers = (pushed.get("board") or {}).get("coop", {}).get("tiers") or []
check("guest re-ranks within the host's tier",
      len(coop_tiers) == 1
      and coop_tiers[0].get("id") == "s1"
      and (coop_tiers[0].get("images") or [{}])[0].get("id") == img["id"],
      str(coop_tiers))
check("guest cannot rename or add tiers",
      coop_tiers[0].get("label") == "S"
      and all(t.get("id") != "g1" for t in coop_tiers),
      str(coop_tiers))

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
rejoined = guest.req("POST", f"/apps/tierforge/sessions/{token}/join",
                     name="left member rejoins via the same link")
check("rejoined member is active again",
      any(m.get("userId") == GUEST_ID
          for m in rejoined.get("members", [])), str(rejoined.get("members")))
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
check("session starts with default shared image sizes",
      (split.get("board") or {}).get("settings")
      == {"poolImgSize": 120, "tierImgSize": 120},
      str((split.get("board") or {}).get("settings")))
settings_state = host.req(
    "POST", f"/apps/tierforge/sessions/{stoken}/settings",
    json={"poolImgSize": 180, "tierImgSize": 260},
    name="host updates the shared image sizes")
check("shared image sizes stored on the board",
      (settings_state.get("board") or {}).get("settings")
      == {"poolImgSize": 180, "tierImgSize": 260},
      str((settings_state.get("board") or {}).get("settings")))
clamped = host.req(
    "POST", f"/apps/tierforge/sessions/{stoken}/settings",
    json={"poolImgSize": 999, "tierImgSize": -5},
    name="invalid image sizes are accepted as defaults")
check("invalid sizes fall back to the defaults",
      (clamped.get("board") or {}).get("settings")
      == {"poolImgSize": 120, "tierImgSize": 120},
      str((clamped.get("board") or {}).get("settings")))

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

third_split = third.req("POST", f"/apps/tierforge/sessions/{stoken}/join",
                        name="third user joins the split session")
check("split session accepts three members",
      len(third_split.get("members") or []) == 3,
      str(third_split.get("members")))
friend.req("POST", f"/apps/tierforge/sessions/{stoken}/join", expect=409,
           name="split session rejects a fourth member")

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

print("== delete model: co-op (host-only) ==")
coop_del = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke co-op delete",
    "catalog": [ref], "tiers": tiers, "pool": [],
}, expect=201, name="host creates a delete-test co-op session")
dtoken = coop_del.get("token", "")
guest.req("POST", f"/apps/tierforge/sessions/{dtoken}/join",
          name="guest joins delete-test co-op session")
guest.req("POST", f"/apps/tierforge/sessions/{dtoken}/remove",
          json={"refs": [{"owner": HOST_ID, "id": img["id"]}]},
          expect=403, name="co-op guest cannot delete shared images")
removed = host.req("POST", f"/apps/tierforge/sessions/{dtoken}/remove",
                   json={"refs": [{"owner": HOST_ID, "id": img["id"]}]},
                   name="co-op host deletes a shared image")
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

print("== friend invites (direct join) ==")
inv = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke invites", "catalog": [], "tiers": [],
    "pool": [],
}, expect=201, name="host creates invite-test session")
itoken = inv.get("token", "")
friend.req("POST", f"/apps/tierforge/sessions/{itoken}/invite",
           json={"user_id": FRIEND_ID},
           expect=403, name="non-host cannot invite")
host.req("POST", f"/apps/tierforge/sessions/{itoken}/invite",
         json={"user_id": THIRD_ID},
         expect=403, name="host cannot invite a non-friend")
invited = host.req("POST", f"/apps/tierforge/sessions/{itoken}/invite",
                   json={"user_id": FRIEND_ID},
                   name="host invites a friend")
check("invited friend is active immediately",
      any(m.get("userId") == FRIEND_ID
          for m in invited.get("members") or []),
      str(invited.get("members")))
check("no pending approval row for a friend invite",
      not (invited.get("pending") or []), str(invited.get("pending")))
with app.app_context():
    note = Notification.query.filter_by(
        user_id=FRIEND_ID, type="tierforge_join_request").first()
    check("invite notification created", note is not None, "")
friend.req("POST", f"/apps/tierforge/sessions/{itoken}/join",
           name="invited friend joins idempotently")
friend.req("GET", f"/apps/tierforge/sessions/{itoken}",
           name="invited friend can read the board immediately")
host.req("POST",
         f"/apps/tierforge/sessions/{itoken}/members/{FRIEND_ID}/deny",
         expect=400, name="active member cannot be denied")
invited2 = host.req("POST", f"/apps/tierforge/sessions/{itoken}/invite",
                    json={"user_id": FRIEND2_ID},
                    name="host invites a second friend")
check("second friend is active immediately",
      any(m.get("userId") == FRIEND2_ID
          for m in invited2.get("members") or []),
      str(invited2.get("members")))
with app.app_context():
    active_row = TierForgeSessionMember.query.filter_by(
        user_id=FRIEND2_ID).first()
    check("second invite row is active",
          active_row is not None and active_row.status == "active",
          str(active_row.status if active_row else None))

print("== invite grants app access + reaches the inbox ==")
granted = host.req("POST", f"/apps/tierforge/sessions/{itoken}/invite",
                   json={"user_id": FRIEND3_ID},
                   name="host invites a friend without tierforge")
check("non-permitted friend is active immediately",
      any(m.get("userId") == FRIEND3_ID
          for m in granted.get("members") or []),
      str(granted.get("members")))
with app.app_context():
    friend3_user = db.session.get(User, FRIEND3_ID)
    check("invite grants tierforge access",
          friend3_user.has_permission("tierforge"), "")
    note3 = Notification.query.filter_by(
        user_id=FRIEND3_ID, type="tierforge_join_request").first()
    check("invite notification exists for the friend",
          note3 is not None, "")
check("invited friend can now open the app page",
      friend3.client.get("/apps/tierforge").status_code == 200, "")
inbox = friend3.req("GET", "/notifications/api/list",
                    name="invited friend reads the inbox")
row = next((n for n in inbox.get("notifications") or []
            if n.get("type") == "tierforge_join_request"), None)
check("inbox shows the invite with a join-session action",
      row is not None
      and (row.get("action") or {}).get("kind") == "tierforge"
      and (row.get("action") or {}).get("session_token") == itoken,
      str(row))
friend3.req("POST", f"/apps/tierforge/sessions/{itoken}/join",
            name="invited friend joins without approval")

host.req("POST", f"/apps/tierforge/sessions/{itoken}/end",
         name="host ends invite-test session")

print("== auto-end idle sessions ==")
idle = host.req("POST", "/apps/tierforge/sessions", json={
    "mode": "coop", "title": "Smoke idle", "catalog": [], "tiers": [],
    "pool": [],
}, expect=201, name="host creates idle-test session")
itok = idle.get("token", "")
with app.app_context():
    row = TierForgeSession.query.filter_by(token=itok).first()
    row.updated_at = datetime.utcnow() - timedelta(hours=7)
    db.session.commit()
state = host.req("GET", f"/apps/tierforge/sessions/{itok}",
                 name="polling a stale session")
check("idle session auto-ends", state.get("status") == "ended",
      str(state.get("status")))
host.req("POST", f"/apps/tierforge/sessions/{itok}/board", json={
    "base_version": state.get("version"),
    "catalog": [], "tiers": [], "pool": [],
}, expect=410, name="writes to an auto-ended session answer 410")

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

host.req("POST", f"/apps/tierforge/sessions/{stoken}/end",
         name="host ends split session")

print("\n" + ("PASS: TierForge sessions verified "
              f"({len(PASSES)} checks)"
              if not FAILS else f"FAILED ({len(FAILS)}): {FAILS}"))
sys.exit(1 if FAILS else 0)
