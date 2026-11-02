# nedwork — open TODOs

Things deferred, passed off, or noticed-but-not-fixed. Newest context first
per item. Working assumption: the DB-backed app catalog (apps tab) is the
source of truth; `flask_app/data/apps.json` is seed-only. Shipped rounds
(events MVP + UI rounds 1–6, socials, admin console, app corner) are in
git history — this file keeps only open items.

---

## Events site

(none — shipped rounds are in git history)

## Socials site

- [ ] **Socials mobile pass** — the redesign CSS includes single column
      ≤640px + wrap rows, but it was never screenshot-verified on a
      phone viewport; do a pass with `socials_shot.py` mobile shots when
      touching this page again.
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

Frontend concealment is implemented (JS hides the button via
`/auth/api/who`, server stacks `permission_required("colors_ai")`); the
open bits:

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

## Static asset caching

- [ ] **Deployment procedure.** nedwor.ch served old code until a manual
      restart once (33 modified + untracked files sat uncommitted at
      2026-11-01). Decide/fix a commit + pull + restart flow so
      console/gate fixes actually ship (see `__docs/git.md`).

## Admin console

- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.
- [ ] **Admin console responsiveness** — wide-screen focus so far (1920px
      cap, grids at 700/900/1700px); narrow windows only get a rail
      collapse at ≤860px and 1-col panel stacking ≤700px, no
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
