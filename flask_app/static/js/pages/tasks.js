/* ==========================================================================
   Tasks page — vanilla JS, no dependencies.

   Private tasks: client-side encryption (PBKDF2 -> AES-GCM, key in memory
   only, server stores "enc:v1:..." envelopes). One passphrase = one key.
   Verification before adoption, >= 3s gear-spinner on every attempt.
   Locked tasks are read-only except delete; "Forgot passphrase?" wipes them.

   Gamification (client-side, per user via /me): XP per completion, levels,
   daily streak. Reopening never takes XP away.

   Interactions: click cycle active -> working -> done (celebration).
   Keyboard: cards/tabs focusable, Enter/Space activate, Esc closes layers.
   Touch: swipe right = done, left = delete (undo), long-press = menu.
   Drag: reorder in the All tab, drop on a tag pill to tag a task.
   Deletes are instant with an Undo toast. URL hash mirrors the view.
   ========================================================================== */

const state = {
    view: "overview",
    query: "",
    loadError: null,
    editingId: null,
    draftSubtasks: [],
    pendingDeleteId: null,
    pendingReset: false,
    pendingDiscard: false,
    afterUnlock: null,

    rawTasks: [],
    tasks: [],
    privateKey: null,
    privateSalt: null,

    userId: null,
    game: { xp: 0, streak: 0, lastDone: null },
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
const DONE_KEEP_DAYS = 7;

const CIPHER_PREFIX = "enc:v1:";
const PBKDF2_ITERATIONS = 250_000;
const UNLOCK_MIN_MS = 3_000;
const CELEBRATE_MS = 900;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const URGENCY_LABELS = {
    "overdue": "Overdue", "very high": "Very high", "high": "High",
    "medium": "Medium", "low": "Low", "very low": "Very low", "none": "No deadline",
};
const URGENCY_CLASS = {
    "overdue": "badge-danger-fill", "very high": "badge-danger-fill", "high": "badge-danger",
    "medium": "badge-warning", "low": "badge-info", "very low": "badge-neutral", "none": "badge-neutral",
};
const IMPORTANCE_LABELS = { "low": "Low", "medium": "Medium", "high": "High", "very high": "Very high" };
const IMPORTANCE_CLASS = { "low": "badge-info", "medium": "badge-warning", "high": "badge-danger", "very high": "badge-danger-fill" };
const IMPORTANCE_WEIGHT = { "low": 10, "medium": 20, "high": 50, "very high": 90 };
const IMPORTANCE_XP = { "low": 10, "medium": 20, "high": 30, "very high": 40 };
const BADGE_CLASSES = ["badge-accent", "badge-neutral", "badge-info", "badge-warning", "badge-danger", "badge-danger-fill", "badge-success"];

const ICON_NAMES = [
    "search", "plus", "x", "check", "minus", "edit", "trash", "copy",
    "calendar", "alert-circle", "lock", "lock-open", "arrow-right",
    "settings", "download", "star-filled", "chart-bar", "bell",
];
const CONFETTI_COLORS = ["var(--success)", "var(--accent)", "var(--warning)", "var(--info)"];

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const els = {
    nav: $("#tasks-nav"),
    container: $("#container"),
    toastContainer: $("#toastContainer"),
    dragHint: $("#dragHint"),
    search: $("#taskSearch"),
    lockBtn: $("#lockBtn"),
    newTaskBtn: $("#newTaskBtn"),
    exportBtn: $("#exportBtn"),

    backdrop: $("#taskModalBackdrop"),
    modalTitle: $("#taskModalTitle"),
    form: $("#taskForm"),
    name: $("#taskName"),
    nameError: $("#taskNameError"),
    deadline: $("#taskDeadline"),
    importance: $("#taskImportance"),
    recurrence: $("#taskRecurrence"),
    tags: $("#taskTags"),
    text: $("#taskText"),
    private: $("#taskPrivate"),
    passWrap: $("#taskPassWrap"),
    passphrase: $("#taskPassphrase"),
    passError: $("#taskPassError"),
    subtaskList: $("#subtaskList"),
    subtaskInput: $("#subtaskInput"),
    addSubtaskBtn: $("#addSubtaskBtn"),
    saveBtn: $("#taskSaveBtn"),

    unlockBackdrop: $("#unlockBackdrop"),
    unlockForm: $("#unlockForm"),
    unlockPass: $("#unlockPassphrase"),
    unlockError: $("#unlockError"),
    unlockBtn: $("#unlockBtn"),

    confirmBackdrop: $("#confirmBackdrop"),
    confirmText: $("#confirmText"),
    confirmForm: $("#confirmForm"),

    contextMenu: $("#taskContextMenu"),

    templates: {
        overviewCard: $("#overview-card-template"),
        shelf: $("#shelf-template"),
        task: $("#task-template"),
        empty: $("#empty-template"),
    },
};


/* -- icons -------------------------------------------------------------------- */

const iconUrl = name => `url("${window.STATIC_URL}img/icons/tabler-${name}.svg")`;

function setIcon(el, name) {
    el.style.setProperty("--icon", iconUrl(name));
}

function preloadIcons() {
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:fixed;left:-9999px;top:0;width:16px;height:16px;overflow:hidden;pointer-events:none;";
    for (const name of ICON_NAMES) {
        const span = document.createElement("span");
        span.className = "icon";
        span.style.setProperty("--icon", iconUrl(name));
        holder.appendChild(span);
    }
    document.body.appendChild(holder);
}


/* -- api ------------------------------------------------------------------------ */

async function api(url, options = {}) {
    const res = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (res.status === 401) {
        window.location.href = window.LOGIN_URL;   // expired session -> fresh login
        throw new Error("Session expired — redirecting to login");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

const listTasks  = ()      => api(window.TASKS_API_URL);
const apiCreate  = payload => api(window.TASKS_API_URL, { method: "POST", body: JSON.stringify(payload) });
const apiUpdate  = (id, patch) => api(`${window.TASKS_API_URL}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
const apiDelete  = id      => api(`${window.TASKS_API_URL}/${id}`, { method: "DELETE" });
const fetchSalt  = ()      => api(`${window.TASKS_API_URL}/private_salt`, { method: "POST" });
const apiPrivateReset = () => api(`${window.TASKS_API_URL}/private_reset`, { method: "POST" });
const apiReorder = order   => api(`${window.TASKS_API_URL}/reorder`, { method: "POST", body: JSON.stringify({ order }) });
const fetchMe    = ()      => api(`${window.TASKS_API_URL}/me`);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};


/* -- client-side crypto ------------------------------------------------------------ */

function bytesToB64(bytes) {
    let str = "";
    bytes.forEach(b => { str += String.fromCharCode(b); });
    return btoa(str);
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function derivePrivateKey(passphrase, saltHex) {
    const encoder = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

async function encryptField(key, value) {
    if (value === null || value === undefined) return value;
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(raw))
    );
    const out = new Uint8Array(iv.length + cipher.length);
    out.set(iv);
    out.set(cipher, iv.length);
    return CIPHER_PREFIX + bytesToB64(out);
}

async function decryptField(key, value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== "string" || !value.startsWith(CIPHER_PREFIX)) return value;
    try {
        const bytes = b64ToBytes(value.slice(CIPHER_PREFIX.length));
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)
        );
        const text = new TextDecoder().decode(plain);
        if (text.startsWith("[") || text.startsWith("{")) {
            try { return JSON.parse(text); } catch { /* plain string starting with [/{ */ }
        }
        return text;
    } catch {
        return null;
    }
}

async function ensurePrivateSalt() {
    if (state.privateSalt) return state.privateSalt;
    const data = await fetchSalt();
    state.privateSalt = data.salt;
    return state.privateSalt;
}

function findSampleCiphertext() {
    for (const t of state.rawTasks) {
        if (!t.private) continue;
        if (typeof t.name === "string" && t.name.startsWith(CIPHER_PREFIX)) return t.name;
        if (typeof t.text === "string" && t.text.startsWith(CIPHER_PREFIX)) return t.text;
    }
    return null;
}

async function verifyKey(key) {
    const sample = findSampleCiphertext();
    if (sample) return (await decryptField(key, sample)) !== null;
    const check = await encryptField(key, "test");
    return (await decryptField(key, check)) === "test";
}

async function encryptTaskFields(payload) {
    if (!state.privateKey) return payload;
    const out = { ...payload };
    for (const f of ["name", "text", "tags", "subtasks"]) {
        if (f in out) out[f] = await encryptField(state.privateKey, out[f]);
    }
    return out;
}

async function decryptTaskFields(task) {
    const dec = { ...task, _locked: false };
    dec.name     = await decryptField(state.privateKey, task.name);
    dec.text     = await decryptField(state.privateKey, task.text);
    dec.tags     = await decryptField(state.privateKey, task.tags ?? []);
    dec.subtasks = await decryptField(state.privateKey, task.subtasks ?? []);
    if (dec.name === null)     dec.name = "[couldn't decrypt]";
    if (dec.text === null)     dec.text = "[couldn't decrypt]";
    if (dec.tags === null)     dec.tags = [];
    if (dec.subtasks === null) dec.subtasks = [];
    return dec;
}

function maskLocked(task) {
    return { ...task, _locked: true, name: "Private task", text: null, tags: [], subtasks: [] };
}

async function presentTasks(rawTasks) {
    const out = [];
    for (const t of rawTasks) {
        if (!t.private)             out.push(t);
        else if (!state.privateKey) out.push(maskLocked(t));
        else                        out.push(await decryptTaskFields(t));
    }
    return out;
}


/* -- urgency / priority / sorting ---------------------------------------------------- */

function calcUrgency(task) {
    if (!task.deadline) return "none";
    const hoursLeft = (new Date(task.deadline).getTime() - Date.now()) / HOUR;
    if (Number.isNaN(hoursLeft)) return "none";
    if (hoursLeft < 0)   return "overdue";
    if (hoursLeft < 6)   return "very high";
    if (hoursLeft < 24)  return "high";
    if (hoursLeft < 168) return "medium";
    if (hoursLeft < 504) return "low";
    return "very low";
}

function calcPriority(task) {
    if (!task.deadline) return null;
    const weight = IMPORTANCE_WEIGHT[task.importance] ?? 0;
    const hoursLeft = (new Date(task.deadline).getTime() - Date.now()) / HOUR;
    if (Number.isNaN(hoursLeft)) return null;
    if (hoursLeft <= 0) return weight * 1e10;
    return weight / hoursLeft;
}

const byPriority  = (a, b) => (calcPriority(b) ?? -Infinity) - (calcPriority(a) ?? -Infinity);
const byCompleted = (a, b) => new Date(b.completed_at ?? 0) - new Date(a.completed_at ?? 0);
const byImportance = (a, b) =>
    (IMPORTANCE_WEIGHT[b.importance] ?? 0) - (IMPORTANCE_WEIGHT[a.importance] ?? 0) || byDeadline(a, b);
const byPosition = (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity);

function byDeadline(a, b) {
    const ta = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const tb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ta - tb;
}

function hasValidDeadline(task) {
    return !!task.deadline && !Number.isNaN(new Date(task.deadline).getTime());
}

/* relative when close, absolute when far — re-rendered every minute */
function humanSpan(ms) {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)}m`;
    const hours = Math.round(ms / HOUR);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(ms / DAY)}d`;
}

function dueText(task) {
    if (task.done) {
        if (!task.completed_at) return "Done";
        const remaining = Math.ceil(
            (new Date(task.completed_at).getTime() + DONE_KEEP_DAYS * DAY - Date.now()) / DAY
        );
        return remaining <= 0 ? "Deletes today" : `Done · deletes in ${remaining}d`;
    }
    if (!hasValidDeadline(task)) return "No due date";
    const diff = new Date(task.deadline).getTime() - Date.now();
    if (diff < 0) return `Overdue by ${humanSpan(-diff)}`;
    if (diff < 7 * DAY) return `Due in ${humanSpan(diff)}`;
    return "Due " + new Date(task.deadline).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
}

function isOverdue(task) {
    return !task.done && hasValidDeadline(task) && new Date(task.deadline).getTime() < Date.now();
}


/* -- gamification ------------------------------------------------------------------------ */

const gameKey = () => `tasks_game_${state.userId ?? "anon"}`;

function loadGame() {
    try {
        const raw = JSON.parse(localStorage.getItem(gameKey()) ?? "null");
        if (raw && typeof raw.xp === "number") state.game = raw;
    } catch { /* fresh start */ }
}

function saveGame() {
    localStorage.setItem(gameKey(), JSON.stringify(state.game));
}

/* progressive levels: level n costs n * 100 XP */
function levelInfo(xp) {
    let level = 1, acc = 0, need = 100;
    while (xp >= acc + need) { acc += need; level++; need = level * 100; }
    return { level, into: xp - acc, need };
}

function dayString(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* true if any task was due on at least one day strictly between the last
   completion day and today — those are the only days that may break a streak */
function gapDaysHadDueTasks(lastDoneStr, todayStr) {
    const parse = s => {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(y, m - 1, d);
    };
    for (let day = parse(lastDoneStr); day < parse(todayStr); day.setDate(day.getDate() + 1)) {
        const dayStr = dayString(day.getTime());
        if (dayStr === lastDoneStr) continue;   // the completion day itself doesn't count
        const hadDue = state.rawTasks.some(t => {
            if (!t.deadline) return false;
            const dl = new Date(t.deadline);
            if (Number.isNaN(dl.getTime())) return false;
            return dayString(dl.getTime()) === dayStr;
        });
        if (hadDue) return true;
    }
    return false;
}

function awardXP(task) {
    let gained = IMPORTANCE_XP[task.importance] ?? 20;
    if (hasValidDeadline(task) && new Date(task.deadline).getTime() >= Date.now()) gained += 15;

    const today = dayString(Date.now());
    if (state.game.lastDone !== today) {   // first completion of this day -> +1
        state.game.streak += 1;
        state.game.lastDone = today;
    }

    if (state.game.streak >= 3) gained += 10;
    gained += Math.min(state.game.streak, 10) * 2;   // streak kicker, capped

    const before = levelInfo(state.game.xp);
    state.game.xp += gained;
    saveGame();
    const after = levelInfo(state.game.xp);

    toast(`+${gained} XP${state.game.streak >= 3 ? ` · ${state.game.streak}-day streak` : ""}`, "success");

    if (after.level > before.level) {
        setTimeout(() => {
            toast(`Level ${after.level} reached!`, "level");
            playChime(true);
        }, 450);
        return true;   // level-up -> bigger celebration
    }
    return false;
}

/* -- toasts (with optional action button, e.g. Undo) ------------------------------------------ */

function toast(message, type = "info", action = null) {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", "status");

    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);

    if (action) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action";
        btn.textContent = action.label;
        btn.addEventListener("click", () => { el.remove(); action.fn(); });
        el.appendChild(btn);
    }

    els.toastContainer.appendChild(el);
    setTimeout(() => {
        el.classList.add("is-leaving");
        setTimeout(() => el.remove(), 300);
    }, action ? 6500 : 3800);
}


/* -- celebration --------------------------------------------------------------------------------- */

function playChime(big = false) {
    if (REDUCED_MOTION) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const notes = big
            ? [[523.25, 0], [659.25, .1], [783.99, .2], [1046.5, .32]]
            : [[523.25, 0], [783.99, .12]];
        notes.forEach(([freq, offset]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.4);
        });
        setTimeout(() => ctx.close().catch(() => {}), 1500);
    } catch { /* audio unavailable */ }
}

function celebrateCard(id, big = false) {
    const card = $(`.task-card[data-task-id="${id}"], .overview-card[data-task-id="${id}"]`);
    if (!card) return;

    playChime(big);
    card.classList.add("is-celebrating");
    const count = big ? 26 : 14;
    for (let i = 0; i < count; i++) {
        const bit = document.createElement("span");
        bit.className = "confetti-bit";
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = (big ? 60 : 40) + Math.random() * 55;
        bit.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
        bit.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist - 30)}px`);
        bit.style.setProperty("--rot", `${Math.round(Math.random() * 360)}deg`);
        bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        card.appendChild(bit);
    }

    setTimeout(() => {
        card.classList.remove("is-celebrating");
        $$(".confetti-bit", card).forEach(b => b.remove());
    }, CELEBRATE_MS);
}


