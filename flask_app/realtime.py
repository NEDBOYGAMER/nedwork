import logging
from datetime import datetime, timedelta, timezone

from .models import db, EventMember, RealtimeEvent

logger = logging.getLogger("nedwork.realtime")

TOPIC_SOCIALS = "socials"
TOPIC_EVENTS = "events"
RETENTION_HOURS = 24


def _user_ids(values):
    ids = set()
    for value in values or ():
        if value is None:
            continue
        uid = value if isinstance(value, int) else getattr(value, "id", None)
        if isinstance(uid, int):
            ids.add(uid)
    return ids


def publish(user_ids, topic, payload=None):
    ids = _user_ids(user_ids)
    if not ids:
        return 0
    try:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) \
            - timedelta(hours=RETENTION_HOURS)
        RealtimeEvent.query.filter(
            RealtimeEvent.created_at < cutoff
        ).delete(synchronize_session=False)
        body = payload if isinstance(payload, dict) else {}
        db.session.add_all([
            RealtimeEvent(user_id=uid, topic=topic, payload=body)
            for uid in ids
        ])
        db.session.commit()
        return len(ids)
    except Exception:
        db.session.rollback()
        logger.exception("realtime publish failed topic=%s", topic)
        return 0


def publish_event_members(event, scope, list_changed=False,
                          extra_user_ids=(), exclude_user_ids=(),
                          module_id=None):
    if event is None:
        return 0
    members = EventMember.query.filter_by(event_id=event.id).all()
    recipients = {m.user_id for m in members}
    recipients.update(_user_ids(extra_user_ids))
    recipients.difference_update(_user_ids(exclude_user_ids))
    payload = {
        "event_id": event.id,
        "scope": scope,
        "list": bool(list_changed),
    }
    if module_id is not None:
        payload["module_id"] = module_id
    return publish(recipients, TOPIC_EVENTS, payload)
