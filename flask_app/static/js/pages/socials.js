/* Socials page — friends + social groups. Two tabs over one API surface
   (window.SOCIALS_API). Shares the global .modal patterns and the events
   ui.js helpers (el, iconBtn, toast, confirmDialog). People render as
   tiles in a grid, groups as wide tiles; requests/pending stay as compact
   rows. Each person's avatar gets a hue derived from their name so a list
   is scannable at a glance. */
import { el, iconBtn, toast, openModal, closeModal, confirmDialog, initConfirm } from "./events/ui.js";

const BASE = window.SOCIALS_API || {};

async function api(url, options = {}) {
    const res = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (res.status === 401) {
        window.location.href = window.LOGIN_URL;
        throw new Error("Session expired — redirecting to login");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

const groupUrl = (id) => `${BASE.groups}/${id}`;
const groupMemberUrl = (id, mid) => `${BASE.groups}/${id}/members/${mid}`;

/* ── shared bits ───────────────────────────────────────────────────── */
const initials = (name) =>
    (name || "?").trim().slice(0, 2).toUpperCase();

/* stable hue per name — same person, same colour, every visit */
function hueFor(name) {
    let h = 0;
    for (const ch of name || "") h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
}

const avatar = (name) => {
    const node = el("span", "avatar-person", initials(name));
    node.style.setProperty("--hue", hueFor(name));
    node.setAttribute("aria-hidden", "true");
    return node;
};

const roleBadge = (role) =>
    el("span", "badge " + (role === "owner" ? "badge-accent"
        : role === "admin" ? "badge-info" : "badge-neutral"), role);

/* case-insensitive substring filter over a rendered list */
function applyFilter(list, query, attrName) {
    const q = query.trim().toLowerCase();
    for (const row of list.querySelectorAll(`[data-${attrName}]`)) {
        row.hidden = q && !row.dataset[attrName].toLowerCase().includes(q);
    }
}

/* hero counters — friends view and groups view load separately, so keep
   the last known numbers and re-render both from one place */
const counts = { friends: 0, requests: 0, groups: 0 };

function renderCounts() {
    for (const [key, id] of [["friends", "statFriends"], ["requests", "statRequests"],
                             ["groups", "statGroups"]]) {
        const node = document.getElementById(id);
        if (node) node.textContent = counts[key];
    }
}

/* ── tabs ──────────────────────────────────────────────────────────── */
function initTabs() {
    const nav = document.getElementById("socials-nav");
    if (!nav) return;
    const views = { friends: "friendsView", groups: "groupsView" };
    nav.querySelectorAll("[data-view]").forEach((tab) => {
        tab.onclick = () => {
            nav.querySelectorAll("[data-view]").forEach((t) => {
                t.classList.toggle("active", t === tab);
                t.setAttribute("aria-selected", String(t === tab));
            });
            for (const [key, id] of Object.entries(views)) {
                document.getElementById(id).hidden = key !== tab.dataset.view;
            }
            if (tab.dataset.view === "groups") loadGroups();
            else loadFriends();
        };
    });
}

/* ── friends ───────────────────────────────────────────────────────── */
async function loadFriends() {
    const data = await api(BASE.friends).catch((e) => {
        toast(e.message, "error");
        return { friends: [], incoming: [], outgoing: [] };
    });

    const incoming = document.getElementById("incomingList");
    const outgoing = document.getElementById("outgoingList");
    const friends = document.getElementById("friendsList");
    incoming.innerHTML = "";
    outgoing.innerHTML = "";
    friends.innerHTML = "";

    counts.friends = data.friends.length;
    counts.requests = data.incoming.length;
    renderCounts();

    const inBadge = document.getElementById("incomingBadge");
    inBadge.hidden = !data.incoming.length;
    inBadge.textContent = data.incoming.length;
    const outBadge = document.getElementById("friendsBadge");
    outBadge.hidden = !data.friends.length;
    outBadge.textContent = data.friends.length;
    document.getElementById("outgoingBlock").hidden = !data.outgoing.length;
    document.getElementById("requestsBlock").hidden = !data.incoming.length;

    for (const u of data.incoming) {
        const row = el("li", "socials-row");
        row.dataset.username = u.username;
        row.appendChild(avatar(u.username));
        const info = el("div", "socials-row-info");
        info.appendChild(el("span", "social-name", u.username));
        info.appendChild(el("span", "social-key", u.key));
        row.appendChild(info);
        const actions = el("div", "socials-row-actions");
        const accept = el("button", "btn btn-sm btn-primary", "Accept");
        accept.type = "button";
        accept.onclick = async () => {
            try {
                await api(`${BASE.friends}/${u.id}/accept`, { method: "POST" });
                toast(`Accepted ${u.username}`, "success");
                loadFriends();
            } catch (e) { toast(e.message, "error"); }
        };
        actions.appendChild(accept);
        const deny = el("button", "btn btn-sm btn-secondary", "Deny");
        deny.type = "button";
        deny.onclick = async () => {
            try {
                await api(`${BASE.friends}/${u.id}`, { method: "DELETE" });
                toast(`Denied ${u.username}`, "info");
                loadFriends();
            } catch (e) { toast(e.message, "error"); }
        };
        actions.appendChild(deny);
        row.appendChild(actions);
        incoming.appendChild(row);
    }

    for (const u of data.outgoing) {
        const row = el("li", "socials-row");
        row.dataset.username = u.username;
        row.appendChild(avatar(u.username));
        const info = el("div", "socials-row-info");
        info.appendChild(el("span", "social-name", u.username));
        info.appendChild(el("span", "badge badge-info", "Pending"));
        row.appendChild(info);
        const cancel = iconBtn("x", `Cancel request to ${u.username}`);
        cancel.onclick = async () => {
            try {
                await api(`${BASE.friends}/${u.id}`, { method: "DELETE" });
                toast("Request cancelled", "info");
                loadFriends();
            } catch (e) { toast(e.message, "error"); }
        };
        row.appendChild(cancel);
        outgoing.appendChild(row);
    }

    for (const u of data.friends) {
        const tile = el("li", "person-tile");
        tile.dataset.username = u.username;
        const top = el("div", "person-tile-top");
        top.appendChild(avatar(u.username));
        const info = el("div", "person-tile-info");
        info.appendChild(el("span", "social-name", u.username));
        info.appendChild(el("span", "social-key", u.key));
        top.appendChild(info);
        tile.appendChild(top);
        const actions = el("div", "person-tile-actions");
        const del = iconBtn("trash", `Remove ${u.username} as friend`);
        del.onclick = async () => {
            if (!(await confirmDialog(`Remove ${u.username} from your friends?`))) return;
            try {
                await api(`${BASE.friends}/${u.id}`, { method: "DELETE" });
                toast("Friend removed", "info");
                loadFriends();
            } catch (e) { toast(e.message, "error"); }
        };
        actions.appendChild(del);
        tile.appendChild(actions);
        friends.appendChild(tile);
    }
    if (!data.friends.length) {
        friends.appendChild(el("li", "module-empty",
            "No friends yet — send a request above."));
    }

    const q = filterInput("friendsFilter").value;
    applyFilter(incoming, q, "username");
    applyFilter(outgoing, q, "username");
    applyFilter(friends, q, "username");
}

const filterInput = (id) => document.getElementById(id);

function initFilters() {
    for (const [inputId, lists] of [
        ["friendsFilter", ["incomingList", "outgoingList", "friendsList"]],
        ["groupsFilter", ["groupReqList", "groupsList"]],
    ]) {
        const input = filterInput(inputId);
        if (!input) continue;
        input.addEventListener("input", () => {
            for (const listId of lists) {
                const listEl = document.getElementById(listId);
                if (listEl) applyFilter(listEl, input.value, "username");
            }
        });
    }
}

function initFriendAdd() {
    const input = document.getElementById("friendAddInput");
    const btn = document.getElementById("friendAddBtn");
    if (!input || !btn) return;
    const send = async () => {
        const lookup = input.value.trim();
        if (!lookup) { toast("Enter a username or key", "info"); return; }
        try {
            const data = await api(BASE.friends, {
                method: "POST",
                body: JSON.stringify({ username: lookup }),
            });
            toast(data.auto_accepted
                ? "They had already asked you — you're friends now"
                : "Request sent", "success");
            input.value = "";
            loadFriends();
        } catch (e) { toast(e.message, "error"); }
    };
    btn.onclick = send;
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); send(); }
    });
}

