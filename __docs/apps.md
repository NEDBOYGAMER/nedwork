# Apps

App-specific notes that go beyond the per-app TODO entries in `TODO.md`.
Architecture rules and the "add a new app" recipe live in `AGENTS.md`.

## TierForge

Multiplayer sessions (shipped 2026-11-08). Members share a board through an
invite link (`/apps/tierforge?s=<token>`). Board changes are broadcast
instantly over the shared WebSocket relay (with the normal 350 ms debounced
push and 1 s poll as the authoritative fallback), so images appear on peers'
screens without a full board round trip. Multiplayer is desktop-only -
phones (< 1000 px) cannot start or join a session.

### Toolbar and board UI

- The host toolbar is: **Add tier**, **Import** (Images / ZIP / Saved
  `.tierforge` / TierMaker link), **Export** (Save as file / PNG), a person
  icon for Multiplayer, a settings gear, **Clear all**, and the close X.
- Imports show a **real determinate progress bar**: byte progress for
  image/ZIP uploads, "Re-uploading 7 of 100 images" for a saved file, and
  "Importing 7 of 100 images" for a TierMaker link (the server runs that
  import in a background job and the client polls
  `GET /apps/tierforge/import/<job>` for `done/total`). TierMaker filenames
  and downloaded bytes are deduplicated before/while importing.
- The list name is a borderless line: once it has text the input hides and
  the name is shown as plain text; clicking it turns it back into an input.
- Double-clicking a ranked image sends it back to the unranked pool;
  double-clicking an unranked image moves it to the front of the pool.

### Roles and modes

- **Co-op** — one shared board (tiers + pool), up to 10 members. The host
  drives the session: only the host uploads/imports, manages tiers
  (add/rename/delete), clears, or deletes images. Guests may drag and
  arrange images (rank/un-rank, reorder) and see everything live; a guest
  board push is server-side restricted to re-ranking inside the host's
  existing tier structure.
- **Split-screen** — one shared image catalog, one equal-width column per
  member (host included, max 3 members) in one **global join order**: the
  same left-to-right column order on every screen, with the own editable
  board sitting at its own join position instead of being pinned to the
  left. Both members rank their own board (and manage their own tiers); a
  joining guest's tiers are seeded from the host's labels/colors with no
  images placed. Only the host uploads/curates the catalog and deletes
  images. A guest's pool ✕ un-ranks the image back to their own pool.
- **TierMaker import replaces the shared board** in a session: it is
  host-only, tombstones the previous catalog, and keeps guests' tier
  labels/colors while clearing their placements. Normal board pushes stay
  add-only.
- **Sessions have no "ended" screen**: when the host ends a session (closes
  the app tab, reloads, presses the X, or it auto-ends), every guest keeps
  the final shared board/tier list by snapshotting it into their local
  autosave before the reload. The host lands back on their personal board.
  A guest can still leave voluntarily without keeping the board.
- **Guest chrome**: while in a session a guest gets no top bar at all —
  just the session banner and a floating ✕ (top-left) back to App Corner.
  The header is host-only and hidden for guests.

### Friend invites

- The host can invite a friend from the session banner (Invite friends →
  the list comes from `/socials/api/friends`). An invite creates an
  **active** `TierForgeSessionMember` row immediately (no host approval
  step) and sends a `tierforge_join_request` notification (payload carries
  the session token). Inviting also grants the friend the `tierforge`
  access permission so they can open the app page at all.
- Invite notifications show up in the `/notifications` inbox (and the
  dashboard widget) using the shared notification types, with a **Join
  session** action that opens `/apps/tierforge?s=<token>`. While the
  recipient is on the TierForge page, a top-of-page popup polls the inbox
  every ~12 s and offers the same one-click Join.
- Invite links (holding the URL) join instantly too. Memberships,
  including any legacy pending rows, are purged with the rest of the
  user's rows by `purge_user`. Both modes enforce member caps server-side:
  co-op 10, split 3 (host included); a full session answers `409`.

### Board layout and live cursors

- Single-player and co-op boards are laid out **1:1**. Co-op keeps the
  original fixed 1200 px session layout (1136 px board), so every member
  renders the shared board identically and cursor fractions
  map directly. A board larger than the window just scrolls. The tier title
  stays above the board in its normal spot, same as single-player mode.
- Split-screen uses **one canonical 3-column canvas scaled to the viewer**:
  a 430 px unit (`u`), 24 px gaps, a 1338 px canvas, and a 32 px screen-space
  side margin. `--session-scale = available width / 1338`; the board body is
  a grid of `members` equal tracks, so 3 members get `u`-wide columns, 2 get
  ~1.53u, and a lone host gets the full canvas. The scale is shared by the
  whole split layout and drives every board-internal dimension. Widths and
  fonts use `--session-scale`; heights use `--session-scale-y`, which split
  mode sets to **75% of `--session-scale`** (row/image sizes, vertical
  paddings and gaps), and the tier min-height base drops from 100 px to
  75 px, so the columns are compact without changing the width scale. Member
  count changes only the columns, so element sizes match
  across columns on one screen and change only with the viewport. The own
  editable board is a normal grid item at its global join position; there
  are no per-owner widths or transforms. The title, header and session
  banner stay unscaled.
