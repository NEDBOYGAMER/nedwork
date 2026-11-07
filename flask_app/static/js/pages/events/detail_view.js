/* View mode (§1) — /events/<id>/. Identical for host and attendees
   (same layout, same interactions); the host sees a quiet Edit pill that
   jumps to /events/<id>/edit/. Content sections (bring list, votes,
   ride seats) are operated here — settings live in edit mode only.

   Page anatomy (2026-11 rework — "one page, not a stack of cards"):
     event-hero     full-bleed masthead spanning the viewport; the Image
                    module's picture sits BEHIND the event title (poster
                    treatment). Without an image it's a quiet band.
     event-hero-desc   the Description module as a muted poster caption
                    inside the hero, bottom-right of the title.
     event-info-row location + members side by side near the top (both
                    are info, not interactive; location only when
                    activated). Single-orphan falls back to a plain
                    section.
     event-main     the member-operated sections (pick a date, what to
                    bring, rides) as the host's saved order has it —
                    separated by hairlines, never boxed as cards. Section
                    labels speak the event's language ("What to bring"),
                    not the host's module logic ("Bring list").
     event-chat     the conversation pinned to the page bottom — never a
                   reorderable card. */
import { el, evIcon, statusBadge, fmtDate, countdown, toast, confirmDialog } from "./ui.js";
import { MODULE_META, MODULES } from "./modules/index.js";
import { startPolling } from "./poller.js";
import { joinUrl, leaveUrl, api } from "./api.js";

let state = null;          // last server snapshot
let poller = null;

export function renderDetailView(container, eventId, opts = {}) {
    container.innerHTML = "";
    state = null;

    const wrap = el("div", "event-detail event-detail-view");
    container.appendChild(wrap);

    poller?.stop();
    poller = startPolling(() => eventId, (snap, why) => {
        applySnapshot(wrap, snap, why);
    }, (e) => {
        if (String(e.message).includes("not found")) {
            // archived or lost access — back to the list
            poller?.stop();
            window.location.href = window.EVENTS_API.baseUrl;
        }
    });

    // if the URL carries an invite token, join first
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (token) {
        api(joinUrl(eventId), {
            method: "POST",
            body: JSON.stringify({ token }),
        })
            .then(() => {
                window.history.replaceState(null, "", window.location.pathname);
                toast("Welcome — you're in", "success");
            })
            .catch((e) => toast(e.message, "error"));
    }
    return wrap;
}

export function stopPolling() {
    poller?.stop();
    poller = null;
}

export async function refreshDetail() {
    poller?.refresh();
}

function applySnapshot(wrap, snap, why) {
    const prev = state;
    state = snap;
    draw(wrap, prev, why);
}

function draw(wrap, prev, why) {
    wrap.innerHTML = "";
    const event = state.event;
    const amHost = event.is_host;
    const myMemberId = event.my_member_id;
    const me = (state.members || []).find((m) => m.id === myMemberId);

    // (the prominent back button lives in the template header, §6)

    // draft / archived banners — above the hero, aligned to the page column
    if (event.status === "draft" || event.status === "archived") {
        const alerts = el("div", "event-detail-alerts");
        if (event.status === "draft") {
            const banner = el("div", "alert alert-warning");
            banner.appendChild(el("span", null,
                "Draft — only you can see this event. Publish from Edit when it's ready."));
            alerts.appendChild(banner);
        }
        if (event.status === "archived") {
            const banner = el("div", "alert alert-neutral");
            banner.appendChild(el("span", null,
                "Archived — members no longer have access."));
            alerts.appendChild(banner);
        }
        wrap.appendChild(alerts);
    }

    const sectionCtx = (module) => ({
        module, event, state, isHost: amHost, me,
        refresh: () => poller?.refresh(),
    });

    // the description module is gone — the subtitle is the event's short
    // description and already renders in the hero under the title
    wrap.appendChild(renderHero(event, amHost));

    // �"?�"? announcement: a yellow banner right under the title, not a
    // section. Hidden once it expires or the event date has passed.
    const annBanner = announcementBanner(event, state);
    if (annBanner) wrap.appendChild(annBanner);

    // �"?�"? main column: info row first, then the member-operated sections
    // in the host's saved order
    const main = el("div", "event-main");
    const modules = (state.modules || [])
        .filter((m) => !m.hidden || amHost)
        .filter((m) => m.type !== "image" && m.type !== "chat" &&
                       m.type !== "description" &&
                       m.type !== "announcement");

    // info row: location + members side by side (location only when the
    // module is activated); with only one of them it stays a plain section
    const location = modules.find((m) => m.type === "location");
    const members = modules.find((m) => m.type === "members");
    const locSec = location ? eventSection(location, sectionCtx(location)) : null;
    const memSec = members ? eventSection(members, sectionCtx(members)) : null;
    if (locSec && memSec) {
        const infoRow = el("div", "event-info-row");
        infoRow.appendChild(locSec);
        infoRow.appendChild(memSec);
        main.appendChild(infoRow);
    } else if (memSec) {
        main.appendChild(memSec);
    } else if (locSec) {
        main.appendChild(locSec);
    }

    // interactive sections (doodle, bring, rides) keep the saved order
    const stack = el("div", "event-sections");
    for (const module of modules) {
        if (module.type === "location" || module.type === "members") continue;
        const sec = eventSection(module, sectionCtx(module));
        if (sec) stack.appendChild(sec);
    }
    main.appendChild(stack);

    // my duties footer
    const duties = myDuties(state, me);
    if (duties) main.appendChild(duties);

    // membership actions — a quiet page-bottom band before chat (the
    // Leave button was buried in the members column before)
    const memberActions = renderMemberActions(event, state, me,
        () => poller?.refresh());
    if (memberActions) main.appendChild(memberActions);
    wrap.appendChild(main);

    // ── chat pinned to the page bottom (never a reorderable card)
    const chatModule = (state.modules || [])
        .find((m) => m.type === "chat" && (!m.hidden || amHost));
    if (chatModule) {
        wrap.appendChild(chatSection(chatModule, {
            module: chatModule, event, state, isHost: amHost, me,
            refresh: () => poller?.refresh(),
        }));
    }
}

