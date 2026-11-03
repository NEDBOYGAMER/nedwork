/* Friend picker modal — accepted friends as a checkbox list + add by
   key/username for the rare non-friend. Uses the global .modal pattern. */
import { el, icon, toast, openModal, closeModal } from "./ui.js";
import { friendsUrl, userSearchUrl, api } from "./api.js";
import { addMembers, addMemberByKey } from "./modules/members.js";

export function openPicker(event, refresh) {
    const backdrop = document.getElementById("pickerBackdrop");
    const list = document.getElementById("pickerList");
    const search = document.getElementById("pickerSearch");
    const keyInput = document.getElementById("pickerKey");
    const suggestions = document.getElementById("pickerSuggestions");
    openModal("pickerBackdrop");

    let friends = [];
    let suggestTimer = null;
    let suggestSeq = 0;
    const selected = new Set();

    const clearSuggestions = () => {
        suggestions.innerHTML = "";
        suggestions.hidden = true;
    };

    const renderSuggestions = (users) => {
        suggestions.innerHTML = "";
        if (!users.length) {
            suggestions.hidden = true;
            return;
        }
        for (const user of users) {
            const row = el("button", "picker-row");
            row.type = "button";
            row.appendChild(el("span", "picker-name", user.username));
            row.appendChild(el("span", "picker-key mono", user.key));
            row.onclick = async () => {
                try {
                    await addMembers(event, [user.id], refresh);
                    closeModal("pickerBackdrop");
                } catch (e) { toast(e.message, "error"); }
            };
            suggestions.appendChild(row);
        }
        suggestions.hidden = false;
    };

    const render = () => {
        const query = search.value.trim().toLowerCase();
        list.innerHTML = "";
        const shown = friends.filter((f) =>
            !query || f.username.toLowerCase().includes(query));
        if (!shown.length) {
            list.appendChild(el("p", "module-empty",
                friends.length ? "No friends match." : "No friends yet."));
        }
        for (const friend of shown) {
            const row = el("label", "picker-row");
            const check = el("input");
            check.type = "checkbox";
            check.checked = selected.has(friend.id);
            check.onchange = () => {
                if (check.checked) selected.add(friend.id);
                else selected.delete(friend.id);
            };
            const name = el("span", "picker-name", friend.username);
            const key = el("span", "picker-key mono", friend.key);
            row.append(check, name, key);
            list.appendChild(row);
        }
    };

    search.value = "";
    keyInput.value = "";
    clearSuggestions();
    search.oninput = render;
    render();

    // live username suggestions for the manual add field (4+ chars)
    keyInput.oninput = () => {
        clearTimeout(suggestTimer);
        const query = keyInput.value.trim().replace(/^@/, "");
        if (query.length < 4) { clearSuggestions(); return; }
        suggestTimer = setTimeout(async () => {
            const seq = ++suggestSeq;
            try {
                const data = await api(userSearchUrl(query));
                if (seq !== suggestSeq) return;
                renderSuggestions(data.users || []);
            } catch {
                clearSuggestions();
            }
        }, 250);
    };

    api(friendsUrl())
        .then((data) => { friends = data.friends || []; render(); })
        .catch((e) => toast(e.message, "error"));

    document.getElementById("pickerAddBtn").onclick = async () => {
        if (!selected.size) { toast("Select at least one friend", "info"); return; }
        try {
            await addMembers(event, [...selected], refresh);
            closeModal("pickerBackdrop");
        } catch (e) { toast(e.message, "error"); }
    };

    document.getElementById("pickerKeyBtn").onclick = async () => {
        const lookup = keyInput.value.trim();
        if (!lookup) return;
        try {
            await addMemberByKey(event, lookup, refresh);
            closeModal("pickerBackdrop");
        } catch (e) { toast(e.message, "error"); }
    };
}

export function initPicker() {
    const backdrop = document.getElementById("pickerBackdrop");
    if (!backdrop) return;
    backdrop.querySelectorAll("[data-action='close-picker']")
        .forEach((b) => { b.onclick = () => closeModal("pickerBackdrop"); });
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal("pickerBackdrop");
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && backdrop.classList.contains("open")) {
            closeModal("pickerBackdrop");
        }
    });
}
