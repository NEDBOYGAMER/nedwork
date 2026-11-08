# Apps

App-specific notes that go beyond the per-app TODO entries in `TODO.md`.
Architecture rules and the "add a new app" recipe live in `AGENTS.md`.

## TierForge

Multiplayer sessions (shipped 2026-11-08). Two or more members share a
board through an invite link (`/apps/tierforge?s=<token>`). There is no
server push: both sides poll the session every second and push their own
edits (debounced) with a base version.

- **Co-op**: one shared board (tiers + pool). Any member may add, rank,
  and delete images.
- **Split-screen**: one shared image catalog, but every member ranks
  privately; the read-only peer view shows everyone else's board. Any
  member may add and rank. Only the host may delete from the shared
  catalog; a guest's pool ✕ un-ranks the image back to their own pool.
- **Deletions are tombstones**: `POST /apps/tierforge/sessions/<token>/remove`
  records the `{owner, id}` refs under `board["removed"]` and strips them
  from the catalog and every member's tiers/pool. Ordinary board pushes
  are add-only (existing ∪ incoming, then tombstone filter), so a member
  with a stale board can neither delete nor resurrect another member's
  images. Deleting only drops the ref from the session board — the bytes
  stay in the owner's personal uploads.
- **Live drag presence**: while dragging, the client posts
  `{image, x, y}` to `POST /apps/tierforge/sessions/<token>/presence`
  (throttled to ~10/s). The advertised image ref must already be on the
  board — off-board refs are dropped. The GET poll returns a `presence`
  snapshot and other members render a cursor dot + dragged-image ghost.
  Presence is in-memory (single waitress process), never persisted,
  expires after ~2.5 s, and is cleared on leave/end, account purge, or
  restart.
- Session image bytes are served through
  `/apps/tierforge/sessions/<token>/images/<owner>/<image>/<variant>`:
  members only, and the ref must exist in the board (403 non-member,
  404 otherwise). Personal image routes are never used inside a session.
- Known limitation: sessions have no inactivity timeout — abandoned open
  sessions stay open until the host ends them (see `TODO.md`).
