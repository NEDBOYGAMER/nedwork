"""Events site — API.

Site shape (one gathering per event, host owns structure, members fill
content). All JSON endpoints live under /events/api/ and answer
{"error": ...} with 400 (validation) / 403 (not member) / 404 (not
found) / 409 (conflict). Per-event authorization is via _event_for /
_member / _host helpers inside the handlers — the global decorators only
gate login + the "core" permission.

CSRF: covered globally by the double-submit cookie (csrf.js +
before_request). Endpoints read JSON via request.get_json(silent=True).
"""
from datetime import datetime
import copy
import os
import secrets

from flask import (Blueprint, current_app, render_template, request,
                   jsonify, send_from_directory)

from ..models import *   # Event, EventMember, EventModule, ..., db, User
from ..auth.decorators import permission_required, PAGE, API
from ..notifications import (
    notify_user, notify_event_members, notifications_for_user, mark_read,
    notification_to_dict, event_upcoming_for_user,
)


events_bp = Blueprint('events', __name__, static_folder='../static')

# ---------------------------------------------------------------------------
# constants / templates
# ---------------------------------------------------------------------------

VALID_STATUS = ("draft", "published", "archived")
VALID_RSVP = ("attending", "maybe", "cant")
# "members" is FIXED — auto-seeded at create, not addable/removable.
VALID_MODULE_TYPES = ("description", "image", "location", "doodle",
                      "bring", "rides", "chat")
SINGLETON_TYPES = ("description", "image", "location", "doodle",
                   "bring", "rides", "chat")

MAX_DOODLE_OPTIONS = 20
MAX_CHAT_LEN = 2000
IMAGE_UPLOAD_DIR = "event_images"   # under instance/data/
IMAGE_EXT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
             "gif": "image/gif", "webp": "image/webp"}

# Hardcoded "Movie Night" preset — the MVP stand-in for the App Store
# template packs (master plan §9). module type → initial config.
EVENT_TEMPLATES = {
    "movie_night": [
        {"type": "description", "config": {"text": "", "spacing": "normal"}},
        {"type": "image",  "config": {"url": "", "caption": ""}},
        {"type": "location", "config": {"address": "", "note": ""}},
        {"type": "doodle", "config": {"anonymous": False, "deadline": None,
                                      "show_counts": True, "mode": "date"}},
        {"type": "bring",  "config": {}},
        {"type": "rides",  "config": {}},
    ],
}

_INV = object()   # sentinel for an unparseable datetime


# ---------------------------------------------------------------------------
# helpers - auth scope / lookups
# ---------------------------------------------------------------------------

def _event_for(event_id):
    return Event.query.get(event_id)


def _member(event, user):
    """The caller's EventMember row, or None (non-members can't see it)."""
    if event is None or user is None:
        return None
    return EventMember.query.filter_by(event_id=event.id,
                                       user_id=user.id).first()


def _host(event, user):
    m = _member(event, user)
    return m if m is not None and m.role == "host" else None


def _deny(msg, code):
    return jsonify({"error": msg}), code


