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
      to configure yet". Deferred 2026-11-03: the first real site-wide
      setting needs a product decision (announcement banner, maintenance
      mode, branding, …). Everything else from the 2026-11 TODO round is
      shipped.

## Home (Dashboard)

(none — timer view switching and the oval ring were fixed 2026-11-03)

## Events

(none — templates, create→edit, hero, upload field, doodle spacing, map
zoom/link-out, transfer-host placement and username suggestions shipped
2026-11-03)

## Socials

- [ ] **Full visual/UI rework.** Must be done on its own, not bundled
      with other TODOs — it requires full concentration on visuals and
      UI. The 2026-11-03 pass only fixed tokens/spacing. Email delivery
      confirmed live 2026-11-03 (`RESEND_API_KEY` set); mobile pass
      verified.

## Tasks

(none — no open items)

## Apps (App Corner)

(none — no open items; this section is for the app-corner grid page itself,
not for individual apps — those live under 'Apps catalog' below)

## About

(none — no open items)

## Settings

- [ ] **Password change.** The Account panel still shows a disabled
      "Coming soon" password row. Wire it to the existing
      `/auth/api/change_password` (current/new/confirm modal) or a
      voluntary change-password page.

## Account

(none — Delete account is implemented: purge helper, typed-username
confirmation, cookie/logout flow, and the admin delete endpoint share it)

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

- [ ] **Saved links open in a new tab.** Clicking a saved link should
      open the external URL in a new tab (clarified: not
      `/dashboard/link`). `flask_app/apps/links/app.js` already intends
      this via `window.open(..., '_blank')` and the card anchor; verify
      and fix if it does not.

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
- [ ] **Apply the new migration on the server.** `SettingsConfig.notify_events`
      was added in `f3a1c7d9b2e4`; run `python -m flask db upgrade` after
      pulling so the toggle works (local dev DB is already upgraded).

## Deliberately accepted tradeoffs (documented, revisit only if annoyed)

(none at the moment — the GET-logout, admin-session, permission-kind
reseeding, and dead-account-button tradeoffs were resolved in the 2026-11
session; history keeps the reasoning.)
