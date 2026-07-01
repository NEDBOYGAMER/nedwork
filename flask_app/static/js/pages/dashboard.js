// dashboard.js
import { createBackground } from '../components/background.js';



// ═══════════════════════════════════════════════════════════════════════════
// CARD TYPE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const CARD_TYPES = {
    clock: {
        label: 'Clock',
        icon:  '🕐',
        desc:  'Live date & time',
        size:  'small',
        config: {}
    },
    todo: {
        label: 'Tasks',
        icon:  '✅',
        desc:  'Todo checklist',
        size:  'medium',
        config: { items: [] }
    },
    notes: {
        label: 'Notes',
        icon:  '📝',
        desc:  'Quick notepad',
        size:  'medium',
        config: { text: '' }
    },
    stat: {
        label: 'Stat',
        icon:  '📊',
        desc:  'Custom metric',
        size:  'small',
        config: { label: 'Metric', value: '0' }
    },
    timer: {
        label: 'Timer',
        icon:  '⏱',
        desc:  'Stopwatch',
        size:  'small',
        config: {}
    },
    links: {
        label: 'Links',
        icon:  '🔗',
        desc:  'Quick bookmarks',
        size:  'medium',
        config: { items: [] }
    },
    weather: {
        label: 'Weather',
        icon:  '🌤',
        desc:  'Local forecast',
        size:  'small',
        config: {}
    }
};


// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let cards = [];
const timerState = {};   // { [cardId]: { running, elapsed, startTime, interval } }
let cursorEl, ringEl;


// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

function loadCards() {
    try { cards = JSON.parse(localStorage.getItem('dash_cards') || '[]'); }
    catch { cards = []; }
}

function saveCards() {
    localStorage.setItem('dash_cards', JSON.stringify(cards));
}

function uid() {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}


// ═══════════════════════════════════════════════════════════════════════════
// HTML HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Create the outer card shell with header + empty card-body. */
function makeShell(card, titleOverride = '') {
    const title = titleOverride || CARD_TYPES[card.type]?.label || card.type;
    const el = document.createElement('div');
    el.className = `card card-${card.size}`;
    el.dataset.id   = card.id;
    el.dataset.type = card.type;
    el.innerHTML = `
        <div class="card-head">
            <span class="card-lbl">${esc(title)}</span>
            <button class="card-x" title="Remove widget">✕</button>
        </div>
        <div class="card-body"></div>
    `;
    return el;
}


// ═══════════════════════════════════════════════════════════════════════════
// CARD ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

function addCard(type) {
    const def = CARD_TYPES[type];
    if (!def) return;
    cards.push({
        id:     uid(),
        type,
        size:   def.size,
        config: JSON.parse(JSON.stringify(def.config))
    });
    saveCards();
    renderAll();
    closeModal();
}

function removeCard(id) {
    // stop any running timer
    if (timerState[id]?.interval) clearInterval(timerState[id].interval);
    delete timerState[id];
    cards = cards.filter(c => c.id !== id);
    saveCards();
    renderAll();
}


// ═══════════════════════════════════════════════════════════════════════════
// WIDGET BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

function buildClock(card) {
    const el = makeShell(card, 'Clock');
    el.querySelector('.card-body').innerHTML = `
        <div class="clock-time" id="ct-${card.id}">—</div>
        <div class="clock-date" id="cd-${card.id}">—</div>
    `;
    return el;
}

function buildTodo(card) {
    const el = makeShell(card, 'Tasks');
    el.querySelector('.card-body').innerHTML = `
        <div class="todo-list" id="tl-${card.id}"></div>
        <div class="todo-row">
            <input class="field todo-in" placeholder="Add a task…" autocomplete="off">
            <button class="icon-btn todo-ok" title="Add">+</button>
        </div>
    `;
    return el;
}

function buildNotes(card) {
    const el = makeShell(card, 'Notes');
    el.querySelector('.card-body').innerHTML = `
        <textarea class="notes-ta" placeholder="Start typing…">${esc(card.config.text || '')}</textarea>
    `;
    return el;
}

function buildStat(card) {
    const el = makeShell(card, card.config.label || 'Metric');
    el.querySelector('.card-body').innerHTML = `
        <div class="stat-val" contenteditable="true" spellcheck="false">${esc(card.config.value || '0')}</div>
        <div class="stat-lbl" contenteditable="true" spellcheck="false">${esc(card.config.label || 'Metric')}</div>
    `;
    return el;
}

