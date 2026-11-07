/* Car share — the one way to actually get a ride is to take a seat in an
   offered one. A status line shows where you stand (driving / riding /
   not in a car); "I need a ride" is a passive signal to drivers, not a
   competing action — it clears the moment you take a seat and comes back
   if your ride disappears. Drivers edit their ride in place. */
import { el, toast, confirmDialog } from "../ui.js";
import { needsRideUrl, ridesUrl, rideUrl, passengersUrl, api } from "../api.js";

export function renderRides(root, ctx) {
    const { module, event, state, isHost, me, refresh } = ctx;
    const rides = state.rides || [];
    const myMemberId = me?.id;
    const memberNames = new Map(
        (state.members || []).map((m) => [m.id, m.user.username]));

    if (!me) return;

    const myRide = rides.find((r) => r.driver?.member_id === myMemberId);
    const seatedRide = rides.find((r) =>
        (r.passengers || []).some((p) => p.member_id === myMemberId));

    // ── your status line ────────────────────────────────────────────────
    const status = el("div", "rides-status");
    root.appendChild(status);

    const showForm = (form, after) => {
        root.querySelectorAll(".ride-form").forEach((f) => f.remove());
        after.insertAdjacentElement("afterend", form);
    };

    const buildForm = (ride) => {
        const form = el("div", "ride-form");
        const seats = el("input", "field-input ride-seats");
        seats.type = "number";
        seats.min = "1";
        seats.max = "8";
        seats.value = String(ride?.seats ?? 3);
        const from = el("input", "field-input");
        from.type = "text";
        from.placeholder = "From — where you start";
        from.maxLength = 200;
        from.value = ride?.pickup_note || "";
        const to = el("input", "field-input");
        to.type = "text";
        to.placeholder = "To — destination";
        to.maxLength = 200;
        to.value = ride?.destination || "";
        const when = el("input", "field-input ride-when");
        when.type = "text";
        when.placeholder = "When — e.g. 18:30";
        when.maxLength = 40;
        when.value = ride?.departure || "";
        const save = el("button", "btn btn-primary btn-sm",
            ride ? "Save ride" : "Offer ride");
        save.type = "button";
        save.onclick = async () => {
            const body = {
                seats: Number(seats.value) || 1,
                pickup_note: from.value.trim() || null,
                destination: to.value.trim() || null,
                departure: when.value.trim() || null,
            };
            try {
                if (ride) {
                    await api(rideUrl(ride.id), {
                        method: "PATCH",
                        body: JSON.stringify(body),
                    });
                    toast("Ride updated", "success");
                } else {
                    await api(ridesUrl(module.id), {
                        method: "POST",
                        body: JSON.stringify(body),
                    });
                }
                form.remove();
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        const rowA = el("div", "host-content-row");
        rowA.append(seats, when);
        const rowB = el("div", "host-content-row");
        rowB.append(from, to, save);
        form.append(rowA, rowB);
        return form;
    };

    if (myRide) {
        const free = myRide.seats - (myRide.passengers || []).length;
        status.appendChild(el("span", "rides-status-text",
            `You're driving · ${free} seat${free === 1 ? "" : "s"} free`));
    } else if (seatedRide) {
        const name = seatedRide.driver?.user?.username || "the driver";
        status.appendChild(el("span", "rides-status-text",
            `You're riding with ${name}`));
    } else {
        status.appendChild(el("span", "rides-status-text",
            "You're not in a car yet"));
        const offer = el("button", "btn btn-sm btn-primary", "Offer a ride");
        offer.type = "button";
        offer.onclick = () => showForm(buildForm(null), status);
        status.appendChild(offer);
        // passive signal to drivers — the actual way to get a ride is the
        // "Take a seat" action on an offered ride below
        const need = el("button",
            `btn btn-sm needs-ride${me.needs_ride ? " is-on" : ""}`,
            "I need a ride");
        need.type = "button";
        need.onclick = async () => {
            try {
                await api(needsRideUrl(event.id), {
                    method: "PATCH",
                    body: JSON.stringify({ value: !me.needs_ride }),
                });
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        status.appendChild(need);
    }

    // ── offered rides list ──────────────────────────────────────────────
    if (!rides.length) {
        root.appendChild(el("p", "module-empty",
            "No rides offered yet — be the first to offer one."));
        return;
    }

    const list = el("ul", "ride-list");
    for (const ride of rides) {
        const passengers = ride.passengers || [];
        const taken = passengers.length;
        const free = ride.seats - taken;

        const isMine = ride.driver?.member_id === myMemberId;
        const li = el("li", isMine ? "ride-card is-mine" : "ride-card");
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
            const dot = el("span", `seat-dot${p ? " is-taken" : ""}`);
            if (p) dot.title = memberNames.get(p.member_id) || "taken";
            else dot.title = "Free seat";
            diagram.appendChild(dot);
        }
        diagram.appendChild(el("span", "hint",
            `${taken}/${ride.seats} seats taken`));
        li.appendChild(diagram);

        const mySeat = passengers.find((p) => p.member_id === myMemberId);
        const hasRide = !!(myRide || seatedRide);
        const actions = el("div", "ride-actions");

        // my ride — edit + remove live on the card (one place, no dup)
        if (ride.driver?.member_id === myMemberId) {
            actions.appendChild(el("span", "badge badge-accent", "Your ride"));
            const edit = el("button", "btn btn-secondary", "Edit my ride");
            edit.type = "button";
            edit.onclick = () => showForm(buildForm(ride), li);
            actions.appendChild(edit);
            const remove = el("button", "btn btn-danger btn-sm", "Remove ride");
            remove.type = "button";
            remove.onclick = async () => {
                if (!(await confirmDialog(
                    "Remove this ride? Passengers go back to the board."))) return;
                try { await api(rideUrl(ride.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(remove);
        } else if (mySeat) {
            actions.appendChild(el("span", "hint", "You're in this car"));
            const leave = el("button", "btn btn-secondary btn-sm", "Release my seat");
            leave.type = "button";
            leave.onclick = async () => {
                try { await api(passengersUrl(ride.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(leave);
        } else if (free > 0) {
            // other rides stay visible; if I already have a ride the join
            // is greyed out instead of hidden
            const join = el("button", "btn btn-primary btn-sm", "Take a seat");
            join.type = "button";
            join.disabled = hasRide;
            if (hasRide) join.title = "You already have a ride";
            join.onclick = async () => {
                if (hasRide) return;
                try { await api(passengersUrl(ride.id), { method: "POST" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(join);
        }
        // the host can remove anyone's ride (the driver manages their own
        // above) — no duplicate buttons
        if (isHost && ride.driver?.member_id !== myMemberId) {
            const remove = el("button", "btn btn-sm btn-danger", "Remove ride");
            remove.type = "button";
            remove.onclick = async () => {
                if (!(await confirmDialog(
                    "Remove this ride? Passengers go back to the board."))) return;
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