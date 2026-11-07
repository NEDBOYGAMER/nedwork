/* admin.js -- the admin console's only page script.

   Owns: tab switching, pending logins, users, the unified permission
   manager (keys + descriptions + app links via the app-store catalog),
   groups, suggestions, the changelog form and the console password.

   Source is pure ASCII on purpose: any non-ASCII glyph is written as a
   \uXXXX escape so no editor/encoding mishap can ever garble visible UI
   text again.

   Endpoints (flask_app/admin/routes.py):
     GET  /admin/api/pending                   POST /admin/api/pending/<id>/approve|deny
     POST /admin/api/pending/deny_all
     GET  /admin/api/users                     POST /admin/api/users/<id>/permissions
     POST /admin/api/users/<id>/set_core       DELETE /admin/api/users/<id>
     POST /admin/api/users/<id>/force_password_reset
     GET/POST /admin/api/permissions           PATCH/DELETE /admin/api/permissions/<name>
     GET/POST /admin/api/apps                  PATCH/DELETE /admin/api/apps/<slug>
     POST /admin/api/apps/<slug>/image         (multipart tile upload)
     POST /admin/api/apps/<slug>/permissions   {permission, granted}  (access keys)
     POST /admin/api/apps/<slug>/functions     {permission, granted}  (function keys)
     GET/POST /admin/api/groups                DELETE /admin/api/groups/<id>
     POST /admin/api/groups/<id>/permissions   POST /admin/api/groups/<id>/members
     GET  /admin/api/suggestions               DELETE /admin/api/suggestions/<id>
     GET/POST /about/api/updates               DELETE /about/api/updates/<id>
     POST /admin/api/change_password           POST /admin/api/logout
   CSRF is handled globally by csrf.js (reads the csrf_token cookie).

   Forms: handlers are bound ONLY on "submit" (the template's glue
   preventDefaults every form inside .admin-shell) -- never on click too,
   or actions fire twice.
 */

let state = {
    users: [],
    groups: [],
    permissionNames: [],   // known keys for grant chips; refreshed via /permissions
    apps: [],              // app catalog (also drives the Users tab's slug mapping)
    perms: [],             // permission rows incl. kind (access|function)
};

const PERMISSION_DESCRIPTIONS = {};   // friendly hint on group permission chips

/* ---------------------------------- helpers -------------------------- */

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) continue;
        if (key === "class") node.className = value;
        else if (key.startsWith("on") && typeof value === "function")
            node.addEventListener(key.slice(2), value);
        else if (key === "dataset" || key === "data")
            for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
        else if (value instanceof Node) throw new Error(`el(): attribute ${key} expects a string, got a Node`);
        else node.setAttribute(key, value);
    }
    for (const child of children) {
        if (child === undefined || child === null || child === false) continue;
        if (child instanceof Node) node.appendChild(child);
        else node.appendChild(document.createTextNode(child));   // plain text only [as designed]
    }
    return node;
}

async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}

async function api(url, { method = "POST", body } = {}) {
    const res = await fetch(url, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    return { ok: res.ok, data, status: res.status };
}

function toast(message) {
    return window.toast(message, "info");
}

/* setError(targetClass, text) -- fills the .admin-error in the section
   (or the given id when passed); empty text hides it. */
function setError(targetClass, text) {
    let node = null;
    if (targetClass) node = document.getElementById(targetClass);
    if (!node) node = document.querySelector(`#tab-${state.currentSection} .admin-error`);
    if (!node) return;
    node.hidden = text === "";
    node.textContent = text;
}

/* HTML- Whisper nothing: all rendering goes through el() text nodes, so
   user data is safe by construction. */

/* ---------------------------------- switching + boot ------------------ */

function switchSection(name) {
    document.querySelectorAll("#adminNav .nav-link").forEach((n) => {
        n.classList.toggle("active", n.dataset.tab === name);
    });
    document.querySelectorAll(".admin-section").forEach((s) => {
        s.hidden = s.id !== `tab-${name}`;
    });
    state.currentSection = name;
    if (name === "pending") loadPending();
    if (name === "users") loadUsers();
    if (name === "apps") loadApps();
    if (name === "permissions") loadPermissions();
    if (name === "groups") loadGroups().then(loadUsers);
    if (name === "suggestions") loadSuggestions();
    if (name === "changelog") loadChangelog();
    window.scrollTo(0, 0);
}

document.addEventListener("DOMContentLoaded", () => {
    // nav
    document.getElementById("adminNav")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".nav-link");
        if (!btn || btn.id === "admin-logout") return;
        switchSection(btn.dataset.tab);
    });

    // log out (fresh navigation: no cached console may survive this)
    document.getElementById("admin-logout")?.addEventListener("click", async () => {
        await api("/admin/api/logout");
        location.href = "/admin/";
    });

    // actions
    document.getElementById("pendingRefresh")?.addEventListener("click", loadPending);
    document.getElementById("pendingDenyAll")?.addEventListener("click", denyAllPending);

    document.querySelectorAll(".perm-add-form").forEach((form) => {
        form.addEventListener("submit", (e) => addPermission(e.target));
    });
    document.getElementById("appAddForm")?.addEventListener("submit", (e) => createApp(e.target));
    document.getElementById("groupAddForm")?.addEventListener("submit", createGroup);
    document.getElementById("changelogForm")?.addEventListener("submit", (e) => addChangelog(e.target));

    document.getElementById("adminPwForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        changeAdminPassword();
    });

    // temp-password modal
    document.getElementById("pwModalCopy")?.addEventListener("click", async () => {
        const value = document.getElementById("pwModalValue").textContent.trim();
        try { await navigator.clipboard.writeText(value); } catch (e) { /* older browsers */ }
        toast("Temporary password copied");
    });
    document.getElementById("pwModalClose")?.addEventListener("click", () => {
        document.getElementById("admin-password-modal").hidden = true;
        document.getElementById("pwModalValue").textContent = "";
        loadUsers();
    });

    switchSection("pending");   // pending logins are the console's main job
});