/* ── groups ────────────────────────────────────────────────────────── */
async function loadGroups() {
    const data = await api(BASE.groups).catch((e) => {
        toast(e.message, "error");
        return { groups: [], requests: [] };
    });

    const reqList = document.getElementById("groupReqList");
    const groupsList = document.getElementById("groupsList");
    reqList.innerHTML = "";
    groupsList.innerHTML = "";

    counts.groups = data.groups.length;
    renderCounts();

    const reqBadge = document.getElementById("groupReqBadge");
    reqBadge.hidden = !data.requests.length;
    reqBadge.textContent = data.requests.length;
    const gBadge = document.getElementById("groupsBadge");
    gBadge.hidden = !data.groups.length;
    gBadge.textContent = data.groups.length;
    document.getElementById("groupRequestsBlock").hidden = !data.requests.length;

    for (const r of data.requests) {
        const row = el("li", "socials-row");
        row.dataset.username = r.username;
        row.appendChild(avatar(r.username));
        const info = el("div", "socials-row-info");
        info.appendChild(el("span", "social-name", r.username));
        info.appendChild(el("span", "social-key", r.group_name));
        row.appendChild(info);
        const actions = el("div", "socials-row-actions");
        const accept = el("button", "btn btn-sm btn-primary", "Accept");
        accept.type = "button";
        accept.onclick = async () => {
            try {
                await api(`${BASE.groups}/${r.group_id}/requests/${r.id}/accept`,
                          { method: "POST" });
                toast(`Accepted ${r.username} into ${r.group_name}`, "success");
                loadGroups();
            } catch (e) { toast(e.message, "error"); }
        };
        const deny = el("button", "btn btn-sm btn-secondary", "Deny");
        deny.type = "button";
        deny.onclick = async () => {
            try {
                await api(`${BASE.groups}/${r.group_id}/requests/${r.id}/deny`,
                          { method: "POST" });
                toast("Request denied", "info");
                loadGroups();
            } catch (e) { toast(e.message, "error"); }
        };
        actions.append(accept, deny);
        row.appendChild(actions);
        reqList.appendChild(row);
    }

    for (const g of data.groups) {
        const tile = el("li", "group-tile");
        tile.dataset.username = g.name;
        const top = el("div", "group-tile-top");
        top.appendChild(avatar(g.name));
        const info = el("div", "group-tile-info");
        info.appendChild(el("span", "group-tile-name", g.name));
        if (g.description) info.appendChild(el("span", "group-tile-desc", g.description));
        top.appendChild(info);
        tile.appendChild(top);

        const meta = el("div", "group-tile-meta");
        if (g.my_status === "pending") {
            meta.appendChild(el("span", "badge badge-info", "Pending"));
        } else if (g.my_role) {
            meta.appendChild(roleBadge(g.my_role));
        }
        meta.appendChild(el("span", "group-tile-count",
            `${g.member_count} member${g.member_count === 1 ? "" : "s"}`));

        // the whole tile is the target; the Open button keeps it keyboard-
        // reachable and bubbles into the same handler
        const open = el("button", "btn btn-sm btn-secondary group-tile-open", "Open");
        open.type = "button";
        meta.appendChild(open);
        tile.appendChild(meta);
        tile.onclick = () => openGroupDetail(g);
        groupsList.appendChild(tile);
    }
    if (!data.groups.length) {
        groupsList.appendChild(el("li", "module-empty",
            "No groups yet — create one or join with a code."));
    }

    applyFilter(reqList, filterInput("groupsFilter").value, "username");
    applyFilter(groupsList, filterInput("groupsFilter").value, "username");
}

