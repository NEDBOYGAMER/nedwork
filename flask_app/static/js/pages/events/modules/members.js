/* Members module — FIXED (always present, first). View mode: RSVP list
   only — removing people is an edit-mode setting (settingsMembers). */
import { el, rsvpBadge, toast } from "../ui.js";
import { rsvpUrl, transferUrl, api } from "../api.js";

const RSVP_VALUES = ["attending", "maybe", "cant"];

export function renderMembers(root, ctx) {
    const { module, event, state, isHost, me, refresh } = ctx;
    const members = state.members || [];
    const amHost = isHost;

    // my RSVP row (not the host — host is implicit attending); the
    // "Your RSVP:" label is gone (round 6) — the buttons speak for it
    if (me && me.role === "member") {
        const mine = members.find((m) => m.id === me.id) || me;
        const row = el("div", "rsvp-row");
        const group = el("div", "rsvp-group");
        for (const value of RSVP_VALUES) {
            const btn = el("button", "btn btn-sm " +
                (mine.rsvp === value ? "btn-primary" : "btn-secondary"));
            btn.type = "button";
            btn.textContent = { attending: "Going", maybe: "Maybe", cant: "Can't" }[value];
            btn.onclick = async () => {
                try {
                    await api(rsvpUrl(event.id), {
                        method: "POST",
                        body: JSON.stringify({ rsvp: value }),
                    });
                    await refresh();
                } catch (e) { toast(e.message, "error"); }
            };
            group.appendChild(btn);
        }
        row.appendChild(group);
        if (mine.rsvp_stale) {
            row.appendChild(el("span", "badge badge-warning", "Date changed — re-confirm"));
        }
        root.appendChild(row);
    }

    // member list
    const list = el("ul", "member-list");
    for (const member of members) {
        const li = el("li", "member-row");
        const info = el("div", "member-info");
        info.appendChild(el("span", "member-name", member.user.username));
        if (member.role === "host") {
            info.appendChild(el("span", "badge badge-accent", "Host"));
        }
        li.appendChild(info);
        li.appendChild(rsvpBadge(member.rsvp));
        if (member.rsvp_stale && member.rsvp !== "pending") {
            li.appendChild(el("span", "badge badge-warning", "stale"));
        }
        if (member.needs_ride) {
            li.appendChild(el("span", "badge badge-info", "needs ride"));
        }
        list.appendChild(li);
    }
    root.appendChild(list);

    // host-only handover lives with the members it acts on, not in the
    // page-bottom band (which floated detached on events without content)
    if (amHost && event.status !== "archived") {
        const actions = el("div", "host-actions-row");
        const transferBtn = el("button", "btn btn-secondary btn-sm",
            "Transfer host");
        transferBtn.type = "button";
        transferBtn.onclick = async () => {
            const others = (state.members || [])
                .filter((m) => m.role === "member");
            if (!others.length) {
                toast("No members to transfer to", "info");
                return;
            }
            const name = prompt("Transfer host to which member?\n" +
                others.map((m, i) => `${i + 1}. ${m.user.username}`).join("\n"));
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
        actions.appendChild(transferBtn);
        root.appendChild(actions);
    }
}

export async function addMembers(event, ids, refresh) {
    const data = await api(memberUrl(event.id), {
        method: "POST",
        body: JSON.stringify({ user_ids: ids }),
    });
    if (data.skipped?.length) {
        toast(`Added ${data.added}, skipped ${data.skipped.length} (already members)`, "info");
    } else {
        toast(`Added ${data.added} member${data.added === 1 ? "" : "s"}`, "success");
    }
    await refresh();
}

export async function addMemberByKey(event, lookup, refresh) {
    await api(byKeyUrl(event.id), {
        method: "POST",
        body: JSON.stringify({ key: lookup }),
    });
    toast("Member added", "success");
    await refresh();
}
