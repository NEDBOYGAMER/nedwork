/* ==========================================================================
   nedwork — about page logic

   NOTE: this page does not extend base.html, so the §14 settings
   fetch-and-apply logic is duplicated here (plus a pre-paint inline
   script in about.html). Keep in sync if the base implementation changes.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ============================== config ================================== */

const ICON_BASE = '/static/img/icons/';
const LS_CONFIG = 'nedwork:config';          // must match the key your base uses
const LS_QUEUE_UPDATES = 'nedwork:pending-updates';
const LS_QUEUE_SUGGEST = 'nedwork:pending-suggestions';
const API_UPDATES = document.body.dataset.apiUpdates || '/about/api/updates';
const API_SUGGEST = '/about/api/suggestions'; // added to routes.py in this step
const API_COST = '/about/api/cost';           // contract: { chf: <number> } — may not exist yet
const IDEAS_URL = '/static/data/ideas.json';

/* EDIT ME — bump when you feel like it */
const MANUAL_VERSION = 'v0.1';

/* EDIT ME — number of tools you actually have; the apps themselves are
   deliberately NOT listed on this page, this is just the count */
const MANUAL_TOOL_COUNT = 5;

const TAG_BADGE = {
    feature:     'badge-accent',
    improvement: 'badge-info',
    fix:         'badge-success',
    'heads-up':  'badge-warning',
    note:        'badge-neutral',
};

const IDEA_BADGE = {
    wip:          'badge-info',
    planned:      'badge-accent',
    considering:  'badge-neutral',
};

/* fallback if static/data/ideas.json is missing — same placeholder content */
const IDEAS_FALLBACK = [
    { id: 'idea-1', title: 'shared lists',       status: 'planned',      body: 'shopping & packing lists, shareable by link — no accounts, just a link you pass around.' },
    { id: 'idea-2', title: 'date poll',          status: 'considering',  body: 'doodle-style "when works for everyone?" polls. game night scheduling, solved.' },
    { id: 'idea-3', title: 'transport board',    status: 'considering',  body: 'live departure times for your station, straight on the dashboard.' },
    { id: 'idea-4', title: 'tasks & events',     status: 'wip',          body: 'already being built — shared task lists and a small event calendar.' },
];

/* ============================== settings (§14, duplicated) =============== */

async function applySettings() {
    try {
        const res = await fetch('/settings/api/get_config');
        if (!res.ok) throw new Error('bad status');
        const c = await res.json();
        localStorage.setItem(LS_CONFIG, JSON.stringify(c));
        paintSettings(c);
    } catch {
        /* fetch failed — the pre-paint cache from localStorage already holds */
    }
}

function paintSettings(c) {
    const root = document.documentElement;
    root.setAttribute('data-theme', c.dark_mode === false ? 'light' : 'dark');
    if (c.accent_color)      root.style.setProperty('--accent', c.accent_color);
    if (c.accent_color_soft) root.style.setProperty('--accent-soft', c.accent_color_soft);
    if (c.accent_color_ink)  root.style.setProperty('--accent-ink', c.accent_color_ink);
    document.body.classList.toggle('no-ambient', c.grid === false);
}

/* ============================== helpers ================================= */