/* ---------------------------------- pending logins ------------------- */

function updatePendingBadge(count) {
    const badge = document.getElementById("navPendingCount");
    if (!badge) return;
    badge.textContent = String(count);
    badge.hidden = count === 0;
}

async function loadPending() {
    try {
        const rows = await loadJson("/admin/api/pending");
        renderPending(rows);
        setError("pendingError", "");
    } catch (e) {
        setError("pendingError", "Loading failed: " + e.message);
    }
}

function renderPending(rows) {
    updatePendingBadge(rows.length);

    const table = document.getElementById("pendingTable");
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";

    rows.forEach((p) => {
        const actions = el("div", { class: "admin-actions" },
            el("button", {
                class: "btn btn-primary",
                onclick: () => approvePending(p.id),
            }, "Approve"),
            el("button", {
                class: "btn btn-danger",
                onclick: () => denyPending(p.id),
            }, "Deny")
        );
        tbody.append(el("tr",
            { data: { pending: String(p.id) } },
            el("td", { class: "username" }, p.name || "-"),
            el("td", { class: "cell-muted" }, p.detail || "-"),
            el("td", { class: "cell-muted" }, p.requested_at || "-"),
            el("td", { class: "td-actions" }, actions)
        ));
    });

    table.hidden = rows.length === 0;
    document.getElementById("pendingEmpty").hidden = rows.length !== 0;
}

async function approvePending(id) {
    const res = await api(`/admin/api/pending/${id}/approve`);
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("pendingError", data.error || "Approve failed");
        loadPending();
        return;
    }
    // the created account has NO permissions yet - grant core separately
    // in the Users tab ("Approve" there). Approving twice is intentional:
    // step 1 makes the account exist, step 2 unlocks the site.
    toast(`${data.username}'s account was created - still locked out until "Approve" in the Users tab`);
    loadPending();
    if (state.currentSection === "pending") loadUsers().catch(() => {});
}

async function denyPending(id) {
    const res = await api(`/admin/api/pending/${id}/deny`);
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("pendingError", data.error || "Deny failed");
        loadPending();
        return;
    }
    toast("Request denied");
    loadPending();
}

async function denyAllPending() {
    if (!(await confirmDialog("Deny ALL pending requests? Their names become free again for new registrations.", { danger: true }))) return;
    const res = await api("/admin/api/pending/deny_all");
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("pendingError", data.error || "Failed");
        return;
    }
    toast(`${data.denied} request(s) denied`);
    loadPending();
}

/* ---------------------------------- users ---------------------------- */

async function loadUsers() {
    try {
        state.users = await loadJson("/admin/api/users");
        renderUsers();
        // refresh known permission names for the "+ key" chips (and groups)
        try {
            const rows = await loadJson("/admin/api/permissions");
            state.permissionNames = rows.map((r) => r.name);
            rows.forEach((r) => { PERMISSION_DESCRIPTIONS[r.name] = r.description || ""; });
        } catch (e) { /* grant chips may just be stale */ }
        setError("usersError", "");
    } catch (e) {
        setError("usersError", "Loading failed: " + e.message);
    }
}

function renderUsers() {
    const tbody = document.querySelector("#userTable tbody");
    tbody.innerHTML = "";

    state.users.forEach((user) => {
        const tr = el("tr", { data: { user: String(user.id) } });

        // 1. identity
        const idCell = el("td");
        idCell.append(el("div", { class: "username" }, user.username));
        idCell.append(el("div", { class: "hint" }, user.email || "-"));
        tr.appendChild(idCell);

        // 2. access state
        const accessCell = el("td");
        accessCell.append(user.permissions.includes("core")
            ? el("span", { class: "badge ok" }, "approved - has site access")
            : el("span", { class: "badge err" }, "locked out - no site access"));
        if (user.must_change_password)
            accessCell.append(el("span", { class: "badge accent", title: "Password change is forced at next login" }, "password reset"));
        tr.appendChild(accessCell);

        // 3. permission chips: held keys revoke on x, available keys grant on +
        const permCell = el("td");
        const permChips = el("div", { class: "chip-row" });
        user.permissions.forEach((p) => {
            const chip = el("span", { class: "chip", title: PERMISSION_DESCRIPTIONS[p] || "" });
            chip.append(document.createTextNode(p));
            chip.append(el("button", {
                type: "button",
                title: "Revoke " + p,
                onclick: () => setUserPermissions(user, [], [p], true),
            }, "\u00d7"));
            permChips.appendChild(chip);
        });
        availablePermissions(user.permissions).forEach((p) => {
            permChips.appendChild(el("button", {
                type: "button",
                class: "chip chip-add",
                title: "Grant " + p,
                onclick: () => setUserPermissions(user, [p], [], true),
            }, "+ " + p));
        });
        permCell.appendChild(permChips);
        tr.appendChild(permCell);

        // 4. groups
        tr.append(el("td", { class: "cell-muted" }, user.groups.join(", ") || "-"));

        // 5. actions
        const actionCell = el("td", { class: "td-actions" });
        const actions = el("div", { class: "admin-actions" });
        actions.append(el("button", {
            type: "button",
            class: "btn" + (user.permissions.includes("core") ? "" : " btn-primary"),
            title: user.permissions.includes("core")
                ? "Lock them out (revoke core)"
                : "Approve them (grant core)",
            onclick: () => setCore(user, !user.permissions.includes("core")),
        }, user.permissions.includes("core") ? "Lock out" : "Approve"));
        actions.append(el("button", {
            type: "button",
            class: "btn",
            title: "Kick them out of every device now (sessions die, access stays)",
            onclick: () => forceLogout(user),
        }, "Kick"));
        actions.append(el("button", {
            type: "button",
            class: "btn",
            title: "Force a password reset: fresh temporary password, change forced at next login",
            onclick: () => forcePasswordReset(user),
        }, "Reset password"));
        actions.append(el("button", {
            type: "button",
            class: "btn btn-danger",
            title: "Delete this user and ALL their data permanently",
            onclick: () => deleteUser(user),
        }, "Delete"));
        actionCell.appendChild(actions);
        tr.appendChild(actionCell);

        tbody.appendChild(tr);
    });
}

