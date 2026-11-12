"""Read-only SQLite access for the WebSocket relay.

Every call opens a fresh connection, applies ``query_only`` and a short
``busy_timeout`` on it, runs one short SELECT, and closes. Two rules keep
the event loop safe:

* callers run these functions through ``asyncio.to_thread``;
* a locked database is a skipped tick, never a multi-second stall.

The relay is not a second source of truth: it only ever SELECTs from the
tables the Flask app owns (notifications, sessions, users).
"""
import json
import os
import pathlib
import sqlite3
from datetime import datetime, timezone

_REQUIRED_SCHEMA = {
    "notifications": {"id", "user_id", "type", "payload", "read", "created_at"},
    "sessions": {"session_id", "user_id", "expires"},
    "users": {"id"},
}


def db_path():
    override = os.environ.get("NEDWORK_DB_PATH")
    if override:
        return override
    root = pathlib.Path(__file__).resolve().parents[2]
    return str(root / "instance" / "app.db")


def _connect():
    # mode=rw (not the default rwc) refuses to create a blank database when
    # the mount is wrong - the relay degrades instead of inventing state.
    uri = pathlib.Path(db_path()).resolve().as_uri() + "?mode=rw"
    conn = sqlite3.connect(uri, uri=True, timeout=0.25,
                           isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 250")
    conn.execute("PRAGMA query_only = ON")
    return conn


def _parse_utc(value):
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _utc_iso(value):
    parsed = _parse_utc(value)
    if parsed is None:
        return None
    return parsed.isoformat()


def validate_session(session_id):
    """Return the user id for a live session row, or None."""
    if not session_id:
        return None
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT s.user_id, s.expires FROM sessions s "
            "JOIN users u ON u.id = s.user_id "
            "WHERE s.session_id = ?",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    if _parse_utc(row["expires"]) is None:
        return None
    if _parse_utc(row["expires"]) <= datetime.now(timezone.utc):
        return None
    return int(row["user_id"])


def unread_for_user(user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM notifications "
            "WHERE user_id = ? AND read = 0",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    return int(row["n"] or 0)


def schema_status():
    """Return {table: [missing columns]} without raising on a bad schema."""
    missing = {}
    conn = _connect()
    try:
        for table, required in _REQUIRED_SCHEMA.items():
            rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
            present = {row["name"] for row in rows}
            absent = sorted(required - present)
            if absent:
                missing[table] = absent
    finally:
        conn.close()
    return missing


def sweep(auth_sessions, user_ids, after_id):
    """One relay tick, in one short-lived connection.

    - revalidate the sessions that are due (the caller decides cadence);
    - return notifications newer than ``after_id`` (or initialise the
      watermark at MAX(id) when ``after_id`` is None);
    - return the unread count for every connected user.
    """
    conn = _connect()
    try:
        invalid = []
        for session_id in auth_sessions:
            row = conn.execute(
                "SELECT s.user_id, s.expires FROM sessions s "
                "JOIN users u ON u.id = s.user_id "
                "WHERE s.session_id = ?",
                (session_id,),
            ).fetchone()
            if (row is None
                    or _parse_utc(row["expires"]) is None
                    or _parse_utc(row["expires"])
                    <= datetime.now(timezone.utc)):
                invalid.append(session_id)

        if after_id is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(id), 0) AS max_id FROM notifications"
            ).fetchone()
            watermark = int(row["max_id"] or 0)
            rows = []
        else:
            rows = conn.execute(
                "SELECT id, user_id, type, payload, read, created_at "
                "FROM notifications WHERE id > ? ORDER BY id ASC LIMIT 500",
                (after_id,),
            ).fetchall()
            watermark = max(
                [int(after_id)] + [int(row["id"]) for row in rows])

        unread = {}
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            counted = conn.execute(
                "SELECT user_id, COUNT(*) AS n FROM notifications "
                f"WHERE read = 0 AND user_id IN ({placeholders}) "
                "GROUP BY user_id",
                tuple(user_ids),
            ).fetchall()
            unread = {int(row["user_id"]): int(row["n"])
                      for row in counted}

        notifications = []
        for row in rows:
            try:
                payload = json.loads(row["payload"]) \
                    if isinstance(row["payload"], str) else (row["payload"] or {})
            except (TypeError, ValueError):
                payload = {}
            notifications.append({
                "id": int(row["id"]),
                "user_id": int(row["user_id"]),
                "type": row["type"],
                "payload": payload if isinstance(payload, dict) else {},
                "read": bool(row["read"]),
                "created_at": _utc_iso(row["created_at"]),
            })

        return {
            "invalid": invalid,
            "notifications": notifications,
            "unread": unread,
            "watermark": watermark,
        }
    finally:
        conn.close()