function iconEl(name, extra = '') {
    const s = document.createElement('span');
    s.className = 'icon' + (extra ? ' ' + extra : '');
    s.style.setProperty('--icon', `url(${ICON_BASE}tabler-${name}.svg)`);
    s.setAttribute('aria-hidden', 'true');
    return s;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relTime(iso) {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    const table = [
        [60,       'second', 1],
        [3600,     'minute', 60],
        [86400,    'hour',   3600],
        [604800,   'day',    86400],
        [2629800,  'week',   604800],
        [31557600, 'month',  2629800],
        [Infinity, 'year',   31557600],
    ];
    for (const [limit, unit, secs] of table) {
        if (abs < limit) return rtf.format(Math.round(diff / secs), unit);
    }
}

function toast(msg, kind = 'accent') {
    const t = document.createElement('div');
    t.className = 'toast';
    if (kind !== 'accent') t.style.borderLeftColor = `var(--${kind})`;
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => {
        t.style.transition = 'opacity .3s ease';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 4200);
}

/* ============================== updates data ============================ */

let updates = [];

const readQueue  = key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const writeQueue = (key, q) => localStorage.setItem(key, JSON.stringify(q));

async function loadUpdates() {
    updates = [];
    try {
        const res = await fetch(API_UPDATES);
        if (!res.ok) throw new Error('api missing');
        updates = await res.json();
    } catch {
        try {
            const res = await fetch('/static/data/updates.json');
            if (!res.ok) throw new Error('file missing');
            updates = await res.json();
            updates.push(...readQueue(LS_QUEUE_UPDATES));
        } catch {
            updates = readQueue(LS_QUEUE_UPDATES);
        }
    }
    updates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderUpdates();
    renderFacts();
}

/* ============================== timeline render ========================= */

function formatDaysAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();

    // Compare calendar days
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((startOfNow - startOfDate) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
}

function renderUpdates() {
    const list = $('#timeline');
    list.replaceChildren();
    $('#updates-empty').hidden = updates.length > 0;

    updates.forEach((u, i) => {
        const li = document.createElement('li');
        li.className = 'tl-item' + (i === 0 ? ' is-latest' : '');
        li.id = 'update-' + u.id;              // deep-linkable: /about#update-<id>

        const card = document.createElement('article');
        card.className = 'card tl-card';

        const head = document.createElement('div');
        head.className = 'tl-head';

        const title = document.createElement('h3');
        title.className = 'tl-title';
        title.textContent = u.title;           // textContent everywhere — no HTML injection

        const badge = document.createElement('span');
        badge.className = 'badge ' + (TAG_BADGE[u.tag] || 'badge-neutral');
        badge.textContent = u.tag;

        const timeWrap = document.createElement('span');
        timeWrap.className = 'tooltip-wrap';
        
        const time = document.createElement('span');
        time.className = 'tl-time';
        time.textContent = formatDaysAgo(u.created_at); // Displays "today", "1 day ago", etc.

        const tip = document.createElement('span');
        tip.className = 'tooltip';
        tip.textContent = new Date(u.created_at)
            .toLocaleDateString(undefined, { dateStyle: 'medium' });

        timeWrap.append(time, tip);

        head.append(title, badge, timeWrap);

        if (isAdmin()) head.append(makeDeleteButton(u.id));

        const body = document.createElement('p');
        body.className = 'tl-body';
        body.textContent = u.body;

        card.append(head, body);
        li.append(card);
        list.append(li);
    });
}

function makeDeleteButton(id) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost btn-sm';
    const idle  = () => del.replaceChildren(iconEl('trash'), document.createTextNode('delete'));
    const armed = () => del.replaceChildren(iconEl('check'), document.createTextNode('sure?'));
    idle();

    let sure = false, timer;
    del.addEventListener('click', async () => {
        if (!sure) {
            sure = true; armed();
            timer = setTimeout(() => { sure = false; idle(); }, 2500);
            return;
        }
        clearTimeout(timer);
        updates = updates.filter(u => u.id !== id);
        writeQueue(LS_QUEUE_UPDATES, readQueue(LS_QUEUE_UPDATES).filter(u => u.id !== id));
        renderUpdates(); renderFacts();
        try { await fetch(`${API_UPDATES}/${id}`, { method: 'DELETE' }); } catch { /* offline ok */ }
        toast('update removed', 'danger');
    });
    return del;
}

/* ============================== facts =================================== */

function renderFacts() {
    $('#fact-tools').textContent = MANUAL_TOOL_COUNT;
    $('#fact-updates').textContent = updates.length;
    // "online since" is read from the oldest changelog entry — no date to maintain
    $('#fact-online').textContent = updates.length
        ? relTime(updates[updates.length - 1].created_at)
        : '—';
    $('#fact-last').textContent = updates.length ? relTime(updates[0].created_at) : '—';
$('#site-version').textContent = MANUAL_VERSION;
}

/* ============================== admin mode ============================== */

const isAdmin = () => sessionStorage.getItem('nedwork:admin') === '1';

function setAdmin(on) {
    sessionStorage.setItem('nedwork:admin', on ? '1' : '0');
    document.body.classList.toggle('is-admin', on);
    renderUpdates();
    if (on) toast('admin mode on — add updates with the button in the changelog, esc closes the dialog');
}

function initAdminFromUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get('admin') === '1') {
        sessionStorage.setItem('nedwork:admin', '1');
        p.delete('admin');
        const qs = p.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    }
    document.body.classList.toggle('is-admin', isAdmin());
}

/* ============================== add-update modal (stopgap) ============== */

const backdrop = $('#update-modal');

function openModal()  { backdrop.classList.add('open'); $('#f-title').focus(); }
function closeModal() { backdrop.classList.remove('open'); $('#update-form').reset(); }

backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
$('#cancel-modal').addEventListener('click', closeModal);
$('#add-btn').addEventListener('click', openModal);

$('#update-form').addEventListener('submit', async e => {
    e.preventDefault();
    const entry = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        title: $('#f-title').value.trim(),
        tag: $('#f-tag').value,
        body: $('#f-body').value.trim(),
        created_at: new Date().toISOString(),  // ← the auto part (client preview)
    };
    closeModal();
    updates.unshift(entry);
    renderUpdates(); renderFacts();

    try {
        const res = await fetch(API_UPDATES, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: entry.title, tag: entry.tag, body: entry.body }),
        });
        if (!res.ok) throw new Error('api');
        const saved = await res.json();        // server's stamp is the truth
        Object.assign(entry, saved);
        renderUpdates(); renderFacts();
        toast('published — stamped ' + relTime(saved.created_at), 'success');
    } catch {
        const q = readQueue(LS_QUEUE_UPDATES); q.push(entry); writeQueue(LS_QUEUE_UPDATES, q);
        toast('no api yet — saved locally on this device', 'warning');
    }
});

