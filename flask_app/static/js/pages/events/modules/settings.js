/* Settings renderers — edit mode (§1). Each module renders as a config
   card: settings/fields/previews, NO live content interaction. They write
   into a local `draft` object; the sticky "Save changes" bar POSTs/PATCHes
   everything in one go. Chat/Car share/Bring list have no settings — the
   editor renders them as plain on/off switches instead. */

import { el, icon, iconBtn, toast, fmtDate, confirmDialog, rsvpBadge } from "../ui.js";
import {
    eventUrl, moduleUrl, modulesUrl, memberUrl, moduleContentUrl,
    imageUploadUrl, inviteUrl, transferUrl, finalizeUrl, resetVotesUrl, api,
} from "../api.js";
import { openPicker } from "../picker.js";
import { setupMapInteraction, keepMapSized, composeAddress } from "./location.js";

/* ---- shared helpers -------------------------------------------------- */

function field(labelText, inputEl, hint) {
    const wrap = el("div", "field");
    const label = el("label", null, labelText);
    label.htmlFor = inputEl.id || "";
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    if (hint) wrap.appendChild(el("p", "hint", hint));
    return wrap;
}

function textInput(value, placeholder, onInput) {
    const input = el("input", "field-input");
    input.type = "text";
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;
    input.oninput = () => onInput(input.value);
    return input;
}

function toggle(labelText, checked, onChange) {
    const label = el("label", "toggle-label");
    const check = el("input");
    check.type = "checkbox";
    check.checked = !!checked;
    check.onchange = () => onChange(check.checked);
    label.append(check, document.createTextNode(labelText));
    return label;
}

/* ---- title (name + canonical event date) ------------------------------ */

export function settingsTitle(root, ctx) {
    const { draft, event, refresh, imageModule } = ctx;
    const titleInput = textInput(draft.title, "Event title",
        (v) => { draft.title = v; });
    titleInput.maxLength = 120;
    // the subtitle carries the event description now (the Description
    // module is gone) — keep the hint pointing there
    const subInput = textInput(draft.subtitle, "Subtitle (optional)",
        (v) => { draft.subtitle = v; });
    subInput.maxLength = 200;

    const dateInput = el("input", "field-input");
    dateInput.type = "datetime-local";
    if (draft.event_date) {
        const d = new Date(draft.event_date);
        const pad = (n) => String(n).padStart(2, "0");
        dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // trashcan clears the date again - only visible while one is set
    const clearDate = iconBtn("trash", "Remove the date");
    clearDate.type = "button";
    const syncClear = () => {
        clearDate.style.display = dateInput.value ? "" : "none";
    };
    dateInput.addEventListener("input", syncClear);
    dateInput.onchange = () => {
        draft.event_date = dateInput.value || null;
        draft.date_source = "manual";
        syncClear();
    };
    clearDate.onclick = () => {
        draft.event_date = null;
        draft.date_source = "manual";
        dateInput.value = "";
        syncClear();
    };
    syncClear();

    const dateRow = el("div", "input-row");
    dateRow.append(dateInput, clearDate);

    root.appendChild(field("Title", titleInput));
    root.appendChild(field("Subtitle", subInput,
        "Shown under the title — the event's short description."));
    root.appendChild(field("Event date", dateRow,
        "The one canonical date — the Doodle (time mode) and the countdown use it."));

    // cover image — not a module card anymore, it lives in the header next
    // to the title (view mode shows it behind the title as the masthead)
    const coverBody = el("div", "cover-image-edit");
    if (imageModule) {
        settingsImage(coverBody, { ...ctx, module: imageModule });
    } else {
        // the button opens the native picker straight away; the module is
        // only created once a file is chosen, so cancelling changes nothing
        const fileInput = el("input", "visually-hidden");
        fileInput.type = "file";
        fileInput.accept = "image/png,image/jpeg,image/gif,image/webp";

        const addBtn = el("button", "btn btn-secondary btn-sm",
            "Add cover image");
        addBtn.type = "button";
        addBtn.appendChild(icon("upload"));
        addBtn.onclick = () => fileInput.click();

        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            addBtn.disabled = true;
            addBtn.textContent = "Uploading...";
            try {
                const created = await api(modulesUrl(event.id), {
                    method: "POST",
                    body: JSON.stringify({ type: "image" }),
                });
                const body = new FormData();
                body.append("file", file);
                await api(imageUploadUrl(created.module.id),
                    { method: "POST", body });
            } catch (e) {
                toast(e.message, "error");
            } finally {
                await refresh();
            }
        };
        coverBody.append(fileInput, addBtn);
        coverBody.appendChild(el("p", "hint",
            "Shown as the event's header picture."));
    }
    root.appendChild(field("Cover image", coverBody));
}

