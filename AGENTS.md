# nedwork — agent orientation guide

Orientation for coding agents working in this repo. Read this before touching
anything. **Always read `TODO.md` too, at the start of every task** — open
work items and accepted tradeoffs live there; check whether your task (or a
cheap related fix) is already listed before you plan, and keep it current
when things change. Verified 2026-10-28; if reality has moved, update this
file in the same session (same rule as `__docs/structure.md`).

---

## 1. What this project is

**Nedwork** — a personal web app (nedwork.ch, homelab server) built with
Flask + Flask-SQLAlchemy + SQLite. Runs locally via `python app.py` (debug
reloader) and in Docker via waitress (port 8000, see `Dockerfile`). No
JavaScript build step, no bundler, no frontend framework — plain JS/CSS
files served from `static/`. There are **no tests**; changes are verified
manually.

The same physical server also hosts unrelated Docker stacks (photos, cloud,
etc.). That infrastructure is documented in `__docs/structure.md` — out of
scope for this repo, but read it if your task touches deployment.

## 2. Top-level layout

| entry | what it is | rules of thumb |
|---|---|---|
| `app.py` | entry point: `create_app()` + `db.create_all()` + `permissions.ensure_all()` | bootstrap happens here; don't add logic |
| `flask_app/` | **all application code** | nothing lives outside this (except entry/docs) |
| `instance/` | live SQLite DB (`app.db` + `-wal`/`-shm`), `notify_secret.key`, `instance/data/` runtime JSON | NEVER delete/replace; never commit changes to it |
| `migrations/` | standard Flask-Migrate/Alembic | schema changes go through `flask db migrate` |
| `__docs/` | project docs (see §9 doc map) | keep current when things change |
| `stuff/` | smoke/verification scripts (browser + API smokes, screenshot tools, ES-module link check) | not shipped code — don't import from here |
| `flask_app/data/apps.json` | seed-only app catalog | see §5 — runtime truth is the DB |
| `requirements.txt` | Python deps | version pins drift; check actual imports before trusting it |
| `TODO.md` | open work items + accepted tradeoffs | read it, keep it current |
| `robots.txt`, `Dockerfile`, `.opencode/`, `.vscode/` | config | self-explanatory |

## 3. Boot flow (memorize this chain)

1. `app.py` calls `create_app()` from `flask_app/__init__.py`
2. `create_app` registers blueprints via `flask_app/blueprint_imports/main.py`
   (core pages) and `blueprint_imports/apps.py` (apps)
3. `db.create_all()` then `permissions.ensure_all()` — seeds the three
   `BASE_PERMISSIONS` rows, seeds `App` rows from `apps.json` **only if the
   table is empty**, and prints a one-time admin password on first boot
4. Old DBs without current columns print a bootstrap-skip message → operator
   must run `flask db upgrade`