function buildTimer(card) {
    const el = makeShell(card, 'Timer');
    el.querySelector('.card-body').innerHTML = `
        <div class="timer-disp" id="td-${card.id}">00:00:00</div>
        <div class="timer-row">
            <button class="timer-btn t-ss" data-id="${card.id}">Start</button>
            <button class="timer-btn t-rs" data-id="${card.id}">Reset</button>
        </div>
    `;
    return el;
}

function buildLinks(card) {
    const el = makeShell(card, 'Quick Links');
    el.querySelector('.card-body').innerHTML = `
        <div class="links-list" id="ll-${card.id}"></div>
        <div class="link-row">
            <input class="field lbl-in" placeholder="Label" autocomplete="off">
            <input class="field url-in" placeholder="https://…" autocomplete="off">
            <button class="icon-btn lnk-ok" title="Add">+</button>
        </div>
    `;
    return el;
}

function buildWeather(card) {
    const el = makeShell(card, 'Weather');
    el.querySelector('.card-body').innerHTML = `
        <div class="weather-loading">Fetching weather…</div>
    `;
    return el;
}


// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════

function bindCard(el, card) {
    el.querySelector('.card-x').addEventListener('click', () => removeCard(card.id));

    switch (card.type) {
        case 'todo':    bindTodo(el, card);    break;
        case 'notes':   bindNotes(el, card);   break;
        case 'stat':    bindStat(el, card);    break;
        case 'timer':   bindTimer(el, card);   break;
        case 'links':   bindLinks(el, card);   break;
        case 'weather': bindWeather(el, card); break;
    }
}

// ── Todo ──────────────────────────────────────────────────────────────────
function bindTodo(el, card) {
    function refresh() {
        const list = el.querySelector(`#tl-${card.id}`);
        if (!list) return;
        list.innerHTML = (card.config.items || []).map((item, i) => `
            <div class="todo-item${item.done ? ' done' : ''}">
                <button class="chk">${item.done ? '✓' : ''}</button>
                <span class="txt">${esc(item.text)}</span>
                <button class="del" title="Remove">✕</button>
            </div>
        `).join('');

        list.querySelectorAll('.chk').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                card.config.items[i].done = !card.config.items[i].done;
                saveCards();
                refresh();
            });
        });
        list.querySelectorAll('.del').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                card.config.items.splice(i, 1);
                saveCards();
                refresh();
            });
        });
    }

    const inp = el.querySelector('.todo-in');
    const ok  = el.querySelector('.todo-ok');

    function addItem() {
        const text = inp.value.trim();
        if (!text) return;
        card.config.items.push({ text, done: false });
        saveCards();
        inp.value = '';
        refresh();
    }

    ok.addEventListener('click', addItem);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });
    refresh();
}

// ── Notes ─────────────────────────────────────────────────────────────────
function bindNotes(el, card) {
    const ta = el.querySelector('.notes-ta');
    ta.addEventListener('input', () => {
        card.config.text = ta.value;
        saveCards();
    });
}

// ── Stat ──────────────────────────────────────────────────────────────────
function bindStat(el, card) {
    const valEl  = el.querySelector('.stat-val');
    const lblEl  = el.querySelector('.stat-lbl');
    const headLbl = el.querySelector('.card-lbl');

    valEl.addEventListener('input', () => {
        card.config.value = valEl.textContent.trim();
        saveCards();
    });
    lblEl.addEventListener('input', () => {
        card.config.label = lblEl.textContent.trim();
        headLbl.textContent = card.config.label || 'Metric';
        saveCards();
    });

    // prevent newlines in contenteditable
    [valEl, lblEl].forEach(el => {
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });
    });
}

