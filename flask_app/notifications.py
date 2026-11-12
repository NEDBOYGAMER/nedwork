"""User-targeted notifications for the Events site.

Two channels, both best-effort and never allowed to break the request
that triggered them:

- In-app: a Notification row per user (the universal inbox API lives at
  /notifications/api/list; the WebSocket relay pushes new rows and the
  unread count from the same table, so every writer below is realtime).
- Email: optional fan-out via Resend, reusing the fire-and-forget plumbing
  from flask_app.notify (silent no-op without RESEND_API_KEY).

Triggers in the MVP:
  event_published  — host published; members see the event now
  date_finalized   — doodle finalization set the canonical date
  date_changed     — host edited the canonical date manually
  member_added     — the host added you to an event
  event_reminder   — 24h-before nudge (scan_reminders, no scheduler)
"""
import logging
import os
import threading
from datetime import datetime, timedelta, timezone

from flask import render_template

from .models import db, Notification, Event, EventMember, User, Task
from .notify import _send, RESEND_URL, _REPLY_TO

logger = logging.getLogger("nedwork.notifications")

# Every notification type owned by the Events site. The Settings
# "Events" toggle gates these (in-app + email) in one place; Socials
# notifications are deliberately not in this set.
EVENT_NOTIFICATION_TYPES = frozenset({
    "event_published", "date_finalized", "date_changed",
    "member_added", "event_reminder", "ride_cancelled",
    "event_announcement",
})


# ------------------------------------------------------------------ email
def _email_payload(user, subject, body_text, event):
    """Build the Resend payload for one user email; None → skip."""
    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key or not user.email:
        return None
    from_addr = os.environ.get(
        "NOTIFY_FROM", "Nedwork Events <events@nedwork.ch>")
    return {
        "from": from_addr,
        "to": [user.email],
        "subject": subject,
        "html": render_template(
            "emails/event_notification.html",
            user=user, event=event, body=body_text,
        ),
        "text": f"{body_text}\n\n— nedwork",
        "reply_to": _REPLY_TO,
    }


def _queue_email(api_key, payload):
    threading.Thread(
        target=_send, args=(api_key, payload), daemon=True
    ).start()


# ------------------------------------------------------------- in-app
def notify_user(user, type, payload=None, email=None, event=None):
    """Insert one in-app Notification; optionally send a matching email.

    email: if a dict, it is passed straight to the Resend payload builder
    ({subject, body}); if True, a default body is derived from the type.
    Never raises — a broken notification must never break the action.
    """
    try:
        if type in EVENT_NOTIFICATION_TYPES:
            settings = getattr(user, "settings_config", None)
            if settings is not None and settings.notify_events is False:
                return
        notification = Notification(
            user_id=user.id,
            type=type,
            payload=payload or {},
        )
        db.session.add(notification)

        if email is not None:
            subject = email.get("subject", "nedwork")
            body = email.get("body", "")
            mail = _email_payload(user, subject, body, event)
            if mail is not None:
                _queue_email(os.environ.get("RESEND_API_KEY", ""), mail)

        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("notify_user(%s) failed", type)


def notify_event_members(event, type, subject, body,
                         exclude_user_id=None, email=True):
    """Fan out one notification (in-app, and email by default) to every
    member of the event. Skips the acting user by default."""
    for member in EventMember.query.filter_by(event_id=event.id).all():
        if member.user_id == exclude_user_id:
            continue
        notify_user(
            member.user,
            type,
            payload={"event_id": event.id, "title": event.title},
            email={"subject": subject, "body": body} if email else None,
            event=event,
        )


# --------------------------------------------------------------- helpers
def _email_title_for(event, type, actor_name):
    """Default email subject/body per notification type."""
    when = event.event_date.strftime("%d.%m.%Y %H:%M") \
        if event.event_date else "(no date yet)"
    if type == "event_published":
        return (
            f"Invitation: {event.title}",
            f"{actor_name} published the event “{event.title}” — "
            f"you are on the member list. Open Events to RSVP.",
        )
    if type == "date_finalized":
        return (
            f"Date finalized: {event.title}",
            f"The date for “{event.title}” is set: {when}. "
            f"Please confirm your RSVP.",
        )
    if type == "date_changed":
        return (
            f"Date changed: {event.title}",
            f"The date for “{event.title}” changed to {when}. "
            f"Please re-check your RSVP.",
        )
    if type == "member_added":
        return (
            f"You're in: {event.title}",
            f"{actor_name} added you to “{event.title}” "
            f"({when}). Open Events to see the details.",
        )
    return (f"nedwork: {event.title}", "You have an update on an event.")