/* ── group detail modal ────────────────────────────────────────────── */
let detailGroup = null;   // the group object openGroupDetail was called with

async function openGroupDetail(g) {
    detailGroup = g;
    const title = document.getElementById("groupDetailTitle");
    const body = document.getElementById("groupDetailBody");
    title.textContent = g.name;
    body.innerHTML = "";
    openModal("groupDetailBackdrop");

    let detail;
    try {
        detail = await api(groupUrl(g.id));
    } catch (e) {
        body.appendChild(el("p", "module-empty", e.message));
        return;
    }
    const { group, members } = detail;
    const me = members.find((m) => m.user_id === window.EVENT_USER_ID);
    const amAdmin = me && me.role === "admin";
    const amOwner = me && me.role === "owner";
    const amAdminish = Boolean(amAdmin || amOwner);

    // join code + link (admins/owners only — the server omits it otherwise)
    if (group.join_code) {
        const codeBox = el("div", "group-code-box");
        const label = el("p", "hint", "Join code — share it, or the link below:");
        codeBox.appendChild(label);
        const codeRow = el("div", "group-code-row");
        codeRow.appendChild(el("span", "mono group-code", group.join_code));
        const copyLink = el("button", "btn btn-sm btn-secondary", "Copy link");
        copyLink.type = "button";
        const link = `${window.location.origin}${BASE.baseUrl}join/${group.join_code}`;
        copyLink.onclick = async () => {
            try {
                await navigator.clipboard.writeText(link);
                toast("Link copied", "success");
            } catch {
                window.prompt("Copy this link:", link);
            }
        };
        codeRow.appendChild(copyLink);
        const rotate = iconBtn("refresh", "Rotate code — old code/link stops working");
        rotate.onclick = async () => {
            if (!(await confirmDialog(
                "Rotate the join code? The current code and link stop working immediately."
            ))) return;
            try {
                const data = await api(`${BASE.groups}/${g.id}/regenerate-code`,
                                       { method: "POST" });
                toast("Code rotated", "success");
                if (data.join_code) {
                    codeRow.querySelector(".group-code").textContent = data.join_code;
                    detailGroup = Object.assign({}, g, { join_code: data.join_code });
                }
            } catch (e2) { toast(e2.message, "error"); }
        };
        codeRow.appendChild(rotate);
        codeBox.appendChild(codeRow);
        body.appendChild(codeBox);
    }

    const active = members.filter((m) => m.status === "active");
    const pending = members.filter((m) => m.status === "pending");

    const list = el("ul", "socials-list group-member-list");
    for (const m of active) {
        const row = el("li", "socials-row");
        row.dataset.username = m.username;
        row.appendChild(avatar(m.username));
        const info = el("div", "socials-row-info");
        info.appendChild(el("span", "social-name", m.username));
        row.appendChild(info);
        const meta = el("div", "socials-row-actions");
        meta.appendChild(roleBadge(m.role));
        const actions = el("div", "socials-row-actions");
        if (amOwner && m.role !== "owner") {
            const toggleRole = el("button", "btn btn-sm btn-secondary",
                m.role === "admin" ? "Demote" : "Make admin");
            toggleRole.type = "button";
            toggleRole.onclick = async () => {
                try {
                    await api(groupMemberUrl(g.id, m.id), {
                        method: "PATCH",
                        body: JSON.stringify({ role: m.role === "admin" ? "member" : "admin" }),
                    });
                    openGroupDetail(g);
                } catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(toggleRole);
            if (m.role === "member") {
                const transfer = el("button", "btn btn-sm btn-secondary", "Transfer");
                transfer.type = "button";
                transfer.onclick = async () => {
                    if (!(await confirmDialog(`Make ${m.username} the owner? You become an admin.`))) return;
                    try {
                        await api(`${BASE.groups}/${g.id}/transfer`, {
                            method: "POST",
                            body: JSON.stringify({ member_id: m.id }),
                        });
                        toast("Ownership transferred", "success");
                        loadGroups();
                        openGroupDetail(g);
                    } catch (e) { toast(e.message, "error"); }
                };
                actions.appendChild(transfer);
            }
        }
        if (amAdminish && m.role !== "owner" && m.user_id !== window.EVENT_USER_ID) {
            const remove = iconBtn("x", `Remove ${m.username}`);
            remove.onclick = async () => {
                if (!(await confirmDialog(`Remove ${m.username} from the group?`))) return;
                try {
                    await api(groupMemberUrl(g.id, m.id), { method: "DELETE" });
                    openGroupDetail(g);
                } catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(remove);
        }
        meta.appendChild(actions);
        row.appendChild(meta);
        list.appendChild(row);
    }
    if (!active.length) {
        list.appendChild(el("li", "module-empty", "No members yet."));
    }
    body.appendChild(list);

    // pending members: admins see accept/deny, everyone else sees nothing
    // (the server withholds pending rows from non-admins' awareness anyway
    // — pending are listed for all readers of the detail, so gate the UI)
    if (pending.length) {
        const reqHead = el("h3", "socials-block-title", "Join requests");
        body.appendChild(reqHead);
        const reqList = el("ul", "socials-list");
        for (const m of pending) {
            const row = el("li", "socials-row");
            row.dataset.username = m.username;
            row.appendChild(avatar(m.username));
            const info = el("div", "socials-row-info");
            info.appendChild(el("span", "social-name", m.username));
            row.appendChild(info);
            const actions = el("div", "socials-row-actions");
            if (amAdminish) {
                const accept = el("button", "btn btn-sm btn-primary", "Accept");
                accept.type = "button";
                accept.onclick = async () => {
                    try {
                        await api(`${BASE.groups}/${g.id}/requests/${m.id}/accept`,
                                  { method: "POST" });
                        openGroupDetail(g);
                    } catch (e) { toast(e.message, "error"); }
                };
                const deny = el("button", "btn btn-sm btn-secondary", "Deny");
                deny.type = "button";
                deny.onclick = async () => {
                    try {
                        await api(`${BASE.groups}/${g.id}/requests/${m.id}/deny`,
                                  { method: "POST" });
                        openGroupDetail(g);
                    } catch (e) { toast(e.message, "error"); }
                };
                actions.append(accept, deny);
            } else {
                actions.appendChild(el("span", "badge badge-info", "Pending"));
            }
            row.appendChild(actions);
            reqList.appendChild(row);
        }
        body.appendChild(reqList);
    }

    // admins add members straight from their friends list
    if (amAdminish) {
        const addRow = el("div", "socials-row-actions");
        const addBtn = el("button", "btn btn-sm btn-secondary", "Add members");
        addBtn.type = "button";
        addBtn.onclick = () => openGroupPicker(g);
        addRow.appendChild(addBtn);
        body.appendChild(addRow);
    }

    // my own escape hatches
    const mine = el("div", "socials-row-actions");
    if (me && me.role !== "owner") {
        const leave = el("button", "btn btn-sm btn-danger", "Leave group");
        leave.type = "button";
        leave.onclick = async () => {
            if (!(await confirmDialog(`Leave ${group.name}?`))) return;
            try {
                await api(`${BASE.groups}/${g.id}/leave`, { method: "POST" });
                closeModal("groupDetailBackdrop");
                toast("Left the group", "info");
                loadGroups();
            } catch (e) { toast(e.message, "error"); }
        };
        mine.appendChild(leave);
    }
    if (amOwner) {
        const del = el("button", "btn btn-sm btn-danger", "Delete group");
        del.type = "button";
        del.onclick = async () => {
            if (!(await confirmDialog(`Delete ${group.name} and remove all its members? This cannot be undone.`))) return;
            try {
                await api(groupUrl(g.id), { method: "DELETE" });
                closeModal("groupDetailBackdrop");
                toast("Group deleted", "info");
                loadGroups();
            } catch (e) { toast(e.message, "error"); }
        };
        mine.appendChild(del);
    }
    if (mine.children.length) body.appendChild(mine);
}

/* ── friend picker (group add-member) — checkbox list of accepted
   friends + add by key/username. Posts the batch endpoint. ──────────── */
let pickerGroup = null;

function openGroupPicker(g) {
    pickerGroup = g;
    const list = document.getElementById("pickerList");
    const search = document.getElementById("pickerSearch");
    const keyInput = document.getElementById("pickerKey");
    openModal("pickerBackdrop");

    let friends = [];
    const selected = new Set();

    const render = () => {
        const query = search.value.trim().toLowerCase();
        list.innerHTML = "";
        const shown = friends.filter((f) =>
            !query || f.username.toLowerCase().includes(query));
        if (!shown.length) {
            list.appendChild(el("p", "module-empty",
                friends.length ? "No friends match." : "No friends yet."));
        }
        for (const friend of shown) {
            const row = el("label", "picker-row");
            const check = el("input");
            check.type = "checkbox";
            check.checked = selected.has(friend.id);
            check.onchange = () => {
                if (check.checked) selected.add(friend.id);
                else selected.delete(friend.id);
            };
            row.append(check, avatar(friend.username),
                       el("span", "picker-name", friend.username),
                       el("span", "picker-key mono", friend.key));
            list.appendChild(row);
        }
    };

    search.value = "";
    keyInput.value = "";
    search.oninput = render;
    render();

    api(BASE.friends)
        .then((data) => { friends = data.friends || []; render(); })
        .catch((e) => toast(e.message, "error"));

    document.getElementById("pickerAddBtn").onclick = async () => {
        if (!selected.size) { toast("Select at least one friend", "info"); return; }
        try {
            const data = await api(`${BASE.groups}/${pickerGroup.id}/members`, {
                method: "POST",
                body: JSON.stringify({ user_ids: [...selected] }),
            });
            const added = data.added ?? selected.size;
            const skipped = data.skipped?.length ?? 0;
            toast(skipped
                ? `${added} added, ${skipped} already in the group`
                : `${added} member${added === 1 ? "" : "s"} added`, "success");
            closeModal("pickerBackdrop");
            openGroupDetail(pickerGroup);
            loadGroups();
        } catch (e) { toast(e.message, "error"); }
    };

    document.getElementById("pickerKeyBtn").onclick = async () => {
        const lookup = keyInput.value.trim();
        if (!lookup) return;
        try {
            await api(`${BASE.groups}/${pickerGroup.id}/members/by-key`, {
                method: "POST",
                body: JSON.stringify({ username: lookup }),
            });
            toast("Member added", "success");
            keyInput.value = "";
            closeModal("pickerBackdrop");
            openGroupDetail(pickerGroup);
            loadGroups();
        } catch (e) { toast(e.message, "error"); }
    };
}

function initPicker() {
    const backdrop = document.getElementById("pickerBackdrop");
    if (!backdrop) return;
    backdrop.querySelectorAll("[data-action='close-picker']")
        .forEach((b) => { b.onclick = () => closeModal("pickerBackdrop"); });
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal("pickerBackdrop");
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.classList.contains("open")) {
            closeModal("pickerBackdrop");
        }
    });
}

