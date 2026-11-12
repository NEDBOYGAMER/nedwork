"""API smoke test for the Events site MVP (plan verification script).

Runs against a throwaway in-memory SQLite DB so the live app.db is never
touched. Three simulated users (host + member + third) walk the full
restructured flow: create (fixed members module) -> publish -> RSVP ->
doodle (date + time modes, vote-lock) -> finalize -> bring -> rides ->
chat -> description/image upload -> reorder -> leave -> transfer-host ->
archive -> invite landing page + token join -> notifications.
"""
import io
import os
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""  # emails must be a silent no-op here

# Swap the shared DB for an isolated one. Flask-SQLAlchemy resolves the
# URI (from app.instance_path) at init_app time inside create_app, so the
# flask.Flask swap must happen BEFORE importing the factory.
tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User, Event  # noqa: E402

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


class Session:
    """A logged-in browser profile: its own test client + CSRF token."""

    def __init__(self, username):
        self.client = app.test_client()
        r = self.client.get("/auth/login")
        csrf = r.headers.get("Set-Cookie", "")
        self.csrf = csrf.split("csrf_token=")[1].split(";")[0] \
            if "csrf_token=" in csrf else ""
        self.login(username)

    def login(self, username):
        r = self.client.post("/auth/api/login",
                             json={"username": username, "password": PASSWORD})
        if r.status_code != 200:
            print(f"  (login {username}: {r.status_code} {r.get_json()})")
        self.username = username

    def req(self, method, path, json=None, expect=200, name=None):
        r = self.client.open(path, method=method, json=json,
                             headers={"X-CSRF-Token": self.csrf})
        label = name or f"{method} {path}"
        ok = r.status_code == expect
        check(label, ok,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        return r.get_json() or {}


with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    for name in ("host_user", "member_user", "third_user"):
        u = User.query.filter_by(username=name).first()
        if u is None:
            u = User(username=name, email=f"{name}@test.local")
            u.set_password(PASSWORD)
            u.generate_key()
            db.session.add(u)
            db.session.flush()
            u.grant_permission("core")
    db.session.commit()

print("== setup: sessions ==")
host = Session("host_user")
member = Session("member_user")
third = Session("third_user")

# make host + member friends so the picker path has data
with app.app_context():
    h = User.query.filter_by(username="host_user").first()
    m = User.query.filter_by(username="member_user").first()
    h.friends.append(m)
    db.session.commit()
    MEMBER_ID = m.id

print("== create (draft) ==")
ev = host.req("POST", "/events/api/events",
              json={"title": "Movie Night", "subtitle": "test run",
                    "template": "movie_night"}, expect=201,
              name="create event from movie_night template")
event_id = ev.get("event", {}).get("id")
check("event id returned", bool(event_id), str(ev))

# member cannot see the draft yet
member.req("GET", f"/events/api/events/{event_id}/data", expect=404,
           name="member cannot open draft")

print("== modules from template ==")
data = host.req("GET", f"/events/api/events/{event_id}/data",
                name="host fetches event data")
modules = data.get("modules", [])
types = [m["type"] for m in modules]
check("template modules present",
      set(types) == {"members", "description", "image", "location",
                     "doodle", "bring", "rides"},
      str(types))
check("members module fixed at position 0",
      types[0] == "members" and modules[0]["position"] == 0, str(types))
members_mod = modules[0]
host.req("DELETE", f"/events/api/modules/{members_mod['id']}", expect=400,
         name="members module cannot be deleted")

print("== add members + publish ==")
host.req("POST", f"/events/api/events/{event_id}/members",
         json={"user_ids": [MEMBER_ID]},
         name="host adds member via friends list")
host.req("POST", f"/events/api/events/{event_id}/publish",
         name="host publishes event")

print("== RSVP + doodle (date mode) ==")
member.req("POST", f"/events/api/events/{event_id}/rsvp",
           json={"rsvp": "attending"}, name="member RSVPs attending")
doodle = next(m for m in modules if m["type"] == "doodle")
mid = doodle["id"]
host.req("POST", f"/events/api/modules/{mid}/options",
         json={"days": ["2026-11-14", "2026-11-15"]},
         name="host sets 2 doodle day options")
data = host.req("GET", f"/events/api/events/{event_id}/data")
check("date-mode options have ends_at NULL",
      all(o["ends_at"] is None for o in data["options"]),
      str(data["options"]))
oid = data["options"][0]["id"]
member.req("POST", f"/events/api/modules/{mid}/vote",
           json={"option_ids": [oid], "comment": "works for me"},
           name="member votes for option 1")
# post-vote edit: no blanket vote-lock anymore — options are editable,
# votes survive only on dates that are still offered (per-date rule)
data = host.req("GET", f"/events/api/events/{event_id}/data")
oid_2 = next(o["id"] for o in data["options"]
             if o["starts_at"].startswith("2026-11-15"))
member.req("POST", f"/events/api/modules/{mid}/vote",
           json={"option_ids": [oid, oid_2]},
           name="member votes for both days")
host.req("POST", f"/events/api/modules/{mid}/options",
         json={"days": ["2026-11-14", "2026-11-20"]},
         name="host edits options after a vote (kept date survives)")
data = host.req("GET", f"/events/api/events/{event_id}/data")
kept = next(o for o in data["options"]
            if o["starts_at"].startswith("2026-11-14"))
check("kept option keeps its row id", kept["id"] == oid, str(kept))
check("vote on kept date survives the edit",
      any(v.get("option_id") == oid for v in data["votes"]),
      str(data["votes"]))
check("vote on removed date is wiped with it",
      not any(v.get("option_id") == oid_2 for v in data["votes"]),
      str(data["votes"]))
member.req("POST", f"/events/api/modules/{mid}/vote",
           json={"option_ids": [], "none_of_these": True},
           name="none-of-these vote works without a comment")
host.req("POST", f"/events/api/modules/{mid}/vote",
         json={"option_ids": [oid]}, name="host votes too")
host.req("POST", f"/events/api/modules/{mid}/finalize",
         json={"option_id": oid}, name="host finalizes date")
data = host.req("GET", f"/events/api/events/{event_id}/data")
check("date finalized from doodle",
      data["event"]["event_date"] and data["event"]["date_source"] == "doodle",
      str(data["event"]))
mdata = member.req("GET", f"/events/api/events/{event_id}/data")
me_m = next(m for m in mdata["members"] if m["user"]["username"] == "member_user")
check("rsvp stale after finalize", me_m["rsvp_stale"] is True, str(me_m))

print("== doodle time mode ==")
host.req("DELETE", f"/events/api/modules/{mid}/votes",
         name="host resets votes to unlock options")
host.req("PATCH", f"/events/api/modules/{mid}",
         json={"config": {"mode": "time", "anonymous": False}},
         name="host switches doodle to time mode")
host.req("POST", f"/events/api/modules/{mid}/options",
         json={"time_slots": [{"start": "19:30", "end": "22:00"}]},
         name="host sets a time span (pinned to event date)")
data = host.req("GET", f"/events/api/events/{event_id}/data")
check("time-mode option carries ends_at",
      len(data["options"]) == 1 and data["options"][0]["ends_at"] is not None,
      str(data["options"]))
host.req("POST", f"/events/api/modules/{mid}/options",
         json={"time_slots": [{"start": "25:00", "end": "26:00"}]}, expect=400,
         name="invalid HH:MM rejected")
host.req("PATCH", f"/events/api/modules/{mid}",
         json={"config": {"mode": "date", "anonymous": False,
                          "deadline": "whatever"}},
         name="deadline key silently dropped (one source of truth)")
host.req("POST", f"/events/api/modules/{mid}/options",
         json={"days": ["2026-11-14", "2026-11-16"]},
         name="back to date mode with fresh days")

print("== bring + rides + chat ==")
bring = next(m for m in modules if m["type"] == "bring")
member.req("POST", f"/events/api/modules/{bring['id']}/items",
           json={"label": "Popcorn", "target_qty": 2},
           name="member adds bring item", expect=201)
data = member.req("GET", f"/events/api/events/{event_id}/data")
item = data["items"][0]
item_id = item["id"]
host.req("POST", f"/events/api/items/{item_id}/claim",
         json={"qty": 1}, name="host claims popcorn x1")
data = host.req("GET", f"/events/api/events/{event_id}/data")
item = next(i for i in data["items"] if i["id"] == item_id)
check("claim counted", item["claimed_qty"] == 1, str(item))

rides_m = next(m for m in modules if m["type"] == "rides")
host.req("POST", f"/events/api/modules/{rides_m['id']}/rides",
         json={"seats": 1, "departure": "18:00"},
         name="host offers ride with 1 seat", expect=201)
data = host.req("GET", f"/events/api/events/{event_id}/data")
ride = data["rides"][0]
member.req("POST", f"/events/api/rides/{ride['id']}/passengers",
           name="member claims the seat")
member.req("DELETE", f"/events/api/rides/{ride['id']}/passengers",
           name="member releases the seat")
member.req("PATCH", f"/events/api/events/{event_id}/needs-ride",
           json={"value": True}, name="member toggles needs-ride")

host.req("POST", f"/events/api/events/{event_id}/modules",
         json={"type": "chat"}, name="host adds chat module", expect=201)
host.req("POST", f"/events/api/events/{event_id}/modules",
         json={"type": "chat"}, expect=409,
         name="duplicate singleton module rejected")
data = host.req("GET", f"/events/api/events/{event_id}/data")
chat_m = next(m for m in data["modules"] if m["type"] == "chat")
member.req("POST", f"/events/api/modules/{chat_m['id']}/chat",
           json={"text": "Hello from the member"},
           name="member chats", expect=201)
data = member.req("GET", f"/events/api/events/{event_id}/data")
msg = next(x for x in data["messages"])
member.req("DELETE", f"/events/api/chat/{msg['id']}", expect=403,
           name="author cannot delete own message (host only)")
host.req("DELETE", f"/events/api/chat/{msg['id']}",
         name="host deletes member message")

print("== description + image ==")
desc = next(m for m in modules if m["type"] == "description")
host.req("PATCH", f"/events/api/modules/{desc['id']}/content",
         json={"text": "Movie night at my place"},
         name="host saves description text")
data = host.req("GET", f"/events/api/events/{event_id}/data")
desc_mod = next(m for m in data["modules"] if m["type"] == "description")
check("description text persisted",
      desc_mod["config"]["text"] == "Movie night at my place",
      str(desc_mod["config"]))

img = next(m for m in modules if m["type"] == "image")
png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
r = host.client.open(f"/events/api/modules/{img['id']}/image",
                     method="POST",
                     data={"file": (io.BytesIO(png), "poster.png")},
                     content_type="multipart/form-data",
                     headers={"X-CSRF-Token": host.csrf})
check("image upload accepted", r.status_code == 200,
      f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
img_url = (r.get_json() or {}).get("module", {}).get("config", {}).get("url")
check("image url under /events/img/",
      bool(img_url and img_url.startswith("/events/img/")), str(img_url))
r = host.client.get(img_url)
check("uploaded image served", r.status_code == 200, f"got {r.status_code}")
r = host.client.open(f"/events/api/modules/{img['id']}/image",
                     method="POST",
                     data={"file": (io.BytesIO(b"nope"), "evil.exe")},
                     content_type="multipart/form-data",
                     headers={"X-CSRF-Token": host.csrf})
check("non-image upload rejected", r.status_code == 400, f"got {r.status_code}")

print("== reorder ==")
desc2 = next(m for m in data["modules"] if m["type"] == "description")
bring2 = next(m for m in data["modules"] if m["type"] == "bring")
host.req("POST", f"/events/api/events/{event_id}/modules/reorder",
         json={"order": [bring2["id"], desc2["id"]]},
         name="host reorders modules")
data = host.req("GET", f"/events/api/events/{event_id}/data")
ordered = sorted(data["modules"], key=lambda x: x["position"])
order = [m["type"] for m in ordered]
check("reorder applied", order.index("bring") < order.index("description"),
      str(order))

print("== transfer host + leave rules ==")
host.req("POST", f"/events/api/events/{event_id}/leave", expect=409,
         name="host blocked from leaving")
data = host.req("GET", f"/events/api/events/{event_id}/data")
others = [m for m in data["members"] if m["role"] == "member"]
check("member to transfer to", bool(others), str(data["members"]))
host.req("POST", f"/events/api/events/{event_id}/transfer-host",
         json={"member_id": others[0]["id"]},
         name="host transfers host")
member.req("POST", f"/events/api/events/{event_id}/leave", expect=409,
           name="new host also blocked from leaving")
# the popcorn claim belonged to the former host — released on leave
host.req("POST", f"/events/api/events/{event_id}/leave",
         name="former host leaves (claim released)")
with app.app_context():
    from flask_app.models import BringClaim
    h_evt = Event.query.filter_by(title="Movie Night").first()
    bclaims = [c for mod in h_evt.modules if mod.type == "bring"
               for i in mod.items for c in i.claims]
    check("claim released when its owner leaves", len(bclaims) == 0,
          str(len(bclaims)))

print("== token join ==")
inv = member.req("POST", f"/events/api/events/{event_id}/invite",
                 name="new host rotates invite token")
token = inv.get("token", "")
check("token returned", len(token) >= 32, token)
r = third.client.get(f"/events/invite/{token}")
check("invite landing page renders (GET)", r.status_code == 200,
      f"got {r.status_code}")
check("invite page shows event title",
      "Movie Night" in r.get_data(as_text=True),
      r.get_data(as_text=True)[:200])
third.req("POST", f"/events/api/events/{event_id}/join",
          json={"token": token}, name="third joins via token")
third.req("POST", f"/events/api/events/{event_id}/join",
          json={"token": "wrong"}, expect=403, name="wrong token rejected")

print("== edit page + archive ==")
r = host.client.get(f"/events/{event_id}/edit/")
check("edit page renders", r.status_code == 200, f"got {r.status_code}")
check("edit page sets EVENT_EDIT_MODE",
      "window.EVENT_EDIT_MODE = true" in r.get_data(as_text=True), "")
r = member.client.get(f"/events/{event_id}/edit/")
check("edit page renders for member (JS guards host-only)",
      r.status_code == 200, f"got {r.status_code}")
r = third.client.get(f"/events/{event_id}/")
check("third (now member) sees detail page", r.status_code == 200,
      f"got {r.status_code}")

third.req("POST", f"/events/api/events/{event_id}/archive", expect=403,
          name="non-host cannot archive")
member.req("POST", f"/events/api/events/{event_id}/archive",
           name="host archives event")
third.req("GET", f"/events/api/events/{event_id}/data", expect=404,
          name="archived event 404s for member")

print("== notifications ==")
n = member.req("GET", "/notifications/api/list",
               name="member fetches notifications")
check("notifications exist", n.get("notifications"), str(n)[:200])
if n.get("notifications"):
    first = n["notifications"][0]["id"]
    member.req("POST", "/notifications/api/read",
               json={"ids": [first]}, name="mark one read")
    n2 = member.req("GET", "/notifications/api/list")
    check("unread decremented", n2["unread"] == n["unread"] - 1,
          f"{n['unread']} -> {n2.get('unread')}")

print(f"\n{len(PASSES)} passed, {len(FAILS)} failed")
for f in FAILS:
    print("FAILED:", f)
sys.exit(1 if FAILS else 0)
