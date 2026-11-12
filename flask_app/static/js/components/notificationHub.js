/* Site-wide notification hub.

   One WebSocket per tab (`/ws/notifications`) plus the REST inbox as the
   authoritative source. The socket pushes the unread count instantly and
   new rows trigger a debounced list refresh, so every row always carries
   the live `action` annotation. When the socket is down the hub falls back
   to the old 60 s poll; when it is up, a 5-minute tick keeps the reminder
   scans running (the poll used to be the scheduler).

   Consumers: sidenav dot, /notifications page, dashboard widget, and the
   TierForge invite popup. Import `getHub()` (ES module) or listen for the
   `nedwork:notifications` window event (classic scripts). */

const LIST_URL = "/notifications/api/list";
const READ_URL = "/notifications/api/read";
const SCAN_MS = 5 * 60_000;
const FALLBACK_MS = 60_000;
const REFRESH_DEBOUNCE_MS = 250;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function isAuthed() {
    return window.NEDWORK_AUTHED === true
        || !!(window.TIERFORGE_USER && window.TIERFORGE_USER.id);
}

function socketUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const isDevServer = location.hostname === "localhost"
        && location.port === "5000";
    // `python app.py` serves the app on 5000 and the relay on 5001; every
    // other deployment is behind the same origin (nginx proxies the path).
    const base = isDevServer
        ? `${proto}://${location.hostname}:5001`
        : `${proto}://${location.host}`;
    return `${base}/ws/notifications`;
}

class NotificationHub {
    constructor() {
        this.items = [];
        this.unread = 0;
        this.connected = false;
        this.loaded = false;
        this.started = false;

        this.socket = null;
        this.reconnectTimer = null;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.scanTimer = null;
        this.fallbackTimer = null;
        this.refreshTimer = null;
        this.refreshing = false;
        this.refreshPromise = null;
        this.refreshQueued = false;
        this.lastRefresh = 0;
        this.listeners = new Set();

        this.onVisibility = () => {
            if (document.hidden) return;
            if (!this.connected
                || Date.now() - this.lastRefresh >= SCAN_MS) {
                this.refresh();
            }
        };
    }

    start() {
        if (this.started || !isAuthed()) return;
        this.started = true;
        this.refresh();
        this.connect();

        this.scanTimer = setInterval(() => {
            if (!document.hidden) this.refresh();
        }, SCAN_MS);
        this.fallbackTimer = setInterval(() => {
            if (!this.connected && !document.hidden) this.refresh();
        }, FALLBACK_MS);
        document.addEventListener("visibilitychange", this.onVisibility);
    }

    stop() {
        this.started = false;
        clearInterval(this.scanTimer);
        clearInterval(this.fallbackTimer);
        clearTimeout(this.reconnectTimer);
        clearTimeout(this.refreshTimer);
        this.scanTimer = null;
        this.fallbackTimer = null;
        this.reconnectTimer = null;
        this.refreshTimer = null;
        document.removeEventListener("visibilitychange", this.onVisibility);
        const socket = this.socket;
        this.socket = null;
        this.connected = false;
        if (socket) {
            try { socket.close(); } catch (_) { /* already gone */ }
        }
        this.emit();
    }

    state() {
        return {
            items: this.items,
            unread: this.unread,
            connected: this.connected,
            loaded: this.loaded,
        };
    }

    subscribe(callback) {
        this.listeners.add(callback);
        callback(this.state());
        return () => this.listeners.delete(callback);
    }

    emit() {
        const state = this.state();
        for (const callback of this.listeners) {
            try { callback(state); } catch (_) { /* isolated consumer */ }
        }
        window.dispatchEvent(
            new CustomEvent("nedwork:notifications", { detail: state }));
    }

    connect() {
        if (!this.started || this.socket) return;
        let socket;
        try {
            socket = new WebSocket(socketUrl());
        } catch (_) {
            // Blocked/invalid port (browser policy) still leaves the REST
            // fallback and the scan tick working.
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;

        socket.addEventListener("open", () => {
            if (this.socket !== socket) return;
            this.connected = true;
            this.reconnectDelay = RECONNECT_MIN_MS;
            this.refreshSoon();
            this.emit();
        });

        socket.addEventListener("message", (event) => {
            if (this.socket !== socket) return;
            this.handleMessage(event.data);
        });

        socket.addEventListener("close", (event) => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.connected = false;
            this.emit();
            if (event.code === 4401) {
                // Session row is gone/expired; a reconnect would fail.
                this.stop();
                return;
            }
            this.scheduleReconnect();
        });
    }

    scheduleReconnect() {
        if (!this.started || this.reconnectTimer) return;
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(
            this.reconnectDelay * 2, RECONNECT_MAX_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    handleMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch (_) { return; }
        if (!message || !message.type) return;

        if (message.type === "ready") {
            this.unread = Number(message.unread) || 0;
            // Reconnect/recovery: backfill rows and per-row actions over REST.
            this.refreshSoon();
            this.emit();
            return;
        }
        if (message.type === "notification" && message.notification) {
            const row = message.notification;
            if (!this.items.some((item) => item.id === row.id)) {
                if (!row.read) this.unread += 1;
            }
            // The pushed row has no `action`; refresh to get the authoritative
            // list (and keep the action buttons correct).
            this.refreshSoon();
            this.emit();
            return;
        }
        if (message.type === "unread") {
            const unread = Number(message.unread) || 0;
            // A drop means another tab marked rows read; refresh so this
            // tab's row styling agrees with the count.
            if (unread < this.unread) this.refreshSoon();
            this.unread = unread;
            this.emit();
        }
    }

    refreshSoon() {
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, REFRESH_DEBOUNCE_MS);
    }

    async refresh() {
        if (this.refreshing) {
            this.refreshQueued = true;
            return this.refreshPromise;
        }
        this.refreshing = true;
        this.refreshPromise = (async () => {
            try {
                const res = await fetch(LIST_URL,
                                        { credentials: "same-origin" });
                if (res.status === 401 || res.status === 403) {
                    this.stop();
                    return false;
                }
                if (!res.ok) return false;
                const data = await res.json();
                this.items = data.notifications || [];
                this.unread = Number(data.unread) || 0;
                this.loaded = true;
                this.lastRefresh = Date.now();
                this.emit();
                return true;
            } catch (_) {
                // Offline: keep the last known state; the fallback tick
                // retries.
                return false;
            }
        })();
        const ok = await this.refreshPromise;
        this.refreshing = false;
        this.refreshPromise = null;
        if (this.refreshQueued) {
            this.refreshQueued = false;
            this.refresh();
        }
        return ok;
    }

    async markRead(ids = null, all = false) {
        const body = all ? { all: true } : { ids: ids || [] };
        try {
            const res = await fetch(READ_URL, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) return this.unread;
            const data = await res.json();
            if (all) {
                this.items.forEach((item) => { item.read = true; });
            } else {
                const marked = new Set(ids || []);
                this.items.forEach((item) => {
                    if (marked.has(item.id)) item.read = true;
                });
            }
            this.unread = Number(data.unread ?? this.unread);
            this.emit();
        } catch (_) { /* local state already reflects the change */ }
        return this.unread;
    }
}

let hub = null;

export function getHub() {
    if (hub === null) hub = new NotificationHub();
    return hub;
}
