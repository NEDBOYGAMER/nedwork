# nedwork — open TODOs

Things deferred, passed off, or noticed-but-not-fixed during the admin
console / permissions / apps-tab rounds. Newest context first per item.
Working assumption: the DB-backed app catalog (apps tab) is the source of
truth; `flask_app/data/apps.json` is seed-only.

---

## Events site MVP (shipped 2026-10-31; restructure §1–§7 verified)

The full MVP is built: 11 new tables (migration `e3b7a41c58d9`, applied),
39 routes under `/events` (API for events/members/modules/doodle/bring/
rides/chat/notifications/upcoming), SPA frontend in `js/pages/events/`
(list + detail views, friend picker, 8 module renderers), notification
system (`notifications.py`, in-app + Resend email fan-out), and both
dashboard widgets (Notifications + Event Manager) wired to real data with
60s polling and silent demo fallback. App boots clean (165 rules).

**§1–§7 restructure (2026-10-31) done and verified:** strict view/edit
split (view identical for all, host-only Edit button → `/events/<id>/edit/`
config cards + sticky Save bar), Title + Description as modules (Members
fixed at position 0, singleton types grayed in add-picker, reorder arrows
saved on Save), image upload from PC (`/events/img/...` under
`instance/data/`) + OSM/Nominatim location (search button fills lat/lng,
attribution shown), doodle date mode (month calendar in edit) vs time mode
(HH:MM spans, pinned to the Title's date), vote-lock 409 + host
"Reset votes" (`DELETE /api/modules/<id>/votes`), deadline removed
(Title is the single date source), "New event" only on the list +
labeled back button, and the invite-link fix: `GET /events/invite/<token>`
landing page → Join POST, anonymous visitors bounced to login with a
same-origin `?next=` return.

Verification (2026-10-31): `stuff/events_api_smoke.py` 78/78,
`stuff/browser_smoke.py` 33/33 headless Chromium (login → create → view →
edit cards/sticky bar/doodle calendar/time slots → save → cancel →
publish/unpublish → invite bounce/join → invalid token; zero console,
page, or request errors), `node --check` clean on all events JS,
`stuff/link_check.mjs` 16/16 LINK-OK. Manual two-browser run-through
below is optional polish now, not a gate.

**UI rework round 2 (2026-11-01; code-verified 2026-11-01 — Leaflet in
`static/vendor/leaflet/`, `event_rides.destination` (migration
`c5d9e7f1a3b6`), "I need/have a ride" UI all present in the tree):** big
dominant event title + proper Edit button; Add members (+ invite link)
moved to an edit-mode Members card; drag-handle (grip) module reorder +
Delete/Restore per card; interactive OSM maps (Leaflet vendored in
`static/vendor/leaflet/` — view: marker popup; edit: overlaid search +
draggable pin, Nominatim fills address); doodle mode as two explained
cards + shift-click range selection (calendar and attendee votes);
image-upload fixed (api() forced application/json on FormData — killed
the multipart boundary); car-share reworked ("I need a ride" /
"I have a ride" entries, from/to/when — new `event_rides.destination`
column, migration `c5d9e7f1a3b6` on top of `a4f8c21d97be`); Tasks site
briefly removed (restored same day — nav + dashboard link back);
responsive pass (2-col edit cards on wide screens, single column +
thumb-sized sticky bar on phones).

**Polish round 3 (2026-11-01):** map tiles no longer render offset in a
corner (Leaflet measured the container before it was laid out —
`ResizeObserver → invalidateSize`, in both view and edit maps); bring
add-row fixed (global `input[type=number] { width: 100% }` out-specificed
the 64px qty field — now flex-basis, label input big / qty small); drivers
can't take a seat in their own ride (UI + 400 server-side); doodle
calendar enlarged (480px, bigger day cells).

- [x] Live-DB migrations `a4f8c21d97be` + `c5d9e7f1a3b6` applied
      (2026-11-01, operator-run); event pages open again.
- [x] **View mode shouldn't read as "modules"** (shipped + screenshot-verified
      2026-11-01; reworked the same day into a full-bleed unboxed page): the
      event page is now one page, not a
      stack of labeled cards:
      - **Image = hero**: the Image module renders as a full-bleed
        viewport-width hero with the event title overlaid on a legibility
        scrim (poster treatment); no image → a quiet flat band. No more
        titled "Image" card in view mode.
      - **Unboxed sections**: view-mode sections are hairline-separated
        rows on one continuous page — no card borders. Labels speak the
        event's language ("What to bring", "Pick a date"), not module
        names ("Bring list", "Dates (Doodle)"). Edit mode keeps the cards.
      - **Quieter Edit**: the host's edit affordance is a small glass
        pill ("Edit") top-right in the hero, not a loud primary button —
        invisible furniture for attendees (who see no Edit at all).
      - **Chat pinned to the bottom**: the chat renders as a full-width
        band at the page bottom (`.event-chat`), no longer a
        reorderable card.
      - **Custom SVG icon set** (`static/img/ev-icons/` — table, vote,
        basket, car, map, chat, clipboard, flyer) for the view-mode
        section headers; edit mode keeps the tabler icons.
      Edit mode untouched (cards + grip). Mobile fix included: the hero
      title wraps instead of colliding with the Edit button on narrow
      viewports (screenshot-confirmed). Verified: browser_smoke 36/36,
      node --check clean, zero console/page/request errors.