/* -- state helpers --------------------------------------------------------------------------------- */

function adoptTask(task) {
    const i = state.rawTasks.findIndex(t => t.id === task.id);
    if (i >= 0) state.rawTasks[i] = task;
    else state.rawTasks.push(task);
}

const findTask = id => state.tasks.find(t => t.id === id);

async function refreshView() {
    state.tasks = await presentTasks(state.rawTasks);
    render();
}

/* optimistic: apply locally, render, fire the request, roll back on error */
async function patchTask(id, patch, successMsg = null, successType = "info") {
    const raw = state.rawTasks.find(t => t.id === id);
    const snapshot = raw ? { ...raw } : null;

    if (raw && "done" in patch) {
        raw.done = patch.done;
        raw.completed_at = patch.done ? new Date().toISOString() : null;
    }
    if (raw && "working" in patch) raw.working = patch.working;

    try {
        const data = await apiUpdate(id, patch);
        adoptTask(data.task);
        if (data.spawned) adoptTask(data.spawned);
        if (successMsg) toast(successMsg, successType);
        await refreshView();
        return true;
    } catch (err) {
        if (err.message.startsWith("Session expired")) return false;
        if (snapshot) adoptTask(snapshot);
        toast(err.message, "error");
        await refreshView();
        return false;
    }
}

