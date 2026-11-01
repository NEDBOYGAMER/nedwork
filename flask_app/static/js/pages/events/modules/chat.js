/* Chat module — basic member chat. Newest last; deleted by author or
   host; "left" members keep their messages (username shows as (left)). */
import { el, icon, iconBtn, toast, fmtTime, fmtDate, confirmDialog } from "../ui.js";
import { chatUrl, chatMsgUrl, api } from "../api.js";

export function renderChat(root, ctx) {
    const { module, state, isHost, me, refresh } = ctx;
    const messages = state.messages || [];
    const myUserId = window.EVENT_USER_ID;
    const log = el("div", "chat-log");
    log.id = "chatLog";

    let lastDay = null;
    for (const message of messages) {
        const day = message.created_at?.slice(0, 10);
        if (day && day !== lastDay) {
            log.appendChild(el("div", "chat-day", fmtDate(message.created_at)));
            lastDay = day;
        }
        const row = el("div", `chat-row${message.user.id === myUserId ? " chat-mine" : ""}`);
        const head = el("div", "chat-head");
        head.appendChild(el("span", "chat-author", message.user.username));
        head.appendChild(el("span", "chat-time mono", fmtTime(message.created_at)));
        if (message.user.id === null) {
            head.appendChild(el("span", "badge badge-neutral", "left"));
        }
        if (isHost || message.user.id === myUserId) {
            const del = iconBtn("x", "Delete message", "btn-ghost-icon btn-sm-icon");
            del.onclick = async () => {
                if (!(await confirmDialog("Delete this message?"))) return;
                try { await api(chatMsgUrl(message.id), { method: "DELETE" }); await refresh(); }
                catch (e) { toast(e.message, "error"); }
            };
            head.appendChild(del);
        }
        row.appendChild(head);
        row.appendChild(el("p", "chat-text", message.text));
        log.appendChild(row);
    }
    root.appendChild(log);
    log.scrollTop = log.scrollHeight;

    if (me) {
        const form = el("form", "chat-form");
        form.onsubmit = (e) => e.preventDefault();
        const input = el("input", "field-input");
        input.type = "text";
        input.placeholder = "Message…";
        input.maxLength = 2000;
        const send = el("button", "btn btn-primary btn-sm", "Send");
        send.type = "submit";
        form.onsubmit = async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            try {
                await api(chatUrl(module.id), {
                    method: "POST",
                    body: JSON.stringify({ text }),
                });
                input.value = "";
                await refresh();
            } catch (e) { toast(e.message, "error"); }
        };
        form.append(input, send);
        root.appendChild(form);
    }
}