// ── Timer ─────────────────────────────────────────────────────────────────
function bindTimer(el, card) {
    if (!timerState[card.id]) {
        timerState[card.id] = { running: false, elapsed: 0, startTime: null, interval: null };
    }
    const st    = timerState[card.id];
    const disp  = el.querySelector(`#td-${card.id}`);
    const ssBtn = el.querySelector('.t-ss');
    const rsBtn = el.querySelector('.t-rs');

    function fmt(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return [h, m, s % 60].map(n => String(n).padStart(2, '0')).join(':');
    }
    function upd() {
        const t = st.running ? st.elapsed + (Date.now() - st.startTime) : st.elapsed;
        if (disp) disp.textContent = fmt(t);
    }

    // Resume if was running before re-render
    if (st.running) {
        st.interval = setInterval(upd, 100);
        if (ssBtn) ssBtn.textContent = 'Stop';
    }
    upd();

    ssBtn.addEventListener('click', () => {
        if (st.running) {
            clearInterval(st.interval);
            st.elapsed += Date.now() - st.startTime;
            st.running  = false;
            ssBtn.textContent = 'Start';
        } else {
            st.startTime = Date.now();
            st.running   = true;
            st.interval  = setInterval(upd, 100);
            ssBtn.textContent = 'Stop';
        }
    });

    rsBtn.addEventListener('click', () => {
        clearInterval(st.interval);
        Object.assign(st, { running: false, elapsed: 0, startTime: null, interval: null });
        ssBtn.textContent = 'Start';
        upd();
    });
}

// ── Links ─────────────────────────────────────────────────────────────────
function bindLinks(el, card) {
    function refresh() {
        const list = el.querySelector(`#ll-${card.id}`);
        if (!list) return;
        list.innerHTML = (card.config.items || []).map((item, i) => `
            <div class="link-item">
                <a href="${esc(item.url)}" target="_blank" rel="noopener" class="link-a">
                    🔗 ${esc(item.label)}
                </a>
                <button class="del" title="Remove">✕</button>
            </div>
        `).join('');
        list.querySelectorAll('.del').forEach((btn, i) => {
            btn.addEventListener('click', () => {
                card.config.items.splice(i, 1);
                saveCards();
                refresh();
            });
        });
    }

    const lblIn = el.querySelector('.lbl-in');
    const urlIn = el.querySelector('.url-in');
    const ok    = el.querySelector('.lnk-ok');

    function addLink() {
        let lbl = lblIn.value.trim();
        let url = urlIn.value.trim();
        if (!lbl || !url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        card.config.items.push({ label: lbl, url });
        saveCards();
        lblIn.value = urlIn.value = '';
        refresh();
    }

    ok.addEventListener('click', addLink);
    urlIn.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });
    refresh();
}