/* -- hero ---------------------------------------------------------------- */

function renderHero(event, amHost) {
    // the Image module's picture becomes the masthead — it renders behind
    // the title; the module itself no longer appears in the stack
    const imgModule = (state.modules || []).find((m) => m.type === "image");
    const config = imgModule?.config || {};
    const hasImage = !!config.url;

    const hero = el("header", "event-hero event-header");
    // no image: render a plain masthead instead of an empty gray band
    if (!hasImage) hero.classList.add("event-hero-plain");
    if (hasImage) {
        hero.classList.add("event-hero-image");
        const media = el("div", "event-hero-media");
        const img = el("img", "event-hero-img");
        img.src = config.url;
        img.alt = event.title || "";
        media.appendChild(img);
        hero.appendChild(media);
    }

    const scrim = el("div", "event-hero-scrim");
    const inner = el("div", "event-hero-inner");
    // big name + subtitle on the left; the date block rides at the
    // bottom-right of the same line (bottom edge, not mid-title)
    const titleLine = el("div", "event-head-line");
    const headMain = el("div", "event-head-main");
    headMain.appendChild(el("h1", "event-title", event.title));
    if (event.subtitle) {
        headMain.appendChild(el("p", "event-subtitle", event.subtitle));
    }
    titleLine.appendChild(headMain);
    const dateBox = el("div", "event-date-box");
    dateBox.appendChild(el("span", "event-date", fmtDate(event.event_date)));
    const cd = countdown(event.event_date);
    if (cd) dateBox.appendChild(el("span", "event-countdown", cd));
    titleLine.appendChild(dateBox);
    inner.appendChild(titleLine);
    // "Published" is the normal state — no tag in the title bar for it
    if (event.status !== "published") {
        const meta = el("div", "event-head-meta");
        meta.appendChild(statusBadge(event.status));
        inner.appendChild(meta);
    }

    scrim.appendChild(inner);

    hero.appendChild(scrim);

    if (amHost && event.status !== "archived") {
        hero.classList.add("event-hero-host"); // title reserves room for the button
        // quiet glass pill — present for the host, invisible furniture for
        // everyone else (the attendees never see it)
        const editBtn = el("a", "event-edit-btn");
        editBtn.href = `${window.EVENTS_API.baseUrl}${event.id}/edit/`;
        editBtn.appendChild(document.createTextNode("Edit"));
        hero.appendChild(editBtn);
    }
    return hero;
}

/* -- announcement banner --------------------------------------------------- */
/* The announcement is not a section — it renders as a yellow band right
   under the title (full width). Active while it has content and neither
   its own expiry nor the event date has passed. */
function announcementBanner(event, state) {
    const module = (state.modules || []).find((m) => m.type === "announcement");
    if (!module) return null;
    const config = module.config || {};
    const title = (config.title || "").trim();
    const text = (config.text || "").trim();
    if (!title && !text) return null;

    const now = Date.now();
    const expires = config.expires_at ? new Date(config.expires_at).getTime() : Infinity;
    const eventAt = event.event_date ? new Date(event.event_date).getTime() : Infinity;
    if (now >= expires || now >= eventAt) return null;

    const banner = el("div", "event-announcement");
    if (title) banner.appendChild(el("h3", "event-announcement-title", title));
    if (text) banner.appendChild(el("p", "event-announcement-text", text));
    return banner;
}