function availablePermissions(held) {
    const all = new Set(state.permissionNames);
    all.add("core");
    held.forEach((p) => all.delete(p));
    return [...all].sort();
}

async function setUserPermissions(user, grant, revoke) {
    const res = await api(`/admin/api/users/${user.id}/permissions`, { body: { grant, revoke } });
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("usersError", data.error || "Permission change failed");
        return;
    }
    user.permissions = data.permissions || user.permissions;
    setError("usersError", "");
    renderUsers();
}

async function setCore(user, approved) {
    const res = await api(`/admin/api/users/${user.id}/set_core`, { body: { approved } });
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("usersError", data.error || "Failed");
        return;
    }
    if (approved) toast(`${user.username} approved - site access granted`);
    else toast(`${user.username} locked out - their live sessions were ended`);
    loadUsers();
}

async function deleteUser(user) {
    if (!(await confirmDialog(`PERMANENTLY delete ${user.username}? All their data (sessions, dashboards, tasks, app data, groups, friendships) is removed - this cannot be undone.`, { danger: true }))) return;

    const res = await api(`/admin/api/users/${user.id}`, { method: "DELETE" });
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("usersError", data.error || "Delete failed");
        return;
    }
    toast(`${user.username} deleted - they would have to request access again`);
    loadUsers();
}

async function forceLogout(user) {
    if (!(await confirmDialog(`Kick ${user.username} out of every device now? Their access stays - they can log back in.`, { danger: true }))) return;
    const res = await api(`/admin/api/users/${user.id}/force_logout`, { method: "POST" });
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("usersError", data.error || "Kick failed");
        return;
    }
    toast(`${user.username} kicked - all their sessions were ended`);
}

async function forcePasswordReset(user) {
    const res = await api(`/admin/api/users/${user.id}/force_password_reset`);
    const data = res.data;
    if (!res.ok || !data.success) {
        setError("usersError", data.error || "Reset failed");
        return;
    }

    // show the temp password once in the modal
    document.getElementById("pwModalTitle").textContent =
        `Temporary password for ${data.username}`;
    document.getElementById("pwModalText").textContent =
        "Copy it and hand it over - they must change it on next login.";
    document.getElementById("pwModalValue").textContent = data.temporary_password;
    document.getElementById("admin-password-modal").hidden = false;
}

/* ---------------------------------- permissions (unified) ------------ */
/* The Permissions tab CREATES keys and shows where each key is in use.
   Assignment happens in the Apps tab (app links) and Users/Groups. */

async function loadPermissions() {
    let rows, apps;
    try {
        [rows, apps] = await Promise.all([
            loadJson("/admin/api/permissions"),
            loadJson("/admin/api/apps"),
        ]);
        setError("permError", "");
    } catch (e) {
        setError("permError", "Failed to load permissions: " + e.message);
        return;
    }

    state.permissionNames = rows.map((r) => r.name);
    state.perms = rows;
    state.apps = apps;
    rows.forEach((r) => { PERMISSION_DESCRIPTIONS[r.name] = r.description || ""; });
    renderPermissions(rows);
}

function renderPermissions(permRows) {
    const access = permRows.filter((r) => (r.kind || "access") !== "function");
    const fns = permRows.filter((r) => (r.kind || "access") === "function");

    const sections = [
        { table: document.getElementById("permAccessTable"),
          empty: document.getElementById("permAccessEmpty"), rows: access },
        { table: document.getElementById("permFnTable"),
          empty: document.getElementById("permFnEmpty"), rows: fns },
    ];

    sections.forEach((s) => {
        if (!s.table) return;
        const tbody = s.table.querySelector("tbody");
        tbody.innerHTML = "";
        s.rows.forEach((row) => tbody.appendChild(buildPermRow(row)));
        s.table.hidden = s.rows.length === 0;
        if (s.empty) s.empty.hidden = s.rows.length !== 0;
    });
}

/* one permissions row (shared by both sections — the section decides the
   kind, there is no kind switcher; only the description is editable) */
