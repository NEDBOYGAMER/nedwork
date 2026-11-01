"""API smoke test for the Socials site (friends + social groups).

Runs against a throwaway in-memory SQLite DB so the live app.db is never
touched. Three simulated users walk the full flow: friend request ->
accept -> delete, reverse-pending auto-accept, deny, cancel-outgoing;
group create -> join by code -> admin accept/deny -> add member ->
promote/demote -> transfer -> leave -> delete. Also the pages render and
the join landing page bounces/logins.
"""
import os
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["RESEND_API_KEY"] = ""  # emails must be a silent no-op here

# Swap the shared DB for an isolated one BEFORE importing the factory.
tmp = tempfile.mkdtemp()
import flask  # noqa: E402
_flask_real = flask.Flask
flask.Flask = lambda *a, **kw: _flask_real(*a, instance_path=tmp, **kw)

from flask_app import create_app  # noqa: E402
from flask_app.models import db, User, SocialGroup  # noqa: E402

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

    def req(self, method, path, json=None, expect=200, name=None):
        r = self.client.open(path, method=method, json=json,
                             headers={"X-CSRF-Token": self.csrf})
        label = name or f"{method} {path}"
        ok = r.status_code == expect
        check(label, ok,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        return r.get_json() or {}

    def get(self, path, expect=200, name=None):
        r = self.client.get(path)
        label = name or f"GET {path}"
        check(label, r.status_code == expect,
              f"got {r.status_code} {r.get_data(as_text=True)[:200]}")
        return r


with app.app_context():
    db.create_all()
    from flask_app.permissions import ensure_all
    ensure_all()
    for name in ("alice", "bob", "carol"):
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
alice = Session("alice")
bob = Session("bob")
carol = Session("carol")

print("== pages render ==")
alice.get("/socials/", name="socials page renders (200)")
alice.get("/socials/join/BADCODE1", name="join landing renders for bad code")

print("== friends: request -> accept ==")
bob.req("POST", "/socials/api/friends",
        json={"username": "alice"}, expect=201,
        name="bob sends friend request to alice")
f = alice.req("GET", "/socials/api/friends", name="alice lists friends")
check("alice sees bob as incoming", any(u["username"] == "bob"
      for u in f.get("incoming", [])), str(f))
bob.req("POST", "/socials/api/friends",
        json={"username": "alice"}, expect=400,
        name="duplicate request rejected")
alice.req("POST", "/socials/api/friends",
          json={"username": "bob"}, expect=200,
          name="reverse request auto-accepts")
f = alice.req("GET", "/socials/api/friends", name="alice lists friends again")
check("bob is now a friend", any(u["username"] == "bob"
      for u in f.get("friends", [])), str(f))

print("== friends: deny / cancel ==")
carol.req("POST", "/socials/api/friends",
          json={"username": "alice"}, expect=201,
          name="carol requests alice")
alice.req("POST", "/socials/api/friends/badmethod",
          expect=404, name="bad path 404s")
carol.req("POST", "/socials/api/friends",
          json={"username": "alice"}, expect=400,
          name="duplicate carol request rejected")
f = alice.req("GET", "/socials/api/friends", name="alice sees carol incoming")
carol_id = next(u["id"] for u in f["incoming"] if u["username"] == "carol")
alice.req("DELETE", f"/socials/api/friends/{carol_id}",
          name="alice denies carol")
carol.req("POST", "/socials/api/friends",
          json={"username": "alice"}, expect=201,
          name="carol can re-request after deny")
f = alice.req("GET", "/socials/api/friends", name="alice lists friends")
carol_id = next(u["id"] for u in f["incoming"] if u["username"] == "carol")
alice.req("POST", f"/socials/api/friends/{carol_id}/accept",
          name="alice accepts carol")
alice.req("DELETE", f"/socials/api/friends/{carol_id}",
          name="alice deletes carol as friend")
f = alice.req("GET", "/socials/api/friends", name="alice lists friends")
check("carol no longer a friend", not any(u["username"] == "carol"
      for u in f.get("friends", [])), str(f))
alice.req("POST", "/socials/api/friends",
          json={"username": "ghost_user_xyz"}, expect=404,
          name="unknown username 404s")
alice.req("POST", "/socials/api/friends",
          json={"username": "alice"}, expect=400,
          name="self-request rejected")

print("== groups: create / join by code ==")
g = alice.req("POST", "/socials/api/groups",
              json={"name": "Test Group", "description": "smoke"},
              expect=201, name="alice creates group")
gid = g.get("group", {}).get("id")
code = g.get("group", {}).get("join_code")
check("join code returned", bool(code), str(g))

bob.req("POST", "/socials/api/groups/join",
        json={"code": "WRONG123"}, expect=404,
        name="wrong code 404s")
bob.req("POST", "/socials/api/groups/join",
        json={"code": code}, expect=201,
        name="bob joins by code (pending)")
fr = alice.req("GET", "/socials/api/groups", name="alice lists groups")
check("alice sees bob's join request",
      any(r["username"] == "bob" for r in fr.get("requests", [])), str(fr))
bob.req("POST", "/socials/api/groups/join",
        json={"code": code}, expect=400,
        name="duplicate join rejected")

print("== groups: requests / members ==")
alice.req("POST", f"/socials/api/groups/{gid}/requests/99999/accept",
          expect=404, name="unknown member id 404s")
bob_req_id = next(r["id"] for r in fr["requests"] if r["username"] == "bob")
alice.req("POST", f"/socials/api/groups/{gid}/requests/{bob_req_id}/accept",
          name="alice accepts bob")
bob.req("POST", f"/socials/api/groups/{gid}/requests/{bob_req_id}/accept",
        expect=403, name="non-admin cannot accept requests")

carol.req("POST", f"/socials/api/groups/{gid}/join",
          json={"code": code}, expect=201, name="carol joins by id+code")
fr = alice.req("GET", "/socials/api/groups", name="alice lists groups")
carol_req_id = next(r["id"] for r in fr["requests"] if r["username"] == "carol")
alice.req("POST", f"/socials/api/groups/{gid}/requests/{carol_req_id}/deny",
          name="alice denies carol")
f = alice.req("GET", f"/socials/api/groups/{gid}",
              name="alice fetches group detail")
check("carol gone after deny", not any(m["username"] == "carol"
      for m in f.get("members", [])), str(f))

print("== groups: batch add + add-by-key + rotate code ==")
with app.app_context():
    carol_id = User.query.filter_by(username="carol").first().id
    alice_id = User.query.filter_by(username="alice").first().id
alice.req("POST", f"/socials/api/groups/{gid}/members",
          json={"user_ids": [carol_id, alice_id, 99999]},
          expect=201, name="batch add: 1 added, 2 skipped (self + unknown)")
d = alice.req("GET", f"/socials/api/groups/{gid}",
              name="group detail after batch add")
check("carol active after batch add",
      any(m["username"] == "carol" and m["status"] == "active"
          for m in d.get("members", [])), str(d))
carol.req("POST", f"/socials/api/groups/{gid}/members/by-key",
          json={"username": "alice"}, expect=403,
          name="non-admin cannot add by key")
alice.req("POST", f"/socials/api/groups/{gid}/members/by-key",
          json={"username": "carol"}, expect=400,
          name="add-by-key rejects an existing member")
alice.req("POST", f"/socials/api/groups/{gid}/members/by-key",
          json={"username": "nobody-here"}, expect=404,
          name="add-by-key unknown user 404s")
old_code = code
bob.req("POST", f"/socials/api/groups/{gid}/regenerate-code",
        expect=403, name="non-admin cannot rotate code")
rot = alice.req("POST", f"/socials/api/groups/{gid}/regenerate-code",
                name="alice rotates the code")
check("rotated code differs from old code",
      rot.get("join_code") and rot["join_code"] != old_code, str(rot))
alice.req("POST", f"/socials/api/groups/join",
          json={"code": old_code}, expect=404,
          name="old code no longer works after rotation")
carol_m = next(m for m in d["members"] if m["username"] == "carol")
alice.req("DELETE", f"/socials/api/groups/{gid}/members/{carol_m['id']}",
          name="admin removes carol (reset for promote tests)")

print("== groups: add / promote / remove ==")
with app.app_context():
    carol_id = User.query.filter_by(username="carol").first().id
alice.req("POST", f"/socials/api/groups/{gid}/members",
          json={"user_id": carol_id}, expect=201,
          name="alice (admin) adds carol directly")
bob.req("POST", f"/socials/api/groups/{gid}/members",
        json={"user_id": carol_id}, expect=403,
        name="non-admin cannot add members")
d = alice.req("GET", f"/socials/api/groups/{gid}",
              name="alice fetches group detail")
carol_m = next(m for m in d["members"] if m["username"] == "carol")
bob_m = next(m for m in d["members"] if m["username"] == "bob")
alice_m = next(m for m in d["members"] if m["username"] == "alice")
bob.req("PATCH", f"/socials/api/groups/{gid}/members/{carol_m['id']}",
        json={"role": "admin"}, expect=403,
        name="non-owner cannot change roles")
alice.req("PATCH", f"/socials/api/groups/{gid}/members/{carol_m['id']}",
          json={"role": "admin"}, name="owner promotes carol to admin")
alice.req("PATCH", f"/socials/api/groups/{gid}/members/{alice_m['id']}",
          json={"role": "member"}, expect=404,
          name="owner role cannot be changed via PATCH")
alice.req("DELETE", f"/socials/api/groups/{gid}/members/{alice_m['id']}",
          expect=400, name="owner cannot be removed")
alice.req("DELETE", f"/socials/api/groups/{gid}/members/{carol_m['id']}",
          name="admin removes carol")

print("== groups: transfer / leave / delete ==")
alice.req("POST", f"/socials/api/groups/{gid}/transfer",
          json={"member_id": bob_m["id"]},
          name="alice transfers ownership to bob")
bob.req("POST", f"/socials/api/groups/{gid}/leave",
        expect=400, name="owner cannot leave (must transfer)")
alice.req("POST", f"/socials/api/groups/{gid}/leave",
          name="alice (now admin) leaves")
with app.app_context():
    carol_id = User.query.filter_by(username="carol").first().id
bob.req("POST", f"/socials/api/groups/{gid}/members",
        json={"user_id": carol_id}, expect=201,
        name="bob (owner) re-adds carol")
bob.req("DELETE", f"/socials/api/groups/{gid}",
        name="bob (owner) deletes group")
carol.req("GET", f"/socials/api/groups/{gid}", expect=404,
          name="deleted group 404s")

print("== join landing ==")
g2 = alice.req("POST", "/socials/api/groups", json={"name": "Landing"},
               expect=201, name="alice creates landing group")
code2 = g2["group"]["join_code"]
alice.get(f"/socials/join/{code2}", name="join landing renders for real code")
r = alice.client.get(f"/socials/join/{code2}")
check("landing shows group name", "Landing" in r.get_data(as_text=True),
      r.get_data(as_text=True)[:300])

print("== notifications fired ==")
with app.app_context():
    from flask_app.models import Notification
    types = [n.type for n in Notification.query.all()]
    check("friend_request notification", "friend_request" in types, str(types))
    check("friend_accepted notification", "friend_accepted" in types, str(types))
    check("group_join_request notification",
          "group_join_request" in types, str(types))

print()
print(f"{len(PASSES)} passed, {len(FAILS)} failed")
for f_ in FAILS:
    print(f"  FAIL {f_}")
sys.exit(1 if FAILS else 0)
