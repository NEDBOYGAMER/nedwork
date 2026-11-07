"""Socials site — friends + social groups.

Social groups are the Socials site's own tables (SocialGroup /
SocialGroupMember) — NOT the permission system's Group model. A
membership row with status "pending" IS the open join request: the
requester inserts it, an admin flips it to "active" (accept) or deletes
it (deny).

Friends reuse the pre-existing Friendship model (composite PK
sender_id + receiver_id, status pending/accepted/rejected). Deny/cancel/
delete all DELETE the row — a stale "rejected" row would block future
requests, and a fresh request must always be possible.

pages:
  GET  /socials/                       -> the SPA
  GET  /socials/join/<code>            -> group join landing (by link)

api — friends:
  GET    /socials/api/friends                  -> friends + in/out pending
  POST   /socials/api/friends                  -> add by username or key
  POST   /socials/api/friends/<user_id>/accept -> accept incoming request
  DELETE /socials/api/friends/<user_id>        -> deny / cancel / delete

api — groups:
  GET    /socials/api/groups                     -> my groups + open requests
  POST   /socials/api/groups                     -> create (owner)
  GET    /socials/api/groups/<id>                -> detail (members, code)
  DELETE /socials/api/groups/<id>                -> delete (owner)
  POST   /socials/api/groups/join                -> join by code (pending)
  POST   /socials/api/groups/<id>/join           -> join via code (same)
  POST   /socials/api/groups/<id>/requests/<mid>/accept|deny  (admin+)
  POST   /socials/api/groups/<id>/members        -> admin adds (batch
        user_ids, the picker's shape, or a single user_id)
  POST   /socials/api/groups/<id>/members/by-key -> admin adds by
        username/key
  DELETE /socials/api/groups/<id>/members/<mid>  -> admin removes member
  PATCH  /socials/api/groups/<id>/members/<mid>  -> set role (owner)
  POST   /socials/api/groups/<id>/leave          -> member leaves
  POST   /socials/api/groups/<id>/transfer       -> owner transfers
  POST   /socials/api/groups/<id>/regenerate-code -> admin rotates code
"""
import json
import secrets

from flask import Blueprint, jsonify, render_template, request, url_for

from ..models import *   # User, Friendship, SocialGroup, db, ... (project pattern)
from ..auth.decorators import permission_required, PAGE, API
from ..notifications import notify_user