async function setDone(task, done, celebrate = false) {
    if (done && celebrate && !REDUCED_MOTION) {
        const levelUp = awardXP(task);
        celebrateCard(task.id, levelUp);
        await wait(CELEBRATE_MS - 150);
    } else if (done) {
        awardXP(task);
    }
    await patchTask(task.id, { done }, null);
    if (done) toast(`“${task.name}” completed`, "success");
    else toast(`“${task.name}” reopened`, "info");
}

function cycleTaskState(task) {
    if (task._locked) {
        requestUnlock(() => cycleTaskState(findTask(task.id)));
        return;
    }
    if (task.done) {
        setDone(task, false);
    } else if (task.working) {
        setDone(task, true, true);
    } else {
        patchTask(task.id, { working: true });
    }
}

/* instant delete + Undo toast (undo re-creates the task with all fields) */
async function deleteTask(task) {
    try {
        await apiDelete(task.id);
        state.rawTasks = state.rawTasks.filter(t => t.id !== task.id);
        await refreshView();
        toast(`“${task._locked ? "Private task" : task.name}” deleted`, "info", {
            label: "Undo",
            fn: async () => {
                try {
                    let payload = {
                        name: task.name,
                        importance: task.importance,
                        deadline: task.deadline,
                        tags: task.tags ?? [],
                        text: task.text ?? "",
                        subtasks: task.subtasks ?? [],
                        private: !!task.private,
                        recurrence: task.recurrence ?? null,
                    };
                    if (payload.private) payload = await encryptTaskFields(payload);
                    const data = await apiCreate(payload);
                    adoptTask(data.task);
                    await refreshView();
                } catch (err) { toast(err.message, "error"); }
            },
        });
    } catch (err) {
        if (!err.message.startsWith("Session expired")) toast(err.message, "error");
    }
}

async function duplicateTask(task) {
    if (task._locked) return;
    try {
        let payload = {
            name: `${task.name} (copy)`.slice(0, 80),
            importance: task.importance,
            deadline: task.deadline,
            tags: task.tags ?? [],
            text: task.text ?? "",
            subtasks: (task.subtasks ?? []).map(s => ({ ...s })),
            private: !!task.private,
            recurrence: task.recurrence ?? null,
        };
        if (payload.private) payload = await encryptTaskFields(payload);
        const data = await apiCreate(payload);
        adoptTask(data.task);
        toast("Task duplicated", "success");
        await refreshView();
    } catch (err) {
        toast(err.message, "error");
    }
}


/* -- unlock / lock private tasks ---------------------------------------------------------------------- */

function openUnlock() {
    els.unlockError.hidden = true;
    els.unlockPass.value = "";
    openLayer(els.unlockBackdrop, els.unlockPass);
}

function closeUnlock() {
    closeLayer(els.unlockBackdrop);
    state.afterUnlock = null;
}

function requestUnlock(after = null) {
    state.afterUnlock = after;
    openUnlock();
}