/* ---- description ------------------------------------------------------- */

export function settingsDescription(root, ctx) {
    const { draft } = ctx;
    draft.description = draft.description || "";
    const textarea = el("textarea", "field-input notes-editor");
    textarea.rows = 5;
    textarea.placeholder = "Describe the event…";
    textarea.value = draft.description;
    textarea.oninput = () => { draft.description = textarea.value; };
    root.appendChild(field("Description", textarea));
}

/* ---- image (upload from PC) --------------------------------------------- */

export function settingsImage(root, ctx) {
    const { module, draft, refresh } = ctx;
    const config = module.config || {};

    // preview thumbnail
    let preview = null;
    if (config.url) {
        preview = el("img", "event-image image-preview");
        preview.src = config.url;
        root.appendChild(preview);
    }

    // upload from PC — hidden native input + styled browse button; the
    // chosen filename/status live on the draft so the poll redraw keeps
    // them (a fresh native input would reset to "no file selected")
    draft.imageFileName = draft.imageFileName || "";
    draft.imageStatus = draft.imageStatus || "";

    const fileInput = el("input", "visually-hidden");
    fileInput.type = "file";
    fileInput.id = `event-image-file-${module.id}`;
    fileInput.accept = "image/png,image/jpeg,image/gif,image/webp";

    const browse = el("label", "btn btn-secondary btn-sm", "Choose file");
    browse.htmlFor = fileInput.id;

    const fileName = el("span", "file-name",
        draft.imageFileName || "No file chosen");
    const status = el("p", "hint", draft.imageStatus);

    const uploadRow = el("div", "file-upload-row");
    uploadRow.append(fileInput, browse, fileName);

    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        draft.imageFileName = file.name;
        draft.imageStatus = "Uploading...";
        fileName.textContent = draft.imageFileName;
        status.textContent = draft.imageStatus;
        const body = new FormData();
        body.append("file", file);
        try {
            const data = await api(imageUploadUrl(module.id),
                { method: "POST", body });
            // show the fresh image immediately — the next redraw only
            // happens with the next poll, which read as "upload lags
            // one image behind"
            const url = data?.module?.config?.url;
            if (url) {
                if (!preview) {
                    preview = el("img", "event-image image-preview");
                    root.insertBefore(preview, root.firstChild);
                }
                preview.src = url;
            }
            draft.imageStatus = "Uploaded";
            status.textContent = draft.imageStatus;
            if (refresh) await refresh();
        } catch (e) {
            draft.imageStatus = "";
            status.textContent = "";
            toast(e.message, "error");
        }
    };
    root.appendChild(field("Upload image", uploadRow,
        "PNG, JPEG, GIF or WebP."));
    root.appendChild(status);
}

/* ---- location ---------------------------------------------------------- */

/* §3: search a free-text place via Nominatim (free OSM geocoder, no key).
   Attribution: data © OpenStreetMap contributors — shown by the map. */
async function nominatimSearch(query) {
    const url = "https://nominatim.openstreetmap.org/search?format=json"
        + "&addressdetails=1&limit=1&q=" + encodeURIComponent(query);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const results = await res.json();
    return results?.[0] || null;
}

/* Reverse-geocode a map click/drag so the address fills itself in.
   zoom=18 asks for building-level detail (house number + road). */
async function nominatimReverse(lat, lng) {
    const url = "https://nominatim.openstreetmap.org/reverse?format=json"
        + "&addressdetails=1&zoom=18&lat=" + lat + "&lon=" + lng;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return await res.json();
}