socials_bp = Blueprint('socials', __name__, static_folder='../static')


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _new_join_code():
    """8-char unambiguous code (no 0/O/1/I/L)."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not SocialGroup.query.filter_by(join_code=code).first():
            return code


def _user_dict(user):
    return {"id": user.id, "username": user.username, "key": user.key}


def _friendship_between(a, b):
    return Friendship.query.filter(
        ((Friendship.request_sender_id == a.id) &
         (Friendship.request_receiver_id == b.id)) |
        ((Friendship.request_sender_id == b.id) &
         (Friendship.request_receiver_id == a.id))
    ).first()


def _notify_admins(group, actor, ntype, payload, email=None):
    """In-app notify every active admin/owner of the group."""
    for m in group.members:
        if m.status == "active" and m.role in ("admin", "owner") \
                and m.user_id != actor.id:
            notify_user(m.user, ntype, payload, email=email)


# ---------------------------------------------------------------------------
# pages
# ---------------------------------------------------------------------------

@socials_bp.route('/')
@permission_required("core", PAGE)
def socials_page(user):
    return render_template('main/socials.html', user_id=user.id)


# group join landing — the shareable link form of the join code; mirrors
# the events invite landing (login bounce with a same-origin ?next= return)
@socials_bp.route('/join/<code>')
def join_page(code):
    group = SocialGroup.query.filter_by(join_code=code.upper()).first()
    return render_template(
        "main/social_join.html",
        code=code.upper(),
        group=group,
    )


# ---------------------------------------------------------------------------
# api — friends
# ---------------------------------------------------------------------------

@socials_bp.route('/api/friends', methods=['GET'])
@permission_required("core", API)
def list_friends(user):
    friends, incoming, outgoing = [], [], []
    rows = Friendship.query.filter(
        (Friendship.request_sender_id == user.id) |
        (Friendship.request_receiver_id == user.id)
    ).all()
    for f in rows:
        other = f.sender if f.request_receiver_id == user.id else f.receiver
        if f.status == "accepted":
            friends.append(_user_dict(other))
        elif f.status == "pending":
            if f.request_receiver_id == user.id:
                incoming.append(_user_dict(other))
            else:
                outgoing.append(_user_dict(other))
    return jsonify({"friends": friends, "incoming": incoming,
                    "outgoing": outgoing})


@socials_bp.route('/api/users/search', methods=['GET'])
@permission_required("core", API)
def search_users(user):
    """Username suggestions for the friend add field and member pickers
    (3+ chars, max 8)."""
    q = str(request.args.get("q") or "").strip().lstrip("@")
    if len(q) < 3:
        return jsonify({"users": []})
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    users = (User.query
             .filter(User.id != user.id)
             .filter(User.username.ilike(f"%{escaped}%", escape="\\"))
             .order_by(User.username)
             .limit(8)
             .all())
    return jsonify({"users": [_user_dict(u) for u in users]})


@socials_bp.route('/api/friends', methods=['POST'])
@permission_required("core", API)
def add_friend(user):
    payload = request.get_json(silent=True) or {}
    lookup = str(payload.get("username") or "").strip().lstrip("@")
    if not lookup:
        return jsonify({"error": "Username or key required"}), 400

    target = User.query.filter(
        (User.username == lookup) | (User.key == lookup)
    ).first()
    if target is None:
        return jsonify({"error": "No such user"}), 404
    if target.id == user.id:
        return jsonify({"error": "That's you"}), 400

    existing = _friendship_between(user, target)
    if existing and existing.status == "accepted":
        return jsonify({"error": "Already friends"}), 400

    # reverse pending: they already asked me — accept it instead
    if existing and existing.status == "pending" and \
            existing.request_receiver_id == user.id:
        existing.status = "accepted"
        db.session.commit()
        notify_user(target, "friend_accepted",
                    {"actor": user.username, "title": user.username})
        return jsonify({"ok": True, "status": "accepted",
                        "auto_accepted": True})

    if existing and existing.status == "pending":
        return jsonify({"error": "Request already pending"}), 400

    # a stale "rejected" row is deleted so the new request can be inserted
    if existing:
        db.session.delete(existing)
        db.session.flush()

    db.session.add(Friendship(request_sender_id=user.id,
                              request_receiver_id=target.id,
                              status="pending"))
    db.session.commit()
    notify_user(target, "friend_request",
                {"actor": user.username, "title": user.username})
    return jsonify({"ok": True, "status": "pending"}), 201


@socials_bp.route('/api/friends/<int:sender_id>/accept', methods=['POST'])
@permission_required("core", API)
def accept_friend(user, sender_id):
    f = Friendship.query.filter_by(request_sender_id=sender_id,
                                   request_receiver_id=user.id,
                                   status="pending").first()
    if f is None:
        return jsonify({"error": "No pending request from that user"}), 404
    f.status = "accepted"
    db.session.commit()
    sender = User.query.get(sender_id)
    if sender:
        notify_user(sender, "friend_accepted",
                    {"actor": user.username, "title": user.username})
    return jsonify({"ok": True})


@socials_bp.route('/api/friends/<int:other_id>', methods=['DELETE'])
@permission_required("core", API)
def remove_friend(user, other_id):
    f = Friendship.query.filter(
        ((Friendship.request_sender_id == user.id) &
         (Friendship.request_receiver_id == other_id)) |
        ((Friendship.request_sender_id == other_id) &
         (Friendship.request_receiver_id == user.id))
    ).first()
    if f is None:
        return jsonify({"error": "No friendship with that user"}), 404
    db.session.delete(f)   # deny / cancel / delete are all the same row removal
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# api — groups
#   Social groups are SocialGroup rows — NOT the permission system's Group.
# ---------------------------------------------------------------------------

def _group_dict(group, user):
    me = group.member(user)
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "join_code": group.join_code if me and me.role in ("admin", "owner") else None,
        "my_role": me.role if me else None,
        "my_status": me.status if me else None,
        "member_count": SocialGroupMember.query.filter_by(
            group_id=group.id, status="active").count(),
        "created_at": group.created_at.isoformat() if group.created_at else None,
    }


def _member_dict(m):
    return {
        "id": m.id,
        "user_id": m.user_id,
        "username": m.user.username if m.user else "?",
        "role": m.role,
        "status": m.status,
    }


@socials_bp.route('/api/groups', methods=['GET'])
@permission_required("core", API)
def list_groups(user):
    my_memberships = SocialGroupMember.query.filter_by(user_id=user.id).all()
    groups = [g for g in
              (SocialGroup.query.get(m.group_id) for m in my_memberships)
              if g]
    # open join requests in groups where I'm an admin
    admin_ids = [g.id for g, m in zip(
        groups, my_memberships) if m.role in ("admin", "owner") and g]
    requests = []
    if admin_ids:
        rows = SocialGroupMember.query.filter(
            SocialGroupMember.group_id.in_(admin_ids),
            SocialGroupMember.status == "pending").all()
        requests = [dict(_member_dict(r), group_name=r.group.name,
                         group_id=r.group_id) for r in rows]
    return jsonify({
        "groups": [_group_dict(g, user) for g in groups],
        "requests": requests,
    })


@socials_bp.route('/api/groups', methods=['POST'])
@permission_required("core", API)
def create_group(user):
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()[:60]
    description = str(payload.get("description") or "").strip()[:300] or None
    if not name:
        return jsonify({"error": "Name required"}), 400
    group = SocialGroup(name=name, description=description,
                        join_code=_new_join_code())
    db.session.add(group)
    db.session.flush()
    db.session.add(SocialGroupMember(group_id=group.id, user_id=user.id,
                                     role="owner", status="active"))
    db.session.commit()
    return jsonify({"ok": True, "group": _group_dict(group, user)}), 201


def _group_or_404(group_id):
    return SocialGroup.query.get(group_id)


def _require_admin(group, user):
    me = group.member(user)
    if me is None or me.status != "active" or me.role not in ("admin", "owner"):
        return None
    return me


@socials_bp.route('/api/groups/<int:group_id>', methods=['GET'])
@permission_required("core", API)
def group_detail(user, group_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    me = group.member(user)
    if me is None:
        return jsonify({"error": "Not a member"}), 403
    members = SocialGroupMember.query.filter_by(group_id=group.id).all()
    return jsonify({
        "group": _group_dict(group, user),
        "members": [_member_dict(m) for m in members],
    })


@socials_bp.route('/api/groups/<int:group_id>', methods=['DELETE'])
@permission_required("core", API)
def delete_group(user, group_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    me = group.member(user)
    if me is None or me.role != "owner":
        return jsonify({"error": "Only the owner can delete the group"}), 403
    db.session.delete(group)
    db.session.commit()
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/join', methods=['POST'])
@socials_bp.route('/api/groups/<int:group_id>/join', methods=['POST'])
@permission_required("core", API)
def join_group(user, group_id=None):
    payload = request.get_json(silent=True) or {}
    code = str(payload.get("code") or "").strip().upper()
    if group_id is not None:
        group = _group_or_404(group_id)
        if group and code and group.join_code != code:
            group = None
    else:
        group = SocialGroup.query.filter_by(join_code=code).first() if code else None
    if group is None:
        return jsonify({"error": "Invalid code"}), 404

    me = group.member(user)
    if me and me.status == "active":
        return jsonify({"error": "Already a member"}), 400
    if me and me.status == "pending":
        return jsonify({"error": "Request already pending"}), 400
    if me:   # stale pending/denied row from a previous attempt
        db.session.delete(me)
        db.session.flush()

    db.session.add(SocialGroupMember(group_id=group.id, user_id=user.id,
                                     role="member", status="pending"))
    db.session.commit()
    _notify_admins(group, user, "group_join_request",
                   {"actor": user.username, "group": group.name,
                    "group_id": group.id, "title": group.name})
    return jsonify({"ok": True, "status": "pending"}), 201


@socials_bp.route('/api/groups/<int:group_id>/requests/<int:member_id>/<any(accept,deny):action>',
                  methods=['POST'])
@permission_required("core", API)
def handle_join_request(user, group_id, member_id, action):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    if not _require_admin(group, user):
        return jsonify({"error": "Admins only"}), 403
    req = SocialGroupMember.query.filter_by(id=member_id,
                                            group_id=group.id,
                                            status="pending").first()
    if req is None:
        return jsonify({"error": "No such pending request"}), 404

    if action == "accept":
        req.status = "active"
        db.session.commit()
        notify_user(req.user, "group_joined",
                    {"actor": user.username, "group": group.name,
                     "group_id": group.id, "title": group.name})
    else:
        requester = req.user
        db.session.delete(req)
        db.session.commit()
        if requester:
            notify_user(requester, "group_denied",
                        {"actor": user.username, "group": group.name,
                         "title": group.name})
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/<int:group_id>/members', methods=['POST'])
@permission_required("core", API)
def add_member(user, group_id):
    """Admin adds member(s). Batch of user_ids (the friend picker's shape)
    or a single user_id — mirrors the events add-members contract."""
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    if not _require_admin(group, user):
        return jsonify({"error": "Admins only"}), 403
    payload = request.get_json(silent=True) or {}
    ids = payload.get("user_ids")
    if ids is None and payload.get("user_id") is not None:
        ids = [payload.get("user_id")]
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "user_ids must be a non-empty list"}), 400

    added, skipped = 0, []
    for uid in ids:
        if not isinstance(uid, int) or uid <= 0:
            skipped.append(uid)
            continue
        if SocialGroupMember.query.filter_by(group_id=group.id,
                                             user_id=uid).first() is not None:
            skipped.append(uid)   # already active or pending
            continue
        target = User.query.get(uid)
        if target is None:
            skipped.append(uid)
            continue
        db.session.add(SocialGroupMember(group_id=group.id, user_id=target.id,
                                         role="member", status="active"))
        notify_user(target, "group_added",
                    {"actor": user.username, "group": group.name,
                     "group_id": group.id, "title": group.name})
        added += 1
    db.session.commit()
    return jsonify({"ok": True, "added": added, "skipped": skipped}), 201


@socials_bp.route('/api/groups/<int:group_id>/members/by-key',
                  methods=['POST'])
@permission_required("core", API)
def add_member_by_key(user, group_id):
    """Admin adds one person by key or username — same shape as the
    events add-by-key endpoint."""
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    if not _require_admin(group, user):
        return jsonify({"error": "Admins only"}), 403
    payload = request.get_json(silent=True) or {}
    lookup = str(payload.get("username") or "").strip().lstrip("@")
    if not lookup:
        return jsonify({"error": "Username or key required"}), 400
    target = User.query.filter(
        (User.username == lookup) | (User.key == lookup)).first()
    if target is None:
        return jsonify({"error": "No such user"}), 404
    if SocialGroupMember.query.filter_by(group_id=group.id,
                                         user_id=target.id).first() is not None:
        return jsonify({"error": "Already a member (or pending)"}), 400
    db.session.add(SocialGroupMember(group_id=group.id, user_id=target.id,
                                     role="member", status="active"))
    db.session.commit()
    notify_user(target, "group_added",
                {"actor": user.username, "group": group.name,
                 "group_id": group.id, "title": group.name})
    return jsonify({"ok": True}), 201


@socials_bp.route('/api/groups/<int:group_id>/members/<int:member_id>',
                  methods=['DELETE'])
@permission_required("core", API)
def remove_member(user, group_id, member_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    if not _require_admin(group, user):
        return jsonify({"error": "Admins only"}), 403
    member = SocialGroupMember.query.filter_by(id=member_id,
                                               group_id=group.id).first()
    if member is None:
        return jsonify({"error": "No such member"}), 404
    if member.role == "owner":
        return jsonify({"error": "The owner cannot be removed — transfer "
                                 "ownership first"}), 400
    was_active = member.status == "active"
    removed_user = member.user
    db.session.delete(member)
    db.session.commit()
    if was_active and removed_user:
        notify_user(removed_user, "group_removed",
                    {"actor": user.username, "group": group.name,
                     "title": group.name})
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/<int:group_id>/members/<int:member_id>',
                  methods=['PATCH'])
@permission_required("core", API)
def set_member_role(user, group_id, member_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    me = group.member(user)
    if me is None or me.role != "owner":
        return jsonify({"error": "Only the owner can change roles"}), 403
    payload = request.get_json(silent=True) or {}
    role = payload.get("role")
    if role not in ("admin", "member"):
        return jsonify({"error": "Role must be admin or member"}), 400
    member = SocialGroupMember.query.filter_by(id=member_id,
                                               group_id=group.id,
                                               status="active").first()
    if member is None or member.role == "owner":
        return jsonify({"error": "No such member"}), 404
    member.role = role
    db.session.commit()
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/<int:group_id>/leave', methods=['POST'])
@permission_required("core", API)
def leave_group(user, group_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    me = group.member(user)
    if me is None:
        return jsonify({"error": "Not a member"}), 404
    if me.role == "owner":
        return jsonify({"error": "Transfer ownership before leaving"}), 400
    db.session.delete(me)
    db.session.commit()
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/<int:group_id>/transfer', methods=['POST'])
@permission_required("core", API)
def transfer_group(user, group_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    me = group.member(user)
    if me is None or me.role != "owner":
        return jsonify({"error": "Only the owner can transfer"}), 403
    payload = request.get_json(silent=True) or {}
    target = SocialGroupMember.query.filter_by(
        id=int(payload.get("member_id") or 0),
        group_id=group.id, status="active").first()
    if target is None:
        return jsonify({"error": "No such active member"}), 404
    me.role = "admin"
    target.role = "owner"
    db.session.commit()
    return jsonify({"ok": True})


@socials_bp.route('/api/groups/<int:group_id>/regenerate-code',
                  methods=['POST'])
@permission_required("core", API)
def regenerate_code(user, group_id):
    group = _group_or_404(group_id)
    if group is None:
        return jsonify({"error": "Group not found"}), 404
    if not _require_admin(group, user):
        return jsonify({"error": "Admins only"}), 403
    group.join_code = _new_join_code()
    db.session.commit()
    return jsonify({"ok": True, "join_code": group.join_code})
