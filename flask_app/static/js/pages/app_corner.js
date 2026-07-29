import { createBackground } from '../components/background.js';

/** @type {Array<Object>} */
let apps = [];

/** @type {{
 *   shelves: string[],
 *   show_recent: boolean,
 *   recent_apps: (number|string)[],
 *   favorited_apps: (number|string)[],
 *   disabled_apps: (number|string)[],
 *   disabled_shelves: string[],
 * }} */
let config = {
    shelves: [],
    show_recent: true,
    recent_apps: [],
    favorited_apps: [],
    disabled_apps: [],
    disabled_shelves: [],
};

document.addEventListener('DOMContentLoaded', async () => {
    initBackground();

    const [appsData, userConfig] = await Promise.all([
        loadApps(),
        loadUserPreferences(),
    ]);

    apps = Array.isArray(appsData) ? appsData : [];
    if (userConfig && typeof userConfig === 'object') {
        config = { ...config, ...userConfig };
    }

    syncShelvesWithAvailableTypes();
    render();
});

function initBackground() {
    const cursor = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    if (cursor && ring && canvas) {
        const background = createBackground({ cursor, ring, canvas });
        background.start();
    } else {
        console.warn('Missing background elements');
    }
}

/* ────────────────────────────────────────────────────────────────
   Data loading / persistence
   ──────────────────────────────────────────────────────────────── */

async function loadApps() {
    try {
        const response = await fetch('/app_corner/api/apps-data');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to load apps data:', error);
        return [];
    }
}

async function loadUserPreferences() {
    try {
        const response = await fetch('/app_corner/api/user_preferences');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to load user preferences:', error);
        return null;
    }
}

async function saveConfig() {
    try {
        const response = await fetch('/app_corner/api/update_user_preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    } catch (error) {
        console.error('Failed to save preferences:', error);
    }
}

/** Any app "type" not yet tracked in config.shelves gets appended to the
 *  end of the shelf order, so newly added app categories show up. */
function syncShelvesWithAvailableTypes() {
    const known = new Set(config.shelves);
    const missing = allTypes().filter(type => !known.has(type));
    if (missing.length > 0) {
        config.shelves = [...config.shelves, ...missing];
        saveConfig();
    }
}

/* ────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────── */

function getAppById(id) {
    return apps.find(app => app.id === id);
}

function isAppDisabled(app) {
    return config.disabled_apps.includes(app.id);
}

function isAppFavorited(app) {
    return config.favorited_apps.includes(app.id);
}

function allTypes() {
    const set = new Set();
    apps.forEach(app => set.add(app.type));
    return Array.from(set);
}

function appsByType(type) {
    return apps.filter(app => app.type === type && !isAppDisabled(app));
}

/* ────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────── */

function render() {
    const container = document.getElementById('shelves-container');
    if (!container) return;
    container.innerHTML = '';

    // 1. Recent
    if (config.show_recent) {
        const recentApps = config.recent_apps
            .map(getAppById)
            .filter(app => app && !isAppDisabled(app));

        if (recentApps.length > 0) {
            container.appendChild(buildShelf({
                title: 'Recent',
                apps: recentApps,
                oneLine: true,
                shelfKey: '__recent__',
                canDisableShelf: true,
            }));
        }
    }

    // 2. Favorites — never disableable, only shown if something is favorited
    const favoritedApps = config.favorited_apps
        .map(getAppById)
        .filter(app => app && !isAppDisabled(app));

    if (favoritedApps.length > 0) {
        container.appendChild(buildShelf({
            title: 'Favorites',
            apps: favoritedApps,
            shelfKey: '__favorites__',
        }));
    }

    // 3. Normal shelves, in the user's configured order
    config.shelves.forEach(type => {
        if (config.disabled_shelves.includes(type)) return;

        const shelfApps = appsByType(type);
        if (shelfApps.length === 0) return;

        container.appendChild(buildShelf({
            title: type,
            apps: shelfApps,
            shelfKey: type,
            canDisableShelf: true,
        }));
    });

    // 4. Collapsible disabled section
    const disabledApps = config.disabled_apps.map(getAppById).filter(Boolean);
    const hasDisabledContent =
        !config.show_recent ||
        disabledApps.length > 0 ||
        config.disabled_shelves.length > 0;

    if (hasDisabledContent) {
        container.appendChild(buildDisabledSection(disabledApps));
    }
}

function buildDisabledSection(disabledApps) {
    const wrapper = document.createElement('section');
    wrapper.id = 'disabled-section';

    const toggle = document.createElement('button');
    toggle.id = 'disabled-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="chevron">&#9662;</span><span>Disabled</span>';
    toggle.addEventListener('click', () => {
        const expanded = wrapper.classList.toggle('expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
    });
    wrapper.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'disabled-content';

    // Recent, greyed out, if the shelf itself is disabled
    if (!config.show_recent) {
        const recentApps = config.recent_apps.map(getAppById).filter(Boolean);
        content.appendChild(buildShelf({
            title: 'Recent',
            apps: recentApps,
            oneLine: true,
            shelfKey: '__recent__',
            disabled: true,
            headerRestore: true,
        }));
    }

    // Individually-disabled apps (regardless of which shelf they belong to)
    if (disabledApps.length > 0) {
        content.appendChild(buildShelf({
            title: 'Disabled Apps',
            apps: disabledApps,
            shelfKey: '__disabled_apps__',
            disabled: true,
            cardRestore: true,
        }));
    }

    // Fully disabled shelves
    config.disabled_shelves.forEach(type => {
        const shelfApps = apps.filter(app => app.type === type);
        content.appendChild(buildShelf({
            title: type,
            apps: shelfApps,
            shelfKey: type,
            disabled: true,
            headerRestore: true,
        }));
    });

    wrapper.appendChild(content);
    return wrapper;
}

function buildShelf({
    title,
    apps: shelfApps,
    oneLine = false,
    shelfKey,
    disabled = false,
    headerRestore = false,
    cardRestore = false,
    canDisableShelf = false,
}) {
    const shelf = document.createElement('section');
    shelf.className = `shelf${oneLine ? ' shelf--oneline' : ''}${disabled ? ' shelf--disabled' : ''}`;
    shelf.dataset.shelf = shelfKey;

    const header = document.createElement('div');
    header.className = 'shelf-header';

    const heading = document.createElement('h2');
    heading.className = 'shelf-title';
    heading.textContent = title;
    header.appendChild(heading);

    if (headerRestore) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'shelf-restore-btn';
        restoreBtn.type = 'button';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', () => restoreShelf(shelfKey));
        header.appendChild(restoreBtn);
    } else if (canDisableShelf && !disabled) {
        const disableBtn = document.createElement('button');
        disableBtn.className = 'shelf-disable-btn';
        disableBtn.type = 'button';
        disableBtn.title = `Disable ${title}`;
        disableBtn.textContent = '\u2715 Disable';
        disableBtn.addEventListener('click', () => disableShelf(shelfKey));
        header.appendChild(disableBtn);
    }

    shelf.appendChild(header);

    const row = document.createElement('div');
    row.className = 'shelf-row';

    shelfApps.forEach(app => {
        row.appendChild(buildCard(app, { disabled, cardRestore }));
    });

    shelf.appendChild(row);
    return shelf;
}

function buildCard(app, { disabled = false, cardRestore = false } = {}) {
    const isPlaceholderUrl = !app.url || app.url === '/placeholder';

    const card = document.createElement('div');
    card.className = `app-card${disabled ? ' app-card--disabled' : ''}${isPlaceholderUrl ? ' app-card--placeholder' : ''}`;
    card.dataset.appId = app.id;

    const imageWrap = document.createElement('div');
    imageWrap.className = 'app-card-image';

    if (app.image) {
        const img = document.createElement('img');
        img.src = window.STATIC_URL + "img/apps" + app.image;
        img.alt = app.name;
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            imageWrap.innerHTML = '';
            imageWrap.appendChild(buildPlaceholder(app.name));
        });
        imageWrap.appendChild(img);
    } else {
        imageWrap.appendChild(buildPlaceholder(app.name));
    }

    card.appendChild(imageWrap);

    const body = document.createElement('div');
    body.className = 'app-card-body';

    const heading = document.createElement('h3');
    heading.textContent = app.name;
    body.appendChild(heading);

    const desc = document.createElement('p');
    desc.className = 'app-card-desc';
    desc.textContent = app.description || '';
    body.appendChild(desc);

    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'app-card-actions';

    if (cardRestore) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'app-action-btn restore-btn';
        restoreBtn.type = 'button';
        restoreBtn.title = 'Restore app';
        restoreBtn.innerHTML = '&#8635;';
        restoreBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            restoreApp(app.id);
        });
        actions.appendChild(restoreBtn);
    } else if (!disabled) {
        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = `app-action-btn favorite-btn${isAppFavorited(app) ? ' active' : ''}`;
        favoriteBtn.type = 'button';
        favoriteBtn.title = isAppFavorited(app) ? 'Remove from favorites' : 'Add to favorites';
        favoriteBtn.innerHTML = '&#9733;';
        favoriteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFavorite(app.id);
        });
        actions.appendChild(favoriteBtn);

        const disableBtn = document.createElement('button');
        disableBtn.className = 'app-action-btn disable-btn';
        disableBtn.type = 'button';
        disableBtn.title = 'Disable app';
        disableBtn.innerHTML = '&#10005;';
        disableBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            disableApp(app.id);
        });
        actions.appendChild(disableBtn);
    }

    card.appendChild(actions);

    if (!disabled && !isPlaceholderUrl) {
        card.addEventListener('click', () => openApp(app));
    }

    return card;
}

