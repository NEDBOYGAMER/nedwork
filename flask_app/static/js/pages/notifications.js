/* Notifications inbox — the newest 50 notifications with the action the
   viewer most likely wants next to each one (accept a friend request,
   approve a group join, open the event, open the task). Actions come from
   the API per row (`action`) and are derived from live state, so a stale
   row never shows a dead button. */

import { NOTIFICATION_TYPES, relativeTime } from "../components/notifications.js";
import { el, icon, toast } from "./events/ui.js";

const API = window.INBOX_API || {};
const POLL_MS = 60_000;

let items = [];
let filter = "all";

const listEl = document.getElementById("inboxList");
const markAllBtn = document.getElementById("markAllBtn");

async function api(url, options = {}) {
    const res = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

const eventUrl = (id) => API.event.replace("/0/", `/${id}/`);
const friendAcceptUrl = (id) => API.acceptFriend.replace("/0/", `/${id}/`);
const groupRequestUrl = (gid, mid, action = "accept") =>
    API.groupRequest.replace("/0/", `/${gid}`).replace("/0/", `/${mid}`)
        .replace("/accept", `/${action}`);

/* ── actions ───────────────────────────────────────────────────────── */

// Each action runs against the live API, then re-reads the list so the
// row's action disappears when it no longer applies.
const actionRunners = {
    async friend_request(a) {
        await api(friendAcceptUrl(a.user_id), { method: "POST" });
        toast("Friend request accepted", "success");
    },
    async group_request(a, accept) {
        await api(groupRequestUrl(a.group_id, a.member_id, accept ? "accept" : "deny"),
                  { method: "POST" });
        toast(accept ? "Joined — request approved" : "Request denied",
              accept ? "success" : "info");
    },
    async event(a) {
        window.location.href = eventUrl(a.event_id);
    },
    async task(a) {
        window.location.href = `${API.tasks}#task=${a.task_id}`;
    },
    async tierforge(a) {
        window.location.href = `/apps/tierforge?s=${a.session_token}`;
    },
};

function actionButtons(n) {
    const a = n.action;
    if (!a) return [];

    if (a.kind === "friend_request") {
        return [{ label: "Accept friend", primary: true,
                  run: () => actionRunners.friend_request(a) }];
    }
    if (a.kind === "group_request") {
        return [
            { label: "Approve", primary: true, run: () => actionRunners.group_request(a, true) },
            { label: "Deny", run: () => actionRunners.group_request(a, false) },
        ];
    }
    if (a.kind === "event") {
        return [{ label: "View event", primary: true, run: () => actionRunners.event(a) }];
    }
    if (a.kind === "task") {
        return [{ label: "View task", primary: true, run: () => actionRunners.task(a) }];
    }
    if (a.kind === "social") {
        return [{ label: "Open Socials", primary: false,
                  run: () => { window.location.href = API.socials; } }];
    }
    if (a.kind === "tierforge") {
        return [{ label: "Join session", primary: true,
                  run: () => actionRunners.tierforge(a) }];
    }
    return [];
}

/* ── rendering ─────────────────────────────────────────────────────── */

function matchesFilter(n) {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    const slug = NOTIFICATION_TYPES[n.type]?.slug;
    return filter === "message" ? slug === "message" : slug === filter;
}

function render() {
    listEl.innerHTML = "";

    const visible = items.filter(matchesFilter);
    const unread = items.filter((n) => !n.read).length;
    markAllBtn.hidden = unread === 0;

    for (const n of visible) {
        const row = el("li", "inbox-item");
        row.classList.toggle("is-unread", !n.read);
        row.dataset.type = n.type;

        const meta = NOTIFICATION_TYPES[n.type];

        const dot = el("span", `notification-dot dot-${meta?.slug || "system"}`);
        dot.setAttribute("aria-hidden", "true");

        const body = el("div", "inbox-body");
        const head = el("div", "inbox-row");
        head.appendChild(el("span", "inbox-category", meta?.label || n.type));
        head.appendChild(el("span", "inbox-time", relativeTime(new Date(n.created_at))));
        body.append(head, el("p", "inbox-message", meta
            ? meta.message(n.payload || {})
            : n.payload?.title || n.type));
        body.appendChild(el("div", "inbox-actions"));
        for (const b of actionButtons(n)) {
            const btn = el("button", `btn btn-sm ${b.primary ? "btn-primary" : "btn-secondary"}`, b.label);
            btn.type = "button";
            btn.addEventListener("click", async () => {
                btn.disabled = true;
                try {
                    await b.run();
                    await markOne(n.id);   // acting on it settles it
                    await load();
                } catch (err) {
                    toast(err.message, "error");
                    btn.disabled = false;
                }
            });
            body.querySelector(".inbox-actions").appendChild(btn);
        }

        row.append(dot, body);

        if (!n.read) {
            const markBtn = el("button", "inbox-mark", "Mark read");
            markBtn.type = "button";
            markBtn.setAttribute("aria-label", "Mark read");
            markBtn.addEventListener("click", () => markOne(n.id));
            row.appendChild(markBtn);
        }

        if (!n.read) {
            row.addEventListener("click", (e) => {
                if (e.target.closest("button")) return;
                markOne(n.id);
            });
        }

        listEl.appendChild(row);
    }

    if (!visible.length) {
        const empty = el("li", "inbox-empty");
        empty.appendChild(icon("bell", "icon inbox-empty-icon"));
        empty.appendChild(el("p", null, filter === "all"
            ? "You're all caught up"
            : "Nothing here — try another filter."));
        listEl.appendChild(empty);
    }
}

/* ── data ──────────────────────────────────────────────────────────── */

async function load() {
    try {
        const data = await api(API.list);
        items = data.notifications || [];
        // Opening the inbox counts as "seen": remember the count the dot
        // should be compared against (it reappears when more arrive).
        syncDot(data.unread || 0);
    } catch (err) {
        items = [];
        toast(err.message, "error");
    }
    render();
}

async function markOne(id) {
    const n = items.find((x) => x.id === id);
    if (n) n.read = true;
    render();
    try {
        const { unread } = await api(API.read, {
            method: "POST", body: JSON.stringify({ ids: [id] }) });
        syncDot(unread);
    } catch { /* the local state already reflects it */ }
}

async function markAll() {
    items.forEach((n) => { n.read = true; });
    render();
    try {
        const { unread } = await api(API.read, {
            method: "POST", body: JSON.stringify({ all: true }) });
        syncDot(unread);
    } catch { /* local state already reflects it */ }
}

/* the sidenav dot polls every minute; opening/reading here updates it */
function syncDot(unread) {
    localStorage.setItem("notifSeenCount", String(unread));
    const dot = document.getElementById("notifications-dot");
    if (dot) dot.hidden = true;
}

/* ── boot ──────────────────────────────────────────────────────────── */

document.getElementById("inbox-nav")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-filter]");
    if (!tab) return;
    filter = tab.dataset.filter;
    for (const t of document.querySelectorAll("#inbox-nav [data-filter]")) {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
    }
    render();
});

markAllBtn.addEventListener("click", markAll);

load();
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