def _parse_dt(value):
    """Naive local wall-clock: client sends what datetime-local gives."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=None)
    except ValueError:
        return _INV


def _iso(dt):
    return dt.isoformat() if dt else None


def _parse_hhmm(value):
    """"19:30" → (19, 30); None when not a valid time."""
    if not isinstance(value, str):
        return None
    try:
        h, m = value.strip().split(":")
        h, m = int(h), int(m)
    except ValueError:
        return None
    if 0 <= h < 24 and 0 <= m < 60:
        return (h, m)
    return None


def _since_param(name):
    raw = request.args.get(name)
    if not raw:
        return None
    parsed = _parse_dt(raw)
    return None if parsed is _INV else parsed


# ---------------------------------------------------------------- serializers

def _user_brief(user):
    if user is None:
        return {"id": None, "username": "(left)"}
    return {"id": user.id, "username": user.username}


def _member_to_dict(member):
    return {
        "id": member.id,
        "user": _user_brief(member.user),
        "role": member.role,
        "rsvp": member.rsvp,
        "rsvp_stale": member.rsvp_stale,
        "needs_ride": member.needs_ride,
        "joined_at": _iso(member.joined_at),
    }


def _module_to_dict(module, deep=False):
    out = {
        "id": module.id,
        "type": module.type,
        "position": module.position,
        "hidden": module.hidden,
        "config": module.config or {},
    }
    if not deep:
        return out
    out.update(_module_state(module))
    return out


def _module_state(module):
    """Per-type relational state (the member roster is shipped in
    event_data separately, so stateful sections start at doodle)."""
    if module.type == "doodle":
        options = [_option_to_dict(o) for o in module.options]
        votes = [_vote_to_dict(v) for v in module.votes]
        return {"options": options, "votes": votes}
    if module.type == "bring":
        items = [_item_to_dict(i) for i in module.items]
        return {"items": items}
    if module.type == "rides":
        rides = [_ride_to_dict(r) for r in module.rides]
        return {"rides": rides}
    if module.type == "chat":
        messages = [_message_to_dict(m) for m in module.messages]
        return {"messages": messages}
    return {}


def _option_to_dict(option):
    return {
        "id": option.id,
        "starts_at": _iso(option.starts_at),
        "ends_at": _iso(option.ends_at),
        "position": option.position,
    }


def _vote_to_dict(vote, member_ids=None):
    """member_ids: the set of current member user-ids — votes from
    non-members render as 'left' (user_id survives, membership doesn't)."""
    return {
        "id": vote.id,
        "option_id": vote.option_id,
        "user": _user_brief(vote.user),
        "comment": vote.comment,
        "created_at": _iso(vote.created_at),
    }


def _item_to_dict(item):
    return {
        "id": item.id,
        "label": item.label,
        "target_qty": item.target_qty,
        "added_by": _user_brief(item.added_by and
                                User.query.get(item.added_by)),
        "claims": [
            {"id": c.id, "member_id": c.member_id, "qty": c.qty}
            for c in item.claims
        ],
        "claimed_qty": sum(c.qty for c in item.claims),
        "created_at": _iso(item.created_at),
    }


def _ride_to_dict(ride):
    driver = ride.driver
    return {
        "id": ride.id,
        "driver": {
            "member_id": driver.id if driver else None,
            "user": _user_brief(driver.user if driver else None),
        },
        "seats": ride.seats,
        "departure": ride.departure,
        "pickup_note": ride.pickup_note,
        "destination": ride.destination,
        "passengers": [
            {"id": p.id, "member_id": p.member_id}
            for p in ride.passengers
        ],
        "created_at": _iso(ride.created_at),
    }


def _message_to_dict(message):
    return {
        "id": message.id,
        "user": _user_brief(message.user),
        "text": message.text,
        "created_at": _iso(message.created_at),
    }


def _event_to_dict(event, user=None):
    members = event.members
    me = _member(event, user) if user is not None else None
    return {
        "id": event.id,
        "title": event.title,
        "subtitle": event.subtitle,
        "status": event.status,
        "event_date": _iso(event.event_date),
        "date_source": event.date_source,
        "is_host": bool(me and me.role == "host"),
        "my_member_id": me.id if me else None,
        "my_rsvp": me.rsvp if me else None,
        "member_count": len(members),
        "attending": sum(1 for m in members if m.rsvp == "attending"),
        "maybe": sum(1 for m in members if m.rsvp == "maybe"),
    }


# ------------------------------------------------------- leave/remove cascade

def _release_member_state(member):
    """Explicit transactional release when a member leaves or is removed:
    their bring claims, their passenger seats, any ride they drive (which
    drops its passengers back to the board). Doodle votes and chat survive
    (FK to users → render as 'left'). Not relied on cascade: SQLite."""
    BringClaim.query.filter_by(member_id=member.id).delete(
        synchronize_session=False)
    RidePassenger.query.filter_by(member_id=member.id).delete(
        synchronize_session=False)
    rides_module = EventModule.query.filter_by(
        event_id=member.event_id, type="rides").first()
    if rides_module is not None:
        EventRide.query.filter_by(module_id=rides_module.id,
                                  driver_member_id=member.id).delete(
            synchronize_session=False)


# ---------------------------------------------------------------------------
# pages
# ---------------------------------------------------------------------------

@events_bp.route('/')
@permission_required("core", PAGE)
def events_page(user):
    return render_template('main/events.html', user_id=user.id)


@events_bp.route('/<int:event_id>/')
@permission_required("core", PAGE)
def event_page(user, event_id):
    # same SPA template as the list view; JS switches on window.EVENT_ID
    return render_template('main/events.html', event_id=event_id,
                           user_id=user.id)


@events_bp.route('/<int:event_id>/edit/')
@permission_required("core", PAGE)
def event_edit_page(user, event_id):
    # host-only edit mode — same SPA template; JS switches on the path
    return render_template('main/events.html', event_id=event_id,
                           user_id=user.id, edit_mode=True)


# invite landing page — /events/<id>?t=<token> is the link the host
# copies; this dedicated GET page replaces the old "Method Not Allowed"
# trap where the join POST endpoint was opened directly in the browser.
@events_bp.route('/invite/<token>')
def invite_page(token):
    """Shows event name + host + a Join button; the button POSTs to the
    join API (which needs a session — the page prompts login first if
    anonymous). Invalid/expired tokens render the same page with an
    error banner; no existence leak. Also handles archived events."""
    event = Event.query.filter_by(invite_token=token).first()
    return render_template(
        "main/invite.html",
        invite_token=token,
        event=event if event and event.status == "published" else None,
        already_member=False,   # JS refines this via the who API
    )


# ---------------------------------------------------------------------------
# api - lifecycle
#   GET    /events/api/events            -> my events (list view)
#   POST   /events/api/events            -> create draft (+template)
#   GET    /events/api/events/<id>/data  -> aggregate (polled)
#   PATCH  /events/api/events/<id>       -> host edits title/subtitle/date
#   POST   /events/api/events/<id>/publish | unpublish | archive  (host)
#   POST   /events/api/events/<id>/invite -> rotate token (host)
#   POST   /events/api/events/<id>/join   -> join via token
# ---------------------------------------------------------------------------


@events_bp.route('/api/events', methods=['GET'])
@permission_required("core", API)
def list_events(user):
    memberships = EventMember.query.filter_by(user_id=user.id).all()
    events = []
    for m in memberships:
        e = m.event
        if e is None or e.status == "archived" and m.role != "host":
            continue
        events.append(_event_to_dict(e, user))
    # soonest-dated first, undated last, then by id
    events.sort(key=lambda ev: (ev["event_date"] is None,
                                ev["event_date"] or "", ev["id"]))
    return jsonify({"events": events})


@events_bp.route('/api/events', methods=['POST'])
@permission_required("core", API)
def create_event(user):
    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title") or "").strip()[:120]
    subtitle = str(payload.get("subtitle") or "").strip()[:200] or None
    template = payload.get("template")

    if not title:
        return _deny("title is required", 400)

    modules_spec = EVENT_TEMPLATES.get(template)
    if template is not None and modules_spec is None:
        return _deny("unknown template", 400)

    event = Event(host_id=user.id, title=title, subtitle=subtitle,
                  status="draft")
    db.session.add(event)
    db.session.flush()   # event.id for members/modules

    db.session.add(EventMember(event_id=event.id, user_id=user.id,
                               role="host", rsvp="attending"))

    # every event: the fixed Members module at the top, then template
    # modules (or a single empty Description for a blank event)
    specs = (modules_spec or [{"type": "description", "config": {}}])
    db.session.add(EventModule(event_id=event.id, type="members",
                               position=0, config={}))
    for i, spec in enumerate(specs):
        db.session.add(EventModule(event_id=event.id, type=spec["type"],
                                   position=i + 1,
                                   config=spec.get("config") or {}))

    db.session.commit()
    return jsonify({"event": _event_to_dict(event, user)}), 201


@events_bp.route('/api/events/<int:event_id>/data', methods=['GET'])
@permission_required("core", API)
def event_data(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    me = _member(event, user)
    # non-members get 404 (not 403) so drafts don't leak their existence
    if me is None:
        return _deny("not found", 404)
    if event.status == "archived" and me.role != "host":
        return _deny("not found", 404)

    modules = [m for m in event.modules if not m.hidden or me.role == "host"]
    out = {
        "event": _event_to_dict(event, user),
        "modules": [_module_to_dict(m) for m in modules],
        "server_time": datetime.now().isoformat(),
    }

    # per-type sections: always fresh for now (no delta deltas yet) —
    # cursors are plumbed for later; counts are used by the client to
    # detect refetch needs. The member roster is fundamental — it ships
    # even when no members module exists on the event.
    out["members"] = [_member_to_dict(m) for m in event.members]
    for module in modules:
        if module.type in ("doodle", "bring", "rides", "chat"):
            state = _module_state(module)
            for key in ("members", "options", "votes", "items", "rides",
                        "messages"):
                if key in state:
                    out[key] = state[key]
    # chat always capped + newest last
    if "messages" in out:
        out["messages"] = out["messages"][-100:]

    return jsonify(out)


@events_bp.route('/api/events/<int:event_id>', methods=['PATCH'])
@permission_required("core", API)
def update_event(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    changed = False
    if "title" in payload:
        title = str(payload.get("title") or "").strip()[:120]
        if not title:
            return _deny("title is required", 400)
        event.title = title
        changed = True
    if "subtitle" in payload:
        event.subtitle = str(payload.get("subtitle") or "").strip()[:200] \
            or None
        changed = True
    if "event_date" in payload:
        parsed = _parse_dt(payload.get("event_date"))
        if parsed is _INV:
            return _deny("event_date must be an ISO datetime", 400)
        if parsed != event.event_date:
            event.event_date = parsed
            event.date_source = "manual"
            for m in event.members:
                m.rsvp_stale = True
            notify_event_members(
                event, "date_changed",
                subject=f"Date changed: {event.title}",
                body=f"The date for “{event.title}” changed — "
                     f"please re-check your RSVP.",
                exclude_user_id=user.id,
            )
            changed = True

    if not changed:
        return _deny("nothing to update", 400)

    db.session.commit()
    return jsonify({"event": _event_to_dict(event, user)})


@events_bp.route('/api/events/<int:event_id>/publish', methods=['POST'])
@permission_required("core", API)
def publish_event(user, event_id):
    return _set_status(user, event_id, "published")


@events_bp.route('/api/events/<int:event_id>/unpublish', methods=['POST'])
@permission_required("core", API)
def unpublish_event(user, event_id):
    return _set_status(user, event_id, "draft")


@events_bp.route('/api/events/<int:event_id>/archive', methods=['POST'])
@permission_required("core", API)
def archive_event(user, event_id):
    return _set_status(user, event_id, "archived")


def _set_status(user, event_id, status):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    if status == "published" and event.status == "published":
        return _deny("already published", 409)
    event.status = status
    db.session.commit()

    if status == "published":
        notify_event_members(
            event, "event_published",
            subject=f"Invitation: {event.title}",
            body=f"You have been added to “{event.title}” — open Events "
                 f"to see the details and RSVP.",
            exclude_user_id=user.id,
        )
    return jsonify({"ok": True, "status": event.status})


@events_bp.route('/api/events/<int:event_id>/invite', methods=['POST'])
@permission_required("core", API)
def rotate_invite(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)
    event.invite_token = secrets.token_urlsafe(32)[:64]
    db.session.commit()
    return jsonify({"token": event.invite_token})


@events_bp.route('/api/events/<int:event_id>/join', methods=['POST'])
@permission_required("core", API)
def join_event(user, event_id):
    event = _event_for(event_id)
    if event is None or event.status != "published":
        return _deny("not found", 404)

    payload = request.get_json(silent=True) or {}
    token = str(payload.get("token") or "")
    if not token or not event.invite_token or \
            not secrets.compare_digest(token, event.invite_token):
        return _deny("invalid token", 403)

    if _member(event, user) is not None:
        return jsonify({"ok": True, "already": True})

    db.session.add(EventMember(event_id=event.id, user_id=user.id,
                               role="member", rsvp="pending"))
    db.session.commit()

    notify_user(
        event.host, "member_added",
        payload={"event_id": event.id, "title": event.title,
                 "actor": user.username},
    )
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# api - people
#   GET  /events/api/friends                       -> legacy picker source
#                                                   (picker now reads /socials/api/friends)
#   POST /events/api/events/<id>/members            -> add friends (host)
#   POST /events/api/events/<id>/members/by-key     -> add by key/username
#   DELETE /events/api/events/<id>/members/<mid>    -> host removes
#   POST /events/api/events/<id>/leave              -> member leaves
#   POST /events/api/events/<id>/transfer-host      -> host transfers
#   POST /events/api/events/<id>/rsvp               -> set own RSVP
#   PATCH /events/api/events/<id>/needs-ride        -> own flag
# ---------------------------------------------------------------------------


@events_bp.route('/api/friends', methods=['GET'])
@permission_required("core", API)
def friends(user):
    """Kept for backward compatibility with anything still pointing at
    /events/api/friends — the shared friend picker now reads the richer
    /socials/api/friends (events.html passes that URL to the picker)."""
    return jsonify({"friends": [
        {"id": f.id, "username": f.username, "key": f.key,
         "email": f.email}
        for f in user.friends
    ]})


@events_bp.route('/api/events/<int:event_id>/members', methods=['POST'])
@permission_required("core", API)
def add_members(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    ids = payload.get("user_ids")
    if not isinstance(ids, list) or not ids:
        return _deny("user_ids must be a non-empty list", 400)

    added, skipped = 0, []
    for uid in ids:
        if not isinstance(uid, int):
            skipped.append(uid)
            continue
        if EventMember.query.filter_by(event_id=event.id,
                                       user_id=uid).first() is not None:
            skipped.append(uid)
            continue
        target = User.query.get(uid)
        if target is None:
            skipped.append(uid)
            continue
        db.session.add(EventMember(event_id=event.id, user_id=uid,
                                   role="member"))
        notify_user(
            target, "member_added",
            payload={"event_id": event.id, "title": event.title,
                     "actor": user.username},
            email={"subject": f"You're in: {event.title}",
                   "body": f"{user.username} added you to "
                           f"“{event.title}”."},
            event=event,
        )
        added += 1

    db.session.commit()
    return jsonify({"added": added, "skipped": skipped})


@events_bp.route('/api/events/<int:event_id>/members/by-key',
                 methods=['POST'])
@permission_required("core", API)
def add_member_by_key(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    lookup = str(payload.get("key") or payload.get("username") or "").strip()
    if not lookup:
        return _deny("key or username required", 400)

    target = User.query.filter(
        (User.key == lookup) | (User.username == lookup)).first()
    if target is None:
        return _deny("user not found", 404)
    if EventMember.query.filter_by(event_id=event.id,
                                   user_id=target.id).first() is not None:
        return _deny("already a member", 409)

    db.session.add(EventMember(event_id=event.id, user_id=target.id,
                               role="member"))
    db.session.commit()
    notify_user(
        target, "member_added",
        payload={"event_id": event.id, "title": event.title,
                 "actor": user.username},
        email={"subject": f"You're in: {event.title}",
               "body": f"{user.username} added you to “{event.title}”."},
        event=event,
    )
    return jsonify({"ok": True})


@events_bp.route('/api/events/<int:event_id>/members/<int:member_id>',
                 methods=['DELETE'])
@permission_required("core", API)
def remove_member(user, event_id, member_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    member = EventMember.query.filter_by(id=member_id,
                                         event_id=event.id).first()
    if member is None:
        return _deny("not found", 404)
    if member.role == "host":
        return _deny("cannot remove the host", 409)

    _release_member_state(member)
    db.session.delete(member)
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/events/<int:event_id>/leave', methods=['POST'])
@permission_required("core", API)
def leave_event(user, event_id):
    event = _event_for(event_id)
    me = _member(event, user)
    if me is None:
        return _deny("not found", 404)
    if me.role == "host":
        return _deny("transfer the host role first", 409)

    _release_member_state(me)
    db.session.delete(me)
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/events/<int:event_id>/transfer-host',
                 methods=['POST'])
@permission_required("core", API)
def transfer_host(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    member_id = payload.get("member_id")
    if not isinstance(member_id, int):
        return _deny("member_id required", 400)

    target = EventMember.query.filter_by(id=member_id,
                                         event_id=event.id).first()
    if target is None or target.role == "host":
        return _deny("member not found", 404)

    me = _member(event, user)
    me.role = "member"
    target.role = "host"
    event.host_id = target.user_id
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/events/<int:event_id>/rsvp', methods=['POST'])
@permission_required("core", API)
def set_rsvp(user, event_id):
    event = _event_for(event_id)
    me = _member(event, user)
    if me is None:
        return _deny("not found", 404)

    payload = request.get_json(silent=True) or {}
    rsvp = str(payload.get("rsvp") or "").strip().lower()
    if rsvp not in VALID_RSVP:
        return _deny("rsvp must be one of: " + ", ".join(VALID_RSVP), 400)

    me.rsvp = rsvp
    me.rsvp_stale = False
    db.session.commit()
    return jsonify({"ok": True, "rsvp": me.rsvp})


@events_bp.route('/api/events/<int:event_id>/needs-ride', methods=['PATCH'])
@permission_required("core", API)
def set_needs_ride(user, event_id):
    event = _event_for(event_id)
    me = _member(event, user)
    if me is None:
        return _deny("not found", 404)

    payload = request.get_json(silent=True) or {}
    me.needs_ride = bool(payload.get("value"))
    db.session.commit()
    return jsonify({"ok": True, "needs_ride": me.needs_ride})


# ---------------------------------------------------------------------------
# api - modules (host structure)
#   POST   /events/api/events/<id>/modules        -> add
#   PATCH  /events/api/modules/<module_id>        -> config/position/hidden
#   DELETE /events/api/modules/<module_id>        -> hide (?mode=delete)
#   POST   /events/api/events/<id>/modules/reorder
#   PATCH  /events/api/modules/<module_id>/content -> notes/image/location
# ---------------------------------------------------------------------------


@events_bp.route('/api/events/<int:event_id>/modules', methods=['POST'])
@permission_required("core", API)
def add_module(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    type = str(payload.get("type") or "").strip()
    if type not in VALID_MODULE_TYPES:
        return _deny("unknown module type", 400)

    if type in SINGLETON_TYPES:
        existing = EventModule.query.filter_by(event_id=event.id,
                                               type=type).first()
        if existing is not None:
            if existing.hidden:
                # a hidden singleton blocks the add-picker (409) while
                # being invisible in the stack — bring it back instead
                existing.hidden = False
                db.session.commit()
                return jsonify({"module": _module_to_dict(existing)})
            return _deny("module already exists", 409)

    max_pos = db.session.query(db.func.max(EventModule.position)).filter_by(
        event_id=event.id).scalar()
    module = EventModule(event_id=event.id, type=type,
                         position=(max_pos or 0) + 1)
    if type == "doodle":
        module.config = {"anonymous": False, "deadline": None,
                         "show_counts": True, "mode": "date"}
    db.session.add(module)
    db.session.commit()
    return jsonify({"module": _module_to_dict(module)}), 201


def _module_for(module_id):
    return EventModule.query.get(module_id)


@events_bp.route('/api/modules/<int:module_id>', methods=['PATCH', 'DELETE'])
@permission_required("core", API)
def module_detail(user, module_id):
    module = _module_for(module_id)
    if module is None:
        return _deny("not found", 404)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)

    if request.method == 'DELETE':
        if module.type == "members":
            return _deny("the members module is fixed", 400)
        mode = request.args.get("mode", "hide")
        if mode == "delete" and module.type in ("doodle", "bring", "rides",
                                                "chat"):
            # stateful modules: removing drops their data too
            db.session.delete(module)
        else:
            module.hidden = True
        db.session.commit()
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    changed = False
    if "config" in payload and isinstance(payload["config"], dict):
        # the event date lives in the Title module now — a stale doodle
        # deadline key is silently dropped (one source of truth)
        payload["config"].pop("deadline", None)
        module.config = {**(module.config or {}), **payload["config"]}
        changed = True
    if "position" in payload and isinstance(payload["position"], int):
        module.position = payload["position"]
        changed = True
    if "hidden" in payload:
        module.hidden = bool(payload["hidden"])
        changed = True
    if not changed:
        return _deny("nothing to update", 400)
    db.session.commit()
    return jsonify({"module": _module_to_dict(module)})


@events_bp.route('/api/events/<int:event_id>/modules/reorder',
                 methods=['POST'])
@permission_required("core", API)
def reorder_modules(user, event_id):
    event = _event_for(event_id)
    if event is None:
        return _deny("not found", 404)
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    order = payload.get("order")
    if not isinstance(order, list):
        return _deny("order must be a list of module ids", 400)

    for index, mid in enumerate(order):
        if isinstance(mid, int):
            module = EventModule.query.filter_by(id=mid,
                                                 event_id=event.id).first()
            if module is not None:
                module.position = index

    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/modules/<int:module_id>/content', methods=['PATCH'])
@permission_required("core", API)
def module_content(user, module_id):
    module = _module_for(module_id)
    if module is None:
        return _deny("not found", 404)
    if module.type not in ("description", "image", "location"):
        return _deny("module has no editable content", 400)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    # deepcopy: SQLAlchemy only flags a JSON column as dirty on assignment
    # of a *different* object — in-place mutation of the loaded dict is
    # silently lost on commit.
    config = copy.deepcopy(module.config) or {}

    if module.type == "description":
        if "text" in payload:
            config["text"] = str(payload.get("text") or "")[:5000]
        if "spacing" in payload:
            config["spacing"] = str(payload.get("spacing") or "normal")
    elif module.type == "image":
        if "url" in payload:
            config["url"] = str(payload.get("url") or "")[:500]
        if "caption" in payload:
            config["caption"] = str(payload.get("caption") or "")[:200]
    elif module.type == "location":
        if "address" in payload:
            config["address"] = str(payload.get("address") or "")[:300]
        if "lat" in payload or "lng" in payload:
            try:
                config["lat"] = float(payload.get("lat"))
                config["lng"] = float(payload.get("lng"))
            except (TypeError, ValueError):
                return _deny("lat/lng must be numbers", 400)
        if "note" in payload:
            config["note"] = str(payload.get("note") or "")[:300]

    module.config = config
    db.session.commit()
    return jsonify({"module": _module_to_dict(module)})


# image upload — POST multipart/form-data with a `file` field; stores the
# bytes under instance/data/event_images/ and sets the module's url.
@events_bp.route('/api/modules/<int:module_id>/image', methods=['POST'])
@permission_required("core", API)
def module_image_upload(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "image":
        return _deny("not found", 404)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)

    file = request.files.get("file")
    if file is None or not file.filename:
        return _deny("no file uploaded", 400)
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in IMAGE_EXT:
        return _deny("only png/jpg/gif/webp images", 400)
    blob = file.read()
    if len(blob) > 8 * 1024 * 1024:
        return _deny("image too large (max 8 MB)", 413)

    upload_dir = os.path.join(current_app.instance_path, "data", IMAGE_UPLOAD_DIR)
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"m{module.id}_{secrets.token_hex(8)}.{ext}"
    with open(os.path.join(upload_dir, filename), "wb") as fh:
        fh.write(blob)

    config = copy.deepcopy(module.config) or {}
    config["url"] = f"/events/img/{filename}"
    module.config = config
    db.session.commit()
    return jsonify({"module": _module_to_dict(module)})


@events_bp.route('/img/<path:filename>')
@permission_required("core", PAGE)
def event_image(user, filename):
    # upload dir is flat (module_id-prefixed names, hex token) — no
    # traversal possible beyond it; send_from_directory enforces the root.
    return send_from_directory(
        os.path.join(current_app.instance_path, "data", IMAGE_UPLOAD_DIR), filename)


# ---------------------------------------------------------------------------
# api - doodle
#   POST   /events/api/modules/<id>/options          -> replace set (host)
#   DELETE /events/api/modules/<id>/options/<oid>    -> host
#   POST   /events/api/modules/<id>/vote             -> replace own votes
#   POST   /events/api/modules/<id>/finalize         -> host picks winner
# ---------------------------------------------------------------------------


@events_bp.route('/api/modules/<int:module_id>/votes', methods=['DELETE'])
@permission_required("core", API)
def reset_votes(user, module_id):
    """Host-only: wipes every vote for the doodle so the option set can
    be edited again (the vote-lock 409 points here)."""
    module = _module_for(module_id)
    if module is None or module.type != "doodle":
        return _deny("not found", 404)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)
    DoodleVote.query.filter_by(module_id=module.id).delete(
        synchronize_session=False)
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/modules/<int:module_id>/options', methods=['POST'])
@permission_required("core", API)
def set_options(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "doodle":
        return _deny("not found", 404)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)

    # vote lock — once anyone answered, options can't change (Rallly's
    # "locked: participants have already answered" guard); editing must
    # not silently wipe votes.
    if DoodleVote.query.filter(
            DoodleVote.module_id == module.id,
            DoodleVote.option_id.isnot(None)).count() > 0:
        return _deny("options are locked — participants have already "
                     "voted (reset votes first)", 409)

    payload = request.get_json(silent=True) or {}
    config = module.config or {}
    mode = config.get("mode", "date")

    # "date" mode: {days: ["2026-11-14", ...]} whole-day options
    # "time" mode: {time_slots: [{start: "19:30", end: "21:00"}, ...]}
    #   pinned to the event's canonical date (one source of truth).
    options = []
    if mode == "time":
        slots = payload.get("time_slots")
        if not isinstance(slots, list) or not slots:
            return _deny("time_slots must be a non-empty list", 400)
        if len(slots) > MAX_DOODLE_OPTIONS:
            return _deny("too many options (max 20)", 400)
        base = module.event.event_date
        if base is None:
            return _deny("set the event date first (Title module)", 400)
        for slot in slots:
            if not isinstance(slot, dict):
                return _deny("each time slot must be an object", 400)
            start_t = _parse_hhmm(slot.get("start"))
            end_t = _parse_hhmm(slot.get("end"))
            if start_t is None or end_t is None or end_t <= start_t:
                return _deny("each slot needs start < end (HH:MM)", 400)
            start_dt = base.replace(hour=start_t[0], minute=start_t[1])
            end_dt = base.replace(hour=end_t[0], minute=end_t[1])
            options.append((start_dt, end_dt))
    else:
        days = payload.get("days")
        if not isinstance(days, list) or not days:
            return _deny("days must be a non-empty list of dates", 400)
        if len(days) > MAX_DOODLE_OPTIONS:
            return _deny("too many options (max 20)", 400)
        for day in days:
            try:
                d = datetime.strptime(str(day), "%Y-%m-%d")
            except ValueError:
                return _deny(f"not a date: {day}", 400)
            options.append((d, None))

    DoodleVote.query.filter_by(module_id=module.id).delete(
        synchronize_session=False)
    DoodleOption.query.filter_by(module_id=module.id).delete(
        synchronize_session=False)
    db.session.flush()
    for i, (start, end) in enumerate(options):
        db.session.add(DoodleOption(module_id=module.id, starts_at=start,
                                    ends_at=end, position=i))
    db.session.commit()
    return jsonify({"module": _module_to_dict(module, deep=True)})


@events_bp.route('/api/modules/<int:module_id>/options/<int:option_id>',
                 methods=['DELETE'])
@permission_required("core", API)
def delete_option(user, module_id, option_id):
    module = _module_for(module_id)
    if module is None or module.type != "doodle":
        return _deny("not found", 404)
    if _host(module.event, user) is None:
        return _deny("forbidden", 403)

    option = DoodleOption.query.filter_by(id=option_id,
                                          module_id=module.id).first()
    if option is None:
        return _deny("not found", 404)
    db.session.delete(option)
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/modules/<int:module_id>/vote', methods=['POST'])
@permission_required("core", API)
def vote(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "doodle":
        return _deny("not found", 404)
    me = _member(module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    option_ids = payload.get("option_ids")
    if not isinstance(option_ids, list):
        return _deny("option_ids must be a list", 400)
    comment = payload.get("comment")
    comment = str(comment).strip()[:200] if comment else None

    valid_ids = {o.id for o in module.options}
    picked = [oid for oid in option_ids if oid in valid_ids]
    none_vote = bool(payload.get("none_of_these"))

    if none_vote and not comment:
        return _deny("comment required for 'none of these work'", 400)
    if not picked and not none_vote:
        return _deny("pick at least one option", 400)

    DoodleVote.query.filter_by(module_id=module.id,
                               user_id=user.id).delete(
        synchronize_session=False)
    for oid in picked:
        db.session.add(DoodleVote(module_id=module.id, option_id=oid,
                                  user_id=user.id))
    if none_vote:
        db.session.add(DoodleVote(module_id=module.id, option_id=None,
                                  user_id=user.id, comment=comment))
    db.session.commit()
    return jsonify({"ok": True})


@events_bp.route('/api/modules/<int:module_id>/finalize', methods=['POST'])
@permission_required("core", API)
def finalize_doodle(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "doodle":
        return _deny("not found", 404)
    event = module.event
    if _host(event, user) is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    option_id = payload.get("option_id")
    option = DoodleOption.query.filter_by(id=option_id,
                                          module_id=module.id).first()
    if option is None:
        return _deny("option not found", 404)

    event.event_date = option.starts_at
    event.date_source = "doodle"
    for m in event.members:
        m.rsvp_stale = True

    db.session.commit()
    notify_event_members(
        event, "date_finalized",
        subject=f"Date finalized: {event.title}",
        body=f"The date for “{event.title}” is set: "
             f"{option.starts_at.strftime('%d.%m.%Y %H:%M')}. "
             f"Please confirm your RSVP.",
        exclude_user_id=user.id,
    )
    return jsonify({"ok": True, "event_date": _iso(event.event_date)})


# ---------------------------------------------------------------------------
# api - bring
#   POST   /events/api/modules/<id>/items        -> member adds item
#   PATCH  /events/api/items/<item_id>           -> host edits
#   DELETE /events/api/items/<item_id>           -> host removes
#   POST   /events/api/items/<item_id>/claim     -> member claims
#   DELETE /events/api/items/<item_id>/claim     -> unclaim own
# ---------------------------------------------------------------------------


@events_bp.route('/api/modules/<int:module_id>/items', methods=['POST'])
@permission_required("core", API)
def add_item(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "bring":
        return _deny("not found", 404)
    me = _member(module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    label = str(payload.get("label") or "").strip()[:120]
    if not label:
        return _deny("label is required", 400)
    try:
        target_qty = max(1, int(payload.get("target_qty", 1)))
    except (TypeError, ValueError):
        return _deny("target_qty must be an integer", 400)

    item = BringItem(module_id=module.id, label=label,
                     target_qty=target_qty, added_by=user.id)
    db.session.add(item)
    db.session.commit()
    return jsonify({"item": _item_to_dict(item)}), 201


def _item_for(item_id):
    return BringItem.query.get(item_id)


@events_bp.route('/api/items/<int:item_id>', methods=['PATCH', 'DELETE'])
@permission_required("core", API)
def item_detail(user, item_id):
    item = _item_for(item_id)
    if item is None:
        return _deny("not found", 404)
    if _host(item.module.event, user) is None:
        return _deny("forbidden", 403)

    if request.method == 'DELETE':
        db.session.delete(item)
        db.session.commit()
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    if "label" in payload:
        label = str(payload.get("label") or "").strip()[:120]
        if not label:
            return _deny("label is required", 400)
        item.label = label
    if "target_qty" in payload:
        try:
            item.target_qty = max(1, int(payload["target_qty"]))
        except (TypeError, ValueError):
            return _deny("target_qty must be an integer", 400)
    db.session.commit()
    return jsonify({"item": _item_to_dict(item)})


@events_bp.route('/api/items/<int:item_id>/claim', methods=['POST',
                                                          'DELETE'])
@permission_required("core", API)
def claim_item(user, item_id):
    item = _item_for(item_id)
    if item is None:
        return _deny("not found", 404)
    me = _member(item.module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    existing = BringClaim.query.filter_by(item_id=item.id,
                                          member_id=me.id).first()

    if request.method == 'DELETE':
        if existing is None:
            return _deny("not claimed", 404)
        db.session.delete(existing)
        db.session.commit()
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    try:
        qty = max(1, int(payload.get("qty", 1)))
    except (TypeError, ValueError):
        return _deny("qty must be an integer", 400)

    taken = sum(c.qty for c in item.claims if c.id != (existing.id or -1))
    if taken + qty > item.target_qty:
        return _deny("not enough left", 409)

    if existing is None:
        db.session.add(BringClaim(item_id=item.id, member_id=me.id,
                                  qty=qty))
    else:
        existing.qty = qty
    db.session.commit()
    return jsonify({"item": _item_to_dict(item)})


# ---------------------------------------------------------------------------
# api - rides
#   POST   /events/api/modules/<id>/rides       -> member offers a ride
#   DELETE /events/api/rides/<ride_id>          -> driver or host
#   POST   /events/api/rides/<ride_id>/passengers    -> claim seat
#   DELETE /events/api/rides/<ride_id>/passengers    -> release seat
# ---------------------------------------------------------------------------


@events_bp.route('/api/modules/<int:module_id>/rides', methods=['POST'])
@permission_required("core", API)
def offer_ride(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "rides":
        return _deny("not found", 404)
    me = _member(module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    try:
        seats = max(1, int(payload.get("seats", 1)))
    except (TypeError, ValueError):
        return _deny("seats must be an integer", 400)

    ride = EventRide(module_id=module.id, driver_member_id=me.id,
                     seats=seats,
                     departure=str(payload.get("departure") or "")[:40] or None,
                     pickup_note=str(payload.get("pickup_note") or "")[:200] or None,
                     destination=str(payload.get("destination") or "")[:200] or None)
    db.session.add(ride)
    db.session.commit()
    return jsonify({"ride": _ride_to_dict(ride)}), 201


def _ride_for(ride_id):
    return EventRide.query.get(ride_id)


@events_bp.route('/api/rides/<int:ride_id>', methods=['DELETE'])
@permission_required("core", API)
def delete_ride(user, ride_id):
    ride = _ride_for(ride_id)
    if ride is None:
        return _deny("not found", 404)
    event = ride.module.event
    me = _member(event, user)
    is_driver = me is not None and me.id == ride.driver_member_id
    if not is_driver and _host(event, user) is None:
        return _deny("forbidden", 403)

    # notify passengers the ride is gone
    passengers = [p.member for p in ride.passengers]
    db.session.delete(ride)
    db.session.commit()
    for passenger in passengers:
        if passenger.user_id != user.id:
            notify_user(
                passenger.user, "ride_cancelled",
                payload={"event_id": event.id, "title": event.title,
                         "actor": user.username},
            )
    return jsonify({"ok": True})


@events_bp.route('/api/rides/<int:ride_id>/passengers',
                 methods=['POST', 'DELETE'])
@permission_required("core", API)
def ride_passengers(user, ride_id):
    ride = _ride_for(ride_id)
    if ride is None:
        return _deny("not found", 404)
    me = _member(ride.module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    existing = RidePassenger.query.filter_by(ride_id=ride.id,
                                             member_id=me.id).first()

    if request.method == 'DELETE':
        if existing is None:
            return _deny("not a passenger", 404)
        db.session.delete(existing)
        db.session.commit()
        return jsonify({"ok": True})

    if existing is not None:
        return _deny("already a passenger", 409)
    if me.id == ride.driver_member_id:
        return _deny("you can't take a seat in your own ride", 400)
    if len(ride.passengers) >= ride.seats:
        return _deny("ride is full", 409)
    db.session.add(RidePassenger(ride_id=ride.id, member_id=me.id))
    db.session.commit()
    return jsonify({"ride": _ride_to_dict(ride)})


# ---------------------------------------------------------------------------
# api - chat
#   POST   /events/api/modules/<id>/chat   -> send
#   DELETE /events/api/chat/<msg_id>       -> host only
# ---------------------------------------------------------------------------


@events_bp.route('/api/modules/<int:module_id>/chat', methods=['POST'])
@permission_required("core", API)
def send_chat(user, module_id):
    module = _module_for(module_id)
    if module is None or module.type != "chat":
        return _deny("not found", 404)
    me = _member(module.event, user)
    if me is None:
        return _deny("forbidden", 403)

    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()[:MAX_CHAT_LEN]
    if not text:
        return _deny("text is required", 400)

    message = ChatMessage(module_id=module.id, user_id=user.id, text=text)
    db.session.add(message)
    db.session.commit()
    return jsonify({"message": _message_to_dict(message)}), 201


@events_bp.route('/api/chat/<int:message_id>', methods=['DELETE'])
@permission_required("core", API)
def delete_message(user, message_id):
    # Hosts only — per product decision, authors may NOT delete their own
    # messages (this TIGHTENS the previous author-or-host rule).
    message = ChatMessage.query.get(message_id)
    if message is None:
        return _deny("not found", 404)
    if _host(message.module.event, user) is None:
        return _deny("forbidden", 403)
    db.session.delete(message)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# api - notifications + dashboard
#   GET  /events/api/notifications     -> latest 50 + unread count
#   POST /events/api/notifications/read -> mark ids or all read
#   GET  /events/api/upcoming          -> next published dated events
# ---------------------------------------------------------------------------


@events_bp.route('/api/notifications', methods=['GET'])
@permission_required("core", API)
def list_notifications(user):
    rows, unread = notifications_for_user(user)
    return jsonify({
        "notifications": [notification_to_dict(n) for n in rows],
        "unread": unread,
    })


@events_bp.route('/api/notifications/read', methods=['POST'])
@permission_required("core", API)
def read_notifications(user):
    payload = request.get_json(silent=True) or {}
    mark_read(user, ids=payload.get("ids"), all=bool(payload.get("all")))
    rows, unread = notifications_for_user(user)
    return jsonify({"ok": True, "unread": unread})


@events_bp.route('/api/upcoming', methods=['GET'])
@permission_required("core", API)
def upcoming(user):
    events = event_upcoming_for_user(user)
    return jsonify({"events": [
        {**_event_to_dict(e, user), "my_needs_ride": _member(e, user).needs_ride}
        for e in events[:10]
    ]})
