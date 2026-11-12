"""Smoke test for realtime outbox publishers.

Runs against a throwaway SQLite DB and checks that Socials and Events
mutations write the expected realtime_events rows for the right users.
"""
import os
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""

tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User, RealtimeEvent  # noqa: E402

app = create_app()
app.config["TESTING"] = True

FAILS = []
PASSWORD = "smoke-password"


def check(name, cond, detail=""):
    print(f"{'  ok' if cond else 'FAIL'}  {name}"
          + ("" if cond else f" — {detail}"))
    if not cond:
        FAILS.append(name)


class Session:
    def __init__(self, username):
        self.client = app.test_client()
        r = self.client.get("/auth/login")
        csrf = r.headers.get("Set-Cookie", "")
        self.csrf = csrf.split("csrf_token=")[1].split(";")[0] \
            if "csrf_token=" in csrf else ""
        r = self.client.post("/auth/api/login",
                             json={"username": username,
                                   "password": PASSWORD})
        if r.status_code != 200:
            print(f"  (login {username}: {r.status_code} {r.get_json()})")

    def req(self, method, path, json=None, expect=200):
        r = self.client.open(path, method=method, json=json,
                             headers={"X-CSRF-Token": self.csrf})
        check(f"{method} {path}", r.status_code == expect,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        return r.get_json() or {}


with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    for name in ("alice", "bob"):
        user = User.query.filter_by(username=name).first()
        if user is None:
            user = User(username=name, email=f"{name}@test.local")
            user.set_password(PASSWORD)
            user.generate_key()
            db.session.add(user)
            db.session.flush()
            user.grant_permission("core")
    db.session.commit()
    bob_id = User.query.filter_by(username="bob").first().id

alice = Session("alice")
bob = Session("bob")

alice.req("POST", "/socials/api/friends",
          json={"username": "bob"}, expect=201)
group = alice.req("POST", "/socials/api/groups",
                  json={"name": "Realtime smoke"}, expect=201)["group"]
bob.req("POST", f"/socials/api/groups/{group['id']}/join",
        json={"code": group["join_code"]}, expect=201)

event = alice.req("POST", "/events/api/events",
                  json={"title": "Realtime smoke",
                        "template": "game_night"}, expect=201)["event"]
alice.req("POST", f"/events/api/events/{event['id']}/members",
          json={"user_ids": [bob_id]}, expect=200)
bob.req("POST", f"/events/api/events/{event['id']}/rsvp",
        json={"rsvp": "attending"}, expect=200)
data = bob.req("GET", f"/events/api/events/{event['id']}/data")
chat = next(m for m in data["modules"] if m["type"] == "chat")
bob.req("POST", f"/events/api/modules/{chat['id']}/chat",
        json={"text": "hello"}, expect=201)
alice.req("DELETE", f"/events/api/events/{event['id']}", expect=200)

with app.app_context():
    rows = RealtimeEvent.query.all()

    def has(topic, scope, user_id=None, **extra):
        for row in rows:
            if row.topic != topic:
                continue
            payload = row.payload or {}
            if payload.get("scope") != scope:
                continue
            if user_id is not None and row.user_id != user_id:
                continue
            if any(payload.get(key) != value for key, value in extra.items()):
                continue
            return True
        return False

    alice_id = User.query.filter_by(username="alice").first().id
    check("friend request publishes to both users",
          has("socials", "friends", alice_id)
          and has("socials", "friends", bob_id))
    check("group join publishes to owner and requester",
          has("socials", "group", alice_id, group_id=group["id"])
          and has("socials", "group", bob_id, group_id=group["id"]))
    check("event create publishes to host",
          has("events", "event", alice_id, event_id=event["id"]))
    check("event member add publishes to both users",
          has("events", "members", alice_id, event_id=event["id"])
          and has("events", "members", bob_id, event_id=event["id"]))
    check("event chat publishes to both users",
          has("events", "chat", alice_id, event_id=event["id"])
          and has("events", "chat", bob_id, event_id=event["id"]))
    check("event delete publishes to both users",
          has("events", "event", alice_id, event_id=event["id"],
              deleted=True)
          and has("events", "event", bob_id, event_id=event["id"],
                  deleted=True))

print(f"\n{len(FAILS)} failed")
if FAILS:
    for name in FAILS:
        print("FAILED:", name)
    sys.exit(1)
