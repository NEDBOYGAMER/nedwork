"""Smoke test for the /notifications inbox (page + API + per-row actions).

Throwaway instance dir; the live app.db is never touched. Three users:
alice (sender), bob (receiver) and carol (event host). Walks:
  - unread count + list shapes
  - friend request row carries an accept action, accept deletes the action
  - group join request row carries approve/deny, approve settles it
  - event + task rows carry a navigation action
  - private tasks never produce a task_deadline nudge
  - scan_task_deadlines dedupes (one row per task)
  - mark-read by id and mark-all
  - an anonymous GET /notifications/ redirects to login

Usage:  python stuff/check_inbox.py
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""

tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import (  # noqa: E402
    db, User, Friendship, SocialGroup, SocialGroupMember, Task,
)

app = create_app()
app.config["TESTING"] = True

FAILS = []
PASSWORD = "smoke-password"


def check(name, cond, detail=""):
    print(f"{'  ok' if cond else 'FAIL'}  {name}" + ("" if cond else f" — {detail}"))
    if not cond:
        FAILS.append(name)


class Browser:
    def __init__(self, username):
        self.client = app.test_client()
        r = self.client.get("/auth/login")
        cookie = r.headers.get("Set-Cookie", "")
        self.csrf = cookie.split("csrf_token=")[1].split(";")[0] \
            if "csrf_token=" in cookie else ""
        self.client.post("/auth/api/login",
                         json={"username": username, "password": PASSWORD})

    def get(self, path, expect=200):
        r = self.client.get(path)
        check(f"GET {path}", r.status_code == expect,
              f"{r.status_code} {r.get_data(as_text=True)[:160]}")
        return r

    def post(self, path, json=None, expect=200):
        r = self.client.post(path, json=json,
                             headers={"X-CSRF-Token": self.csrf})
        check(f"POST {path}", r.status_code == expect,
              f"{r.status_code} {r.get_data(as_text=True)[:160]}")
        return r.get_json() or {}


with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    ids = {}
    for name in ("alice", "bob", "carol"):
        u = User(username=name, email=f"{name}@test.local")
        u.set_password(PASSWORD)
        u.generate_key()
        db.session.add(u)
        db.session.flush()
        u.grant_permission("core")
        ids[name] = u.id
    db.session.commit()

print("== setup ==")
alice = Browser("alice")
bob = Browser("bob")
carol = Browser("carol")

anon = app.test_client().get("/notifications/")
check("anonymous /notifications/ redirects to login",
      anon.status_code == 302 and "/auth/login" in anon.headers.get("Location", ""),
      f"{anon.status_code} {anon.headers.get('Location')}")

print("== empty inbox ==")
data = bob.get("/notifications/api/list").get_json()
check("list starts empty", data["notifications"] == [] and data["unread"] == 0,
      str(data))

print("== friend request ==")
alice.post("/socials/api/friends", json={"username": "bob"}, expect=201)
data = bob.get("/notifications/api/list").get_json()
row = next((n for n in data["notifications"] if n["type"] == "friend_request"), None)
check("friend_request row exists", row is not None, str(data))
check("friend_request carries accept action",
      row and row["action"] == {"kind": "friend_request", "user_id": ids["alice"]},
      str(row))
check("unread count is 1", data["unread"] == 1, str(data["unread"]))

bob.post(f"/socials/api/friends/{ids['alice']}/accept")
data = bob.get("/notifications/api/list").get_json()
row = next(n for n in data["notifications"] if n["type"] == "friend_request")
check("action disappears once accepted", row["action"] is None, str(row))

print("== mark read ==")
bob.post("/notifications/api/read", json={"ids": [row["id"]]})
data = bob.get("/notifications/api/list").get_json()
check("mark-one clears unread",
      all(n["read"] for n in data["notifications"]) and data["unread"] == 0,
      str(data["unread"]))
bob.post("/notifications/api/read", json={"all": True})
check("unread endpoint agrees", bob.get("/notifications/api/unread").get_json()["unread"] == 0)
bob.get("/notifications/")
bob.get("/notifications/api/unread")

print("== group join request ==")
with app.app_context():
    g = SocialGroup(name="Smoke Group", join_code="SMOKE123")
    db.session.add(g)
    db.session.flush()
    db.session.add(SocialGroupMember(group_id=g.id, user_id=ids["bob"],
                                     role="owner", status="active"))
    db.session.commit()
    group_id = g.id

alice.post(f"/socials/api/groups/{group_id}/join", expect=201)
data = bob.get("/notifications/api/list").get_json()
row = next((n for n in data["notifications"] if n["type"] == "group_join_request"), None)
check("group_join_request row exists", row is not None, str(data))
check("row carries approve action",
      row and row["action"]["kind"] == "group_request"
      and row["action"]["group_id"] == group_id,
      str(row))
mid = row["action"]["member_id"]
bob.post(f"/socials/api/groups/{group_id}/requests/{mid}/accept")
data = bob.get("/notifications/api/list").get_json()
row = next(n for n in data["notifications"] if n["type"] == "group_join_request")
check("action disappears once approved", row["action"] is None, str(row))

print("== event + task actions ==")
with app.app_context():
    # fabricate the rows the event/task scanners would produce (the event
    # flow itself is covered by stuff/events_api_smoke.py)
    from flask_app.notifications import notify_user
    u = User.query.get(ids["bob"])
    notify_user(u, "event_reminder", {"event_id": 99, "title": "Smoke event"})
    notify_user(u, "task_deadline", {"task_id": 7, "title": "Smoke task"})

data = bob.get("/notifications/api/list").get_json()
ev = next(n for n in data["notifications"] if n["type"] == "event_reminder")
task = next(n for n in data["notifications"] if n["type"] == "task_deadline")
check("event row links to the event",
      ev["action"] == {"kind": "event", "event_id": 99}, str(ev))
check("task row links to the task",
      task["action"] == {"kind": "task", "task_id": 7}, str(task))

print("== task deadline scan ==")
with app.app_context():
    u = User.query.get(ids["carol"])
    now = datetime.now()
    db.session.add(Task(name="Due soon", user_id=u.id, done=False,
                        private=False, importance="medium",
                        deadline=now + timedelta(hours=2),
                        created_at=now, last_updated_at=now))
    db.session.add(Task(name="Secret", user_id=u.id, done=False,
                        private=True, importance="medium",
                        deadline=now + timedelta(hours=2),
                        created_at=now, last_updated_at=now))
    db.session.add(Task(name="Far away", user_id=u.id, done=False,
                        private=False, importance="medium",
                        deadline=now + timedelta(days=9),
                        created_at=now, last_updated_at=now))
    db.session.commit()

carol.get("/notifications/api/list")
carol.get("/notifications/api/list")   # second poll must not duplicate
data = carol.get("/notifications/api/list").get_json()
titles = [n["payload"].get("title") for n in data["notifications"]
          if n["type"] == "task_deadline"]
check("one nudge for the due task", titles == ["Due soon"], str(titles))
check("private + far-future tasks are skipped",
      "Secret" not in titles and "Far away" not in titles, str(titles))

print("== page renders ==")
html = bob.get("/notifications/").get_data(as_text=True)
check("page has the list container", 'id="inboxList"' in html)
check("page boots its module", "js/pages/notifications.js" in html)
check("sidenav shows the bell", 'id="notifications-btn"' in html)

print()
if FAILS:
    print(f"{len(FAILS)} FAILED:")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all checks passed")
