# nedwork — open TODOs

Open items only, newest context first per entry. Shipped rounds are in git
history — this file never keeps completed work. Working assumption: the
DB-backed app catalog is the source of truth; `flask_app/data/apps.json`
is seed-only.

Dont fill this file with tasks that have been dine and dates of when they have been done, keep it updated delete content that has been done and add what needs to be done.

**If the AI is forced to quit mid-task:** dump everything unfinished into
the Temporary section at the bottom instead of leaving it lost — including
state, next steps, and file paths. See Temporary for the etiquette.

---

## Admin

- The password minimum is **4 characters everywhere** (register, settings,
  console password) — deliberately loose, no complexity rules. Keep it
  that way; don't tighten it without asking. Single source:
  `MIN_PASSWORD_LENGTH` in `flask_app/__init__.py`.
- The rail footer has a **Reload** button (`#admin-reload` in
  `admin_base.html`) that does a plain `location.reload()` — handy after
  a server-side migration/restart.
- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.

(phone pass verified 2026-11-03)

## Home (Dashboard)

(none — no open items; anything dashboard-wide starts here. The
Notifications widget shipped 2026-11-03 and now shares its type table with
the `/notifications` inbox via `static/js/components/notifications.js`.)

## Events

(none — no open items. Shipped 2026-11-08: responsibility actions
(bring add/claim, offer ride, take seat, doodle vote, chat) require RSVP
**Going**; `maybe` may still request a ride, `cant`/`pending` are
read-only. Non-Going members see a read-only banner listing outstanding
claims/seats/rides, and downgrading warns before keeping them. Existing
garbled location addresses: re-search / drag the pin in Edit to re-fill.
Also shipped 2026-11-08: the "Your to-dos for this event" rollup
(`myDuties`) is gone, and a pin without an address now shows a muted
fallback line instead of the address silently vanishing.)

## Socials

(none — no open items. Email delivery confirmed live 2026-11-03:
`RESEND_API_KEY` set in the server env. Mobile pass verified.)

## Tasks

(none — no open items. Task deadlines now nudge once, 24h out
(`scan_task_deadlines` in `notifications.py`, piggybacked on the inbox
poll); private tasks are skipped on purpose.)

## Apps (App Corner)

(none — no open items; this section is for the app-corner grid page itself,
not for individual apps — those live under 'Apps catalog' below)

## About

(none — no open items)

## Settings

(none — no open items)

## Account

(none — no open items)

- The sidenav Account button opens the Settings page with the Account
  panel activated (`/settings#account`, read by `settings.js`).

## Apps catalog

Per-app sections. The catalog lives in the DB (admin console Apps tab is
the runtime truth); ids are a stable contract — never renumber or reuse.

### TierForge

TierMaker **template** import shipped 2026-11-07 (`POST /apps/tierforge/import`).
A *completed* user list with placements (share-code page type) is a possible
future extension.

- [ ] **Production WebSocket proxy is still operator work**: the Docker
      image now starts `flask_app/apps/livecursor/ws_server.py` on 5001
      beside waitress, but nginx still needs Upgrade-header proxying for
      `/apps/livecursor/ws` and `/apps/tierforge/ws` (recipe in
      `__docs/structure.md` §6). Until that vhost change is live, Docker
      clients fall back to the 1 s poll.
- [ ] **WS relay is not supervised in Docker**: it runs as a background
      child of the waitress command, so a relay crash leaves the web app up
      but live cursors/hints degraded until the container restarts. Poll
      fallback keeps sessions usable.

(none — no other open items)

### Colors

(none — no open items. Status: the `colors_ai` function key is the proven
reference for the whole function-permission mechanism — server-stacked
decorator + `/auth/api/who` UI concealment, locked state fully hidden.
Resurface new function keys only when a feature needs gating.)

### TownClaim

(none — no open items)

### Controller Tester

(none — no open items)

### Links

(none — no open items)

### Trivia

(none — no open items)

### Timetable

(none — no open items)

## Ideas

**These are NOT meant to be done when "everything from TODO should be
done" — they are only to be worked on if explicitly mentioned.** Idea
candidates, not committed work.

### General

Site-wide ideas that are not an app: nudge flows, UX overhauls,
infrastructure quality-of-life. Currently empty.

### App ideas

- [ ] **Wordle clone** — word-guessing game app.
- [ ] **Recipe maker** — recipe helper app.
- [ ] **QR code generator** — app.

## Temporary

**This section exists so that if the AI is forced to quit mid-task, it
must write everything unfinished here** — full state, what was done,
what remains, and exact file paths — instead of leaving work lost.
Treat it as scratch: expected empty at session start, clear it out once
its contents are done or moved to their real section.

### Small things

Little stuff that doesn't warrant its own section: (empty)
