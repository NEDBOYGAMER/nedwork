import { getHub } from "./notificationHub.js";

export const TOPICS = {
    socials: "socials",
    events: "events",
};

function debounced(handler, delay) {
    let timer = null;
    let pending = null;
    const run = (detail) => {
        pending = detail;
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            const next = pending;
            pending = null;
            try {
                handler(next);
            } catch (error) {
                console.error("[live] handler failed:", error);
            }
        }, delay);
    };
    run.cancel = () => {
        clearTimeout(timer);
        timer = null;
        pending = null;
    };
    return run;
}

export function onLive(topic, handler, { debounce = 150 } = {}) {
    const hub = getHub();
    const run = debounced(handler, debounce);
    const offTopic = hub.subscribeTopic(topic, run);
    const offSync = hub.subscribeSync(run);
    return () => {
        run.cancel();
        offTopic();
        offSync();
    };
}

export function onLiveSync(handler, { debounce = 150 } = {}) {
    const hub = getHub();
    const run = debounced(handler, debounce);
    const offSync = hub.subscribeSync(run);
    return () => {
        run.cancel();
        offSync();
    };
}