def event_upcoming_for_user(user):
    """Next published, dated events the user is a member of (dashboard)."""
    return (
        Event.query
        .join(EventMember, EventMember.event_id == Event.id)
        .filter(
            EventMember.user_id == user.id,
            Event.status == "published",
            Event.event_date.isnot(None),
        )
        .order_by(Event.event_date)
        .all()
    )


def scan_reminders(user):
    """24h-before reminders without a scheduler: piggyback on the
    notifications fetch (the client hub's 5-minute tick, plus its
    reconnect fallback). One reminder per (user, event) — an existing
    event_reminder row is the dedupe marker. Never raises; best-effort
    like everything here."""
    try:
        window_start = datetime.now()
        window_end = datetime.now() + timedelta(hours=26)
        upcoming = (Event.query
                    .join(EventMember, EventMember.event_id == Event.id)
                    .filter(
                        EventMember.user_id == user.id,
                        Event.status == "published",
                        Event.event_date.isnot(None),
                        Event.event_date >= window_start,
                        Event.event_date <= window_end,
                    ).all())
        sent = {n.payload.get("event_id")
                for n in Notification.query.filter_by(
                    user_id=user.id, type="event_reminder").all()}
        for event in upcoming:
            if event.id in sent:
                continue
            when = event.event_date.strftime("%d.%m.%Y %H:%M")
            notify_user(
                user, "event_reminder",
                payload={"event_id": event.id, "title": event.title},
                email={"subject": f"Tomorrow: {event.title}",
                       "body": f"“{event.title}” starts on {when}. "
                               "Open Events to check the details."},
                event=event,
            )
    except Exception:
        db.session.rollback()
        logger.exception("scan_reminders(%s) failed", user.id)


def scan_task_deadlines(user):
    """One nudge per task when its deadline enters the next 24h. Same
    piggyback-and-dedupe shape as scan_reminders (the task id is the
    marker). Private tasks are skipped: their name is ciphertext and the
    payload would carry it in the clear. Never raises.

    shortcut: only fires if the user opens the site inside the window,
    and a moved deadline does not re-nudge the same task."""
    try:
        now = datetime.now()
        due = Task.query.filter(
            Task.user_id == user.id,
            Task.done.is_(False),
            Task.private.is_(False),
            Task.deadline.isnot(None),
            Task.deadline >= now,
            Task.deadline <= now + timedelta(hours=24),
        ).all()
        sent = {n.payload.get("task_id")
                for n in Notification.query.filter_by(
                    user_id=user.id, type="task_deadline").all()}
        for task in due:
            if task.id in sent:
                continue
            notify_user(
                user, "task_deadline",
                payload={"task_id": task.id, "title": task.name},
            )
    except Exception:
        db.session.rollback()
        logger.exception("scan_task_deadlines(%s) failed", user.id)


def notifications_for_user(user, limit=50):
    rows = (Notification.query
            .filter_by(user_id=user.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit).all())
    unread = Notification.query.filter_by(user_id=user.id, read=False).count()
    return rows, unread


def mark_read(user, ids=None, all=False):
    q = Notification.query.filter_by(user_id=user.id, read=False)
    if all:
        q.update({"read": True}, synchronize_session=False)
    elif isinstance(ids, list):
        q.filter(Notification.id.in_(
            [i for i in ids if isinstance(i, int)])).update(
            {"read": True}, synchronize_session=False)
    db.session.commit()


def notification_to_dict(n):
    return {
        "id": n.id,
        "type": n.type,
        "payload": n.payload or {},
        "read": n.read,
        # created_at comes from db.func.now() = UTC, but is naive. Tag it,
        # or the browser parses it as local time and every fresh
        # notification reads "1h ago" (the CET offset).
        "created_at": (n.created_at.replace(tzinfo=timezone.utc).isoformat()
                       if n.created_at else None),
    }


def _user_name(user):
    return user.username if user else "Someone"
