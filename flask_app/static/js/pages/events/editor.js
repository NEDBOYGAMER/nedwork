/* Edit mode (§1) — /events/<id>/edit/, host only. Modules render as
   config cards (settings only, no live content interaction); a sticky
   bottom bar holds Cancel + Save changes (drafts also get "publish after
   saving"). Reordering via drag (desktop) or per-card up/down arrows
   (touch — HTML5 DnD never fires on phones); Members and Title
   are fixed. Saving PATCHes event + module configs, applies reorder,
   then returns to view mode. */
import { el, icon, toast, confirmDialog } from "./ui.js";
import { MODULE_META, MODULES } from "./modules/index.js";
import { startPolling } from "./poller.js";
import {
    eventUrl, moduleUrl, modulesUrl, reorderUrl, publishUrl, unpublishUrl,
    archiveUrl, optionsUrl, api,
} from "./api.js";

let state = null;
let poller = null;
let draft = null;   // kept across redraws — reordering must not wipe edits

export function renderEditor(container, eventId) {
    container.innerHTML = "";
    state = null;
    draft = null;

    const wrap = el("div", "event-detail event-edit");
    container.appendChild(wrap);

    poller?.stop();
    poller = startPolling(() => eventId, (snap) => {
        state = snap;
        if (!draft) {
            // seed once from the server snapshot; later redraws (reorder,
            // add-module) reuse it so unsaved edits survive
            draft = {
                title: snap.event.title,
                subtitle: snap.event.subtitle,
                event_date: snap.event.event_date,
                date_source: snap.event.date_source,
            };
        }
        draw(wrap, eventId, draft);
    }, (e) => {
        if (String(e.message).includes("not found")) {
            poller?.stop();
            window.location.href = window.EVENTS_API.baseUrl;
        }
    });
    return wrap;
}

export function stopEditor() {
    poller?.stop();
    poller = null;
    draft = null;
}

let dragCard = null;   // the card being dragged (module scope: survives DOM moves)

