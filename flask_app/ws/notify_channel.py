"""The authenticated notification channel (``/ws/notifications``).

Auth happens before the upgrade in ``server.process_request``; this module
only handles already-authenticated sockets. A single sweeper reads new
notification and realtime-event rows plus unread counts from SQLite once
per tick, pushes them to the affected users, and revalidates sessions on a
slower cadence.

Wire protocol (server -> client only in v1):
    {"type": "ready", "unread": N}
    {"type": "notification", "notification": {...}}
    {"type": "event", "event": {...}}
    {"type": "unread", "unread": N}

The REST inbox stays authoritative: a notification row pushed here omits
the per-viewer ``action`` annotation, so clients refresh the list once on
receipt. Realtime events are invalidation hints; clients refetch the
affected REST resource. A close code of 4401 means the session row
disappeared/expired.
"""
import asyncio
import json
import logging
import os
import time

from websockets.exceptions import ConnectionClosed

from . import db

logger = logging.getLogger("nedwork.ws.notify")

PATH = "/ws/notifications"
SWEEP_SECONDS = float(os.environ.get("NEDWORK_WS_SWEEP_SECONDS", "1"))
AUTH_CHECK_SECONDS = float(
    os.environ.get("NEDWORK_WS_AUTH_SECONDS", "60"))
MAX_CLIENT_FRAME = 4096


class _Connection:
    __slots__ = ("websocket", "user_id", "session_id",
                 "last_auth", "last_unread")

    def __init__(self, websocket, user_id, session_id):
        self.websocket = websocket
        self.user_id = user_id
        self.session_id = session_id
        self.last_auth = time.monotonic()
        self.last_unread = None


# websocket -> _Connection
CONNECTIONS = {}


async def _send(websocket, payload):
    try:
        await websocket.send(json.dumps(payload, separators=(",", ":")))
        return True
    except Exception:
        return False


async def _close(websocket, code, reason):
    CONNECTIONS.pop(websocket, None)
    try:
        await websocket.close(code=code, reason=reason)
    except Exception:
        pass


async def handler(websocket):
    user_id = getattr(websocket, "nedwork_user_id", None)
    session_id = getattr(websocket, "nedwork_session_id", None)
    if user_id is None or not session_id:
        await websocket.close(code=1008, reason="unauthenticated")
        return

    conn = _Connection(websocket, int(user_id), session_id)
    CONNECTIONS[websocket] = conn
    try:
        try:
            unread = await asyncio.to_thread(db.unread_for_user, conn.user_id)
        except Exception:
            unread = 0
        conn.last_unread = unread
        await _send(websocket, {"type": "ready", "unread": unread})

        async for raw in websocket:
            if isinstance(raw, (bytes, bytearray)) or len(raw) > MAX_CLIENT_FRAME:
                await websocket.close(code=1009, reason="frame too large")
                break
            # v1 is server -> client only; ignore anything the browser sends.
    except ConnectionClosed:
        pass
    finally:
        CONNECTIONS.pop(websocket, None)


def _rows_for_connections(rows):
    by_user = {}
    for row in rows:
        by_user.setdefault(int(row["user_id"]), []).append(row)
    return by_user


async def _push_rows(rows, unread):
    by_user = _rows_for_connections(rows)
    for conn in list(CONNECTIONS.values()):
        for row in by_user.get(conn.user_id, ()):
            payload = {key: value for key, value in row.items()
                       if key != "user_id"}
            if not await _send(conn.websocket,
                               {"type": "notification",
                                "notification": payload}):
                CONNECTIONS.pop(conn.websocket, None)
                break
    await _push_unread(unread)


async def _push_events(rows):
    by_user = _rows_for_connections(rows)
    for conn in list(CONNECTIONS.values()):
        for row in by_user.get(conn.user_id, ()):
            payload = {key: value for key, value in row.items()
                       if key != "user_id"}
            if not await _send(conn.websocket,
                               {"type": "event", "event": payload}):
                CONNECTIONS.pop(conn.websocket, None)
                break


async def _push_unread(unread):
    for conn in list(CONNECTIONS.values()):
        count = int(unread.get(conn.user_id, 0))
        if count == conn.last_unread:
            continue
        if await _send(conn.websocket, {"type": "unread", "unread": count}):
            conn.last_unread = count
        else:
            CONNECTIONS.pop(conn.websocket, None)


async def _broadcast_ready(conns, unread):
    for conn in conns:
        count = int(unread.get(conn.user_id, 0))
        if await _send(conn.websocket, {"type": "ready", "unread": count}):
            conn.last_unread = count
        else:
            CONNECTIONS.pop(conn.websocket, None)


async def sweeper():
    """One DB read per tick, never on the event loop thread."""
    watermark = None
    event_watermark = None
    degraded = False
    while True:
        try:
            conns = list(CONNECTIONS.values())
            if conns:
                now = time.monotonic()
                due = sorted({
                    conn.session_id for conn in conns
                    if now - conn.last_auth >= AUTH_CHECK_SECONDS
                })
                user_ids = sorted({conn.user_id for conn in conns})
                try:
                    result = await asyncio.to_thread(
                        db.sweep, due, user_ids, watermark, event_watermark)
                except Exception as exc:
                    if not degraded:
                        logger.error(
                            "notification channel degraded: %s", exc)
                        degraded = True
                else:
                    if degraded:
                        logger.info("notification channel recovered")
                        degraded = False

                    first = watermark is None
                    watermark = int(result["watermark"]) if first else max(
                        int(watermark), int(result["watermark"]))
                    event_watermark = (
                        int(result["event_watermark"])
                        if event_watermark is None
                        else max(int(event_watermark),
                                 int(result["event_watermark"])))
                    if first:
                        # Watermark just initialised: clients catch up over
                        # REST instead of receiving history row by row.
                        await _broadcast_ready(conns, result["unread"])
                    else:
                        await _push_rows(result["notifications"],
                                         result["unread"])
                        await _push_events(result["events"])

                    invalid = set(result["invalid"])
                    for conn in conns:
                        if conn.session_id in due:
                            conn.last_auth = now
                        if conn.session_id in invalid:
                            await _close(conn.websocket, 4401,
                                         "session expired")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("notification sweeper failed")
        await asyncio.sleep(SWEEP_SECONDS)