/* Approximate the visitor's area from their IP so an empty map opens near
   them instead of over the world/CH. Best-effort: providers with generous
   free CORS quotas; any failure returns null and the map keeps its
   neutral default. */
const IP_GEO_URLS = [
    "https://get.geojs.io/v1/ip/geo.json",
    "https://freeipapi.com/api/json",
];

async function ipLocation() {
    for (const url of IP_GEO_URLS) {
        try {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" },
            });
            if (!res.ok) continue;
            const data = await res.json();
            const lat = Number(data?.latitude);
            const lng = Number(data?.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return [lat, lng];
            }
        } catch { /* rate-limited/blocked — try the next provider */ }
    }
    return null;
}

/* Structured address from the Nominatim fields (addressdetails=1) — not
   display_name, whose first parts are the POI name ("Brandenburger Tor,
   1 …"). The town is the smallest locality present (village > town >
   municipality > suburb > city), so a place inside a town never shows
   the bigger city name. */
function structuredAddress(hit) {
    const a = hit?.address || {};
    const street = a.road || a.pedestrian || a.footway || "";
    const houseNumber = a.house_number || "";
    const town = a.village || a.town || a.municipality || a.suburb
        || a.city || "";
    const display = composeAddress({ street, houseNumber, town })
        || (hit.display_name || "").split(",").slice(0, 2).join(",").trim();
    return { street, houseNumber, town, display };
}

// maps created by the settings card — a redraw (reorder/poll refresh)
// rebuilds the DOM, so the previous instances must be disposed or their
// window listeners (resize/focus) pile up
const liveMaps = [];

export function settingsLocation(root, ctx) {
    const { module, draft } = ctx;
    const config = module.config || {};
    // seed once — a redraw (reorder) must not wipe unsaved edits
    draft.location = draft.location || {
        address: config.address || "", note: config.note || "",
        lat: config.lat ?? null, lng: config.lng ?? null,
        street: config.street || "", houseNumber: config.houseNumber || "",
        town: config.town || "",
    };

    for (const m of liveMaps.splice(0)) {
        try { m.remove(); } catch { /* already gone with its DOM */ }
    }

    const noteInput = textInput(draft.location.note,
        "e.g. “Back entrance, 2nd floor”",
        (v) => { draft.location.note = v; });

    if (window.L) {
        root.appendChild(buildLocationMap(draft, config));
    } else {
        // vendored Leaflet missing — manual lat/lng fallback
        const lat = textInput(draft.location.lat, "Latitude (e.g. 47.3769)",
            (v) => { draft.location.lat = parseFloat(v) || null; });
        const lng = textInput(draft.location.lng, "Longitude (e.g. 8.5417)",
            (v) => { draft.location.lng = parseFloat(v) || null; });
        const coords = el("div", "host-content-row");
        coords.appendChild(field("Latitude", lat));
        coords.appendChild(field("Longitude", lng));
        root.appendChild(coords);
        root.appendChild(field("Address", textInput(draft.location.address,
            "e.g. „Kino City, Hauptstr. 1“",
            (v) => { draft.location.address = v; })));
    }

    root.appendChild(field("Note", noteInput));
    root.appendChild(el("p", "hint",
        "Search inside the map or drag the pin. Click the pin to see the " +
        "details attendees get. Map data © OpenStreetMap contributors."));
}

