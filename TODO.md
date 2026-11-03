# nedwork — open TODOs

Open items only, newest context first per entry. Shipped rounds are in git
history — this file never keeps completed work. Working assumption: the
DB-backed app catalog is the source of truth; `flask_app/data/apps.json`
is seed-only.

**If the AI is forced to quit mid-task:** dump everything unfinished into
the Temporary section at the bottom instead of leaving it lost — including
state, next steps, and file paths. See Temporary for the etiquette.

---

## Admin

- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.

(nothing else console-wide is open — phone pass verified 2026-11-03)

## Home (Dashboard)

(none — no open items; anything dashboard-wide starts here. The
Notifications widget shipped 2026-11-03.)

## Events

(none — no open items; shipped rounds are in git history)

## Socials

(none — no open items. Email delivery confirmed live 2026-11-03:
`RESEND_API_KEY` set in the server env. Mobile pass verified.)

## Tasks

(none — no open items)

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

(none — no open items)

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

Little stuff that doesn't warrant its own section:

- [ ] **HTTPS/proxy scheme — code side done, one on-host check left.**
      All cookies are now issued *and* cleared with unconditional
      `Secure` (no `request.is_secure` sniffing left; verified by
      `stuff/check_cookie_flags.py`). Remaining: on the real host,
      confirm after login that every `Set-Cookie` shows `Secure`
      (session_id, csrf_token, admin_session) and that both logout
      buttons (site + admin) actually clear them.
- [ ] **Log out one more time after deploy** with Ctrl+Shift+R first —
      flushes every cached script; confirms the POST + CSRF logout form
      flow end to end (GET /auth/logout now answers 405).

## Deliberately accepted tradeoffs (documented, revisit only if annoyed)

(none at the moment — the GET-logout, admin-session, permission-kind
reseeding, and dead-account-button tradeoffs were resolved in the 2026-11
session; history keeps the reasoning.)