- [ ] **Module reorder doesn't work on touch** — HTML5 drag-and-drop
      doesn't fire on phones; reordering is desktop-only for now
      (up/down buttons or long-press would be the fallback).

**View polish round 4 (2026-11-01, code + screenshot verified):** the
location search now composes "street house_number, city" from Nominatim's
structured address fields (`addressdetails=1`) instead of the first
display_name chunks (which often started with the POI name); view mode is
full-bleed (whole viewport minus the fixed sidenav, shared micro-gutter
`--event-gutter`, no centered column); the hero image blends into the
page via a bg-colored gradient scrim; the doodle rows/table are compact
hairline rows; finalize-date and reset-votes are edit-mode only (settingsDoodle);
removing people is edit-mode only (settingsMembers — view mode is a
read-only RSVP list); members get a bottom "Leave event" band
(`.event-member-actions`, hosts get "Transfer host" there); chat renders
as a full-width band with the same gutter. Icon-only ghost buttons
(`.btn-ghost-icon` / `.btn-sm-icon`) moved to `ui-elements.css` (loaded
globally) — they were only in tasks.css, which left remove-person /
group / friend buttons unstyled on events and socials. Verified:
browser smokes 36/36 + 11/11, events API 78/78, socials API 57/57,
`node --check`, link_check, screenshots (`stuff/shots/`, incl. mobile).

**Info/interactive split (2026-11-01):** view mode now separates pure
info from the host's interactive stack — the Description module renders
as bare prose directly under the hero (no "About" heading, no icon; it
reads as the subtitle), and location + members ("Who's coming") sit side
by side in an info row right under it (location only when its module is
activated; falls back to a plain members section when location is
absent/hidden; stacks to one column ≤640px). Doodle/bring/rides keep the
host's saved order stack; chat stays pinned to the bottom; edit mode
untouched.

**View polish round 5 (2026-11-01):** five small view-mode tweaks —
chat messages are host-delete-only (backend 403 for authors, delete
button only for hosts; smoke covers both), the "Who's coming" list is a
two-column card grid (one column ≤640px), the doodle vote rows render as
a two-column grid (one column ≤640px), the location map is roughly
quadratic (`aspect-ratio: 1/1`, capped 480px, full-width on mobile), and
the event hero breaks out left of the `#content` sidenav gap on desktop
(negative margin ≥769px only; verified zero horizontal overflow at 1400px
and 390px). Verified: events API 81/81, browser 36/36, socials 68/68 +
18/18, node --check, screenshots (`stuff/shots/ev5-*.png`).

## Socials site (shipped 2026-11-01; redesign + picker round 2026-11-01)

Friends + social groups under `/socials/` (new `socials_bp`, sidebar tab
between Events and Tasks). Social groups are NEW tables
(`social_groups` + `social_group_members`, migration
`d2f4b8e6a9c1`) — the permission-system `Group` model is untouched.
Friendship rows are created/deleted per action: deny/cancel/delete all
remove the row so a fresh request is always possible; add-by-username
(or key) auto-accepts a reverse pending request. Groups: create (owner),
join by 8-char code or shareable `/socials/join/<code>` link (landing
page mirrors the events invite bounce), pending membership row = join
request that admins accept/deny, admins add friends directly, owner
promotes/demotes/transfers/deletes, members leave; admins can rotate the
code. Notifications fire for requests/acceptances/denials
(`friend_request`, `friend_accepted`, `group_join_request`,
`group_joined`, `group_denied`, `group_added`, `group_removed` — labeled
"Social" in the dashboard widget).