function buildPermRow(row) {
    const isFn = (row.kind || "access") === "function";
    const errorId = isFn ? "permFnError" : "permError";
    const tr = el("tr", { data: { perm: row.name } });

    // key + description + fn badge + holders
    const idCell = el("td");
    const keyLine = el("div", { class: "username" }, el("code", {}, row.name));
    if (isFn) keyLine.append(el("span", {
        class: "badge accent fn-badge",
        title: "Function key - gates one feature inside an app, never app access",
    }, "fn"));
    idCell.append(keyLine);
    idCell.append(el("div", {
        class: "hint",
        data: { desc: row.description || "" },
    }, row.description || "- (no description)"));
    const holders = el("div", { class: "chip-row", style: "margin-top:4px" });
    if (row.users.length) holders.append(el("span", { class: "badge" }, `${row.users.length} user(s)`));
    if (row.groups.length) holders.append(el("span", { class: "badge" }, `${row.groups.length} group(s)`));
    if (row.users.length || row.groups.length) idCell.appendChild(holders);
    tr.appendChild(idCell);

    // permits: which apps list this key (unlink only - assignment lives in Apps)
    const appCell = el("td");
    const chipRow = el("div", { class: "chip-row" });
    row.apps.forEach((appName) => {
        const chip = el("span", { class: "chip" });
        chip.append(document.createTextNode(appName));
        chip.append(el("button", {
            type: "button",
            title: `Stop requiring ${row.name} for ${appName}`,
            onclick: () => {
                const app = appNameToSlug(appName);
                if (app) toggleAppPermission(app, row.name, false, errorId);
            },
        }, "\u00d7"));
        chipRow.appendChild(chip);
    });
    if (row.apps.length === 0) {
        chipRow.append(el("span", { class: "hint" }, "- nothing -"));
    }
    appCell.appendChild(chipRow);
    tr.appendChild(appCell);

    // actions
    const actionCell = el("td", { class: "td-actions" });
    const actions = el("div", { class: "admin-actions" });
    actions.append(el("button", {
        type: "button",
        class: "btn",
        title: "Edit description (kind is fixed by the section - rekindle = delete + recreate)",
        onclick: () => editPermission(tr, row, errorId),
    }, "\u270e Edit"));
    actions.append(el("button", {
        type: "button",
        class: "btn btn-danger",
        title: "Delete this permission (it must not be granted anywhere)",
        onclick: () => deletePermission(row, errorId),
    }, "Delete"));
    actionCell.appendChild(actions);
    tr.appendChild(actionCell);

    return tr;
}

function appNameToSlug(name) {
    const hit = (state.apps || []).find((a) => a.name === name);
    return hit ? hit.slug : null;
}

async function toggleAppPermission(slug, permission, granted, errorId = "permError") {
    const res = await api(`/admin/api/apps/${encodeURIComponent(slug)}/permissions`, {
        body: { permission, granted },
    });
    if (!res.ok || !res.data.success) {
        setError(errorId, res.data.error || "failed");
        return;
    }
    setError(errorId, "");
    toast(`${permission} ${granted ? "now required by" : "no longer required by"} ${slug}`);
    loadPermissions();
}

async function addPermission(form) {
    const isFn = form.dataset.kind === "function";
    const errorId = isFn ? "permFnError" : "permError";
    const key = form.querySelector('input[name="key"]')?.value.trim();
    const description = form.querySelector('input[name="description"]')?.value.trim();
    if (!key) return;

    const res = await api("/admin/api/permissions", {
        body: { key, description, kind: form.dataset.kind },
    });
    if (!res.ok || !res.data.success) {
        setError(errorId, res.data.error || "Failed");
        if (res.status === 400) form.reportValidity && form.reportValidity();
        return;
    }

    form.querySelectorAll('input[name="key"], input[name="description"]')
        .forEach((input) => (input.value = ""));
    setError(errorId, "");
    toast(isFn
        ? `Function key ${key} added - assign it in the Apps tab under Functions`
        : `Access key ${key} added - assign it in the Apps tab under "Requires to open"`);
    loadPermissions();
}

/* inline editor: description only - the kind is fixed by the section the
   key lives in (rekindling = delete + recreate, a deliberate move) */
function editPermission(tr, row, errorId = "permError") {
    if (tr.querySelector(".perm-desc-edit")) return;

    const cell = tr.children[0];
    const hint = cell.querySelector(".hint");
    if (!hint) return;

    const originalDesc = hint.dataset.desc || "";

    const input = el("input", {
        type: "text",
        placeholder: "What does this key allow?",
        autocomplete: "off",
    });
    input.value = originalDesc;
    input.style.maxWidth = "300px";

    hint.hidden = true;

    const box = el("div", { class: "perm-desc-edit" });
    box.append(input, el("button", {
        type: "button",
        class: "btn",
        onclick: save,
    }, "Save"), el("button", {
        type: "button",
        class: "btn",
        onclick: cancel,
    }, "Cancel"));
    hint.parentNode.insertBefore(box, hint);

    input.focus();

    async function save() {
        const description = input.value.trim();
        const res = await api(`/admin/api/permissions/${encodeURIComponent(row.name)}`, {
            method: "PATCH",
            body: { description },
        });
        if (!res.ok || !res.data.success) {
            setError(errorId, res.data.error || "Failed");
            return;
        }
        setError(errorId, "");
        toast(`${row.name} updated`);
        loadPermissions();
    }

    function cancel() {
        box.remove();
        hint.hidden = false;
    }
}

async function deletePermission(row, errorId = "permError") {
    if (!(await confirmDialog(`Delete the permission "${row.name}"? It must not be granted anywhere.`, { danger: true }))) return;
    const res = await api(`/admin/api/permissions/${encodeURIComponent(row.name)}`, { method: "DELETE" });
    if (!res.ok || !res.data.success) {
        setError(errorId, res.data.error || "Failed");
        return;
    }
    toast("Permission deleted");
    loadPermissions();
}

/* ---------------------------------- apps ----------------------------- */
/* The Apps tab is the live interface to the app catalog: per-app card
   with editable title/link/types/description, drag & drop tile image,
   "Requires to open" chips (access keys) and "Functions" chips (function
   keys). The kinds are strictly separated server-side. */