// ── Weather (Open-Meteo, no API key needed) ───────────────────────────────
const WEATHER_CODES = {
    0: ['☀️', 'Clear sky'],
    1: ['🌤', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫', 'Fog'], 48: ['🌫', 'Icy fog'],
    51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌧', 'Heavy drizzle'],
    61: ['🌧', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'],
    71: ['🌨', 'Light snow'], 73: ['❄️', 'Snow'], 75: ['❄️', 'Heavy snow'],
    80: ['🌦', 'Rain showers'], 81: ['🌧', 'Heavy showers'], 82: ['⛈', 'Violent showers'],
    95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Thunderstorm + hail'], 99: ['⛈', 'Heavy thunderstorm']
};

function bindWeather(el, card) {
    const body = el.querySelector('.card-body');

    function render(data) {
        const wmo = data.current_weather;
        const [icon, desc] = WEATHER_CODES[wmo.weathercode] || ['🌡', 'Unknown'];
        const temp = Math.round(wmo.temperature);
        body.innerHTML = `
            <div class="weather-main">
                <span class="weather-icon">${icon}</span>
                <span class="weather-temp">${temp}<span class="weather-unit">°C</span></span>
            </div>
            <div class="weather-desc">${desc}</div>
            <div class="weather-loc">📍 ${data._city || 'Your location'}</div>
        `;
    }

    function fetchWeather(lat, lon, city) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
        fetch(url)
            .then(r => r.json())
            .then(data => { data._city = city; render(data); })
            .catch(() => {
                body.innerHTML = `<div class="weather-error">Could not load weather</div>`;
            });
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude, 'Your location'),
            ()  => fetchWeather(46.52, 6.63, 'Lausanne')  // fallback
        );
    } else {
        fetchWeather(46.52, 6.63, 'Lausanne');
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// CLOCK TICK — runs on interval, updates all clock cards
// ═══════════════════════════════════════════════════════════════════════════

function tickClocks() {
    const now = new Date();
    const t   = now.toLocaleTimeString('en-GB', { hour12: false });
    const d   = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    cards.filter(c => c.type === 'clock').forEach(c => {
        const te = document.getElementById(`ct-${c.id}`);
        const de = document.getElementById(`cd-${c.id}`);
        if (te) te.textContent = t;
        if (de) de.textContent = d;
    });
}


// ═══════════════════════════════════════════════════════════════════════════
// RENDER ALL CARDS
// ═══════════════════════════════════════════════════════════════════════════

function renderAll() {
    const grid = document.getElementById('card-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!cards.length) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⊞</div>
                <div class="empty-txt">No widgets yet</div>
                <div class="empty-sub">Press <span class="kbind">+</span> to add your first one</div>
            </div>
        `;
        return;
    }

    cards.forEach(card => {
        let el;
        switch (card.type) {
            case 'clock':   el = buildClock(card);   break;
            case 'todo':    el = buildTodo(card);     break;
            case 'notes':   el = buildNotes(card);    break;
            case 'stat':    el = buildStat(card);     break;
            case 'timer':   el = buildTimer(card);    break;
            case 'links':   el = buildLinks(card);    break;
            case 'weather': el = buildWeather(card);  break;
            default: return;
        }
        if (el) {
            grid.appendChild(el);
            bindCard(el, card);
        }
    });

    rebindHover();
}


// ═══════════════════════════════════════════════════════════════════════════
// WIDGET PICKER
// ═══════════════════════════════════════════════════════════════════════════

function renderPicker() {
    const picker = document.getElementById('widget-picker');
    if (!picker) return;
    picker.innerHTML = Object.entries(CARD_TYPES).map(([type, def]) => `
        <button class="w-opt" data-type="${type}">
            <span class="w-icon">${def.icon}</span>
            <span class="w-name">${def.label}</span>
            <span class="w-desc">${def.desc}</span>
        </button>
    `).join('');
    picker.querySelectorAll('.w-opt').forEach(btn =>
        btn.addEventListener('click', () => addCard(btn.dataset.type))
    );
}


// ═══════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════

function openModal() {
    document.getElementById('add-window')?.classList.remove('hidden');
    document.getElementById('overlay')?.classList.remove('hidden');
}
function closeModal() {
    document.getElementById('add-window')?.classList.add('hidden');
    document.getElementById('overlay')?.classList.add('hidden');
}


// ═══════════════════════════════════════════════════════════════════════════
// CURSOR HOVER — bind to dynamically created elements
// ═══════════════════════════════════════════════════════════════════════════

function rebindHover() {
    document.querySelectorAll('button, input, a, textarea').forEach(el => {
        if (el.__dhBound) return;
        el.addEventListener('mouseenter', () => {
            cursorEl?.classList.add('hovered');
            ringEl?.classList.add('hovered');
        });
        el.addEventListener('mouseleave', () => {
            cursorEl?.classList.remove('hovered');
            ringEl?.classList.remove('hovered');
        });
        el.__dhBound = true;
    });
}


// ═══════════════════════════════════════════════════════════════════════════
// GREETING + DATE HEADER
// ═══════════════════════════════════════════════════════════════════════════

function updateHeader() {
    const h = new Date().getHours();
    const greeting =
        h < 12 ? 'Good morning' :
        h < 17 ? 'Good afternoon' :
                 'Good evening';

    const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
    });

    const greetEl = document.getElementById('dash-greeting');
    const dateEl  = document.getElementById('dash-date');
    if (greetEl) greetEl.textContent = greeting;
    if (dateEl)  dateEl.textContent  = dateStr;
}


// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    cursorEl = document.getElementById('cursor');
    ringEl   = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    // Start animated background
    if (cursorEl && ringEl && canvas) {
        const bg = createBackground({ cursor: cursorEl, ring: ringEl, canvas });
        bg.start();
    } else {
        console.warn('Background elements missing');
    }

    // Populate header
    updateHeader();

    // Load cards from localStorage and render
    loadCards();
    renderAll();

    // Build widget picker options
    renderPicker();

    // Live clock ticker
    tickClocks();
    setInterval(tickClocks, 1000);

    // Plus button / modal
    document.getElementById('plus-button')?.addEventListener('click', openModal);
    document.getElementById('close-add-window')?.addEventListener('click', closeModal);
    document.getElementById('overlay')?.addEventListener('click', closeModal);

    // Close modal on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    // Settings / account nav
    document.getElementById('about-btn')?.addEventListener('click', () => {
        window.location.href = '/about';
    });
    document.getElementById('settings-btn')?.addEventListener('click', () => {
        window.location.href = '/settings';
    });
    document.getElementById('account-btn')?.addEventListener('click', () => {
        window.location.href = '/account';
    });
});