function buildLocationMap(draft, config) {
    const L = window.L;
    const holder = el("div", "location-map-wrap");
    const mapDiv = el("div", "location-map");
    const search = el("div", "location-search");
    const input = el("input", "field-input");
    input.type = "search";
    input.placeholder = "Search a place…";
    const go = el("button", "btn btn-primary btn-sm", "Find");
    go.type = "button";
    holder.append(mapDiv, search);

    const hasPoint = Number.isFinite(draft.location.lat)
        && Number.isFinite(draft.location.lng);
    const map = L.map(mapDiv, {
        scrollWheelZoom: true,
        zoomControl: false,   // re-added bottom-left below (the search
                              // bar overlays the default top-left spot)
    }).setView(
        hasPoint ? [draft.location.lat, draft.location.lng] : [47.4, 8.5],
        hasPoint ? 15 : 4);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    keepMapSized(map);
    liveMaps.push(map);
    setupMapInteraction(map, holder, mapDiv);
    if (!hasPoint) {
        // no pin yet: open near the visitor's approximate IP location
        // (city-level) unless they already started interacting
        let userTookOver = false;
        map.on("click dragstart zoomstart", () => { userTookOver = true; });
        ipLocation().then((pos) => {
            if (pos && !userTookOver) map.setView(pos, 11);
        });
    }
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const readout = el("p", "hint", "");
    let marker = null;

    const popupFor = () => {
        const box = document.createElement("div");
        box.className = "location-popup";
        const address = composeAddress(draft.location) || draft.location.address;
        if (address) {
            const a = document.createElement("strong");
            a.textContent = address;
            box.appendChild(a);
            box.appendChild(document.createElement("br"));
        }
        const coords = document.createElement("span");
        coords.className = "mono";
        coords.textContent = `${draft.location.lat?.toFixed?.(5) ?? "?"}, ${draft.location.lng?.toFixed?.(5) ?? "?"}`;
        box.appendChild(coords);
        return box;
    };
    const syncPopup = () => {
        if (!marker) return;
        marker.unbindPopup();
        marker.bindPopup(popupFor());
    };

    /* Auto-fill the address from the pin position. Nominatim asks for
       at most one request per second, so clicks/drags are debounced; the
       sequence guard drops responses superseded by a newer placement.
       A miss keeps the previously detected address. */
    let reverseTimer = null;
    let reverseSeq = 0;
    const reverseGeocode = (lat, lng) => {
        const seq = ++reverseSeq;
        clearTimeout(reverseTimer);
        reverseTimer = setTimeout(async () => {
            try {
                const hit = await nominatimReverse(lat, lng);
                if (seq !== reverseSeq || !hit?.address) return;
                const parts = structuredAddress(hit);
                // Never clobber: a pin nudged off a building must not drop
                // its street/town/house number (the recurring "the address
                // disappeared" bug). Only fill in what the geocode actually
                // returned; a result with no structured parts at all is
                // ignored entirely (display_name fallback is too noisy).
                if (!parts.street && !parts.town && !parts.houseNumber) return;
                if (parts.street) draft.location.street = parts.street;
                if (parts.houseNumber) draft.location.houseNumber = parts.houseNumber;
                if (parts.town) draft.location.town = parts.town;
                const merged = composeAddress(draft.location);
                if (merged) draft.location.address = merged;
                input.value = draft.location.address || "";
                syncPopup();
            } catch { /* offline/rate-limited — keep the old address */ }
        }, 600);
    };

    const setPoint = (lat, lng, zoom) => {
        const first = !marker;
        draft.location.lat = lat;
        draft.location.lng = lng;
        if (first) {
            marker = L.marker([lat, lng], { draggable: true }).addTo(map);
            marker.on("click", () => marker.openPopup());
            marker.on("dragend", () => {
                const p = marker.getLatLng();
                draft.location.lat = p.lat;
                draft.location.lng = p.lng;
                syncPopup();
                readout.textContent = coordsText();
                reverseGeocode(p.lat, p.lng);
            });
        } else {
            marker.setLatLng([lat, lng]);
        }
        syncPopup();
        // first placement jumps in from the world view; later clicks keep
        // the zoom the user chose (forcing 15 made the map "zoom out")
        map.setView([lat, lng], zoom ?? (first ? 15 : map.getZoom()));
        readout.textContent = coordsText();
    };

    const coordsText = () => {
        if (!Number.isFinite(draft.location.lat)) {
            return "No pin yet — search a place or click the map.";
        }
        return `Pin: ${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`;
    };

    if (hasPoint) setPoint(draft.location.lat, draft.location.lng);
    map.on("click", (e) => {
        setPoint(e.latlng.lat, e.latlng.lng);
        // only auto-fill when there is nothing to lose — a stray click on
        // an event that already has an address must never rewrite it
        if (!draft.location.address) reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    const status = el("span", "hint", "");
    go.onclick = async () => {
        const query = input.value.trim();
        if (!query) { status.textContent = "Type a place first."; return; }
        status.textContent = "Searching…";
        go.disabled = true;
        try {
            const hit = await nominatimSearch(query);
            if (!hit) { status.textContent = "Nothing found — try other words."; return; }
            const parts = structuredAddress(hit);
            draft.location.street = parts.street;
            draft.location.houseNumber = parts.houseNumber;
            draft.location.town = parts.town;
            draft.location.address = parts.display;
            setPoint(parseFloat(hit.lat), parseFloat(hit.lon), 15);
            input.value = parts.display;
            status.textContent = "Found — pin placed. Drag to fine-tune.";
        } catch (e) {
            status.textContent = e.message;
        } finally {
            go.disabled = false;
        }
    };
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); go.click(); }
    });

    const bar = el("div", "location-searchbar");
    bar.append(input, go, status);
    search.innerHTML = "";
    search.appendChild(bar);
    holder.appendChild(readout);
    return holder;
}

