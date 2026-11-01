/* Invite landing — GET /events/invite/<token>. Shows the event; the
   Join button POSTs to the join API (login first if anonymous). */
const joinBtn = document.getElementById("inviteJoinBtn");
const hint = document.getElementById("inviteHint");

async function who() {
    try {
        const res = await fetch("/auth/api/who", { credentials: "same-origin" });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

(async function init() {
    if (!window.INVITE?.eventId) return;
    const me = await who();
    if (!me) {
        // no session: bounce to login, come straight back here
        hint.textContent = "Log in first — then we'll bring you right back.";
        window.location.href =
            "/auth/login?next=" + encodeURIComponent(window.location.pathname);
        return;
    }
    hint.textContent = "You're logged in — one click to join.";
    joinBtn.disabled = false;
    joinBtn.onclick = async () => {
        joinBtn.disabled = true;
        try {
            const csrf = document.cookie.split("; ")
                .find((c) => c.startsWith("csrf_token="))?.split("=")[1];
            const res = await fetch(
                `/events/api/events/${window.INVITE.eventId}/join`,
                {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrf || "",
                    },
                    body: JSON.stringify({ token: window.INVITE.token }),
                });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
            window.location.href = `/events/${window.INVITE.eventId}/`;
        } catch (e) {
            hint.textContent = e.message;
            joinBtn.disabled = false;
        }
    };
})();