function initGroupCreate() {
    const btn = document.getElementById("newGroupBtn");
    const backdrop = document.getElementById("groupModalBackdrop");
    if (!btn || !backdrop) return;

    btn.onclick = () => openModal("groupModalBackdrop");
    backdrop.querySelectorAll("[data-action='close-group-modal']")
        .forEach((b) => { b.onclick = () => closeModal("groupModalBackdrop"); });
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal("groupModalBackdrop");
    });

    document.getElementById("groupForm").onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById("groupName").value.trim();
        const description = document.getElementById("groupDescription").value.trim();
        if (!name) { toast("Name required", "info"); return; }
        try {
            const data = await api(BASE.groups, {
                method: "POST",
                body: JSON.stringify({ name, description }),
            });
            closeModal("groupModalBackdrop");
            toast("Group created — share the code from its page", "success");
            document.getElementById("groupName").value = "";
            document.getElementById("groupDescription").value = "";
            await loadGroups();
            if (data.group) openGroupDetail(data.group);
        } catch (e2) { toast(e2.message, "error"); }
    };
}

function initJoinByCode() {
    const input = document.getElementById("joinCodeInput");
    const btn = document.getElementById("joinCodeBtn");
    if (!input || !btn) return;
    const join = async () => {
        const code = input.value.trim().toUpperCase();
        if (!code) { toast("Enter a code", "info"); return; }
        try {
            await api(`${BASE.groups}/join`, {
                method: "POST",
                body: JSON.stringify({ code }),
            });
            toast("Request sent — the group's admins will confirm", "success");
            input.value = "";
            loadGroups();
        } catch (e) { toast(e.message, "error"); }
    };
    btn.onclick = join;
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); join(); }
    });
}

const detailBackdrop = document.getElementById("groupDetailBackdrop");
if (detailBackdrop) {
    detailBackdrop.querySelectorAll("[data-action='close-group-detail']")
        .forEach((b) => { b.onclick = () => closeModal("groupDetailBackdrop"); });
    detailBackdrop.addEventListener("click", (e) => {
        if (e.target === detailBackdrop) closeModal("groupDetailBackdrop");
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal("groupDetailBackdrop");
    });
}

initConfirm();
initTabs();
initFilters();
initFriendAdd();
initGroupCreate();
initJoinByCode();
initPicker();
renderCounts();
if (document.getElementById("friendAddBtn")) {
    loadFriends();
    loadGroups();   // the hidden view still feeds the hero counters
}
