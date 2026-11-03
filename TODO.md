# nedwork — open TODOs

Things deferred, passed off, or noticed-but-not-fixed. Newest context first
per item. Working assumption: the DB-backed app catalog (apps tab) is the
source of truth; `flask_app/data/apps.json` is seed-only. Shipped rounds
(events MVP + UI rounds 1–6, socials, admin console, app corner) are in
git history — this file keeps only open items.

---

## Shipped 2026-11-03 (Phase-2 round)

- Events announcements module (`announcement` module type: `text` ≤500 /
  `tone` ∈ info|important|urgent, SINGLETON; megaphone icon + tones).
- 24h event reminder — `scan_reminders()` in `notifications.py`,
  piggybacked on `GET /events/api/notifications` (no scheduler by design).
- Dashboard Notifications widget (`NotificationsWidget.js`, demo-data
  fallback when the API is unreachable).
- Socials mobile pass (≤640px single-column verified via
  `stuff/socials_shot_mobile.py`).
- Admin console phone pass — §9 `@media (max-width: 480px)` block plus a
  `min-width: 0` fix in §8 (grid track couldn't shrink below table
  min-content → wide tables stretched the page instead of scrolling
  inside their cards; also fixed the 481–859px range, not just ≤480).
  Verified by `stuff/admin_shot_mobile.py`, `stuff/check_admin_phone.py`,
  `stuff/check_admin_breakpoints.py`, `stuff/check_admin_login_phone.py`
  (no horizontal scroll at 320/390/480/481/700/701/860/1280px; wide
  tables scroll inside `.admin-card`).
- Deploy procedure documented in `__docs/git.md` (commit → server pull →
  rebuild/restart → post-deploy smoke → rollback recipe).

Decisions taken this round: **unclaimed-items dashboard nudge** and
**notification endpoint split** dropped outright (2026-11-03); email
delivery confirmed live (`RESEND_API_KEY` set in the server env).
(Candidate function keys `tierforge_export` / `trivia_host` removed from
TODO — nothing to guard yet; the `colors_ai` mechanism is complete.)

## Events site

(none — shipped rounds are in git history)

## Socials site

(none — shipped rounds are in git history; email delivery confirmed live
2026-11-03 — `RESEND_API_KEY` set in the server env)

## Colors AI (`colors_ai` function permission)

Frontend concealment is implemented (JS hides the button via
`/auth/api/who`, server stacks `permission_required("colors_ai")`).
Locked-state UX decided 2026-11-03: stay fully Hidden (no disabled
button/tooltip). Function-key mechanism is complete and proven; the
`tierforge_export` / `trivia_host` candidate keys were removed from TODO
(no endpoints to guard — resurface when a feature needs gating).

## Apps (candidate ideas)

**These are NOT meant to be done when "everything from TODO should be
done" — they are only to be worked on if explicitly mentioned.** They are
idea candidates, not committed work.

- [ ] **Wordle clone** — word-guessing game app.
- [ ] **Recipe maker** — recipe helper app.
- [ ] **QR code generator** — app.

## Admin console

- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.


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