function draw(wrap, eventId, draft) {
    wrap.innerHTML = "";
    const event = state.event;
    if (!event.is_host) {
        // non-hosts never see edit mode — straight back to view
        window.location.href = `${window.EVENTS_API.baseUrl}${eventId}/`;
        return;
    }

    const head = el("div", "event-edit-head");
    head.appendChild(el("h1", null, "Edit event"));
    head.appendChild(el("p", "hint",
        "Settings only — the content (chat, bring list, votes, ride seats) " +
        "is operated in view mode. Save changes when you're done."));
    wrap.appendChild(head);

    const list = el("div", "edit-module-list");

    const modules = [...(state.modules || [])].sort(
        (a, b) => a.position - b.position);

    const makeCard = (module) => {
        const meta = MODULE_META[module.type] ||
            { label: module.type, icon: "grid-dots" };
        const card = el("section", "card edit-module-card");
        card.dataset.moduleId = module.id ?? "title";
        if (module.hidden) card.classList.add("module-hidden");
        if (meta.fixed) card.classList.add("edit-module-fixed");

        const headRow = el("header", "edit-module-head");
        const title = el("h2", "module-title");
        title.appendChild(icon(meta.icon));
        title.appendChild(el("span", null, meta.label));
        headRow.appendChild(title);

        // non-fixed cards: grip (drag to reorder) + delete; fixed cards
        // (title/members) get neither
        if (!meta.fixed) {
            const nav = el("div", "edit-module-nav");
            if (module.hidden) {
                // content modules "delete" = hide server-side — offer it back
                const restore = el("button", "btn btn-secondary btn-sm",
                    "Restore");
                restore.type = "button";
                restore.onclick = async () => {
                    try {
                        await api(moduleUrl(module.id), {
                            method: "PATCH",
                            body: JSON.stringify({ hidden: false }),
                        });
                        await poller?.refresh();
                    } catch (e) { toast(e.message, "error"); }
                };
                nav.appendChild(restore);
            } else {
                const del = iconBtn("trash", "Delete module");
                del.onclick = async () => {
                    if (!(await confirmDialog(
                        "Delete this module? Data in it (votes, items, "
                        + "messages, rides) is removed too."))) return;
                    try {
                        await api(moduleUrl(module.id) + "?mode=delete",
                            { method: "DELETE" });
                        await poller?.refresh();
                    } catch (e) { toast(e.message, "error"); }
                };
                nav.appendChild(del);
            }

            // reorder — drag on desktop (HTML5 DnD never fires on touch),
            // up/down buttons everywhere. Both mutate the DOM; the shared
            // sync then reorders the live `modules` array from DOM order —
            // Save persists exactly that order (title card is fixed at 0).
            const syncOrder = () => {
                const ordered = [...list.querySelectorAll(
                    ".edit-module-card[data-module-id]")]
                    .map((n) => Number(n.dataset.moduleId))
                    .filter((id) => !Number.isNaN(id));
                const byId = new Map(modules.map((m) => [m.id, m]));
                const next = ordered.map((id) => byId.get(id)).filter(Boolean);
                modules.splice(0, modules.length, ...next);
            };
            const moveCard = (dir) => {
                const sibling = dir < 0 ? card.previousElementSibling
                                        : card.nextElementSibling;
                // stay inside the module stack: not above the fixed title
                // card (always the list's first child), not past the
                // trailing add-module card
                if (!sibling || sibling === list.firstElementChild ||
                        sibling.classList.contains("edit-add-card")) return;
                list.insertBefore(card, dir < 0 ? sibling : sibling.nextSibling);
                syncOrder();
            };
            const up = iconBtn("arrow-up", "Move up", "edit-module-grip");
            up.onclick = () => moveCard(-1);
            const down = iconBtn("arrow-down", "Move down", "edit-module-grip");
            down.onclick = () => moveCard(1);
            nav.appendChild(up);
            nav.appendChild(down);

            // drag handle — HTML5 DnD, enabled only from the grip so text
            // inputs inside the card stay draggable/selectable
            const grip = iconBtn("grip-vertical", "Drag to reorder",
                "edit-module-grip");
            grip.onmousedown = () => { card.draggable = true; };
            card.addEventListener("dragstart", (e) => {
                dragCard = card;
                card.classList.add("is-dragging");
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", card.dataset.moduleId);
            });
            card.addEventListener("dragend", () => {
                card.classList.remove("is-dragging");
                card.draggable = false;
                dragCard = null;
                syncOrder();
            });
            card.addEventListener("dragover", (e) => {
                if (!dragCard || dragCard === card) return;
                e.preventDefault();
                const rect = card.getBoundingClientRect();
                const after = e.clientY - rect.top > rect.height / 2;
                list.insertBefore(dragCard,
                    after ? card.nextSibling : card);
            });
            nav.appendChild(grip);
            headRow.appendChild(nav);
        }
        card.appendChild(headRow);

        const body = el("div", "edit-module-body");
        const renderer = MODULES[module.type];
        if (renderer?.settings) {
            renderer.settings(body, {
                module, event, state, draft, isHost: true,
                refresh: () => poller?.refresh(),
            });
        } else {
            body.appendChild(el("p", "module-empty",
                "Nothing to configure for this module."));
        }
        card.appendChild(body);
        return card;
    };

    // title card first (fixed), then the ordered stack — the drag handlers
    // above mutate both the DOM and the live `modules` array.
    list.appendChild(makeCard({ type: "title" }));
    modules.forEach((module) => list.appendChild(makeCard(module)));

    // add-module picker — already-placed types gray out (no duplicates);
    // fixed types (title/members) never appear here
    const placed = new Set(modules.map((m) => m.type));
    const addCard = el("section", "card edit-module-card edit-add-card");
    const addHead = el("header", "edit-module-head");
    addHead.appendChild(el("h2", "module-title", "Add a module"));
    addCard.appendChild(addHead);
    const addRow = el("div", "module-add-row");
    for (const [type, meta] of Object.entries(MODULE_META)) {
        if (meta.fixed) continue;
        const btn = el("button", "btn btn-secondary btn-sm", meta.label);
        btn.type = "button";
        btn.appendChild(icon(meta.icon));
        if (placed.has(type)) {
            btn.disabled = true;
            btn.title = "Already placed";
        } else {
            btn.onclick = async () => {
                try {
                    await api(modulesUrl(eventId), {
                        method: "POST",
                        body: JSON.stringify({ type }),
                    });
                    await poller?.refresh();
                } catch (e) { toast(e.message, "error"); }
            };
        }
        addRow.appendChild(btn);
    }
    addCard.appendChild(addRow);
    list.appendChild(addCard);
    wrap.appendChild(list);

    wrap.appendChild(stickyBar(eventId, event, draft, modules));
}

function iconBtn(name, title, cls = "btn-ghost-icon btn-sm-icon") {
    const btn = el("button", cls);
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.appendChild(icon(name));
    return btn;
}