**Redesign + picker round (2026-11-01):** card/avatar visual language
(cards with hairline rows, accent-tinted `.avatar` initials everywhere,
role badges on group rows, pending-state badge on groups you've
requested to join), client-side filter input per tab, group add-member
UI (friend picker reusing the events picker layout + batch
`POST /api/groups/<id>/members` `user_ids` + `.../members/by-key`), and
a rotate-code button in group detail (confirm dialog; old code/link dies
immediately — `regenerate-code` endpoint finally surfaced). Shared
`.picker-*` styles moved from `events.css` to `ui-elements.css`; the
events picker now reads `/socials/api/friends` (same response shape as
the old `/events/api/friends`, which is kept for compatibility).
Verified 2026-11-01: `stuff/socials_api_smoke.py` 68/68 (temp-DB,
incl. batch add + by-key + rotate), `stuff/socials_browser_smoke.py`
18/18 headless Chromium (two-user request→accept, group create→picker
add→rotate→filter→join by rotated code→approve→leave; zero console/page
errors), `node --check` clean, `link_check.mjs` LINK-OK, events
`browser_smoke.py` 36/36 + `events_api_smoke.py` 78/78 (shared-file
proof), screenshots in `stuff/shots/`.

- [x] Socials friend-picker reuse (done 2026-11-01): events picker
      reads `/socials/api/friends`; the socials group picker posts the
      batch members endpoint.
- [ ] **Socials mobile pass** is now included in the redesign CSS
      (single column ≤640px, wrap rows) but not screenshot-verified on
      a phone viewport — do a pass with `socials_shot.py` mobile shots
      when touching this page again.
- [x] Genuine two-browser run-through bits: rsvp_stale confirmed in code
      (badge + re-confirm warning in `modules/members.js`, set on finalize
      `events/routes.py`, cleared on re-RSVP). Remaining un-automated bits:
      email delivery (operator env, see below) and dashboard widget live
      data.
- [x] `flask db downgrade` round-trip verified (2026-10-31):
      `e3b7a41c58d9 → c7d1e4b9f205 → e3b7a41c58d9`, clean both ways.
- [ ] **Email delivery on nedwork.ch** — code-side done
      (`notifications.py` reads `RESEND_API_KEY`, sender in `notify.py`);
      purely an operator env task now: set `RESEND_API_KEY` (+ optional
      `NOTIFY_FROM`) in the server env. Without it everything works but
      emails are a silent no-op.
- [ ] **Phase 2 leftovers (deferred by plan):** unclaimed-items dashboard
      nudge, 24h reminder scheduler (no scheduler exists), announcements
      module, notification endpoint split out of the events blueprint when
      a second site needs notifications.

## Colors AI (`colors_ai` function permission)

- [x] **Frontend concealment implemented** (code-verified 2026-11-01):
      `colors.js` fetches `/auth/api/who` and hides `#upload-btn`
      (`display:none`) for users without `colors_ai`, including 401/fetch
      error fallbacks; matching server gate via stacked
      `permission_required("colors_ai")` on the routes. Behavior = fully
      hidden. Remaining: a one-minute glance in a real browser (hidden for
      a `core`-only user, visible with `colors_ai`, hidden after revoking
      the key).
- [ ] **Decide the locked-state UX.** Fully hiding is the current
      behavior. Alternative: show the button disabled with a tooltip
      ("needs colors_ai — ask the admin") so users know the feature
      exists.