- The session banner is an actions-only bar (copy invite link / invite
  friends for the host, plus a single ✕ that ends the session for the host
  or leaves it for a guest) — the session title and mode are no longer shown
  there.
- Image sizes are shared live inside a session: the settings modal's two
  size selects write `board["settings"]` through
  `POST /apps/tierforge/sessions/<token>/settings` and every member adopts
  the values on the next event/poll. They stay active for the rest of that
  page's session (a guest who keeps the final board also keeps them), but
  never rewrite another member's saved personal settings. The board level
  re-fits after a size change.
- Cursors stream over **WebSocket**, not the board poll: clients connect to
  the shared relay at `/apps/tierforge/ws?room=<sessionToken>&client=<id>`
  (the session token is the capability, like the invite link). Each client
  sends its pointer as a fraction of its own board, and peers render it on
  the same board at the same fraction. Fractions are scale-invariant, so
  co-op's fixed layout and split's canonical-canvas columns both land the
  receiver's cursor exactly on the sender's point. Cursors carry the
  member's name and a per-user color, and track
  across the whole window: the pointer is a fraction of the sender's board
  clamped only by the window edges, so it glides off the board and keeps
  moving until it leaves the page instead of freezing at the border. While
  dragging, the cursor message carries the image `{owner, id}` and peers
  render a thumbnail ghost beside the cursor.
- While the host drags, guests follow the host's scroll fraction; idle
  scrolling never yanks the guest. The relay also forwards discrete
  `board` events (`move` / `add` / `remove` / `settings`) so placements
  repaint instantly; the 350 ms push and 1 s poll remain authoritative.
- Co-op renders all cursors on the shared board. Split renders each member's
  cursor on their own column: fractions are measured against the board
  surface (excluding the "Own" name row), and every own/peer surface is the
  same equal grid track on the same scaled canvas, so the fraction maps
  exactly. The host's ▲▼ controls column is mirrored as an
  invisible spacer in their read-only rendering so their rows wrap
  identically for peers. Presence is in-memory in the relay, never
  persisted, and disappears on disconnect/leave/end.

### Sync, deletion, lifetime

- **Deletions are tombstones**: `POST /apps/tierforge/sessions/<token>/remove`
  records the `{owner, id}` refs under `board["removed"]` and strips them
  from the catalog and every member's tiers/pool. Host-only in both modes.
  Ordinary board pushes are add-only (existing ∪ incoming, then tombstone
  filter), so a member with a stale board can neither delete nor resurrect
  another member's images. Deleting only drops the ref from the session
  board — the bytes stay in the owner's personal uploads.
- **"Clear completely" works in sessions too** (host-only): it deletes the
  whole shared catalog in chunks of 200 refs and applies the final board.
  The plain "Clear all" still only un-ranks images. Outside a session the
  behaviour is unchanged (delete every image's bytes).
- **Catalogue preloading**: when a session state arrives, every image ref is
  warmed into the browser cache in the background, so remote placements
  repaint from cache instead of waiting on a fresh download. Starting or
  joining from an already loaded board flushes the pending personal
  autosave first, so the session's "parked board" never loses recent edits.
- **Live cursors and board hints over WebSocket**: the shared relay in
  `flask_app/ws/` (the old `flask_app/apps/tierforge/websocket.py` module is
  a compatibility entry point) serves the TierForge room path
  `/apps/tierforge/ws` **without auth** and the authenticated site-level
  `/ws/notifications` channel beside it. Rooms are
  capability-token keyed; the relay forwards `{name, color, x, y, dragging?,
  ref?, scroll?}` cursor messages plus
  sanitised TierForge `board` events to the other room members and broadcasts
  a leave on disconnect. The Docker
  image starts the relay on port 5001 beside waitress; nginx still has to
  proxy both paths to it with Upgrade headers (see
  `__docs/structure.md` §6). The notification path reads the mounted
  SQLite DB (new notification rows, realtime-event rows, unread counts,
  `query_only`), so the relay service needs `./data:/app/instance`; a
  missing DB degrades notifications only. Realtime event frames are
  documented in `__docs/realtime.md`.
- **Idle sessions auto-end after 6 hours** without a join/board/remove
  write. The check is lazy: every session route calls `_maybe_end_idle` via
  `_get_session_by_token` (presence pings deliberately do not count — they
  would turn the 1 s poll into a DB write).
- Session image bytes are served through
  `/apps/tierforge/sessions/<token>/images/<owner>/<image>/<variant>`:
  active members only, and the ref must exist in the board (403 non-member,
  404 otherwise). Personal image routes are never used inside a session.