/* ---- members (host-only: add/remove people + invite link, edit mode) --- */

export function settingsMembers(root, ctx) {
    const { event, state, refresh } = ctx;
    const others = (state.members || []).filter((m) => m.role !== "host");
    const row = el("div", "host-actions-row");
    const addBtn = el("button", "btn btn-secondary btn-sm", "Add members");
    addBtn.type = "button";
    addBtn.appendChild(icon("plus"));
    addBtn.onclick = () => openPicker(event, refresh);
    row.appendChild(addBtn);

    const inviteBtn = el("button", "btn btn-secondary btn-sm", "Invite link");
    inviteBtn.type = "button";
    inviteBtn.onclick = async () => {
        try {
            const data = await api(inviteUrl(event.id), { method: "POST" });
            // dedicated GET landing page (§7) — /events/invite/<token>
            const url = `${window.location.origin}/events/invite/${data.token}`;
            await navigator.clipboard?.writeText(url).catch(() => {});
            toast("Invite link copied", "success");
        } catch (e) { toast(e.message, "error"); }
    };
    row.appendChild(inviteBtn);

    // handover is a host setting — it lives here in edit mode, not in the
    // attendee-facing members section
    if (others.length) {
        const transferBtn = el("button", "btn btn-secondary btn-sm",
            "Transfer host");
        transferBtn.type = "button";
        transferBtn.onclick = async () => {
            const name = await promptDialog("Transfer host to which member?\n" +
                others.map((m, i) => `${i + 1}. ${m.user.username}`).join("\n"),
                { okText: "Transfer" });
            const idx = Number(name) - 1;
            if (!name || !others[idx]) return;
            try {
                await api(transferUrl(event.id), {
                    method: "POST",
                    body: JSON.stringify({ member_id: others[idx].id }),
                });
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        row.appendChild(transferBtn);
    }
    root.appendChild(row);
    root.appendChild(el("p", "hint",
        "New members join as “pending” and pick their RSVP in view mode."));

    // removal lives here (edit mode) — the attendee-facing list in view
    // mode stays read-only info
    if (others.length) {
        const list = el("ul", "member-list edit-member-list");
        for (const member of others) {
            const li = el("li", "member-row");
            const info = el("div", "member-info");
            info.appendChild(el("span", "member-name", member.user.username));
            li.appendChild(info);
            li.appendChild(rsvpBadge(member.rsvp));
            const rm = iconBtn("x", `Remove ${member.user.username}`,
                "btn-ghost-icon btn-sm-icon");
            rm.onclick = async () => {
                if (!(await confirmDialog(`Remove ${member.user.username} ` +
                        "from the event? Their claims and ride seats are " +
                        "released."))) return;
                try {
                    await api(`${memberUrl(event.id)}/${member.id}`,
                        { method: "DELETE" });
                    await refresh();
                } catch (e) { toast(e.message, "error"); }
            };
            li.appendChild(rm);
            list.appendChild(li);
        }
        root.appendChild(list);
    }
}

/* ---- doodle (date/time mode toggle) ------------------------------------ */

export function settingsDoodle(root, ctx) {
    const { module, draft, state } = ctx;
    const config = module.config || {};
    draft.doodle = draft.doodle || {
        mode: config.mode || "date", anonymous: !!config.anonymous,
    };

    // mode picker — two explained cards (the old bare radio pair read as
    // one unclear toggle); the pick decides what attendees vote on
    const MODES = [
        {
            key: "date",
            label: "Pick days",
            hint: "The date isn't fixed yet — attendees tick which days work.",
        },
        {
            key: "time",
            label: "Pick a time",
            hint: "The date is fixed (Title module) — attendees pick the " +
                "time span that works.",
        },
    ];
    const modeRow = el("div", "doodle-config");
    const modeCards = [];
    for (const mode of MODES) {
        const card = el("button", "doodle-mode-card" +
            (draft.doodle.mode === mode.key ? " is-selected" : ""));
        card.type = "button";
        card.setAttribute("role", "radio");
        card.setAttribute("aria-checked",
            String(draft.doodle.mode === mode.key));
        card.appendChild(el("span", "doodle-mode-label", mode.label));
        card.appendChild(el("span", "doodle-mode-hint", mode.hint));
        card.onclick = () => {
            if (draft.doodle.mode === mode.key) return;
            draft.doodle.mode = mode.key;
            for (const [i, c] of modeCards.entries()) {
                c.classList.toggle("is-selected", MODES[i].key === mode.key);
                c.setAttribute("aria-checked",
                    String(MODES[i].key === mode.key));
            }
            renderModeFields();
        };
        modeCards.push(card);
        modeRow.appendChild(card);
    }
    root.appendChild(modeRow);

    const modeFields = el("div", "doodle-editor");
    const renderModeFields = () => {
        modeFields.innerHTML = "";
        if (draft.doodle.mode === "time") {
            renderTimeFields(modeFields);
        } else {
            renderCalendar(modeFields);
        }
    };

    // -- time mode: start/end spans pinned to the event date ------------
    const renderTimeFields = (host) => {
        draft.doodle.slots = draft.doodle.slots || [];
        const list = el("div", "doodle-slot-list");
        const redraw = () => {
            list.innerHTML = "";
            draft.doodle.slots.forEach((slot, i) => {
                const row = el("div", "host-content-row");
                const start = el("input", "field-input");
                start.type = "time";
                start.value = slot.start || "19:00";
                start.onchange = () => { slot.start = start.value; };
                const end = el("input", "field-input");
                end.type = "time";
                end.value = slot.end || "22:00";
                end.onchange = () => { slot.end = end.value; };
                const remove = iconBtn("x", "Remove slot", "btn-ghost-icon btn-sm-icon");
                remove.onclick = () => {
                    draft.doodle.slots.splice(i, 1);
                    redraw();
                };
                row.append(start, end, remove);
                list.appendChild(row);
            });
        };
        redraw();
        const addBtn = el("button", "btn btn-secondary btn-sm", "Add time span");
        addBtn.type = "button";
        addBtn.onclick = () => {
            draft.doodle.slots.push({ start: "19:00", end: "22:00" });
            redraw();
        };
        host.append(list, addBtn);
    };

    // -- date mode: month calendar, click days to toggle ----------------
    const renderCalendar = (host) => {
        // seed from the module's existing day options (or today)
        draft.doodle.days = draft.doodle.days || new Set(
            (state?.options || []).map((o) => o.starts_at?.slice(0, 10))
                .filter(Boolean));
        const pad = (n) => String(n).padStart(2, "0");
        const isoOf = (y, m, day) => {
            if (y instanceof Date) {
                return `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
            }
            return `${y}-${pad(m + 1)}-${pad(day)}`;
        };
        const countText = () =>
            `${draft.doodle.days.size} day${draft.doodle.days.size === 1 ? "" : "s"} picked — max 20.`;
        const today = new Date();
        let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
        let lastPicked = null;   // anchor for shift-click range selection

        const cal = el("div", "doodle-cal");
        const redraw = () => {
            cal.innerHTML = "";
            const head = el("div", "doodle-cal-head");
            const prev = iconBtn("arrow-left", "Previous month", "btn-ghost-icon btn-sm-icon");
            prev.onclick = () => {
                cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
                redraw();
            };
            const next = iconBtn("arrow-right", "Next month", "btn-ghost-icon btn-sm-icon");
            next.onclick = () => {
                cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
                redraw();
            };
            head.append(prev, el("span", "mono",
                `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`), next);
            cal.appendChild(head);

            const grid = el("div", "doodle-cal-grid");
            for (const name of DAY_NAMES) {
                grid.appendChild(el("span", "doodle-cal-dow", name));
            }
            const firstDow = (cursor.getDay() + 6) % 7;  // Monday = 0
            const daysInMonth = new Date(
                cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
            for (let i = 0; i < firstDow; i++) {
                grid.appendChild(el("span", "doodle-cal-day doodle-cal-blank"));
            }
            for (let day = 1; day <= daysInMonth; day++) {
                const iso = isoOf(cursor.getFullYear(), cursor.getMonth(), day);
                const cell = el("button", "doodle-cal-day" +
                    (draft.doodle.days.has(iso) ? " is-picked" : ""));
                cell.type = "button";
                cell.textContent = String(day);
                cell.onclick = (e) => {
                    if (e.shiftKey && lastPicked) {
                        // shift-click: select the whole range from the last
                        // picked day to this one (inclusive, add-only)
                        const [from, to] = [lastPicked, iso].sort();
                        const end = new Date(`${to}T12:00:00`);
                        for (let d = new Date(`${from}T12:00:00`); d <= end;
                                d.setDate(d.getDate() + 1)) {
                            if (draft.doodle.days.size >= 20
                                    && !draft.doodle.days.has(isoOf(d))) break;
                            draft.doodle.days.add(isoOf(d));
                        }
                        lastPicked = iso;
                        redraw();
                    } else {
                        if (draft.doodle.days.has(iso)) draft.doodle.days.delete(iso);
                        else draft.doodle.days.add(iso);
                        lastPicked = iso;
                        cell.classList.toggle("is-picked");
                        // refresh the count line
                        const count = cal.querySelector(".doodle-cal-count");
                        if (count) count.textContent = countText();
                    }
                };
                grid.appendChild(cell);
            }
            cal.appendChild(grid);
            const count = el("p", "hint doodle-cal-count", countText());
            cal.appendChild(count);
        };
        redraw();
        host.appendChild(cal);
    };

    renderModeFields();
    root.appendChild(modeFields);

    // anonymity — no deadline field (the date lives in the Title module)
    root.appendChild(toggle("Anonymous votes (counts only)",
        config.anonymous,
        (v) => { draft.doodle.anonymous = v; }));

    // finalize + reset — host-only actions that change member-facing
    // state, so they live here in edit mode (not in the attendee view)
    const options = state?.options || [];
    const anyoneVoted = (state?.votes || []).some((v) => v.option_id);
    if (options.length) {
        const finWrap = el("div", "doodle-finalize");
        const select = el("select", "field-input");
        for (const option of options) {
            const opt = el("option", null, fmtDate(option.starts_at));
            opt.value = option.id;
            select.appendChild(opt);
        }
        const finBtn = el("button", "btn btn-primary btn-sm", "Finalize date");
        finBtn.type = "button";
        finBtn.onclick = async () => {
            if (!(await confirmDialog("Finalize this date? Members' RSVPs reset to pending and everyone is notified."))) return;
            try {
                await api(finalizeUrl(module.id), {
                    method: "POST",
                    body: JSON.stringify({ option_id: Number(select.value) }),
                });
                toast("Date finalized", "success");
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        finWrap.append(select, finBtn);
        root.appendChild(finWrap);
        root.appendChild(el("p", "hint",
            "Finalize sets the event's canonical date — member RSVPs reset " +
            "to pending and everyone gets notified."));

        if (anyoneVoted) {
            const resetBtn = el("button", "btn btn-secondary btn-sm", "Reset votes");
            resetBtn.type = "button";
            resetBtn.onclick = async () => {
                if (!(await confirmDialog(
                        "Reset all votes? Everyone has to vote again."))) return;
                try {
                    await api(resetVotesUrl(module.id), { method: "DELETE" });
                    toast("Votes reset", "success");
                    await refresh();
                } catch (e) { toast(e.message, "error"); }
            };
            root.appendChild(resetBtn);
        }
    }
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

/* ---- bring list / car share / chat ------------------------------------
   No settings: the editor (editor.js TOGGLE_TYPES) renders these three as
   plain on/off switches; their content is operated in view mode. */
