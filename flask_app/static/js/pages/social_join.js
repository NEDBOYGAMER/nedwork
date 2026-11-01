/* Group join landing — GET /socials/join/<code>. Shows the group; the
   button POSTs a join request (login first if anonymous). Mirrors the
   events invite landing. */
const joinBtn = document.getElementById("joinGroupBtn");
const hint = document.getElementById("joinHint");

async function who() {
    try {
        const res = await fetch("/auth/api/who", { credentials: "same-origin" });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

(async function init() {
    if (!window.SOCIAL_JOIN?.groupId) return;
    const me = await who();
    if (!me) {
        hint.textContent = "Log in first — then we'll bring you right back.";
        window.location.href =
            "/auth/login?next=" + encodeURIComponent(window.location.pathname);
        return;
    }
    joinBtn.disabled = false;
    joinBtn.onclick = async () => {
        joinBtn.disabled = true;
        try {
            const csrf = document.cookie.split("; ")
                .find((c) => c.startsWith("csrf_token="))?.split("=")[1];
            const res = await fetch(
                `/socials/api/groups/${window.SOCIAL_JOIN.groupId}/join`,
                {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrf || "",
                    },
                    body: JSON.stringify({ code: window.SOCIAL_JOIN.code }),
                });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
            hint.textContent =
                "Request sent — a group admin will confirm. You can close this page.";
            joinBtn.hidden = true;
        } catch (e) {
            hint.textContent = e.message;
            joinBtn.disabled = false;
        }
    };
})();