const STATIC_APPS_IMG = "/static/img/apps";

async function loadApps() {
    let apps, perms;
    try {
        [apps, perms] = await Promise.all([
            loadJson("/admin/api/apps"),
            loadJson("/admin/api/permissions"),
        ]);
        setError("appsError", "");
    } catch (e) {
        setError("appsError", "Failed to load apps: " + e.message);
        return;
    }
    state.apps = apps;
    state.perms = perms;
    renderApps(apps, perms);
}

function renderApps(apps, perms) {
    const list = document.getElementById("appsList");
    list.innerHTML = "";

    // one datalist of all types in use, shared by every type input
    const knownTypes = [...new Set(apps.flatMap((a) => a.types || []))].sort();
    let datalist = document.getElementById("typesDatalist");
    if (!datalist) {
        datalist = el("datalist", { id: "typesDatalist" });
        document.body.appendChild(datalist);
    }
    datalist.innerHTML = "";
    knownTypes.forEach((t) => datalist.appendChild(el("option", { value: t })));

    const accessKeys = perms.filter((p) => (p.kind || "access") === "access").map((p) => p.name);
    const functionKeys = perms.filter((p) => (p.kind || "access") === "function").map((p) => p.name);

    apps.forEach((app) => list.appendChild(renderAppCard(app, accessKeys, functionKeys, knownTypes)));

    document.getElementById("appsEmpty").hidden = apps.length > 0;
}

function renderAppCard(app, accessKeys, functionKeys, knownTypes) {
    const box = el("div", { class: "app-box", data: { slug: app.slug } });

    // head: thumb (dropzone) | name + link | delete (spans both rows)
    const head = el("div", { class: "app-box-head" });
    head.appendChild(buildThumb(app));

    const nameIn = el("input", {
        type: "text",
        class: "app-name-input",
        value: app.name,
        autocomplete: "off",
        spellcheck: "false",
    });
    const urlIn = el("input", {
        type: "text",
        class: "app-link-input",
        value: app.url || "",
        placeholder: "/colors",
        autocomplete: "off",
        spellcheck: "false",
    });
    const titleCol = el("div", { class: "app-box-titlecol" });
    titleCol.appendChild(nameIn);
    titleCol.appendChild(el("div", { class: "app-box-linkrow" },
        urlIn,
        el("span", { class: "hint mono" }, `#${app.slug} - id ${app.id}`)
    ));
    head.appendChild(titleCol);

    head.appendChild(el("div", { class: "app-box-headactions" },
        el("button", {
            type: "button",
            class: "btn btn-danger",
            title: "Delete this app from the catalog (its image file moves to img/apps/bin/)",
            onclick: () => deleteApp(app),
        }, "Delete")
    ));
    box.appendChild(head);

    // description row (the only form-bound fields: name / link / description)
    const descIn = el("input", {
        type: "text",
        value: app.description || "",
        placeholder: "What the app is",
        autocomplete: "off",
    });
    const descRow = el("div", { class: "app-box-descrow" });
    const saveBtn = el("button", {
        type: "button",
        class: "btn btn-primary",
        onclick: () => {
            const name = nameIn.value.trim();
            if (!name) { nameIn.focus(); return; }
            patchApp(app, {
                name,
                url: urlIn.value.trim(),
                description: descIn.value.trim(),
            });
        },
    }, "Save");
    descRow.append(descIn, saveBtn);
    box.appendChild(descRow);

    // panels: types (light) | requires-to-open (dark) | functions (dark, full row)
    const panels = el("div", { class: "app-box-panels" });
    panels.appendChild(buildTagBox({
        title: "Types",
        darker: false,
        hint: "Max 6 types per app - an app can live on several shelves.",
        entries: knownTypes.map((t) => ({
            name: t,
            enabled: (app.types || []).includes(t),
        })),
        onToggle: (t, next) => {
            const types = next
                ? [...(app.types || []), t]
                : (app.types || []).filter((x) => x !== t);
            patchApp(app, { types });
        },
        plus: "type",
    }));
    panels.appendChild(buildTagBox({
        title: "Requires to open",
        darker: true,
        entries: accessKeys.map((p) => ({
            name: p,
            enabled: (app.permissions || []).includes(p),
            title: PERMISSION_DESCRIPTIONS[p] || "",
        })),
        onToggle: (p, next) => toggleAppLink(app, p, next, false),
        plus: "permission",
        app,
    }));
    panels.appendChild(buildTagBox({
        title: "Functions",
        darker: true,
        full: true,
        entries: functionKeys.map((p) => ({
            name: p,
            enabled: (app.functions || []).includes(p),
            title: PERMISSION_DESCRIPTIONS[p] || "",
        })),
        onToggle: (p, next) => toggleAppLink(app, p, next, true),
    }));
    box.appendChild(panels);

    return box;
}

/* One box of toggle tags: filled pill = enabled for this app, muted
   outline = available. Clicking toggles instantly; optional inline
   "plus" row adds new entries (a type, or a brand-new access key that
   is created and linked in one go). */
