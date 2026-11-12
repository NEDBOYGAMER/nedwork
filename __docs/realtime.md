# Realtime UI events

The realtime outbox keeps open Socials and Events pages in sync without a
manual refresh. It is deliberately separate from the notification inbox:

- **Notifications** are durable, user-targeted rows with read state and
  actions. They are gated by notification settings.
- **Realtime events** are short-lived invalidation hints. They are not
  shown in the inbox, are not affected by notification settings, and are
  pruned after 24 hours.

REST remains authoritative. A live event tells the client which resource
to refetch; it never carries the full page state.

## Table

`realtime_events` is defined by `RealtimeEvent` in
`flask_app/models.py`:

| column | meaning |
|---|---|
| `id` | monotonic relay cursor |
| `user_id` | recipient |
| `topic` | `socials` or `events` |
| `payload` | JSON object |
| `created_at` | UTC timestamp, pruned after 24 h |

Indexes: `(user_id, id)` for delivery and `created_at` for pruning.

Old databases need `flask db upgrade`. The migration is idempotent because
`app.py` calls `db.create_all()` before Alembic runs.

## Publishing

Use `flask_app/realtime.py` after the domain transaction has committed:

```python
from ..realtime import publish, publish_event_members, TOPIC_SOCIALS

publish([user.id, target.id], TOPIC_SOCIALS, {"scope": "friends"})

publish_event_members(event, "chat", module_id=module.id)
```

`publish_event_members` sends to every current event member, plus optional
`extra_user_ids` (for example a removed member) and minus
`exclude_user_ids`. It sets `event_id`, `scope`, and `list` in the payload.

Publishing is best-effort: failures are logged and never break the request.
`purge_user` deletes the user's outbox rows.

## Topics and payloads

### `socials`

```json
{"scope": "friends"}
{"scope": "groups"}
{"scope": "group", "group_id": 12}
```

### `events`

```json
{"event_id": 7, "scope": "chat", "list": false, "module_id": 3}
```

`list: true` means the Events list and dashboard widget should refetch.
Scopes:

| scope | client action |
|---|---|
| `event`, `members`, `invite`, `rsvp`, `needs_ride` | full detail snapshot |
| `chat` | replace the chat log, preserving the composer |
| `votes`, `options` | replace the doodle section |
| `items`, `claims` | replace the bring section |
| `rides`, `passengers` | replace the rides section |

A deleted event publishes `scope: "event"`, `list: true`, and
`deleted: true` to the members captured before deletion.

## Relay

The existing authenticated `/ws/notifications` socket carries both
notification and event frames. No new WebSocket path or nginx location is
needed.

Server to client:

```json
{"type": "ready", "unread": 0}
{"type": "notification", "notification": {...}}
{"type": "event", "event": {
  "id": 42,
  "topic": "events",
  "payload": {"event_id": 7, "scope": "chat", "list": false},
  "created_at": "2026-11-12T20:00:00+00:00"
}}
{"type": "unread", "unread": 0}
```

The relay keeps separate notification and event watermarks. On first
connect it initialises both at `MAX(id)`; clients catch up over REST. On
reconnect, `ready` triggers a client sync. Events are targeted by
`user_id`; they are never broadcast to every connection.

If `realtime_events` is missing, the relay degrades live events only and
keeps notifications working.

## Client

`static/js/components/notificationHub.js` owns the single socket and
exposes:

```javascript
hub.subscribeTopic(topic, callback)
hub.subscribeSync(callback)
```

`static/js/components/liveEvents.js` is the page-facing helper:

```javascript
import { onLive, TOPICS } from "../../components/liveEvents.js";

const stop = onLive(TOPICS.events, (detail) => {
    if (detail.type === "sync" || detail.payload?.list) reload();
});
```

Handlers are debounced (150 ms by default). `detail.type` is `"event"` or
`"sync"`. The hub also dispatches a `nedwork:live` window event for
classic scripts. `window.NEDWORK_WS_URL` overrides the socket URL; the
browser smoke uses it to point at a test relay.

## Page behavior

- Socials refreshes friends, groups, and the open group modal.
- Events list refetches on `list` changes.
- Event detail uses a full snapshot for structural changes and targeted
  section replacement for chat, votes, items, and rides.
- The chat composer keeps its typed value, focus, and scroll position.
- The event editor intentionally stays on its existing poller so live
  content events cannot wipe an unsaved draft.
- The dashboard upcoming-events widget refetches on `list` changes.

## Verification

```powershell
python stuff/check_notifications_ws.py
python stuff/check_realtime_outbox.py
python stuff/check_realtime_browser.py
python stuff/socials_api_smoke.py
node stuff/link_check.mjs
```

`stuff/events_api_smoke.py` has a pre-existing failure around the removed
description module; it is unrelated to the outbox.