function stickyBar(eventId, event, draft, modules) {
    const bar = el("div", "edit-sticky-bar");
    const inner = el("div", "edit-sticky-inner");

    const cancel = el("button", "btn btn-secondary", "Cancel");
    cancel.type = "button";
    cancel.onclick = () => {
        window.location.href = `${window.EVENTS_API.baseUrl}${eventId}/`;
    };

    const actions = el("div", "edit-sticky-actions");

    if (event.status === "published") {
        const unpublish = el("button", "btn btn-secondary", "Unpublish");
        unpublish.type = "button";
        unpublish.onclick = async () => {
            try {
                await api(unpublishUrl(eventId), { method: "POST" });
                toast("Event is a draft again", "success");
            } catch (e) { toast(e.message, "error"); }
        };
        actions.appendChild(unpublish);
    }

    const archive = el("button", "btn btn-secondary", "Archive");
    archive.type = "button";
    archive.onclick = async () => {
        if (!(await confirmDialog(
            "Archive this event? Members lose all access (you keep yours)."))) return;
        try {
            await api(archiveUrl(eventId), { method: "POST" });
            window.location.href = `${window.EVENTS_API.baseUrl}${eventId}/`;
        } catch (e) { toast(e.message, "error"); }
    };
    actions.appendChild(archive);

    // draft-only: publish straight from the save bar
    if (event.status === "draft") {
        const publishCheck = el("label", "toggle-label");
        const check = el("input");
        check.type = "checkbox";
        check.checked = true;
        publishCheck.append(check,
            document.createTextNode("Publish after saving"));
        actions.appendChild(publishCheck);
        draft._publish = () => check.checked;
    }

    const save = el("button", "btn btn-primary btn-lg", "Save changes");
    save.type = "button";
    save.onclick = () => saveChanges(eventId, draft, modules);
    actions.appendChild(save);

    inner.append(cancel, actions);
    bar.appendChild(inner);
    return bar;
}

async function saveChanges(eventId, draft, modules) {
    try {
        // 1) event-level: title/subtitle/date
        const eventPayload = {};
        if (draft.title !== undefined) eventPayload.title = draft.title;
        if (draft.subtitle !== undefined) eventPayload.subtitle = draft.subtitle;
        if (draft.event_date !== undefined) {
            eventPayload.event_date = draft.event_date;
        }
        await api(eventUrl(eventId).replace(/\/$/, ""), {
            method: "PATCH",
            body: JSON.stringify(eventPayload),
        });

        // 2) per-module configs (only modules that carry settings)
        for (const module of modules) {
            const renderer = MODULES[module.type];
            if (!renderer?.settings) continue;
            const payload = buildModulePayload(module, draft);
            if (!payload) continue;
            // config first — the server's options endpoint reads
            // config.mode, so the mode switch must land before the slots
            if (payload.config && Object.keys(payload.config).length) {
                await api(moduleUrl(module.id), {
                    method: "PATCH",
                    body: JSON.stringify({ config: payload.config }),
                });
            }
            // doodle options: time slots (time mode) or picked days
            // (date mode) go to the options endpoint — they ARE the options
            if (module.type === "doodle" &&
                    (payload.time_slots || payload.days)) {
                await api(optionsUrl(module.id), {
                    method: "POST",
                    body: JSON.stringify(payload.time_slots
                        ? { time_slots: payload.time_slots }
                        : { days: payload.days }),
                });
            }
        }

        // 3) reorder — positions in list order (title fixed at 0)
        const orderIds = modules.map((m) => m.id);
        await api(reorderUrl(eventId), {
            method: "POST",
            body: JSON.stringify({ order: orderIds }),
        });

        // 4) publish if requested (drafts only)
        if (draft._publish?.()) {
            await api(publishUrl(eventId), { method: "POST" });
            toast("Saved & published", "success");
        } else {
            toast("Changes saved", "success");
        }
        window.location.href = `${window.EVENTS_API.baseUrl}${eventId}/`;
    } catch (e) {
        toast(e.message, "error");
    }
}

/* map draft keys → per-module PATCH payloads */
function buildModulePayload(module, draft) {
    const payload = {};
    switch (module.type) {
        case "description":
            if (draft.description !== undefined) {
                payload.config = { text: draft.description };
            }
            break;
        case "image": {
            const cfg = {};
            if (draft.imageUrl !== undefined) {
                cfg.url = draft.imageUrl;   // pasted URL ("" clears it)
            }
            if (Object.keys(cfg).length) payload.config = cfg;
            break;
        }
        case "location":
            if (draft.location) {
                payload.config = {
                    address: draft.location.address || "",
                    lat: draft.location.lat ?? null,
                    lng: draft.location.lng ?? null,
                    note: draft.location.note || "",
                };
            }
            break;
        case "announcement":
            if (draft.announcement) {
                payload.config = {
                    text: draft.announcement.text || "",
                    tone: draft.announcement.tone || "info",
                };
            }
            break;
        case "doodle":
            if (draft.doodle) {
                payload.config = {
                    mode: draft.doodle.mode,
                    anonymous: draft.doodle.anonymous,
                };
                if (draft.doodle.mode === "time" &&
                        draft.doodle.slots?.length) {
                    payload.time_slots = draft.doodle.slots;
                }
                if (draft.doodle.mode === "date" &&
                        draft.doodle.days?.size) {
                    payload.days = [...draft.doodle.days].sort();
                }
            }
            break;
    }
    return payload;
}
