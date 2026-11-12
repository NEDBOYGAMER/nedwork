"""Shared WebSocket relay: path dispatch, pre-accept auth, process startup.

Two paths, one server (port 5001):

* ``/apps/tierforge/ws`` - unchanged TierForge room relay. No auth; the
  capability token in the query string is the access control exactly as
  before the relay was shared.
* ``/ws/notifications`` - authenticated notification pushes. Origin and
  the ``session_id`` cookie are checked **before** ``accept()``; a
  rejection is a plain HTTP response, not a post-handshake close.

Run standalone (the Docker entry point stays this legacy module):
    python -m flask_app.apps.tierforge.websocket
"""
import asyncio
import logging
import os
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlsplit

from websockets.asyncio.server import serve

from . import db
from . import notify_channel
from . import tierforge_room

logger = logging.getLogger("nedwork.ws")

TIERFORGE_PATH = "/apps/tierforge/ws"
NOTIFY_PATH = notify_channel.PATH
MAX_MESSAGE_SIZE = 256 * 1024


def _site_origin():
    base = urlsplit(os.environ.get("SITE_BASE_URL", "https://nedwork.ch"))
    return base.scheme, base.netloc


def origin_allowed(origin):
    """Missing Origin is rejected; only the dev localhost hosts bypass
    the SITE_BASE_URL equality check."""
    if not origin:
        return False
    parsed = urlsplit(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    host = (parsed.hostname or "").lower()
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    return (parsed.scheme, parsed.netloc) == _site_origin()


def _session_cookie(cookie_header):
    if not cookie_header:
        return None
    try:
        jar = SimpleCookie()
        jar.load(cookie_header)
    except CookieError:
        return None
    morsel = jar.get("session_id")
    return morsel.value if morsel is not None else None


async def _process_request(connection, request):
    path = urlsplit(request.path).path
    if path == TIERFORGE_PATH:
        return None
    if path != NOTIFY_PATH:
        return connection.respond(404, "not found")

    if not origin_allowed(request.headers.get("Origin")):
        return connection.respond(403, "forbidden")
    session_id = _session_cookie(request.headers.get("Cookie"))
    if not session_id:
        return connection.respond(401, "unauthorized")
    try:
        user_id = await asyncio.to_thread(db.validate_session, session_id)
    except Exception:
        user_id = None
    if user_id is None:
        return connection.respond(401, "unauthorized")

    # Read by the handler after the upgrade; ServerConnection allows
    # arbitrary attributes.
    connection.nedwork_user_id = user_id
    connection.nedwork_session_id = session_id
    return None


async def _dispatch(websocket):
    path = urlsplit(websocket.request.path).path
    if path == NOTIFY_PATH:
        await notify_channel.handler(websocket)
    elif path == TIERFORGE_PATH:
        await tierforge_room.handler(websocket)
    else:
        await websocket.close(code=1008, reason="unknown path")


async def _main(host, port):
    try:
        missing = await asyncio.to_thread(db.schema_status)
    except Exception as exc:
        logger.error("notification channel degraded - DB unavailable: %s", exc)
    else:
        if missing:
            logger.error(
                "notification channel degraded - missing schema: %s", missing)
        else:
            logger.info("notification channel schema ok")

    async with serve(
        _dispatch,
        host,
        port,
        process_request=_process_request,
        max_size=MAX_MESSAGE_SIZE,
        ping_interval=20,
        ping_timeout=20,
    ):
        logger.info("WebSocket relay listening on %s:%s", host, port)
        sweeper = asyncio.create_task(notify_channel.sweeper())
        try:
            await asyncio.Future()
        finally:
            sweeper.cancel()


def run_server(host=None, port=None):
    host = host or os.environ.get("TIERFORGE_WS_HOST", "0.0.0.0")
    port = int(port or os.environ.get("TIERFORGE_WS_PORT", "5001"))
    logging.basicConfig(level=logging.INFO,
                        format="[ws] %(levelname)s %(message)s")
    # Per-connection open/reject lines would bury the state-change logs.
    ws_logger = logging.getLogger("websockets")
    if ws_logger.level == logging.NOTSET:
        ws_logger.setLevel(logging.WARNING)
    logger.info("starting shared WebSocket relay")
    asyncio.run(_main(host, port))


if __name__ == "__main__":
    run_server()