function buildTagBox({ title, darker, full, entries, onToggle, plus, app, hint }) {
    const panel = el("div", {
        class: "app-box-panel"
            + (darker ? " dark" : "")
            + (full ? " full" : ""),
    });
    panel.appendChild(el("div", { class: "app-panel-title" }, title));
    if (hint) panel.appendChild(el("span", { class: "hint" }, hint));

    const tags = el("div", { class: "app-panel-tags" });
    entries.forEach((e) => {
        tags.appendChild(el("button", {
            type: "button",
            class: "app-tag" + (e.enabled ? " on" : ""),
            title: e.title
                ? `${e.title} - click to ${e.enabled ? "remove" : "add"}`
                : `Click to ${e.enabled ? "remove" : "add"}`,
            onclick: () => onToggle(e.name, !e.enabled),
        }, e.name));
    });
    if (entries.length === 0) {
        tags.append(el("span", { class: "hint" }, "nothing of this kind exists yet"));
    }
    panel.appendChild(tags);

    if (plus === "type") {
        const row = el("div", { class: "app-panel-plusrow" });
        const input = el("input", {
            type: "text",
            list: "typesDatalist",
            placeholder: "new type name...",
            autocomplete: "off",
            spellcheck: "false",
            hidden: true,
        });
        input.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const t = input.value.trim();
            if (t) onToggle(t, true);   // enable = create + assign
        });
        const plusBtn = el("button", {
            type: "button",
            class: "app-tag plus",
            title: "Add a new type",
            onclick: () => {
                input.hidden = !input.hidden;
                if (!input.hidden) input.focus();
            },
        }, "+ add type");
        row.append(plusBtn, input);
        panel.appendChild(row);
    }

    if (plus === "permission") {
        const row = el("div", { class: "app-panel-plusrow" });
        const keyIn = el("input", {
            type: "text",
            placeholder: "new-key",
            autocomplete: "off",
            spellcheck: "false",
            hidden: true,
        });
        const descIn = el("input", {
            type: "text",
            placeholder: "what it allows",
            autocomplete: "off",
            hidden: true,
        });
        const addBtn = el("button", {
            type: "button",
            class: "btn",
            hidden: true,
            onclick: async () => {
                const key = keyIn.value.trim();
                if (!key) { keyIn.focus(); return; }
                const res = await api("/admin/api/permissions", {
                    body: { key, description: descIn.value.trim(), kind: "access" },
                });
                if (!res.ok || !res.data.success) {
                    setError("appsError", res.data.error || "creating the key failed");
                    return;
                }
                setError("appsError", "");
                toggleAppLink(app, key, true, false);
            },
        }, "Create + link");
        const plusBtn = el("button", {
            type: "button",
            class: "app-tag plus",
            title: "Create a new access key and link it to this app",
            onclick: () => {
                const reveal = keyIn.hidden;
                keyIn.hidden = descIn.hidden = addBtn.hidden = !reveal;
                if (reveal) keyIn.focus();
            },
        }, "+ add permission");
        row.append(plusBtn, keyIn, descIn, addBtn);
        panel.appendChild(row);
    }

    return panel;
}

