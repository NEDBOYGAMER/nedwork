"""Account lifecycle helpers.

SQLite foreign keys are not enforced in this deployment, so deleting a
user is an explicit, table-by-table purge instead of relying on cascades.
The helper never commits -- the caller owns the transaction.
"""
from datetime import datetime

from .models import (
    db, User, UserGroup, Friendship, Event, EventMember,
    EventModule, DoodleVote, BringItem, BringClaim, EventRide,
    RidePassenger, ChatMessage, Notification,
    SocialGroupMember,
)


def _release_member_state(member):
    """Release claims, passenger seats and driven rides for a member."""
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


def _hand_over_social_groups(user):
    """Promote another active member to owner, or delete the group."""
    owned = SocialGroupMember.query.filter_by(
        user_id=user.id, role="owner").all()
    for membership in owned:
        group = membership.group
        if group is None:
            continue
        candidates = [
            m for m in group.members
            if m.user_id != user.id and m.status == "active"
        ]
        candidates.sort(key=lambda m: (
            0 if m.role == "admin" else 1,
            m.joined_at or datetime.min,
            m.id,
        ))
        if candidates:
            candidates[0].role = "owner"
        else:
            db.session.delete(group)


def purge_user(user: User) -> None:
    """Delete `user` and every row that references them.

    Hosted events are deleted (their members and modules cascade), event
    memberships are released, authored content and notifications are
    removed, and owned social groups are handed over. The caller must
    commit.
    """
    # hosted events first: their members/modules/content cascade with them
    for event in Event.query.filter_by(host_id=user.id).all():
        db.session.delete(event)
    db.session.flush()

    # remaining event memberships
    for member in EventMember.query.filter_by(user_id=user.id).all():
        _release_member_state(member)
        db.session.delete(member)

    # content authored by the user
    DoodleVote.query.filter_by(user_id=user.id).delete(
        synchronize_session=False)
    ChatMessage.query.filter_by(user_id=user.id).delete(
        synchronize_session=False)
    Notification.query.filter_by(user_id=user.id).delete(
        synchronize_session=False)
    # keep shared bring items; the author just disappears
    BringItem.query.filter_by(added_by=user.id).update(
        {"added_by": None}, synchronize_session=False)

    # social groups: hand ownership over before dropping memberships
    _hand_over_social_groups(user)
    db.session.flush()
    SocialGroupMember.query.filter_by(user_id=user.id).delete(
        synchronize_session=False)

    # core relationships without a cascade
    UserGroup.query.filter_by(user_id=user.id).delete(
        synchronize_session=False)
    Friendship.query.filter(
        (Friendship.request_sender_id == user.id) |
        (Friendship.request_receiver_id == user.id)
    ).delete(synchronize_session=False)

    # ORM cascades: permissions, dashboards, tasks, app corner configs,
    # settings, sessions, apps config (colors/links) and their children
    db.session.delete(user)