async function withGearSpinner(btn, fn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "";
    const gear = document.createElement("span");
    gear.className = "icon is-spinning";
    setIcon(gear, "settings");
    btn.appendChild(gear);
    try {
        return await fn();
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
}

async function tryUnlock(passphrase) {
    const started = Date.now();
    const salt = await ensurePrivateSalt();
    const key = await derivePrivateKey(passphrase, salt);
    const ok = await verifyKey(key);

    const elapsed = Date.now() - started;
    if (elapsed < UNLOCK_MIN_MS) await wait(UNLOCK_MIN_MS - elapsed);

    if (!ok) return false;

    state.privateKey = key;
    await refreshView();
    toast("Private tasks unlocked", "success");
    return true;
}

els.unlockForm.addEventListener("submit", event => {
    event.preventDefault();
    const pass = els.unlockPass.value;
    if (!pass) return;

    withGearSpinner(els.unlockBtn, async () => {
        try {
            if (await tryUnlock(pass)) {
                closeUnlock();
                const after = state.afterUnlock;
                state.afterUnlock = null;
                if (after) after();
            } else {
                els.unlockError.hidden = false;
            }
        } catch (err) {
            if (!err.message.startsWith("Session expired")) toast(err.message, "error");
        }
    });
});

els.lockBtn.addEventListener("click", async () => {
    state.privateKey = null;
    await refreshView();
    toast("Private tasks locked", "info");
});

function injectResetControl() {
    const foot = $("#unlockBackdrop .task-modal-foot");
    if (!foot || $("#forgotPassBtn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "forgotPassBtn";
    btn.className = "btn btn-ghost";
    btn.textContent = "Forgot passphrase?";
    btn.addEventListener("click", () => {
        els.confirmText.textContent =
            "This permanently deletes ALL private tasks and resets your passphrase. " +
            "They cannot be recovered. Regular tasks are not affected.";
        state.pendingDeleteId = null;
        state.pendingReset = true;
        openLayer(els.confirmBackdrop, $("#confirmDeleteBtn"));
    });
    foot.insertBefore(btn, foot.firstChild);
}


/* -- modal layers: open/close + focus trap --------------------------------------------------------------- */

let lastFocused = null;

function openLayer(backdrop, focusEl = null) {
    lastFocused = document.activeElement;
    backdrop.classList.add("open");
    const panel = $(".task-modal", backdrop);
    panel.addEventListener("keydown", layerTabGuard);
    (focusEl ?? panel).focus();
}

function closeLayer(backdrop) {
    backdrop.classList.remove("open");
    const panel = $(".task-modal", backdrop);
    panel.removeEventListener("keydown", layerTabGuard);
    if (lastFocused?.isConnected) lastFocused.focus();
    lastFocused = null;
}

function layerTabGuard(event) {
    if (event.key !== "Tab") return;
    const panel = event.currentTarget;
    const focusables = $$(
        "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
        panel,
    ).filter(el => !el.hidden && !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
}


/* -- filtering ----------------------------------------------------------------------------------------------- */

function matchesFilters(task) {
    const tagView = state.view.startsWith("tag:");
    const doneView = state.view === "done";

    if (doneView) {
        if (!task.done) return false;
    } else if (task.done) {
        return false;
    }

    if (tagView && !(task.tags ?? []).includes(state.view.slice(4))) return false;

    const q = state.query.trim().toLowerCase();
    if (!q || task._locked) return true;
    const hay = [task.name, task.text ?? "", ...(task.tags ?? [])].join(" ").toLowerCase();
    return hay.includes(q);
}


/* -- URL hash <-> view ------------------------------------------------------------------------------------------ */

function viewToHash(view) {
    return view.startsWith("tag:") ? `#tag/${encodeURIComponent(view.slice(4))}` : `#${view}`;
}

function hashToView() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return "overview";
    if (h.startsWith("tag/")) return `tag:${h.slice(4)}`;
    return ["overview", "priority", "urgency", "importance", "all", "done"].includes(h) ? h : "overview";
}

function switchView(view) {
    state.view = view;
    if (viewToHash(state.view) !== location.hash) location.hash = viewToHash(state.view);
    render();
}

window.addEventListener("hashchange", () => {
    const view = hashToView();
    if (view !== state.view) switchView(view);
});


/* -- tabs ---------------------------------------------------------------------------------------------------------- */

function syncTagTabs() {
    $$(".tab[data-tag]", els.nav).forEach(el => el.remove());

    const tags = [...new Set(
        state.tasks.filter(t => !t.done && !t.private).flatMap(t => t.tags ?? [])
    )].sort((a, b) => a.localeCompare(b));

    if (state.view.startsWith("tag:") && !tags.includes(state.view.slice(4))) {
        state.view = "overview";
    }

    const controls = $(".tabs-controls", els.nav);
    for (const tag of tags) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tab tab-tag";
        btn.dataset.tag = tag;
        btn.dataset.view = `tag:${tag}`;
        btn.setAttribute("role", "tab");
        btn.textContent = `#${tag}`;
        btn.addEventListener("click", () => switchView(btn.dataset.view));
        els.nav.insertBefore(btn, controls);
    }

    $$(".tab", els.nav).forEach(t => {
        const active = t.dataset.view === state.view;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", String(active));
    });
}


/* -- rendering ------------------------------------------------------------------------------------------------------- */

function render() {
    syncTagTabs();
    els.lockBtn.hidden = !(state.privateKey && state.rawTasks.some(t => t.private));
    els.container.classList.toggle("is-overview", state.view === "overview");
    els.container.innerHTML = "";

    if (state.loadError) {
        renderError(state.loadError);
        return;
    }
    if (state.rawTasks.length === 0) {
        renderEmpty("No tasks yet", "Create your first task to get started.");
        return;
    }

    const tasks = state.tasks.filter(matchesFilters);
    if (tasks.length === 0) {
        renderEmpty("No matches", "Try a different search.");
        return;
    }

    renderView(tasks);
    sizeOverview();
}

function renderView(tasks) {
    const open = tasks.filter(t => !t.done);

    if (state.view === "overview") {
        renderOverview(open);
        return;
    }

    if (state.view === "done") {
        renderShelf("Completed", tasks, byCompleted, "Done tasks are removed automatically 7 days after completion.");
    } else if (state.view === "priority") {
        renderShelf("By priority", open, byPriority);
    } else if (state.view === "urgency") {
        renderShelf("By deadline", open.filter(hasValidDeadline), byDeadline);
    } else if (state.view === "importance") {
        renderShelf("By importance", open, byImportance);
    } else if (state.view.startsWith("tag:")) {
        renderShelf(`#${state.view.slice(4)}`, open, byPriority);
    } else {
        renderShelf("Active", open, byPosition, "Drag cards to reorder — this order is saved.");
    }

    if (!els.container.children.length) {
        renderEmpty("Nothing here", emptyHintFor(state.view));
    }
}

function emptyHintFor(view) {
    if (view === "done") return "No completed tasks yet — completed ones stay here for 7 days.";
    if (view === "urgency") return "Tasks with a deadline will show up here.";
    if (view === "all") return "No open tasks — completed ones are in the Done tab.";
    if (view.startsWith("tag:")) return "No active tasks with this tag.";
    return "Create a task or adjust the search.";
}

function statsData() {
    const done = state.tasks.filter(t => t.done);
    const weekAgo = Date.now() - DONE_KEEP_DAYS * DAY;
    return {
        open: state.tasks.filter(t => !t.done).length,
        overdue: state.tasks.filter(isOverdue).length,
        doneThisWeek: done.filter(t => t.completed_at && new Date(t.completed_at).getTime() >= weekAgo).length,
    };
}

function renderStats() {
    const { overdue, doneThisWeek } = statsData();
    const { level, into, need } = levelInfo(state.game.xp);

    const row = document.createElement("div");
    row.className = "stats-row";

    const chips = [
        {
            icon: "star-filled", cls: state.game.streak >= 3 ? "is-hot" : "",
            value: `${state.game.streak} day${state.game.streak === 1 ? "" : "s"}`,
            label: "Streak",
        },
        {
            icon: "check",
            value: String(doneThisWeek),
            label: "Done this week",
        },
        {
            icon: "bell", cls: overdue > 0 ? "is-bad" : "",
            value: String(overdue),
            label: "Overdue",
        },
    ];

    for (const chip of chips) {
        const el = document.createElement("div");
        el.className = "stat-chip";
        const icon = document.createElement("span");
        icon.className = `icon stat-icon ${chip.cls}`;
        setIcon(icon, chip.icon);
        const info = document.createElement("div");
        info.className = "stat-info";
        const value = document.createElement("p");
        value.className = "stat-value";
        value.textContent = chip.value;
        const label = document.createElement("p");
        label.className = "stat-label";
        label.textContent = chip.label;
        info.append(value, label);
        el.append(icon, info);
        row.appendChild(el);
    }

    // level chip with XP progress bar
    const levelChip = document.createElement("div");
    levelChip.className = "stat-chip";
    const levelIcon = document.createElement("span");
    levelIcon.className = "icon stat-icon";
    setIcon(levelIcon, "chart-bar");
    const levelInfoEl = document.createElement("div");
    levelInfoEl.className = "stat-info";
    const levelValue = document.createElement("p");
    levelValue.className = "stat-value";
    levelValue.textContent = `Level ${level}`;
    const levelLabel = document.createElement("p");
    levelLabel.className = "stat-label";
    levelLabel.textContent = `${state.game.xp} XP · ${need - into} to next level`;
    const bar = document.createElement("div");
    bar.className = "progress";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${Math.round((into / need) * 100)}%`;
    bar.appendChild(fill);
    levelInfoEl.append(levelValue, levelLabel, bar);
    levelChip.append(levelIcon, levelInfoEl);
    row.appendChild(levelChip);

    els.container.appendChild(row);
}

function sizeOverview() {
    if (state.view !== "overview" || window.innerWidth <= 640) {
        els.container.style.minHeight = "";
        return;
    }
    const top = els.container.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - (top - window.scrollY) - 32;
    els.container.style.minHeight = `${Math.max(320, Math.floor(available))}px`;
}

window.addEventListener("resize", sizeOverview);

/* overview: gamification strip + three EXCLUSIVE rows (each task once) */
function renderOverview(open) {
    renderStats();

    if (!open.length) {
        renderEmpty("All caught up", "Nothing open — completed tasks are in the Done tab.");
        return;
    }

    const byPrio = [...open].sort(byPriority);
    const topPrio = byPrio.slice(0, 5);

    const restAfterPrio = open.filter(t => !topPrio.includes(t));
    const urgent = restAfterPrio.filter(hasValidDeadline).sort(byDeadline).slice(0, 5);

    const restAfterUrgent = restAfterPrio.filter(t => !urgent.includes(t));
    const important = [...restAfterUrgent].sort(byImportance).slice(0, 5);

    const rows = [
        { title: "Top priority",   items: topPrio,   tab: "priority" },
        { title: "Most urgent",    items: urgent,    tab: "urgency" },
        { title: "Most important", items: important, tab: "importance" },
    ];

    for (const row of rows) {
        const section = document.createElement("section");
        section.className = "overview-row";

        const head = document.createElement("header");
        head.className = "overview-row-head";

        const title = document.createElement("h3");
        title.className = "overview-row-title";
        title.textContent = row.title;

        const arrow = document.createElement("button");
        arrow.type = "button";
        arrow.className = "btn-ghost-icon overview-arrow";
        arrow.title = `Open ${row.title.toLowerCase()}`;
        const icon = document.createElement("span");
        icon.className = "icon";
        setIcon(icon, "arrow-right");
        arrow.appendChild(icon);
        arrow.addEventListener("click", () => switchView(row.tab));

        head.append(title, arrow);
        section.appendChild(head);

        if (row.items.length) {
            const grid = document.createElement("div");
            grid.className = "overview-row-grid";
            row.items.forEach(task => makeOverviewCard(task, grid));
            section.appendChild(grid);
        } else {
            const hint = document.createElement("p");
            hint.className = "overview-row-hint";
            hint.textContent = "Nothing here right now.";
            section.appendChild(hint);
        }

        els.container.appendChild(section);
    }
}

function renderShelf(title, items, sortFn, hint = null) {
    if (!items.length) return;
    const shelf = els.templates.shelf.content.firstElementChild.cloneNode(true);
    $('[data-field="title"]', shelf).textContent = title;
    $('[data-field="count"]', shelf).textContent = items.length;
    const hintEl = $('[data-field="hint"]', shelf);
    if (hint) {
        hintEl.textContent = hint;
        hintEl.hidden = false;
    }
    const grid = $(".task-shelf-grid", shelf);
    [...items].sort(sortFn).forEach(task => makeCard(task, grid));
    els.container.appendChild(shelf);
}

function renderLoading() {
    els.container.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "task-shelf-grid";
    for (let i = 0; i < 6; i++) {
        const sk = document.createElement("div");
        sk.className = "task-card card skeleton task-skeleton";
        grid.appendChild(sk);
    }
    els.container.appendChild(grid);
}

function renderError(message) {
    const alert = document.createElement("div");
    alert.className = "alert alert-danger";
    alert.textContent = message;
    els.container.appendChild(alert);
}

function renderEmpty(title, hint) {
    const el = els.templates.empty.content.firstElementChild.cloneNode(true);
    $('[data-field="title"]', el).textContent = title;
    $('[data-field="hint"]', el).textContent = hint;
    els.container.appendChild(el);
}

function setBadge(root, field, text, levelClass) {
    const el = $(`[data-field="${field}"]`, root);
    el.classList.remove(...BADGE_CLASSES);
    el.classList.add(levelClass);
    $("[data-field-text]", el).textContent = text;
}

/* search highlighting — built from text nodes, so no injection risk */
function setHighlighted(el, text, q) {
    el.textContent = "";
    if (!text) return;
    if (!q) { el.textContent = text; return; }
    const lower = text.toLowerCase();
    let i = 0;
    while (true) {
        const hit = lower.indexOf(q, i);
        if (hit === -1) { el.appendChild(document.createTextNode(text.slice(i))); break; }
        if (hit > i) el.appendChild(document.createTextNode(text.slice(i, hit)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(hit, hit + q.length);
        el.appendChild(mark);
        i = hit + q.length;
    }
}


/* -- cards -------------------------------------------------------------------------------------------------------------- */

function openTaskEditor(task) {
    if (task._locked) {
        requestUnlock(() => openModal(findTask(task.id)));
        return;
    }
    openModal(task);
}

function addCardActivation(card, task) {
    card.addEventListener("click", event => {
        if (event.target.closest("button, input, a")) return;
        cycleTaskState(task);
    });
    card.addEventListener("keydown", event => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            cycleTaskState(task);
        }
    });
    addTouchGestures(card, task);
}

function makeOverviewCard(task, parent) {
    const card = els.templates.overviewCard.content.firstElementChild.cloneNode(true);
    card.dataset.taskId = task.id;
    card.classList.toggle("is-locked", !!task._locked);
    card.classList.toggle("is-working", !!task.working && !task.done);

    $('[data-field="name"]', card).textContent = task.name;
    $('[data-field="lock"]', card).hidden = !task.private;

    const textEl = $('[data-field="text"]', card);
    textEl.textContent = task.text ?? "";
    textEl.hidden = !task.text;

    const urgency = calcUrgency(task);
    setBadge(card, "urgency", URGENCY_LABELS[urgency], URGENCY_CLASS[urgency]);
    setBadge(card, "importance", IMPORTANCE_LABELS[task.importance] ?? task.importance, IMPORTANCE_CLASS[task.importance] ?? "badge-neutral");

    const dueEl = $('[data-field="due"]', card);
    dueEl.textContent = dueText(task);
    dueEl.classList.toggle("is-overdue", isOverdue(task));

    addCardActivation(card, task);
    parent.appendChild(card);
}

function makeCard(task, parent) {
    const card = els.templates.task.content.firstElementChild.cloneNode(true);
    card.dataset.taskId = task.id;

    const isLocked = !!task._locked;
    const q = state.query.trim().toLowerCase();
    card.classList.toggle("is-locked", isLocked);
    card.classList.toggle("is-finished", !!task.done);
    card.classList.toggle("is-working", !!task.working && !task.done);

    // manual drag order is available in the All tab for unlocked tasks
    card.draggable = state.view === "all" && !isLocked;

    setHighlighted($('[data-field="name"]', card), task.name, q);

    $('[data-field="urgency"]', card).hidden = !!task.done;
    const urgency = calcUrgency(task);
    setBadge(card, "urgency", URGENCY_LABELS[urgency], URGENCY_CLASS[urgency]);
    setBadge(card, "importance", IMPORTANCE_LABELS[task.importance] ?? task.importance, IMPORTANCE_CLASS[task.importance] ?? "badge-neutral");

    const recEl = $('[data-field="recurrence"]', card);
    recEl.hidden = !task.recurrence;
    if (task.recurrence) $("[data-field-text]", recEl).textContent = `Repeats ${task.recurrence}`;

    $('[data-field="private"]', card).hidden = !task.private;
    $('[data-field="working-flag"]', card).hidden = !(task.working && !task.done);

    const textEl = $('[data-field="text"]', card);
    setHighlighted(textEl, task.text ?? "", q);
    textEl.hidden = !task.text;

    renderCardSubtasks(task, card);

    const tagsEl = $('[data-field="tags"]', card);
    (task.tags ?? []).forEach(tag => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.textContent = tag;
        tagsEl.appendChild(pill);
    });

    const dueEl = $('[data-field="due"]', card);
    dueEl.textContent = dueText(task);
    dueEl.classList.toggle("is-overdue", isOverdue(task));

    $('[data-field="done-flag"]', card).hidden = !task.done;

    const editBtn = $('[data-action="edit"]', card);
    editBtn.hidden = isLocked;

    const toggleBtn = $('[data-action="toggle-done"]', card);
    toggleBtn.hidden = isLocked;
    toggleBtn.title = task.done ? "Reopen" : "Mark done";
    setIcon($(".task-toggle-icon", toggleBtn), task.done ? "minus" : "check");

    editBtn.addEventListener("click", () => openTaskEditor(task));
    $('[data-action="delete"]', card).addEventListener("click", () => deleteTask(task));
    toggleBtn.addEventListener("click", () => setDone(task, !task.done, !task.done));

    addCardActivation(card, task);
    if (state.view === "all" && !isLocked) addDragHandlers(card, task);

    parent.appendChild(card);
}

function renderCardSubtasks(task, card) {
    const wrap = $('[data-field="subtasks-wrap"]', card);
    const list = $('[data-field="subtasks"]', card);
    const count = $('[data-field="subtasks-count"]', card);
    const fill = $('[data-field="subtasks-progress"]', card);
    const subs = task.subtasks ?? [];

    wrap.hidden = subs.length === 0;
    list.innerHTML = "";
    if (!subs.length) return;

    const doneCount = subs.filter(s => s.done).length;
    count.textContent = `${doneCount}/${subs.length}`;
    fill.style.width = `${Math.round((doneCount / subs.length) * 100)}%`;

    subs.forEach((sub, index) => {
        const li = document.createElement("li");
        if (sub.done) li.classList.add("is-done");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!sub.done;
        cb.disabled = isLocked(task);
        cb.addEventListener("change", () => {
            const next = (task.subtasks ?? []).map((s, i) => ({ ...s, done: i === index ? cb.checked : s.done }));
            patchTask(task.id, { subtasks: next });
        });

        const span = document.createElement("span");
        span.textContent = sub.name;

        li.append(cb, span);
        list.appendChild(li);
    });
}

function isLocked(task) { return !!task._locked; }


/* -- touch gestures: swipe right = done, left = delete, long-press = menu -------------------------------------------------- */

function addTouchGestures(card, task) {
    let startX = 0, startY = 0, dx = 0, tracking = false, swiping = false;
    let pressTimer = null;

    card.addEventListener("touchstart", event => {
        if (event.touches.length !== 1) return;
        if (event.target.closest("button, input, a")) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        dx = 0;
        tracking = true;
        swiping = false;

        pressTimer = setTimeout(() => {
            if (!tracking || swiping) return;
            tracking = false;
            if (navigator.vibrate) navigator.vibrate(30);
            const t = event.touches[0];
            openContextMenuAt(t.clientX, t.clientY, task);
        }, 550);
    }, { passive: true });

    card.addEventListener("touchmove", event => {
        if (!tracking) return;
        dx = event.touches[0].clientX - startX;
        const dy = event.touches[0].clientY - startY;

        if (!swiping && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) + 8) {
            swiping = true;
            clearTimeout(pressTimer);
            card.classList.add("swiping");
        }
        if (swiping) {
            event.preventDefault();
            card.style.transform = `translateX(${dx}px)`;
            card.classList.toggle("swipe-done", dx > 70);
            card.classList.toggle("swipe-delete", dx < -70);
        } else if (Math.abs(dy) > 12) {
            clearTimeout(pressTimer);   // scrolling — not a long-press
            tracking = false;
        }
    }, { passive: false });

    const finish = () => {
        clearTimeout(pressTimer);
        if (!tracking && !swiping) return;
        tracking = false;
        card.classList.remove("swiping", "swipe-done", "swipe-delete");
        card.style.transform = "";

        if (swiping && dx > 80) {
            if (task._locked) requestUnlock(() => cycleTaskState(findTask(task.id)));
            else if (task.done) setDone(task, false);
            else if (task.working) setDone(task, true, true);
            else patchTask(task.id, { working: true });
        } else if (swiping && dx < -80) {
            deleteTask(task);
        }
        swiping = false;
    };

    card.addEventListener("touchend", finish);
    card.addEventListener("touchcancel", finish);
}


/* -- drag & drop: reorder in All tab, drop on tag pill to tag ---------------------------------------------------------------- */

let dragTaskId = null;
let dropIndicator = null;

function addDragHandlers(card, task) {
    card.addEventListener("dragstart", event => {
        dragTaskId = task.id;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        try { event.dataTransfer.setData("text/plain", String(task.id)); } catch {}
        els.dragHint.hidden = false;
    });

    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        dragTaskId = null;
        clearDropIndicator();
        els.dragHint.hidden = true;
        $$(".tab-tag.drop-target", els.nav).forEach(el => el.classList.remove("drop-target"));
    });
}

function clearDropIndicator() {
    if (dropIndicator) { dropIndicator.remove(); dropIndicator = null; }
}

function showDropIndicator(grid, beforeCard) {
    clearDropIndicator();
    dropIndicator = document.createElement("div");
    dropIndicator.className = "drop-indicator";
    if (beforeCard) grid.insertBefore(dropIndicator, beforeCard);
    else grid.appendChild(dropIndicator);
}

async function commitReorder(grid) {
    const cards = $$(".task-card", grid);
    const order = cards.map(c => Number(c.dataset.taskId));

    // optimistic: rewrite positions locally and re-render
    order.forEach((id, index) => {
        const raw = state.rawTasks.find(t => t.id === id);
        if (raw) raw.position = index;
    });
    await refreshView();

    try { await apiReorder(order); }
    catch (err) { if (!err.message.startsWith("Session expired")) toast(err.message, "error"); }
}

function wireDragTargets() {
    els.container.addEventListener("dragover", event => {
        if (state.view !== "all" || dragTaskId === null) return;
        const grid = event.target.closest(".task-shelf-grid");
        if (!grid) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        const card = event.target.closest(".task-card");
        if (card && Number(card.dataset.taskId) !== dragTaskId) {
            const rect = card.getBoundingClientRect();
            showDropIndicator(grid, (event.clientX - rect.left) < rect.width / 2 ? card : card.nextSibling);
        } else if (!card) {
            showDropIndicator(grid, null);
        }
    });

    els.container.addEventListener("drop", event => {
        if (state.view !== "all" || dragTaskId === null) return;
        const grid = event.target.closest(".task-shelf-grid");
        if (!grid) return;
        event.preventDefault();

        // dropping on a card: move the dragged card in the DOM first
        const dragged = $(`.task-card[data-task-id="${dragTaskId}"]`, els.container);
        const target = event.target.closest(".task-card");
        if (dragged && target && dragged !== target) {
            const rect = target.getBoundingClientRect();
            const before = (event.clientX - rect.left) < rect.width / 2;
            grid.insertBefore(dragged, before ? target : target.nextSibling);
        }
        clearDropIndicator();
        commitReorder(grid);
    });

    els.container.addEventListener("dragleave", event => {
        if (event.target.closest?.(".task-shelf-grid")) return;
        clearDropIndicator();
    });

    // tag pills as drop targets: add the tag to the dragged task
    els.nav.addEventListener("dragover", event => {
        const pill = event.target.closest(".tab-tag");
        if (!pill || dragTaskId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        pill.classList.add("drop-target");
    });

    els.nav.addEventListener("dragleave", event => {
        const pill = event.target.closest(".tab-tag");
        if (pill) pill.classList.remove("drop-target");
    });

    els.nav.addEventListener("drop", async event => {
        const pill = event.target.closest(".tab-tag");
        if (!pill || dragTaskId === null) return;
        event.preventDefault();
        pill.classList.remove("drop-target");

        const raw = state.rawTasks.find(t => t.id === dragTaskId);
        const view = state.tasks.find(t => t.id === dragTaskId);
        dragTaskId = null;
        els.dragHint.hidden = true;
        if (!raw || !view || raw.private) return;   // private tags are encrypted — can't merge

        const tag = pill.dataset.tag;
        if ((view.tags ?? []).includes(tag)) return;

        const next = [...(view.tags ?? []), tag];
        patchTask(view.id, { tags: next }, `Tagged #${tag}`, "success");
    });
}