/* -- event sections ------------------------------------------------------- */

/* Attendee-facing labels: the page speaks the event's language ("What to
   bring"), not the host's module logic ("Bring list"). The host learns
   the module names in edit mode — that's the only place they exist. */
const SECTION_LABELS = {
    members:     "Who's coming",
    doodle:      "Pick a date",
    bring:       "What to bring",
    rides:       "Getting there",
    location:    "Where",
    chat:        "Chat",
};

function eventSection(module, ctx) {
    const meta = MODULE_META[module.type] || { label: module.type };
    const label = SECTION_LABELS[module.type] || meta.label;
    const section = el("section", "event-section");
    if (module.hidden) section.classList.add("module-hidden");

    const head = el("header", "event-section-head");
    const title = el("h2", "event-section-title");
    title.appendChild(evIcon(module.type));
    title.appendChild(el("span", null, label));
    head.appendChild(title);
    section.appendChild(head);

    const body = el("div", "event-section-body");
    const renderer = MODULES[module.type];
    if (renderer) {
        renderer.render(body, ctx);
    } else {
        body.appendChild(el("p", "module-empty", "Unknown module."));
    }
    // an empty module gets no section at all — no orphaned title. Only
    // hidden elements (doodle's empty-state hook) don't count as content.
    if (![...body.children].some((n) => !n.hidden)) return null;
    section.appendChild(body);
    return section;
}

/* -- membership actions, page bottom ------------------------------------- */

function renderMemberActions(event, state, me, refresh) {
    // hosts transfer the role from the members section; only members
    // get the page-bottom leave action
    if (!me || event.status === "archived" || me.role !== "member") return null;
    const section = el("div", "event-member-actions");
    const leaveBtn = el("button", "btn btn-secondary", "Leave event");
    leaveBtn.type = "button";
    leaveBtn.onclick = async () => {
        if (!(await confirmDialog(
                "Leave this event? Your claims and ride seats are " +
                "released."))) return;
        try {
            await api(leaveUrl(event.id), { method: "POST" });
            window.location.href = window.EVENTS_API.baseUrl;
        } catch (e) { toast(e.message, "error"); }
    };
    section.appendChild(leaveBtn);
    return section;
}

/* -- chat, pinned to the page bottom ------------------------------------- */

function chatSection(module, ctx) {
    const section = el("section", "event-chat");
    const inner = el("div", "event-chat-inner");

    const head = el("header", "event-section-head event-chat-head");
    const title = el("h2", "event-section-title");
    title.appendChild(evIcon("chat"));
    title.appendChild(el("span", null, "Chat"));
    head.appendChild(title);
    inner.appendChild(head);

    const body = el("div", "event-section-body");
    MODULES.chat.render(body, ctx);
    inner.appendChild(body);

    section.appendChild(inner);
    return section;
}

/* -- my duties rollup ----------------------------------------------------- */

function myDuties(state, me) {
    if (!me) return null;
    const duties = [];
    const event = state.event;

    // doodle: vote pending (module exists, I haven't voted, no date set)
    const doodle = (state.modules || []).find((m) => m.type === "doodle" && !m.hidden);
    if (doodle && !event.event_date) {
        const voted = (state.votes || []).some((v) => v.user.id === window.EVENT_USER_ID);
        if (!voted) duties.push("Vote on the date");
    }
    // bring: something fully unclaimed that I could take? (only hint at open claims)
    const bring = (state.modules || []).find((m) => m.type === "bring" && !m.hidden);
    if (bring) {
        const myClaims = new Set();
        for (const item of state.items || []) {
            for (const claim of item.claims || []) {
                if (claim.member_id === me.id) myClaims.add(item.id);
            }
        }
        const open = (state.items || []).some((i) => i.claimed_qty < i.target_qty);
        if (open && !myClaims.size) duties.push("Claim something to bring");
    }
    // rides: I need a ride and have no seat
    const rides = (state.modules || []).find((m) => m.type === "rides" && !m.hidden);
    if (rides && me.needs_ride) {
        const seated = (state.rides || []).some((r) =>
            (r.passengers || []).some((p) => p.member_id === me.id));
        const driving = (state.rides || []).some(
            (r) => r.driver?.member_id === me.id);
        if (!seated && !driving) duties.push("Find a ride or offer one");
    }
    if (!duties.length) return null;

    const section = el("div", "event-section duties-section");
    const head = el("header", "event-section-head");
    const title = el("h2", "event-section-title");
    title.appendChild(evIcon("duty"));
    title.appendChild(el("span", null, "Your to-dos for this event"));
    head.appendChild(title);
    section.appendChild(head);
    const list = el("ul", "duties-list");
    for (const duty of duties) list.appendChild(el("li", null, duty));
    section.appendChild(list);
    return section;
}
