/* Poller — 60s short polling + revalidate on focus (master plan §8).
   Emits typed deltas so the UI can badge "new since your last visit".
   The server sends full section payloads (small groups make this cheap);
   the since-cursors only tell us which sections actually changed. */
import { dataUrl, api } from "./api.js";

const INTERVAL = 60_000;

export function startPolling(getEventId, onSnapshot, onError = null) {
    let timer = null;

    const fetchOnce = async (why) => {
        const id = getEventId();
        if (!id) return;
        let snap;
        try {
            snap = await api(dataUrl(id));
        } catch (e) {
            if (e.message?.includes("redirecting")) return;
            if (onError) onError(e, why);
            // transient network errors are otherwise swallowed; next tick retries
            return;
        }
        // render errors must NOT be swallowed as network errors —
        // surface them so a broken module renderer is visible in console
        try {
            onSnapshot(snap, why);
        } catch (e) {
            console.error("[events] render error:", e);
        }
    };

    const onFocus = () => fetchOnce("focus");
    const onVis = () => {
        if (document.visibilityState === "visible") fetchOnce("focus");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    fetchOnce("initial");
    timer = setInterval(() => {
        if (document.visibilityState === "visible") fetchOnce("poll");
    }, INTERVAL);
    return { stop: () => { clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVis); }, refresh: () => fetchOnce("manual") };
}