/* -- create / edit modal ---------------------------------------------------------------------------------------------------------- */

function syncPassWrap() {
    els.passWrap.hidden = !(els.private.checked && !state.privateKey);
}

els.private.addEventListener("change", () => { state.formDirty = true; syncPassWrap(); });

function openModal(task = null) {
    state.editingId = task ? task.id : null;
    state.formDirty = false;
    state.draftSubtasks = (task?.subtasks ?? []).map(s => ({ ...s }));

    els.modalTitle.textContent = task ? "Edit task" : "New task";
    els.form.reset();
    els.nameError.hidden = true;
    els.passError.hidden = true;
    els.name.classList.remove("wrong");

    if (task) {
        els.name.value = task.name;
        els.importance.value = task.importance;
        els.deadline.value = task.deadline ? task.deadline.slice(0, 16) : "";
        els.recurrence.value = task.recurrence ?? "";
        els.tags.value = (task.tags ?? []).join(", ");
        els.text.value = task.text ?? "";
        els.private.checked = !!task.private;
    }

    syncPassWrap();
    renderSubtaskEditor();
    openLayer(els.backdrop, els.name);
}

function closeModal(force = false) {
    if (!force && state.formDirty && state.editingId !== null) {
        els.confirmText.textContent = "Discard your changes to this task?";
        state.pendingDiscard = true;
        state.pendingReset = false;
        state.pendingDeleteId = null;
        openLayer(els.confirmBackdrop, $("#confirmDeleteBtn"));
        return;
    }
    closeLayer(els.backdrop);
    state.editingId = null;
    state.draftSubtasks = [];
    state.formDirty = false;
}

