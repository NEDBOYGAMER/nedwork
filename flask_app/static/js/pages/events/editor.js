/* Edit mode (§1) — /events/<id>/edit/, host only. Modules render as
   config cards (settings only, no live content interaction); a sticky
   bottom bar holds Cancel + Save changes (drafts also get "publish after
   saving"). Sections are on/off switches (bring, rides, chat, location) —
   no reordering anymore. Members and Title are fixed. Saving PATCHes
   event + module configs, then returns to view mode. */
import { el, icon, toast, confirmDialog } from "./ui.js";
import { MODULE_META, MODULES } from "./modules/index.js";
import { startPolling } from "./poller.js";
import {
    eventUrl, moduleUrl, modulesUrl, publishUrl, unpublishUrl,
    archiveUrl, optionsUrl, api,
} from "./api.js";

let state = null;
let poller = null;
let draft = null;   // kept across redraws — add/remove must not wipe edits

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
            // seed once from the server snapshot; later redraws (add-module)
            // reuse it so unsaved edits survive
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
    initAnnouncementModal();
    return wrap;
}

export function stopEditor() {
    poller?.stop();
    poller = null;
    draft = null;
}

// sections switched on/off in the add-card: bring/rides/chat have no
// settings card at all; location and doodle keep their cards (map,
// doodle calendar) but are added/removed by the same switch, so their
// cards have no trashcan.
const CARD_LESS = new Set(["bring", "rides", "chat"]);
const TOGGLE_TYPES = new Set(["bring", "rides", "chat", "location",
                              "doodle"]);

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

    // the announcement is not a module — it's edited via a modal from the
    // sticky bar (and renders as a yellow banner in view mode).
    // Description & Image are not modules either (image lives in the Title
    // card); they stay in the array for saving but never render as cards.
    const modules = [...(state.modules || [])]
        .filter((m) => m.type !== "announcement")
        .sort((a, b) => a.position - b.position);
    const imageModule = (state.modules || []).find((m) => m.type === "image");

    const list = el("div", "edit-module-list");

    // a deleted module must not leave its draft slice behind — otherwise
    // re-adding the same type in this session would resurrect old content
    const clearDraftFor = (type) => {
        if (type === "description") delete draft.description;
        else if (type === "location") delete draft.location;
        else if (type === "doodle") delete draft.doodle;
        else if (type === "image") {
            delete draft.imageFileName;
            delete draft.imageStatus;
        }
    };

    const makeCard = (module) => {
        const meta = MODULE_META[module.type] ||
            { label: module.type, icon: "grid-dots" };
        const card = el("section", "card edit-module-card");
        if (module.hidden) card.classList.add("module-hidden");
        if (meta.fixed) card.classList.add("edit-module-fixed");

        const headRow = el("header", "edit-module-head");
        const title = el("h2", "module-title");
        title.appendChild(icon(meta.icon));
        title.appendChild(el("span", null, meta.label));
        headRow.appendChild(title);

        // non-fixed cards get a small nav (restore for legacy hidden rows,
        // delete for everything except location/doodle — those are removed
        // by their on/off switch instead). No reordering anymore.
        if (!meta.fixed) {
            const nav = el("div", "edit-module-nav");
            if (module.hidden) {
                // legacy rows from when removal was a hide — offer them back
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
            }
            if (module.type !== "location" && module.type !== "doodle") {
                const del = iconBtn("trash", "Delete module");
                del.onclick = async () => {
                    if (!(await confirmDialog(
                        "Delete this module? Its content (description, "
                        + "location, votes, items, messages, rides) is "
                        + "removed too."))) return;
                    try {
                        await api(moduleUrl(module.id), { method: "DELETE" });
                        clearDraftFor(module.type);
                        await poller?.refresh();
                    } catch (e) { toast(e.message, "error"); }
                };
                nav.appendChild(del);
            }
            if (nav.children.length) headRow.appendChild(nav);
        }
        card.appendChild(headRow);

        const body = el("div", "edit-module-body");
        const renderer = MODULES[module.type];
        if (renderer?.settings) {
            renderer.settings(body, {
                module, event, state, draft, isHost: true,
                imageModule, refresh: () => poller?.refresh(),
            });
        } else {
            body.appendChild(el("p", "module-empty",
                "Nothing to configure for this module."));
        }
        card.appendChild(body);
        return card;
    };

    // title card first (fixed), then the remaining cards — location keeps its
    // settings card but is switch-controlled; bring/rides/chat are switches
    // only. Description & Image never render (image lives in the Title card).
    list.appendChild(makeCard({ type: "title" }));
    modules
        .filter((module) => !CARD_LESS.has(module.type))
        .filter((module) => module.type !== "description"
                          && module.type !== "image")
        .forEach((module) => list.appendChild(makeCard(module)));

    // every section is an on/off switch now — no "add a module" buttons.
    // bring/rides/chat have no settings card at all; location and doodle
    // keep their cards but the switch is how they're added/removed.
    const addCard = el("section", "card edit-module-card edit-add-card");
    const addHead = el("header", "edit-module-head");
    addHead.appendChild(el("h2", "module-title", "Sections"));
    addCard.appendChild(addHead);

    const toggleRow = el("div", "module-toggle-row");
    for (const [type, meta] of Object.entries(MODULE_META)) {
        if (meta.fixed || !TOGGLE_TYPES.has(type)) continue;
        const present = modules.find((m) => m.type === type);
        const label = el("label", "module-toggle");
        const switchWrap = el("span", "switch");
        const check = el("input");
        check.type = "checkbox";
        check.checked = !!present;
        check.onchange = async () => {
            check.disabled = true;
            try {
                if (check.checked && !present) {
                    await api(modulesUrl(eventId), {
                        method: "POST",
                        body: JSON.stringify({ type }),
                    });
                } else if (!check.checked && present) {
                    await api(moduleUrl(present.id), { method: "DELETE" });
                    clearDraftFor(type);
                }
                await poller?.refresh();
            } catch (e) {
                check.checked = !check.checked;
                toast(e.message, "error");
            } finally {
                check.disabled = false;
            }
        };
        const track = el("span", "switch-track");
        switchWrap.append(check, track);
        const toggleIcon = icon(meta.icon);
        toggleIcon.classList.add("module-toggle-icon");
        label.append(switchWrap, toggleIcon,
            el("span", "module-toggle-label", meta.label));
        toggleRow.appendChild(label);
    }
    addCard.appendChild(toggleRow);

    list.appendChild(addCard);
    wrap.appendChild(list);

    wrap.appendChild(stickyBar(eventId, event, draft, modules));
}