- [ ] **Next function keys.** The pattern (create fn key in Permissions
      tab -> assign under Functions in Apps tab -> stacked decorators in
      the app's routes.py -> `/auth/api/who` concealment) is documented
      in the console guide. Candidates mentioned: `tierforge_export`,
      `trivia_host`. Only `colors_ai` exists today. Code check: tierforge
      endpoints currently guard only with the `tierforge` *access* key,
      and trivia is a static app (no `routes.py` — nothing to guard), so
      these keys have no endpoints to protect yet.

## Static asset caching (the logout-saga root cause)

- [x] **Cache-busting for static JS/CSS.** Fixed 2026-10-28 via the
      `Cache-Control: no-cache` (revalidate) option: an `after_request`
      hook in `flask_app/__init__.py` marks every `/static/**` and
      `/apps/**` response ending in `.js`/`.css` as no-cache, so browsers
      revalidate each load (304 when unchanged, instant freshness after a
      deploy). Caveat found while verifying: Flask 3.x already sends
      no-cache on static by default, so if staleness still happens on
      nedwor.ch, suspect the proxy layer overriding headers — check the
      nginx config, not the app. The `?v=<hash>` alternative stays
      available if proxy-side caching ever needs tuning.
- [ ] **Deployment procedure.** The whole post-admin-console session's
      work is uncommitted (checked 2026-11-01: git at `f883e0c`
      "admin login panel logo", 2026-10-27 — 33 modified + 1 deleted
      tracked files, 15 untracked incl. the entire events site JS,
      `notifications.py`, all 3 new migrations, `static/vendor/`, new
      smoke scripts). nedwor.ch served old code until a manual restart.
      Decide: commit + pull + restart flow, so console/gate fixes
      actually ship.

## Admin console leftovers

- [ ] **Kick (force_logout) is unsurfaced.** `POST
      /admin/api/users/<id>/force_logout` exists and is tested (kills
      sessions, keeps access) — deliberately not in the UI after Delete
      replaced kick. Decide: add a "Kick" button next to Lock out, or
      drop the endpoint.
- [ ] **Groups tab member-add is still a `<select>`.** Permission grants
      became chips; member-add kept the dropdown (no user decision).
      Convert to chips for consistency or leave.
- [ ] **Cosmetic cleanups from the audit:** dead `IMG_EXT_BY_MAGIC`
      (`admin/routes.py:429`, never filled nor read), extra arg in
      `renderPermissions(rows, apps)` call (`admin.js:441` vs 1-arg
      signature). Third item resolved: `typeIn.dataset.known` is gone
      with the old type row (verified 2026-11-01).
- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.

## Apps tab / app corner

- [ ] **Max 6 types per app** is enforced server-side (`_clean_types`)
      but not surfaced in the UI. Add a hint or raise the cap.
- [ ] **Typeless apps vanish from every shelf.** An app with no types
      appears nowhere in the app corner (still manageable in the Apps
      tab). Consider a fallback shelf ("Other") or keep as-is.
- [x] **Mobile layouts for the restructured app cards.** App corner now
      has a real phone layout (`app_corner.css` ≤640px: 3-per-row shelf
      grid, fades/arrows off, always-visible pills) — done enough for
      the corner. (2026-11-01 code check.)
- [ ] **Admin console responsiveness** in general — wide-screen focus so
      far (1920px cap, grids at 700/900/1700px); narrow windows only get
      a rail collapse at ≤860px and 1-col panel stacking ≤700px, no
      phone-specific rules.

## Deployment / server config

- [ ] **HTTPS/proxy scheme.** Cookies are set `secure=...` from
      `request.is_secure`; login sets `Secure` unconditionally. If
      nedwor.ch runs behind a TLS-terminating proxy without
      `X-Forwarded-Proto` handling (ProxyFix), cookie behavior gets
      inconsistent. Verify the scheme handling on the real host.
- [ ] **Log out one more time after deploy** with Ctrl+Shift+R first —
      flushes every cached script; confirms the `<a href="/auth/logout">`
      flow end to end.

## Deliberately accepted tradeoffs (documented, revisit only if annoyed)

- GET `/auth/logout` link: weaker logout-CSRF than POST (third-party
  link can log you out — annoyance only). Chosen for stale-JS immunity.
- Admin session: browser-session cookie + 15-min sliding idle — the
  practical equivalent of "password again on every reopen"; per-tab
  re-login is not server-enforceable.
- `ensure_permissions()` re-asserts canonical kinds on boot
  (BASE_PERMISSIONS are seed-owned; a manual kind change to
  core/tierforge/colors_ai is reverted on restart).
- Account button in the sidenav currently does nothing (`/account`
  route commented out; no account page exists).