function renderSubtaskEditor() {
    els.subtaskList.innerHTML = "";

    state.draftSubtasks.forEach((sub, index) => {
        const li = document.createElement("li");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!sub.done;
        cb.title = sub.done ? "Done" : "Not done";
        cb.addEventListener("change", () => { state.draftSubtasks[index].done = cb.checked; });

        const input = document.createElement("input");
        input.type = "text";
        input.value = sub.name;
        input.maxLength = 200;
        input.addEventListener("input", () => { state.draftSubtasks[index].name = input.value; });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-ghost-icon btn-ghost-danger";
        remove.title = "Remove subtask";
        const icon = document.createElement("span");
        icon.className = "icon";
        setIcon(icon, "x");
        remove.appendChild(icon);
        remove.addEventListener("click", () => {
            state.draftSubtasks.splice(index, 1);
            renderSubtaskEditor();
        });

        li.append(cb, input, remove);
        els.subtaskList.appendChild(li);
    });
}

function addSubtask() {
    const name = els.subtaskInput.value.trim();
    if (!name) return;
    state.draftSubtasks.push({ name: name.slice(0, 200), done: false });
    els.subtaskInput.value = "";
    els.subtaskInput.focus();
    renderSubtaskEditor();
}

function buildPayload(name, willBePrivate) {
    return {
        name,
        importance: els.importance.value,
        deadline: els.deadline.value || null,
        recurrence: els.recurrence.value || null,
        tags: els.tags.value,
        text: els.text.value,
        subtasks: state.draftSubtasks,
        private: willBePrivate,
    };
}