/* ============================== cost counter ============================ */

/* contract for later: GET API_COST returns { "chf": <number> } — e.g. 0.95.
   until that endpoint exists, the counter simply stays at 0.00. */
async function loadCost() {
    let chf = null;
    try {
        const res = await fetch(API_COST);
        if (res.ok) {
            const d = await res.json();
            if (typeof d.chf === 'number' && isFinite(d.chf) && d.chf >= 0) chf = d.chf;
        }
    } catch { /* endpoint not there yet */ }
    if (chf === null) chf = 0;
    $('#cost-value').textContent = chf.toFixed(2);   // rounded to 0.01 chf, as decided
}

/* ============================== ideas (feature future) ================== */

let ideas = [];

async function loadIdeas() {
    try {
        const res = await fetch(IDEAS_URL);
        if (!res.ok) throw new Error('missing');
        ideas = await res.json();
    } catch {
        ideas = IDEAS_FALLBACK;
    }
    renderIdeas();
}

function renderIdeas() {
    const grid = $('#ideas-grid');
    grid.replaceChildren();
    $('#ideas-empty').hidden = ideas.length > 0;

    ideas.forEach(idea => {
        const card = document.createElement('article');
        card.className = 'card idea-item';

        const title = document.createElement('h3');
        const name = document.createElement('span');
        name.textContent = idea.title;
        const badge = document.createElement('span');
        badge.className = 'badge ' + (IDEA_BADGE[idea.status] || 'badge-neutral');
        badge.textContent = idea.status || 'considering';
        title.append(name, badge);

        const body = document.createElement('p');
        body.textContent = idea.body || '';

        card.append(title, body);
        grid.append(card);
    });
}

/* ============================== suggestion form ========================= */

const form = $('#suggestion-form');
const formOpenedAt = Date.now();

form.addEventListener('submit', async e => {
    e.preventDefault();

    // anti-spam: honeypot filled or inhumanly fast → silently drop
    const hp = $('.hp', form).value.trim();
    if (hp || Date.now() - formOpenedAt < 2000) { form.reset(); return; }

    const what = $('#s-what').value.trim();
    if (!what) {
        $('#s-what').classList.add('wrong');
        setTimeout(() => $('#s-what').classList.remove('wrong'), 900);
        $('#s-what').focus();
        return;
    }

    const payload = {
        type: $('#s-type').value,
        name: $('#s-name').value.trim() || 'anonymous',
        area: $('#s-area').value.trim(),
        what,
        how_why: $('#s-why').value.trim(),
    };

    try {
        const res = await fetch(API_SUGGEST, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('api');
        const saved = await res.json();
        showSuccess(saved.id ? '#' + saved.id.slice(0, 8) : '');
        toast('sent — thank you!', 'success');
    } catch {
        const q = readQueue(LS_QUEUE_SUGGEST);
        q.push({ ...payload, created_at: new Date().toISOString() });
        writeQueue(LS_QUEUE_SUGGEST, q);
        showSuccess('locally');
        toast('api not reachable — saved locally on this device for now', 'warning');
    }
});

function showSuccess(where) {
    form.hidden = true;
    $('#success-id').textContent = where || 'just now';
    $('#form-success').hidden = false;
}

$('#send-another').addEventListener('click', () => {
    $('#form-success').hidden = true;
    form.hidden = false;
    $('#s-what').focus();
});

/* ============================== reveal on scroll ======================== */

const io = new IntersectionObserver(
    entries => entries.forEach(en => en.isIntersecting && en.target.classList.add('in')),
    { threshold: .12 }
);
function observeReveals() {
    $$('.reveal:not(.in)').forEach(el => io.observe(el));
}

/* ============================== easter egg ============================== */

/* konami code → the brand accent flashes through the whole page for a
   moment. nice side effect: it proves the accent system re-skins live. */
const BRAND = '#C77400', BRAND_SOFT = 'rgba(199,116,0,.22)';
const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let ki = 0;

addEventListener('keydown', e => {
    ki = e.key === KONAMI[ki] ? ki + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (ki === KONAMI.length) { ki = 0; flashBrand(); }
});

function flashBrand() {
    const root = document.documentElement;
    const prev = ['--accent', '--accent-soft', '--accent-ink']
        .map(n => [n, root.style.getPropertyValue(n)]);
    root.style.setProperty('--accent', BRAND);
    root.style.setProperty('--accent-soft', BRAND_SOFT);
    root.style.setProperty('--accent-ink', '#ffffff');
    document.body.classList.add('party');
    toast('you found the konami code.');
    setTimeout(() => {
        prev.forEach(([n, v]) => v ? root.style.setProperty(n, v) : root.style.removeProperty(n));
        document.body.classList.remove('party');
    }, 3000);
}

/* ============================== init ==================================== */

initAdminFromUrl();
applySettings();
loadUpdates();
loadIdeas();
loadCost();
observeReveals();