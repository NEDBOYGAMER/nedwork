/* List view — my events grid. Drafts visible only to the host; archived
   only to the host. "New event" opens the create modal. */
import { el, icon, statusBadge, rsvpBadge, fmtDate, countdown, toast } from "./ui.js";
import { eventsUrl, api } from "./api.js";

export function renderListView(container, onOpen) {
    container.innerHTML = "";
    const grid = el("div", "events-grid");
    container.appendChild(grid);
    const loading = el("p", "module-empty", "Loading events…");
    grid.appendChild(loading);

    api(eventsUrl())
        .then((data) => {
            loading.remove();
            const events = data.events || [];
            if (!events.length) {
                grid.appendChild(emptyState());
                return;
            }
            for (const event of events) grid.appendChild(card(event, onOpen));
        })
        .catch((e) => {
            loading.remove();
            grid.appendChild(el("p", "alert alert-danger", e.message));
        });
}

function emptyState() {
    const wrap = el("div", "events-empty");
    wrap.appendChild(el("h2", null, "No events yet"));
    wrap.appendChild(el("p", "module-empty",
        "Create an event and invite your friends — doodle a date, split what to bring, organize rides."));
    return wrap;
}

function card(event, onOpen) {
    const card = el("button", "card event-card");
    card.type = "button";
    card.onclick = () => onOpen(event.id);

    const head = el("div", "event-card-head");
    const titles = el("div", "event-card-titles");
    titles.appendChild(el("h3", "event-card-title", event.title));
    if (event.subtitle) titles.appendChild(el("p", "event-card-subtitle", event.subtitle));
    head.appendChild(titles);

    const badges = el("div", "event-card-badges");
    if (event.status !== "published") badges.appendChild(statusBadge(event.status));
    if (event.is_host) badges.appendChild(el("span", "badge badge-accent", "Host"));
    if (event.my_rsvp && event.status === "published") badges.appendChild(rsvpBadge(event.my_rsvp));
    head.appendChild(badges);
    card.appendChild(head);

    const meta = el("div", "event-card-meta");
    const when = fmtDate(event.event_date);
    meta.appendChild(el("span", "event-card-date", when));
    const cd = countdown(event.event_date);
    if (cd) meta.appendChild(el("span", "badge badge-neutral", cd));
    if (event.status === "published") {
        meta.appendChild(el("span", "badge badge-neutral mono",
            `${event.attending}/${event.member_count} going`));
    }
    card.appendChild(meta);

    return card;
}

export function initCreateModal(onCreated) {
    const backdrop = document.getElementById("eventModalBackdrop");
    const form = document.getElementById("eventForm");
    const newBtn = document.getElementById("newEventBtn");
    if (!backdrop || !form) return;
    // the New event button only exists on the list view (hidden on
    // detail/edit pages, §6) — a null here must not kill app init
    if (!newBtn) return;

    const close = () => { backdrop.classList.remove("open"); form.reset(); };
    newBtn.onclick = () => { backdrop.classList.add("open"); };

    backdrop.querySelectorAll("[data-action='close-modal']")
        .forEach((b) => { b.onclick = close; });
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.classList.contains("open")) close();
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const title = form.title.value.trim();
        if (!title) { toast("Title is required", "error"); return; }
        const template = form.elements.template ? form.elements.template.value : "";
        try {
            const data = await api(eventsUrl(), {
                method: "POST",
                body: JSON.stringify({
                    title,
                    subtitle: form.subtitle.value.trim() || undefined,
                    template: template || undefined,
                }),
            });
            close();
            toast("Event created — draft", "success");
            onCreated?.(data.event);
        } catch (err) { toast(err.message, "error"); }
    };
}