function buildThumb(app) {
    const thumb = el("div", {
        class: "app-thumb",
        title: "Drop an image here (or click) - saved to img/apps/ and linked",
    });

    const setImage = () => {
        thumb.innerHTML = "";
        if (app.image && app.image !== "/placeholder") {
            const img = el("img", { src: `${STATIC_APPS_IMG}${app.image}`, alt: "" });
            img.addEventListener("error", () => {
                thumb.innerHTML = "";
                thumb.appendChild(el("span", { class: "app-thumb-fallback" }, app.name[0] || "?"));
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(el("span", { class: "app-thumb-fallback" }, app.name[0] || "?"));
        }
    };
    setImage();

    const input = el("input", { type: "file", accept: "image/*" });
    input.style.display = "none";
    input.addEventListener("change", () => {
        if (input.files[0]) uploadAppImage(app, input.files[0]);
        input.value = "";
    });
    thumb.appendChild(input);

    thumb.addEventListener("click", () => input.click());
    thumb.addEventListener("dragover", (e) => {
        e.preventDefault();
        thumb.classList.add("dragging");
    });
    thumb.addEventListener("dragleave", () => thumb.classList.remove("dragging"));
    thumb.addEventListener("drop", (e) => {
        e.preventDefault();
        thumb.classList.remove("dragging");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) uploadAppImage(app, file);
    });

    return thumb;
}

async function uploadAppImage(app, file) {
    toast(`Uploading image for ${app.name}...`);
    const body = new FormData();
    body.append("image", file);
    const res = await fetch(`/admin/api/apps/${encodeURIComponent(app.slug)}/image`, {
        method: "POST",
        body,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok || !data.success) {
        setError("appsError", data.error || "Image upload failed");
        return;
    }
    setError("appsError", "");
    toast(`${app.name}: image saved as ${data.image}`);
    loadApps();
}

async function toggleAppLink(app, permission, granted, isFn) {
    const path = isFn ? "functions" : "permissions";
    const res = await api(`/admin/api/apps/${encodeURIComponent(app.slug)}/${path}`, {
        body: { permission, granted },
    });
    if (!res.ok || !res.data.success) {
        setError("appsError", res.data.error || "failed");
        return;
    }
    setError("appsError", "");
    toast(`${app.name}: ${permission} ${granted ? (isFn ? "listed as function" : "now required") : (isFn ? "removed from functions" : "no longer required")}`);
    loadApps();
}

async function patchApp(app, changes) {
    const res = await api(`/admin/api/apps/${encodeURIComponent(app.slug)}`, {
        method: "PATCH",
        body: changes,
    });
    if (!res.ok || !res.data.success) {
        setError("appsError", res.data.error || "Save failed");
        loadApps();
        return;
    }
    setError("appsError", "");
    toast(`${app.name} saved`);
    loadApps();
}

async function createApp(form) {
    const name = document.getElementById("appNewName")?.value.trim();
    const url = document.getElementById("appNewUrl")?.value.trim();
    const description = document.getElementById("appNewDesc")?.value.trim();
    const types = (document.getElementById("appNewTypes")?.value || "")
        .split(",").map((t) => t.trim()).filter(Boolean);
    if (!name) return;

    const res = await api("/admin/api/apps", { body: { name, url, types, description } });
    if (!res.ok || !res.data.success) {
        setError("appsError", res.data.error || "Failed");
        return;
    }

    document.getElementById("appNewName").value = "";
    document.getElementById("appNewUrl").value = "";
    document.getElementById("appNewTypes").value = "";
    document.getElementById("appNewDesc").value = "";
    setError("appsError", "");
    toast(`${name} added to the catalog (placeholder tile - drop an image onto it)`);
    loadApps();
}

async function deleteApp(app) {
    if (!(await confirmDialog(`Delete "${app.name}" from the catalog? Its tile image moves to img/apps/bin/ - nothing is hard-deleted.`, { danger: true }))) return;
    const res = await api(`/admin/api/apps/${encodeURIComponent(app.slug)}`, { method: "DELETE" });
    if (!res.ok || !res.data.success) {
        setError("appsError", res.data.error || "Failed");
        return;
    }
    toast(`${app.name} deleted`);
    loadApps();
}

/* ---------------------------------- groups --------------------------- */

async function loadGroups() {
    try {
        state.groups = await loadJson("/admin/api/groups");
        if (Object.keys(PERMISSION_DESCRIPTIONS).length === 0 || state.permissionNames.length === 0) {
            const rows = await loadJson("/admin/api/permissions");
            state.permissionNames = rows.map((r) => r.name);
            rows.forEach((r) => { PERMISSION_DESCRIPTIONS[r.name] = r.description || ""; });
        }
        if (state.users.length === 0) {
            try { state.users = await loadJson("/admin/api/users"); } catch (e) { /* quieter member select */ }
        }
        renderGroups();
        setError(null, "");
        document.getElementById("groupsEmpty").hidden = state.groups.length > 0;
    } catch (e) {
        console.error("groups load failed", e);
        toast("Loading groups failed: " + e.message);
    }
}

function renderGroups() {
    const list = document.getElementById("groupsList");
    list.innerHTML = "";

    state.groups.forEach((group) => {
        const box = el("div", { class: "group-box" }, el("h3", {},
            group.name,
            el("button", {
                type: "button",
                class: "btn btn-danger",
                title: "Delete this group (members keep their user accounts)",
                onclick: () => deleteGroup(group),
            }, "Delete group")
        ));

        // permission chips
        const chips = el("div", { class: "chip-row" });
        group.permissions.forEach((p) => {
            const chip = el("span", { class: "chip", title: PERMISSION_DESCRIPTIONS[p] || "" });
            chip.append(document.createTextNode(p));
            chip.append(el("button", {
                type: "button",
                title: "Revoke " + p,
                onclick: () => saveGroupPermissions(group, group.permissions.filter((x) => x !== p)),
            }, "\u00d7"));
            chips.appendChild(chip);
        });
        protoPermissions(group).forEach((p) => {
            chips.appendChild(el("button", {
                type: "button",
                class: "chip chip-add",
                title: "Grant " + p,
                onclick: () => saveGroupPermissions(group, [...group.permissions, p]),
            }, "+ " + p));
        });
        box.appendChild(chips);

        // add-member chips (same language as the permission chips)
        const candidates = candidateUsers(group);
        if (candidates.length > 0) {
            const addRow = el("div", { class: "chip-row" });
            addRow.appendChild(el("span", { class: "hint" }, "Add member:"));
            candidates.forEach((u) => {
                addRow.appendChild(el("button", {
                    type: "button",
                    class: "chip chip-add",
                    title: "Add " + u + " to this group",
                    onclick: () => saveGroupMembers(group, [u], []),
                }, "+ " + u));
            });
            box.appendChild(addRow);
        } else {
            box.appendChild(el("div", { class: "group-member-row" },
                el("span", { class: "cell-muted" }, "every user is already a member")));
        }

        // member chips
        const memberChips = el("div", { class: "chip-row" });
        group.members.forEach((m) => {
            const chip = el("span", { class: "chip" });
            chip.append(document.createTextNode(m));
            chip.append(el("button", {
                type: "button",
                title: "Remove " + m,
                onclick: () => saveGroupMembers(group, [], [m]),
            }, "\u00d7"));
            memberChips.appendChild(chip);
        });
        if (group.members.length) box.appendChild(memberChips);

        list.appendChild(box);
    });
}

/* group helper -- all known keys not yet held by the group */
function protoPermissions(group) {
    const held = new Set(group.permissions);
    const all = new Set(state.permissionNames);
    all.add("core");
    [...held].forEach((p) => all.delete(p));
    return [...all].sort().filter((p) => !held.has(p));
}

function candidateUsers(group) {
    const members = new Set(group.members);
    return state.users.map((u) => u.username).filter((u) => !members.has(u));
}

async function createGroup(form) {
    const name = document.getElementById("newGroupName")?.value.trim();
    if (!name) return;

    const res = await api("/admin/api/groups", { body: { name } });
    if (!res.ok || !res.data.success) {
        toast(res.data.error || "Could not create the group");
        return;
    }

    document.getElementById("newGroupName").value = "";
    toast(`Group ${name} created`);
    await loadGroups();
}

async function saveGroupPermissions(group, names) {
    const res = await api(`/admin/api/groups/${group.id}/permissions`, { body: { permissions: names } });
    if (!res.ok || !res.data.success) {
        toast(res.data.error || "Failed to save group permissions");
        return;
    }
    group.permissions = names;
    state.permissionNames = [...new Set([...state.permissionNames, ...names])];
    loadGroups();
}

async function saveGroupMembers(group, add, remove) {
    const res = await api(`/admin/api/groups/${group.id}/members`, { body: { add, remove } });
    if (!res.ok || !res.data.success) {
        toast(res.data.error || "Failed to save members");
        return;
    }
    const n = (add?.length || 0) + (remove?.length || 0);
    if (n) toast(`Group members updated (${n} change${n === 1 ? "" : "s"})`);
    loadGroups();
}

async function deleteGroup(group) {
    if (!(await confirmDialog(`Delete group "${group.name}"? Members stay as users; the group's permissions simply go away.`, { danger: true }))) return;
    const res = await api(`/admin/api/groups/${group.id}`, { method: "DELETE" });
    if (!res.ok || !res.data.success) { toast(res.data.error || "Failed"); return; }
    toast(`Group ${group.name} deleted`);
    await loadGroups();
}

/* ---------------------------------- suggestions ---------------------- */

async function loadSuggestions() {
    try {
        const items = await loadJson("/admin/api/suggestions");
        renderSuggestions(items);
    } catch (e) {
        setError("suggestionsError", e.message);
    }
}

function renderSuggestions(items) {
    const list = document.getElementById("suggestionsList");
    list.innerHTML = "";

    items.forEach((s) => {
        const box = el("div", { class: "suggestion-item" });
        box.appendChild(el("div", { class: "suggestion-head" },
            el("span", { class: "username" }, s.name || "anonymous"),
            el("span", { class: "suggestion-date" }, s.created_at || "")
        ));
        if (s.type) box.appendChild(el("span", { class: "badge accent", style: "margin-top:4px" }, s.type));
        box.appendChild(el("p", { class: "suggestion-what" }, s.what || ""));
        if (s.how_why) box.appendChild(el("p", { class: "suggestion-why" }, s.how_why || ""));
        if (s.area) box.appendChild(el("p", { class: "hint" }, "Area: " + s.area));
        box.appendChild(el("div", { class: "admin-actions", style: "justify-content:flex-start" },
            el("button", {
                type: "button",
                class: "btn btn-danger",
                onclick: () => deleteSuggestion(s.id),
            }, "Delete")
        ));
        list.appendChild(box);
    });

    const empty = document.getElementById("suggestionsEmpty");
    if (empty) empty.hidden = items.length > 0;
}

async function deleteSuggestion(id) {
    if (!(await confirmDialog("Delete this suggestion?", { danger: true }))) return;
    const res = await api(`/admin/api/suggestions/${id}`, { method: "DELETE" });
    if (!res.ok || !res.data.success) { toast(res.data.error || "Failed"); return; }
    toast("Suggestion deleted");
    loadSuggestions();
}

/* ---------------------------------- changelog ------------------------ */

async function loadChangelog() {
    try {
        const items = await loadJson("/about/api/updates");
        renderChangelog(items);
    } catch (e) {
        setError("changelogError", e.message);
    }
}

function renderChangelog(items) {
    const list = document.getElementById("changelogList");
    if (!list) return;
    list.innerHTML = "";

    items.forEach((u) => {
        const box = el("div", { class: "suggestion-item" });
        box.appendChild(el("div", { class: "suggestion-head" },
            el("span", { class: "username" }, u.title || "(untitled)"),
            el("span", { class: "badge accent" }, u.tag || "note"),
            el("span", { class: "suggestion-date" }, (u.created_at || "").replace("T", " "))
        ));
        if (u.body) box.appendChild(el("p", { class: "suggestion-what" }, u.body));
        box.appendChild(el("div", { class: "admin-actions", style: "justify-content:flex-start" },
            el("button", {
                type: "button",
                class: "btn btn-danger",
                title: "Remove this update from the public changelog",
                onclick: () => deleteChangelog(u.id),
            }, "Delete")
        ));
        list.appendChild(box);
    });
}

async function addChangelog(form) {
    const title = document.getElementById("changelogTitle")?.value.trim();
    const body = document.getElementById("changelogBody")?.value.trim();
    const tag = document.getElementById("changelogTag")?.value || "note";
    if (!title) return;

    const res = await api("/about/api/updates", { body: { title, body, tag } });
    if (!res.ok) {
        setError("changelogError", res.data.error || "Failed to publish");
        return;
    }

    document.getElementById("changelogTitle").value = "";
    const bodyEl = document.getElementById("changelogBody");
    if (bodyEl) bodyEl.value = "";
    setError("changelogError", "");
    toast("Changelog published");
    loadChangelog();
}

async function deleteChangelog(id) {
    if (!(await confirmDialog("Remove this update from the public changelog?", { danger: true }))) return;
    const res = await api(`/about/api/updates/${id}`, { method: "DELETE" });
    const data = res.data;
    if (!res.ok) { setError("changelogError", data.error || "Failed"); return; }
    toast("Update removed");
    loadChangelog();
}

/* ---------------------------------- settings (console password) ------ */

async function changeAdminPassword() {
    const current = document.getElementById("admin-pw-current")?.value;
    const next = document.getElementById("admin-pw-new")?.value;
    if (!current || !next) return;

    const res = await api("/admin/api/change_password", {
        body: { current_password: current, new_password: next },
    });
    const data = res.data;
    if (!res.ok || !data.success) {
        const err = document.getElementById("admin-pw-error");
        if (err) { err.hidden = false; err.textContent = data.error || "Request failed - see console"; }
        return;
    }

    // all console sessions were invalidated server-side - back to login
    const hint = document.getElementById("admin-pw-hint");
    if (hint) hint.textContent = "Password changed. One moment...";
    setTimeout(() => location.reload(), 1200);
}
