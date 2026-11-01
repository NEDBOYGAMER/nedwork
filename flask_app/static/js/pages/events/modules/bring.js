/* Bring module — wishlist + claim board. Any member adds items; the host
   sets target quantities. "Popcorn ×3 — 2/3 claimed" progress per item. */
import { el, icon, toast, confirmDialog } from "../ui.js";
import { itemsUrl, itemUrl, claimUrl, api } from "../api.js";

export function renderBring(root, ctx) {
    const { module, state, isHost, me, refresh } = ctx;
    const items = state.items || [];
    const amHost = isHost;
    const myMemberId = me?.id;
    const memberNames = new Map(
        (state.members || []).map((m) => [m.id, m.user.username]));

    const addRow = el("div", "bring-add");
    const input = el("input", "field-input");
    input.type = "text";
    input.placeholder = "Add an item (e.g. chips)…";
    input.maxLength = 120;
    const qtyInput = el("input", "field-input bring-qty");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.value = "1";
    const addBtn = el("button", "btn btn-secondary btn-sm", "Add");
    addBtn.type = "button";
    addBtn.appendChild(icon("plus"));
    addBtn.onclick = async () => {
        const label = input.value.trim();
        if (!label) return;
        try {
            await api(itemsUrl(module.id), {
                method: "POST",
                body: JSON.stringify({ label, target_qty: Number(qtyInput.value) || 1 }),
            });
            input.value = "";
            qtyInput.value = "1";
            await refresh();
        } catch (e) { toast(e.message, "error"); }
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
    addRow.append(input, qtyInput, addBtn);
    root.appendChild(addRow);

    if (!items.length) {
        root.appendChild(el("p", "module-empty", "Nothing to bring yet."));
        return;
    }

    const list = el("ul", "bring-list");
    for (const item of items) {
        const li = el("li", "bring-item");
        const claimed = item.claimed_qty || 0;
        const full = claimed >= item.target_qty;

        const head = el("div", "bring-item-head");
        head.appendChild(el("span", "bring-item-label", item.label));
        head.appendChild(el("span", `badge mono ${full ? "badge-success" : "badge-accent"}`,
            `${claimed}/${item.target_qty} claimed`));
        li.appendChild(head);

        // my claim controls
        const myClaim = (item.claims || []).find((c) => c.member_id === myMemberId);
        const actions = el("div", "bring-item-actions");
        if (myMemberId) {
            if (myClaim) {
                const unclaim = el("button", "btn btn-secondary btn-sm", `Unclaim (${myClaim.qty})`);
                unclaim.type = "button";
                unclaim.onclick = async () => {
                    try { await api(claimUrl(item.id), { method: "DELETE" }); await refresh(); }
                    catch (e) { toast(e.message, "error"); }
                };
                actions.appendChild(unclaim);
            } else if (!full) {
                const claim = el("button", "btn btn-primary btn-sm", "Claim");
                claim.type = "button";
                claim.onclick = async () => {
                    const open = item.target_qty - claimed;
                    const qty = open > 1 ? Number(prompt(`How many? (1-${open})`, "1")) || 1 : 1;
                    try {
                        await api(claimUrl(item.id), {
                            method: "POST",
                            body: JSON.stringify({ qty }),
                        });
                        await refresh();
                    } catch (e) { toast(e.message, "error"); }
                };
                actions.appendChild(claim);
            }
        }
        // claims listing (public): "2× Lena"
        if (amHost) {
            const remove = el("button", "btn btn-sm btn-danger", "Remove");
            remove.type = "button";
            remove.onclick = async () => {
                if (!(await confirmDialog(`Remove “${item.label}” and its claims?`))) return;
                try { await api(itemUrl(item.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            actions.appendChild(remove);
        }
        const who = el("div", "bring-claims");
        for (const claim of item.claims || []) {
            who.appendChild(el("span", "badge badge-neutral",
                `${claim.qty}× ${memberNames.get(claim.member_id) || "?"}`));
        }
        li.appendChild(who);
        li.appendChild(actions);
        list.appendChild(li);
    }
    root.appendChild(list);
}