function buildPlaceholder(name) {
    const placeholder = document.createElement('div');
    placeholder.className = 'app-card-placeholder';
    placeholder.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return placeholder;
}

/* ────────────────────────────────────────────────────────────────
   Actions — each mutates local state, re-renders immediately, then
   persists to the backend in the background.
   ──────────────────────────────────────────────────────────────── */

async function openApp(app) {
    config.recent_apps = [app.id, ...config.recent_apps.filter(id => id !== app.id)].slice(0, 10);
    await saveConfig();
    window.location.href = "/apps"+ app.url;
}

function toggleFavorite(id) {
    config.favorited_apps = isFavoritedId(id)
        ? config.favorited_apps.filter(x => x !== id)
        : [...config.favorited_apps, id];
    render();
    saveConfig();
}

function isFavoritedId(id) {
    return config.favorited_apps.includes(id);
}

function disableApp(id) {
    if (!config.disabled_apps.includes(id)) {
        config.disabled_apps = [...config.disabled_apps, id];
    }
    config.favorited_apps = config.favorited_apps.filter(x => x !== id);
    render();
    saveConfig();
}

function restoreApp(id) {
    config.disabled_apps = config.disabled_apps.filter(x => x !== id);
    render();
    saveConfig();
}

function disableShelf(shelfKey) {
    if (shelfKey === '__recent__') {
        config.show_recent = false;
    } else if (!config.disabled_shelves.includes(shelfKey)) {
        config.disabled_shelves = [...config.disabled_shelves, shelfKey];
    }
    render();
    saveConfig();
}

function restoreShelf(shelfKey) {
    if (shelfKey === '__recent__') {
        config.show_recent = true;
    } else {
        config.disabled_shelves = config.disabled_shelves.filter(x => x !== shelfKey);
    }
    render();
    saveConfig();
}