async function submitPayload(payload) {
    const data = state.editingId !== null
        ? await apiUpdate(state.editingId, payload)
        : await apiCreate(payload);
    adoptTask(data.task);
    if (data.spawned) adoptTask(data.spawned);
    toast(state.editingId !== null ? "Task updated" : "Task created", "success");
    closeLayer(els.backdrop);
    state.editingId = null;
    state.formDirty = false;
    await refreshView();
}

els.form.addEventListener("input", () => { state.formDirty = true; });

/* quick deadline picks — keep the time if one is set, else 18:00 */
function setQuickDeadline(which) {
    const now = new Date();
    const target = new Date(now);
    if (which === "tomorrow") target.setDate(target.getDate() + 1);
    if (which === "week") target.setDate(target.getDate() + 7);

    const existing = els.deadline.value ? new Date(els.deadline.value) : null;
    target.setHours(existing && !isNaN(existing) ? existing.getHours() : 18,
                    existing && !isNaN(existing) ? existing.getMinutes() : 0, 0, 0);

    const pad = n => String(n).padStart(2, "0");
    els.deadline.value =
        `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}` +
        `T${pad(target.getHours())}:${pad(target.getMinutes())}`;
    state.formDirty = true;
}

$$("[data-quick]").forEach(btn => btn.addEventListener("click", () => setQuickDeadline(btn.dataset.quick)));

