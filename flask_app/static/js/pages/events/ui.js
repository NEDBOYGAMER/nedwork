/* Events — shared UI helpers: icons, element builder, badges, toast,
   confirm dialog. Matches the global style ruleset (style-instructions.md). */

export const iconUrl = (name) =>
    `url("${window.STATIC_URL}img/icons/tabler-${name}.svg")`;

export function setIcon(el, name) {
    el.style.setProperty("--icon", iconUrl(name));
}

export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function icon(name, cls = "icon") {
    const span = el("span", cls);
    setIcon(span, name);
    return span;
}

/* The events view mode has its own small icon set (static/img/ev-icons/)
   — drawn for what each section IS (a bring basket, a voting sheet, a
   top-down table of seats), not the generic tabler line icons. Edit mode
   keeps the tabler set. Falls back to a tabler icon for unknown types. */
const EV_ICONS = {
    description: "flyer",
    members:     "person",
    doodle:      "vote",
    bring:       "basket",
    rides:       "car",
    location:    "map",
    announcement: "megaphone",
    chat:        "chat",
    duty:        "clipboard",
};

export function evIcon(type, cls = "icon ev-icon") {
    const name = EV_ICONS[type];
    if (!name) return icon(type, cls);
    const span = el("span", cls);
    span.style.setProperty("--icon",
        `url("${window.STATIC_URL}img/ev-icons/ev-${name}.svg")`);
    return span;
}

export function iconBtn(name, title, cls = "btn-ghost-icon") {
    const btn = el("button", cls);
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.appendChild(icon(name));
    return btn;
}

const RSVP_META = {
    attending: { label: "Attending", cls: "badge-success" },
    maybe:     { label: "Maybe",     cls: "badge-warning" },
    cant:      { label: "Can't",     cls: "badge-neutral" },
    pending:   { label: "Pending",   cls: "badge-info" },
};

export function rsvpBadge(rsvp) {
    const meta = RSVP_META[rsvp] || RSVP_META.pending;
    return el("span", `badge ${meta.cls}`, meta.label);
}

/* -- participation gates -----------------------------------------------
   Responsibility actions (bring/claim/drive/seat/vote/chat) need a
   confirmed "Going"; "maybe" may still signal a ride need. Hosts always
   bypass (they are implicitly going). Mirrors PARTICIPATION_RSVP /
   RIDE_SIGNAL_RSVP in flask_app/events/routes.py. */
export function isGoing(ctx) {
    return !!ctx.isHost || ctx.me?.rsvp === "attending";
}

export function mayRequestRide(ctx) {
    return !!ctx.isHost || ctx.me?.rsvp === "attending" ||
        ctx.me?.rsvp === "maybe";
}

/* Outstanding commitments (counts, not rows): bring claims, car seats and
   rides the member drives. Used by the RSVP downgrade warning and the
   read-only banner. */
export function eventDuties(state, me) {
    const out = { claims: 0, seats: 0, rides: 0 };
    if (!me) return out;
    for (const item of state.items || []) {
        if ((item.claims || []).some((c) => c.member_id === me.id)) out.claims++;
    }
    for (const ride of state.rides || []) {
        if ((ride.passengers || []).some((p) => p.member_id === me.id)) out.seats++;
        if (ride.driver?.member_id === me.id) out.rides++;
    }
    return out;
}

export function dutiesText(duties) {
    const parts = [];
    if (duties.claims) {
        parts.push(`${duties.claims} bring claim${duties.claims === 1 ? "" : "s"}`);
    }
    if (duties.seats) {
        parts.push(`${duties.seats} car seat${duties.seats === 1 ? "" : "s"}`);
    }
    if (duties.rides) {
        parts.push(`${duties.rides} offered ride${duties.rides === 1 ? "" : "s"}`);
    }
    return parts.join(", ");
}

/* Confirm an RSVP downgrade that would leave responsibilities behind —
   the commitments are kept, the member just can't take on new ones. */
export async function confirmRsvpChange(state, me, value) {
    if (value === "attending") return true;
    const text = dutiesText(eventDuties(state, me));
    if (!text) return true;
    return confirmDialog(
        `You're still responsible for ${text}. They stay until you ` +
        `release them yourself — you only can't take on new ones unless ` +
        `you're Going. Change your RSVP anyway?`);
}

export function statusBadge(status) {
    const meta = {
        draft:     { label: "Draft",     cls: "badge-warning" },
        published: { label: "Published", cls: "badge-success" },
        archived:  { label: "Archived",  cls: "badge-neutral" },
    }[status] || { label: status, cls: "badge-neutral" };
    return el("span", `badge ${meta.cls}`, meta.label);
}

export function fmtDate(iso) {
    if (!iso) return "No date yet";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined,
        { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString(undefined,
        { hour: "2-digit", minute: "2-digit" });
}

export function countdown(iso) {
    if (!iso) return null;
    const now = Date.now();
    const then = new Date(iso).getTime();
    const days = Math.round((then - now) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days > 1) return `in ${days} days`;
    if (days === -1) return "Yesterday";
    return `${-days} days ago`;
}

/* toast — the one implementation is static/js/global/toast.js, loaded on
   every page; this re-export keeps the module import contract. */
export const toast = (message, kind = "info", action = null) =>
    window.toast(message, kind, action);

/* modal open/close — the global .modal-backdrop uses a .open class */
export function openModal(id) {
    document.getElementById(id)?.classList.add("open");
}
export function closeModal(id) {
    document.getElementById(id)?.classList.remove("open");
}
export function modalIsOpen(id) {
    return document.getElementById(id)?.classList.contains("open");
}

/* confirm — promise-based dialog over the shared modal markup */
let confirmResolve = null;

export function confirmDialog(text) {
    const backdrop = document.getElementById("confirmBackdrop");
    document.getElementById("confirmText").textContent = text;
    openModal("confirmBackdrop");
    return new Promise((resolve) => { confirmResolve = resolve; });
}

export function initConfirm() {
    const backdrop = document.getElementById("confirmBackdrop");
    if (!backdrop) return;
    const done = (value) => {
        closeModal("confirmBackdrop");
        confirmResolve?.(value);
        confirmResolve = null;
    };
    document.getElementById("confirmOkBtn").onclick = () => done(true);
    backdrop.querySelector("[data-action='confirm-cancel']").onclick = () => done(false);
    backdrop.onclick = (e) => { if (e.target === backdrop) done(false); };
}

/* datetime-local helpers (naive local wall-clock, matches the server) */
export function dtLocalValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
