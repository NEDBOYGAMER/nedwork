"""TierForge room relay (moved unchanged from the old module).

Rooms live in memory only; every message is relayed to the other members
of the room. No persistence, no database. TierForge sends two message
types: `cursor` (pointer position, optional scroll) and `board` (discrete
placement/settings changes so peers can apply them instantly). Optional
fields are sanitised here; the relay never inspects session state.
"""
import json
from urllib.parse import parse_qs, urlparse

# room -> {client_id: websocket}
ROOMS = {}

BOARD_KINDS = frozenset({"move", "add", "remove", "settings", "clear"})


def _clean_ref(raw):
    if not isinstance(raw, dict):
        return None
    try:
        owner = int(raw.get("owner"))
    except (TypeError, ValueError):
        return None
    image_id = str(raw.get("id") or "")[:64]
    if not image_id or owner <= 0:
        return None
    return {"owner": owner, "id": image_id}


def _clean_refs(raw):
    if not isinstance(raw, list):
        return []
    out = []
    for entry in raw[:1000]:
        ref = _clean_ref(entry)
        if ref is not None:
            out.append(ref)
    return out


async def _broadcast(room, message, exclude=None):
    members = ROOMS.get(room) or {}
    dead = []
    for client, websocket in list(members.items()):
        if client == exclude:
            continue
        try:
            await websocket.send(message)
        except Exception:
            dead.append(client)
    for client in dead:
        members.pop(client, None)


async def _handle_board(message, client, room):
    """Relay one discrete TierForge board change. Only known shapes are
    forwarded; the session endpoints remain the authority for real state."""
    kind = str(message.get("kind") or "")[:16]
    if kind not in BOARD_KINDS:
        return
    payload = {"type": "board", "client": client, "kind": kind}
    try:
        payload["uid"] = int(message.get("uid"))
    except (TypeError, ValueError):
        pass
    ref = _clean_ref(message.get("ref"))
    if ref is not None:
        payload["ref"] = ref
    refs = _clean_refs(message.get("refs"))
    if refs:
        payload["refs"] = refs
    if "tier" in message:
        tier = message.get("tier")
        payload["tier"] = str(tier)[:32] if tier is not None else None
    before = _clean_ref(message.get("before"))
    if before is not None:
        payload["before"] = before
    raw_settings = message.get("settings")
    if isinstance(raw_settings, dict):
        settings = {}
        for key in ("poolImgSize", "tierImgSize"):
            try:
                value = int(raw_settings.get(key))
            except (TypeError, ValueError):
                continue
            if value in (72, 120, 180, 260):
                settings[key] = value
        if settings:
            payload["settings"] = settings
    await _broadcast(room, json.dumps(payload), exclude=client)


async def handler(websocket):
    query = parse_qs(urlparse(websocket.request.path).query)
    room = (query.get("room") or [""])[0][:64]
    client = (query.get("client") or [""])[0][:64]
    if not room or not client:
        await websocket.close(code=1008, reason="room and client are required")
        return

    members = ROOMS.setdefault(room, {})
    members[client] = websocket
    try:
        async for raw in websocket:
            try:
                message = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "board":
                await _handle_board(message, client, room)
                continue
            if message.get("type") != "cursor":
                continue
            try:
                x = float(message.get("x") or 0)
                y = float(message.get("y") or 0)
            except (TypeError, ValueError):
                continue
            payload = {
                "type": "cursor",
                "client": client,
                "name": str(message.get("name") or "Guest")[:24],
                "color": str(message.get("color") or "#6c5ce7")[:16],
                "x": max(-4.0, min(4.0, x)),
                "y": max(-4.0, min(4.0, y)),
            }
            # Optional fields used by TierForge: the sender's user id and
            # the page scroll (both apps share rooms).
            if "uid" in message:
                try:
                    payload["uid"] = int(message.get("uid"))
                except (TypeError, ValueError):
                    pass
            if message.get("dragging") is True:
                payload["dragging"] = True
                ref = _clean_ref(message.get("ref"))
                if ref is not None:
                    payload["ref"] = ref
            try:
                scroll = float(message.get("scroll"))
            except (TypeError, ValueError):
                scroll = None
            if scroll is not None:
                payload["scroll"] = max(0.0, min(1.0, scroll))
            await _broadcast(room, json.dumps(payload), exclude=client)
    finally:
        if members.get(client) is websocket:
            members.pop(client, None)
            if not members:
                ROOMS.pop(room, None)
            await _broadcast(room, json.dumps({
                "type": "leave", "client": client}))
