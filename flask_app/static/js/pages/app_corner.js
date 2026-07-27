// ==========================================================================
// App Corner
// Fetches the app catalogue, groups it by type, renders category sections
// with big image cards, and wires up a live search filter.
// ==========================================================================

const CONFIG = JSON.parse(document.getElementById('app-corner-config').textContent);

const APPS_JSON_URL = CONFIG.appsJsonUrl || '/static/data/apps.json';
const USER_PERMISSIONS = CONFIG.userPermissions || [];

const sectionsEl = document.getElementById('app-sections');
const noResultsEl = document.getElementById('no-results');
const searchInput = document.getElementById('app-search');
const searchCountEl = document.getElementById('search-count');

let apps = [];

init();

async function init() {
    try {
        apps = await fetchApps();
    } catch (err) {
        console.error('Failed to load apps.json', err);
        sectionsEl.innerHTML = `<p style="opacity:.6">Couldn't load the app list. Try refreshing.</p>`;
        return;
    }

    renderSections(apps);
    updateSearchCount(apps.length, apps.length);

    searchInput.addEventListener('input', onSearch);
}

async function fetchApps() {
    const res = await fetch(APPS_JSON_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Some apps.json entries store an on-disk path (e.g. "flask_app/static/img/x.png")
 * rather than a proper URL. Normalize that to the conventional Flask static route.
 */
function resolveImagePath(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    return '/' + path.replace(/^\/?flask_app\//, '').replace(/^\/?/, 'static/').replace(/^static\/static\//, 'static/');
}

function hasAccess(app) {
    if (!app.permissions || app.permissions.length === 0) return true;
    if (USER_PERMISSIONS.includes('admin')) return true;
    return app.permissions.some((p) => USER_PERMISSIONS.includes(p));
}

function groupByType(list) {
    const groups = new Map();
    for (const app of list) {
        const type = app.type || 'Other';
        if (!groups.has(type)) groups.set(type, []);
        groups.get(type).push(app);
    }
    return groups;
}

function renderSections(list) {
    sectionsEl.innerHTML = '';
    const groups = groupByType(list);

    for (const [type, groupApps] of groups) {
        const section = document.createElement('section');
        section.className = 'app-section';
        section.dataset.type = type;

        const header = document.createElement('div');
        header.className = 'app-section-header';
        header.innerHTML = `
            <span class="app-section-title">${escapeHtml(type)}</span>
            <span class="app-section-count">${groupApps.length}</span>
        `;

        const grid = document.createElement('div');
        grid.className = 'app-grid';
        groupApps.forEach((app) => grid.appendChild(buildCard(app)));

        section.appendChild(header);
        section.appendChild(grid);
        sectionsEl.appendChild(section);
    }
}

function buildCard(app) {
    const card = document.createElement('div');
    const locked = !hasAccess(app);
    card.className = 'app-card' + (locked ? ' locked' : '');
    card.dataset.name = app.name.toLowerCase();
    card.dataset.desc = (app.description || '').toLowerCase();
    card.dataset.type = (app.type || '').toLowerCase();

    card.innerHTML = `
        <img class="app-card-image" src="${resolveImagePath(app.image)}" alt="${escapeHtml(app.name)}" loading="lazy">
        <div class="app-card-scrim"></div>
        <span class="app-card-type">${escapeHtml(app.type || '')}</span>
        ${locked ? '<span class="lock-badge" title="Requires access">🔒</span>' : ''}
        <div class="app-card-body">
            <span class="app-card-name">${escapeHtml(app.name)}</span>
            <p class="app-card-desc">${escapeHtml(app.description || '')}</p>
        </div>
    `;

    card.addEventListener('click', () => {
        if (locked) return;
        if (app.url) window.location.href = app.url;
    });

    return card;
}

function onSearch() {
    const query = searchInput.value.trim().toLowerCase();
    const cards = sectionsEl.querySelectorAll('.app-card');
    let visibleCount = 0;

    cards.forEach((card) => {
        const matches =
            !query ||
            card.dataset.name.includes(query) ||
            card.dataset.desc.includes(query) ||
            card.dataset.type.includes(query);
        card.classList.toggle('hidden', !matches);
        if (matches) visibleCount++;
    });

    // Hide whole sections if every card inside is filtered out.
    sectionsEl.querySelectorAll('.app-section').forEach((section) => {
        const anyVisible = !!section.querySelector('.app-card:not(.hidden)');
        section.classList.toggle('hidden', !anyVisible);
    });

    noResultsEl.classList.toggle('hidden', visibleCount !== 0);
    updateSearchCount(visibleCount, apps.length);
}

function updateSearchCount(visible, total) {
    searchCountEl.textContent = `${visible} / ${total}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}