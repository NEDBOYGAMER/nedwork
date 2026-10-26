# nedwork — open TODOs

Things deferred, passed off, or noticed-but-not-fixed during the admin
console / permissions / apps-tab rounds. Newest context first per item.
Working assumption: the DB-backed app catalog (apps tab) is the source of
truth; `flask_app/data/apps.json` is seed-only.

---

## Colors AI (`colors_ai` function permission)

- [ ] **Live-verify the frontend concealment.** Implemented
      (`colors.js` fetches `/auth/api/who` and hides `#upload-btn` with
      `display:none` for users without `colors_ai`), but only
      code/suite-verified so far. Check in a real browser: button hidden
      for a `core`-only user, visible with `colors_ai`, hidden after
      revoking the key.
- [ ] **Decide the locked-state UX.** Fully hiding is the current
      behavior. Alternative: show the button disabled with a tooltip
      ("needs colors_ai — ask the admin") so users know the feature
      exists.
- [ ] **Next function keys.** The pattern (create fn key in Permissions
      tab -> assign under Functions in Apps tab -> stacked decorators in
      the app's routes.py -> `/auth/api/who` concealment) is documented
      in the console guide. Candidates mentioned: `tierforge_export`,
      `trivia_host`. Only `colors_ai` exists today.

## Static asset caching (the logout-saga root cause)

- [ ] **Cache-busting for static JS/CSS.** `sidenav.js` has no version
      parameter; browsers held the old script for days and made three
      logout fixes look like no-ops. Options: `?v=<hash>` URLs via a
      template helper, or `Cache-Control: no-cache` (revalidate) on
      `/static/js/**` + `/static/css/**`. Highest-leverage open item.
- [ ] **Deployment procedure.** The whole session's work is uncommitted
      (`git status` — many modified files; last commit `6ce90e1`).
      nedwor.ch served old code until a manual restart. Decide: commit +
      pull + restart flow, so console/gate fixes actually ship.

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
      (`admin/routes.py`), extra arg in `renderPermissions(rows, apps)`
      call (`admin.js`), unused `typeIn.dataset.known` in the old type
      row (may be gone after the card restructure — re-check).
- [ ] **Site settings card** (Settings tab) is a placeholder — "Nothing
      to configure yet". First real site-wide setting goes there.

## Apps tab / app corner

- [ ] **Max 6 types per app** is enforced server-side (`_clean_types`)
      but not surfaced in the UI. Add a hint or raise the cap.
- [ ] **Typeless apps vanish from every shelf.** An app with no types
      appears nowhere in the app corner (still manageable in the Apps
      tab). Consider a fallback shelf ("Other") or keep as-is.
- [ ] **Mobile layouts** for the restructured app cards are basic
      sanity-stacked only ("mobile not required" was the call).
- [ ] **Admin console responsiveness** in general — wide-screen focus so
      far (1920px cap, grids at 700/900/1700px).

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
