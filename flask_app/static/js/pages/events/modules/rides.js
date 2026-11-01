/* Car share — two entries: "I need a ride" (flags me on the member list)
   and "I have a ride" (form: seats, from, to, when). Everyone sees the
   driver list with a seat diagram; clicking a free seat joins the ride.
   Passengers release their seat themselves; leaving/being removed
   releases seats/rides server-side. */
import { el, icon, toast, confirmDialog } from "../ui.js";
import { needsRideUrl, ridesUrl, rideUrl, passengersUrl, api } from "../api.js";

export function renderRides(root, ctx) {
    const { module, event, state, isHost, me, refresh } = ctx;
    const rides = state.rides || [];
    const amHost = isHost;
    const myMemberId = me?.id;
    const memberNames = new Map(
        (state.members || []).map((m) => [m.id, m.user.username]));

    if (!me) {
        root.appendChild(el("p", "module-empty", "No ride offers yet."));
        return;
    }

    // ── the two entries ────────────────────────────────────────────────
    const entry = el("div", "rides-entry");
    const needBtn = el("button",
        `btn btn-sm ${me.needs_ride ? "btn-primary" : "btn-secondary"}`,
        "I need a ride");
    needBtn.type = "button";
    needBtn.onclick = async () => {
        try {
            await api(needsRideUrl(event.id), {
                method: "PATCH",
                body: JSON.stringify({ value: !me.needs_ride }),
            });
            await refresh();
        } catch (e) { toast(e.message, "error"); }
    };

    const haveBtn = el("button", "btn btn-sm btn-secondary", "I have a ride");
    haveBtn.type = "button";
    entry.append(needBtn, haveBtn);
    root.appendChild(entry);

    // ── offer form (revealed by "I have a ride") ───────────────────────
    let form = null;
    haveBtn.onclick = () => {
        if (form) { form.remove(); form = null; return; }
        form = el("div", "ride-form");
        const seats = el("input", "field-input ride-seats");
        seats.type = "number";
        seats.min = "1";
        seats.max = "8";
        seats.value = "3";
        const from = el("input", "field-input");
        from.type = "text";
        from.placeholder = "From — where you start";
        from.maxLength = 200;
        const to = el("input", "field-input");
        to.type = "text";
        to.placeholder = "To — destination";
        to.maxLength = 200;
        const when = el("input", "field-input ride-when");
        when.type = "text";
        when.placeholder = "When — e.g. 18:30";
        when.maxLength = 40;
        const save = el("button", "btn btn-primary btn-sm", "Offer ride");
        save.type = "button";
        save.onclick = async () => {
            try {
                await api(ridesUrl(module.id), {
                    method: "POST",
                    body: JSON.stringify({
                        seats: Number(seats.value) || 1,
                        pickup_note: from.value.trim() || null,
                        destination: to.value.trim() || null,
                        departure: when.value.trim() || null,
                    }),
                });
                form.remove(); form = null;
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        const rowA = el("div", "host-content-row");
        rowA.append(seats, when);
        const rowB = el("div", "host-content-row");
        rowB.append(from, to, save);
        form.append(rowA, rowB);
        root.insertBefore(form, entry.nextSibling);
    };

    // ── driver list with seat diagrams ─────────────────────────────────
    if (!rides.length) {
        root.appendChild(el("p", "module-empty",
            me.needs_ride
                ? "You need a ride — nobody has offered one yet."
                : "No ride offers yet."));
        return;
    }

    const list = el("ul", "ride-list");
    for (const ride of rides) {
        const li = el("li", "ride-card");
        const passengers = ride.passengers || [];
        const taken = passengers.length;
        const free = ride.seats - taken;

        const head = el("div", "ride-head");
        head.appendChild(el("span", "ride-driver",
            `${ride.driver.user.username} drives`));
        if (ride.departure) {
            head.appendChild(el("span", "badge badge-info mono", ride.departure));
        }
        if (ride.pickup_note || ride.destination) {
            head.appendChild(el("span", "ride-route",
                `${ride.pickup_note || "?"} → ${ride.destination || "?"}`));
        }
        li.appendChild(head);

        // seat diagram — first dot is the driver, the rest are passenger
        // seats (filled = claimed; hover shows who)
        const diagram = el("div", "seat-diagram");
        const driverDot = el("span", "seat-dot seat-driver");
        driverDot.title = `${ride.driver.user.username} (driver)`;
        diagram.appendChild(driverDot);
        for (let i = 0; i < ride.seats; i++) {
            const p = passengers[i];
            const dot = el("span",
                `seat-dot${p ? " is-taken" : ""}`);
            if (p) dot.title = memberNames.get(p.member_id) || "taken";
            else dot.title = "Free seat";
            diagram.appendChild(dot);
        }
        diagram.appendChild(el("span", "hint",
            `${taken}/${ride.seats} seats taken`));
        li.appendChild(diagram);

        const mySeat = passengers.find((p) => p.member_id === myMemberId);
        const actions = el("div", "ride-actions");
        if (me && !mySeat && free > 0
                && ride.driver.member_id !== myMemberId) {
            const join = el("button", "btn btn-primary btn-sm", "Take a seat");
            join.type = "button";
            join.onclick = async () => {
                try { await api(passengersUrl(ride.id), { method: "POST" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(join);
        }
        if (mySeat) {
            const leave = el("button", "btn btn-secondary btn-sm", "Release my seat");
            leave.type = "button";
            leave.onclick = async () => {
                try { await api(passengersUrl(ride.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(leave);
        }
        if (amHost || (me && ride.driver.member_id === myMemberId)) {
            const remove = el("button", "btn btn-sm btn-danger", "Remove ride");
            remove.type = "button";
            remove.onclick = async () => {
                if (!(await confirmDialog("Remove this ride? Passengers go back to the board."))) return;
                try { await api(rideUrl(ride.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(remove);
        }
        if (actions.children.length) li.appendChild(actions);
        list.appendChild(li);
    }
    root.appendChild(list);
}