/* -- announcement modal ---------------------------------------------------- */
/* Edited from the sticky bar; the fields stage into draft.announcement and
   persist with "Save changes" (same model as everything else in the editor).
   View mode shows the result as a yellow banner under the title. */
function initAnnouncementModal() {
    const backdrop = document.getElementById("announcementBackdrop");
    if (!backdrop) return;
    const titleInput = document.getElementById("annTitle");
    const textInput = document.getElementById("annText");
    const expiresInput = document.getElementById("annExpires");
    if (!titleInput || !textInput) return;

    backdrop.querySelectorAll("[data-action='close-announcement']")
        .forEach((b) => { b.onclick = closeAnnouncementModal; });
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeAnnouncementModal();
    });
    document.getElementById("annSaveBtn").onclick = () => {
        draft.announcement = {
            title: titleInput.value,
            text: textInput.value,
            expires_at: expiresInput.value,
        };
        closeAnnouncementModal();
    };
    backdrop.querySelector("[data-action='announcement-clear']").onclick = () => {
        draft.announcement = { title: "", text: "", expires_at: "" };
        closeAnnouncementModal();
    };
}

function openAnnouncementModal() {
    const backdrop = document.getElementById("announcementBackdrop");
    if (!backdrop) return;
    // seed from the module's current config on first open
    if (!draft.announcement) {
        const annModule = (state.modules || []).find(
            (m) => m.type === "announcement");
        const cfg = annModule?.config || {};
        draft.announcement = {
            title: cfg.title || "",
            text: cfg.text || "",
            expires_at: cfg.expires_at ? String(cfg.expires_at).slice(0, 16) : "",
        };
    }
    const d = draft.announcement;
    document.getElementById("annTitle").value = d.title || "";
    document.getElementById("annText").value = d.text || "";
    document.getElementById("annExpires").value = d.expires_at || "";
    backdrop.classList.add("open");
}

function closeAnnouncementModal() {
    document.getElementById("announcementBackdrop")?.classList.remove("open");
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

    // permanent delete — quiet red, away from the save actions
    const del = el("button", "btn btn-sm btn-danger", "Delete event");
    del.type = "button";
    del.onclick = async () => {
        if (!(await confirmDialog(
            "Delete this event permanently? Everyone loses access, and " +
            "everything inside it (votes, bring list, messages, rides) " +
            "is removed. This cannot be undone."))) return;
        try {
            await api(eventUrl(eventId), { method: "DELETE" });
            window.location.href = window.EVENTS_API.baseUrl;
        } catch (e) { toast(e.message, "error"); }
    };
    const danger = el("div", "edit-sticky-danger");
    danger.appendChild(del);

    const actions = el("div", "edit-sticky-actions");

    // announcement — opened from the bar, edited in a modal. There is only
    // one slot: making a new announcement replaces whatever is out.
    const annBtn = el("button", "btn btn-secondary", "Make announcement");
    annBtn.type = "button";
    annBtn.onclick = openAnnouncementModal;
    actions.appendChild(annBtn);

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

    inner.append(cancel, danger, actions);
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

        // 3) announcement — separate from the module list; PATCH the hidden
        // module (creates it on first save). The server notifies members.
        if (draft.announcement) {
            const annConfig = {
                title: (draft.announcement.title || "").trim(),
                text: draft.announcement.text || "",
                expires_at: draft.announcement.expires_at || null,
            };
            const annModule = (state.modules || []).find(
                (m) => m.type === "announcement");
            if (annModule) {
                await api(moduleUrl(annModule.id), {
                    method: "PATCH",
                    body: JSON.stringify({ config: annConfig }),
                });
            } else if (annConfig.title || annConfig.text) {
                const created = await api(modulesUrl(eventId), {
                    method: "POST",
                    body: JSON.stringify({ type: "announcement" }),
                });
                await api(moduleUrl(created.module.id), {
                    method: "PATCH",
                    body: JSON.stringify({ config: annConfig }),
                });
            }
        }

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
        case "location":
            if (draft.location) {
                payload.config = {
                    address: draft.location.address || "",
                    street: draft.location.street || "",
                    houseNumber: draft.location.houseNumber || "",
                    town: draft.location.town || "",
                    lat: draft.location.lat ?? null,
                    lng: draft.location.lng ?? null,
                    note: draft.location.note || "",
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
