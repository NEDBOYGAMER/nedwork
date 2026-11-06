# nedwork — open TODOs

Open items only, newest context first per entry. Shipped rounds are in git
history — this file never keeps completed work. Working assumption: the
DB-backed app catalog is the source of truth; `flask_app/data/apps.json`
is seed-only.

**If the AI is forced to quit mid-task:** dump everything unfinished into
the Temporary section at the bottom instead of leaving it lost — including
state, next steps, and file paths. See Temporary for the etiquette.

---

## Security (operator actions outstanding)

- [ ] **Rotate `COLORS_AI_API_KEY`.** It was hardcoded in
      `flask_app/apps/colors/routes.py` and that file was downloadable
      from `/apps/colors/routes.py` until 2026-11-06. The code now reads
      the key from the env only (no fallback); set it on the server.
- [ ] **Purge the old key from git history** (`git filter-repo` / BFG)
      once rotated. History rewrite + force-push is the operator's call.
- Fixed 2026-11-06 (no action): app asset allowlist (source/JSON/
      dotfiles no longer served), tierforge uploads moved under
      `instance/data/`, login + admin-login throttling, session
      invalidation on password change, TownClaim seat tokens, escaped
      email bodies, canonical `SITE_BASE_URL` links, 7-day expiry on
      emailed decision tokens, upload/pixel caps, SVG refused for tile
      image uploads, suggestion-form rate limit, baseline security
      headers, dependency pins bumped (Flask 3.1.3, Pillow 13.0.0,
      requests 2.33.0).

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

(none — full visual rework shipped 2026-11-04: hero with live counts,
pill view switcher, person tiles with per-name avatar hues, group tiles,
composer action bars. Root cause of the "buttons don't render" report was
the shared `.tab` rule lacking a UA-button reset, now fixed in
`ui-elements.css`. Email delivery confirmed live 2026-11-03
(`RESEND_API_KEY` set).)

## Tasks

(none — no open items)

## Apps (App Corner)

(none — no open items; this section is for the app-corner grid page itself,
not for individual apps — those live under 'Apps catalog' below)

## About

(none — no open items)

## Settings

(none — password change is implemented: Account panel "Change" button
opens a current/new/confirm modal posting to `/auth/api/change_password`,
shipped 2026-11-04)

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

(Open: the 2026-11-06 security round gives every seat a server-issued
`player_token`; towns created before it have no token stored, so their
seats can no longer act. Restart any such town — no migration for it.)

### Controller Tester

(none — no open items)

### Links

(none — link cards now contain a real `.link-card-hit` anchor
(`target="_blank"`, stretched over the whole card, actions/tag pills
layered above via z-index); click, Enter, ctrl/middle-click and
context-menu all open the external URL in a new tab natively. Shipped
2026-11-04.)

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