els.form.addEventListener("submit", event => {
    event.preventDefault();

    const name = els.name.value.trim();
    if (!name) {
        els.nameError.hidden = false;
        els.name.classList.add("wrong");
        els.name.focus();
        return;
    }

    const willBePrivate = els.private.checked;

    if (willBePrivate && !state.privateKey) {
        const pass = els.passphrase.value;
        if (!pass) {
            els.passError.textContent = "Enter your private passphrase to encrypt this task.";
            els.passError.hidden = false;
            return;
        }

        withGearSpinner(els.saveBtn, async () => {
            try {
                const unlocked = await tryUnlock(pass);
                if (!unlocked) {
                    els.passError.textContent = "Wrong passphrase for your existing private tasks.";
                    els.passError.hidden = false;
                    return;
                }
                await submitPayload(await encryptTaskFields(buildPayload(name, willBePrivate)));
            } catch (err) {
                if (!err.message.startsWith("Session expired")) toast(err.message, "error");
            }
        });
        return;
    }

    els.saveBtn.disabled = true;
    (async () => {
        try {
            let payload = buildPayload(name, willBePrivate);
            if (willBePrivate) payload = await encryptTaskFields(payload);
            await submitPayload(payload);
        } catch (err) {
            if (!err.message.startsWith("Session expired")) toast(err.message, "error");
        } finally {
            els.saveBtn.disabled = false;
        }
    })();
});


/* -- confirm dialog (private wipe / discard changes) --------------------------------------------------------------------------------- */

function closeConfirm() {
    closeLayer(els.confirmBackdrop);
    state.pendingDeleteId = null;
    state.pendingReset = false;
    state.pendingDiscard = false;
}

els.confirmForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (state.pendingReset) {
        try {
            await apiPrivateReset();
            state.rawTasks = state.rawTasks.filter(t => !t.private);
            state.privateKey = null;
            state.privateSalt = null;
            toast("Private tasks deleted — set a new passphrase next time", "success");
        } catch (err) {
            if (!err.message.startsWith("Session expired")) toast(err.message, "error");
        }
        closeConfirm();
        closeUnlock();
        render();
        return;
    }

    if (state.pendingDiscard) {
        closeConfirm();
        closeModal(true);
        return;
    }

    closeConfirm();
});


/* -- right-click / long-press menu ------------------------------------------------------------------------------------------------------- */

let contextTaskId = null;

function openContextMenuAt(x, y, task) {
    contextTaskId = task.id;
    const menu = els.contextMenu;

    const doneOption = $("[data-cmd='toggle-done']", menu);
    doneOption.hidden = !!task._locked;
    $("[data-cmd-label]", doneOption).textContent =
        task.done ? "Reopen"
        : task.working ? "Not in work anymore"
        : "Mark done";

    $("[data-cmd='unlock']", menu).hidden = !task._locked;
    $("[data-cmd='edit']", menu).hidden = !!task._locked;
    $("[data-cmd='duplicate']", menu).hidden = !!task._locked;

    menu.hidden = false;
    const px = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const py = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, px)}px`;
    menu.style.top = `${Math.max(8, py)}px`;
}

function closeContextMenu() {
    els.contextMenu.hidden = true;
    contextTaskId = null;
}

els.container.addEventListener("contextmenu", event => {
    const card = event.target.closest(".task-card, .overview-card");
    if (!card) return;
    const task = findTask(Number(card.dataset.taskId));
    if (!task) return;
    event.preventDefault();
    openContextMenuAt(event.clientX, event.clientY, task);
});

els.contextMenu.addEventListener("click", event => {
    const option = event.target.closest(".context-option");
    if (!option) return;
    const task = findTask(contextTaskId);
    closeContextMenu();
    if (!task) return;

    switch (option.dataset.cmd) {
        case "unlock":
            requestUnlock();
            break;
        case "toggle-done":
            if (task.done) setDone(task, false);
            else if (task.working) patchTask(task.id, { working: false });
            else setDone(task, true, true);
            break;
        case "edit":      openTaskEditor(task); break;
        case "duplicate": duplicateTask(task); break;
        case "delete":    deleteTask(task); break;
    }
});

document.addEventListener("click", event => {
    if (!els.contextMenu.hidden && !event.target.closest("#taskContextMenu")) closeContextMenu();
});
document.addEventListener("scroll", closeContextMenu, true);

els.backdrop.addEventListener("mousedown", event => { if (event.target === els.backdrop) closeModal(); });
els.unlockBackdrop.addEventListener("mousedown", event => { if (event.target === els.unlockBackdrop) closeUnlock(); });
els.confirmBackdrop.addEventListener("mousedown", event => { if (event.target === els.confirmBackdrop) closeConfirm(); });

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!els.contextMenu.hidden) { closeContextMenu(); return; }
    if (els.confirmBackdrop.classList.contains("open")) { closeConfirm(); return; }
    if (els.unlockBackdrop.classList.contains("open")) { closeUnlock(); return; }
    if (els.backdrop.classList.contains("open")) closeModal();
});


/* -- static controls ------------------------------------------------------------------------------------------------------------------------- */

$$("#tasks-nav .tab[data-view]").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));

els.search.addEventListener("input", debounce(() => {
    state.query = els.search.value;
    render();
}, 150));

els.newTaskBtn.addEventListener("click", () => openModal());
els.addSubtaskBtn.addEventListener("click", addSubtask);
els.subtaskInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); addSubtask(); }
});

$$("[data-action='close-modal']").forEach(btn => btn.addEventListener("click", () => closeModal()));
$$("[data-action='close-unlock']").forEach(btn => btn.addEventListener("click", closeUnlock));
$$("[data-action='close-confirm']").forEach(btn => btn.addEventListener("click", closeConfirm));

/* JSON backup export */
els.exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.rawTasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `nedwork-tasks-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Tasks exported", "success");
});


/* -- boot -------------------------------------------------------------------------------------------------------------------------------------- */

async function init() {
    preloadIcons();
    injectResetControl();
    wireDragTargets();
    renderLoading();

    try {
        const me = await fetchMe();
        state.userId = me.user_id;
    } catch { /* stats fall back to a shared local key */ }
    loadGame();

    try {
        const data = await listTasks();
        state.rawTasks = data.tasks;
        state.loadError = null;
    } catch (err) {
        state.loadError = err.message;
    }

    state.view = hashToView();
    await refreshView();

    // live relative dates + stats, every minute, only while visible
    setInterval(() => {
        if (document.hidden) return;
        if (els.backdrop.classList.contains("open")) return;
        render();
    }, 60_000);
}

init();