Central request hooks in `flask_app/__init__.py` (don't reimplement these):
- **CSRF**: all POST/PUT/PATCH/DELETE need a `csrf_token` cookie plus the
  matching token as `X-CSRF-Token` header OR `csrf_token` form field (the
  server accepts either double-submit path; the logout button uses the
  form path, fetch calls use the header). Exempt list: login/register/
  admin-login/HMAC-token pages. `static/js/global/csrf.js` does the
  fetch client half — it is injected into every HTML page automatically.
- **PWA head tags** injected into every `</head>`.
- **`no-store`** on HTML responses while logged in (cache/logout bug class —
  do not defeat this).
- Forced password-change redirect while `must_change_password` is set.

## 4. Architecture rules

### Blueprints
- Core pages: one folder per blueprint in `flask_app/` — `main`, `auth`,
  `settings`, `dashboard`, `app_corner`, `event_manager`, `apps`, `tasks`,
  `events`, `about`, `admin`, plus top-level `notify_routes.py`.
- Each folder: `routes.py` + `__init__.py`, blueprint object named `<name>_bp`.
- Registration lists live in `flask_app/blueprint_imports/` — a new
  blueprint gets one import + one `(bp, '/prefix')` tuple there. Nothing is
  registered in `flask_app/__init__.py` directly.

### Permission system (`flask_app/permissions.py`)
- Permission rows have a `kind`: **`access`** = gate to *open* an app/page;
  **`function`** = gate to *one feature inside* an app (checked by that
  endpoint's own decorator, never counted as open-requirement).
- **The DB is authoritative after first boot**: `ensure_permissions()` is
  create-missing-only and never rewrites kinds/descriptions of existing
  rows. There is deliberately NO kind switcher anywhere — the section a
  key lives in (App permissions vs Functions, admin Permissions tab)
  decides its kind; rekindling = delete + recreate (PATCH refuses kind
  changes, DELETE refuses base rows / granted rows). `stuff/check_permissions_boot.py` verifies all of this.
- Currently seeded: `core` (access — everything not gated further),
  `tierforge` (access), `colors_ai` (function — Colors AI feature only).
- Apps not in the catalog default to `["core"]`; **empty permission list =
  public page**. Function-kind links are filtered out of open
  requirements (gating follows the live DB kind). Unknown names are
  treated as `access`.
- Enforcement via decorators in `flask_app/auth/decorators.py`:
  `login_required`, `permission_required`, `admin_required`. They inject
  `user=user` into the view — protected views take `user` or `**kwargs`.
  Each has a `mode=` (`"page"` redirect, `"api"` 401 JSON, `"redirect"`,
  `"render"`).

### Admin is not a User
The console operator has its own `AdminCredential` (single row, id=1) and a
separate `admin_session` cookie with a 15-min sliding idle window. It is
deliberately separate from the site `session_id` cookie and site
permissions. `User.is_admin()` always returns `False` (kept only for the
`/auth/api/who` JS contract). Don't merge these systems.

## 5. The apps system

Two layers, keep them straight:

- **DB catalog** (`App` + `AppType` models) is the **runtime source of
  truth**, edited through the admin console's Apps tab (`/api/apps*` in
  `admin/routes.py`).
- `flask_app/data/apps.json` is **seed-only**: read once when the `App`
  table is empty. Console edits are never overwritten by it. Seed a new app
  by adding a row there *before* first boot with an empty table — or add it
  via the console.
- **App ids are stable contract**: app_corner favorites/disabled lists and
  dashboard widgets reference them. Ids are non-contiguous by design —
  never renumber or reuse.

Apps live in `flask_app/apps/<name>/` and are self-contained:

| type | example | has `routes.py`? | how it's served |
|---|---|---|---|
| static app (no API) | `controller_tester`, `trivia` | **no** | dynamic route `/<app_name>` in `flask_app/apps/routes.py` |
| API app | `colors`, `links`, `townclaim`, `tierforge`, `timetable` | yes, own blueprint at `/apps/<name>` | registered in `blueprint_imports/apps.py` |

- `apps_bp` is registered with `template_folder='.'` / `static_folder='.'`
  pointing at `flask_app/apps/` itself — app HTML is `<app>/<app>.html`
  colocated with the app folder, NOT in `flask_app/templates/`.
- **`_page_gate(app_name)`** in `flask_app/apps/routes.py` is the single
  permission gate; it covers both the page route and the static catch-all
  (so `.html` files can't bypass permissions). Static JS/CSS is public by
  design — user data must never be in static files.

### Recipe: add a new app
1. Create `flask_app/apps/<name>/` with `<name>.html` (self-contained app
   folder; colocate its JS/CSS, follow `__docs/style-instructions.md`).
2. Seed a catalog entry: add to `flask_app/data/apps.json` (fresh DB) or
   create it in the admin console (running DB). Permission default: `core`.
3. If it has APIs: add `routes.py`, `<name>_bp`, register in
   `blueprint_imports/apps.py` with prefix `/apps/<name>`.
4. If a feature needs per-user gating: create a `function`-kind key in the
   Permissions tab, link it to the app in the Apps tab, stack
   `permission_required` on the endpoint, and conceal the UI via
   `/auth/api/who` (pattern proven by `colors_ai`).
5. Per-user data models go in `flask_app/apps/app_models.py` (imported into
   `models.py`) — schema change → migration.

## 6. Where new files belong

| you're adding… | it belongs in |
|---|---|
| a core page's template | `flask_app/templates/<blueprint>/` (extends `base.html`) |
| a page's JS | `flask_app/static/js/pages/<name>.js` |
| a page's CSS | `flask_app/static/css/pages/<name>.css` |
| a dashboard widget | `static/js/pages/dashboard/widgets/<Name>Widget.js` + register in `widget_registry.js` (+ CSS in `css/pages/dashboard/`) |
| an app page | `flask_app/apps/<name>/<name>.html` (colocated) |
| shared UI JS/CSS | `static/js/components/` / `static/css/components/` |
| an image used by an app entry | `flask_app/static/img/` |
| a DB model (core) | `flask_app/models.py`; (app-specific) `flask_app/apps/app_models.py` |

Never put user data or generated files under `static/` — it is public and
served as-is (historical bug: suggestions JSON used to live there; runtime
stores now live in `instance/data/`).

## 7. Current state & pitfalls (2026-10-28)

- **Uncommitted work in the tree**: dashboard widget/grid JS+CSS is modified
  (see `git status`). Don't assume a clean slate; don't revert silently.
- **`controller_tester` and `trivia`** have no `routes.py` — they are served
  purely via the dynamic catalog route. That is a valid pattern, not a bug.
- **`tierforge/_uploads/`** is an in-package runtime dir (user uploads write
  inside the repo tree). Known wart; don't "fix" without discussion.
- **All cookies are unconditionally `Secure`** (session, csrf, admin —
  issued *and* cleared; no scheme sniffing left, so `X-Forwarded-Proto`
  / `PROXY_FIX_X_FOR` no longer matter for cookies). Consequences:
  fail-closed — over plain HTTP login won't stick; plain-http testing
  happens via localhost only, where browsers allow Secure cookies.
  `stuff/check_cookie_flags.py` verifies every issue/clear path.
- **`requirements.txt` pins drift** from what's actually imported — verify
  imports before adding/removing pins.
- **Windows dev machine, PowerShell 5.1** — `rg` is not installed; use the
  Grep tool or `Select-String`.
- **Zero tests** — there is no test suite. Verify changes by running the
  app and exercising the affected routes.
- **`instance/app.db-wal`/`-shm`** exist because of SQLite WAL mode; they
  are runtime artifacts.
- Full open-items list: `TODO.md` (accepted-tradeoffs section is currently
  empty) — don't relitigate resolved decisions without reading the history.

## 8. Conventions

- **Never push.** Commits are fine, `git push` is not — deploying to
  nedwork.ch is the operator's job (pull + restart on the server, see
  `__docs/git.md`). Don't push, don't create PRs, don't touch remotes.
- Blueprint object names: `<name>_bp`, registered with explicit URL prefix.
- New DB columns: change the model **and** generate a migration
  (`flask db migrate -m "..."`); `db.create_all()` only creates missing
  tables, never new columns.
- Styling: follow `__docs/style-instructions.md` — CSS variables, dark +
  light themes, shared design language. Don't invent per-app styles that
  ignore it.
- Docs live in `__docs/`, plain English, updated when the thing they
  describe changes.

## 9. Doc map

| file | what |
|---|---|
| `__docs/overview.md` | original informal overview (rough, partly outdated — this file supersedes it) |
| `__docs/structure.md` | master doc for the *server/infrastructure* (docker stacks, backup system, restore recipes) — v2.2 |
| `__docs/style-instructions.md` | universal UI styling ruleset (mandatory) |
| `__docs/git.md` | git workflow for pushing changes |
| `__docs/server_cheat-sheet.md` | server command reference (ops context) |
| `__docs/apps.md`, `__docs/tips_and_tricks.md` | currently empty placeholders |

Verified 2026-11-03: `stuff/` was cleaned of one-off screenshots, design
mockups, and stale notes (recoverable from git history); only smoke/diagnostic
scripts remain.
| `TODO.md` | open items + accepted tradeoffs |
