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

/* Feature detection: tilt + hover panel only for real pointers, and
   skipped entirely for users who prefer reduced motion. */
const CAN_HOVER =
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', async () => {

    renderSkeleton();

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

    // Keep the floating panel glued to its card through any scroll
    // (capture: true catches the horizontal shelf rows scrolling too)
    window.addEventListener('scroll', () => {
        if (hoverPanel.classList.contains('show')) positionPanel();
    }, true);
    window.addEventListener('resize', () => {
        if (hoverPanel.classList.contains('show')) positionPanel();
    });
});


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

function isInteractive(app) {
    return Boolean(app.url && app.url !== '/placeholder');
}

function allTypes() {
    const set = new Set();
    apps.forEach(app => set.add(app.type));
    return Array.from(set);
}

function appsByType(type) {
    return apps.filter(app => app.type === type && !isAppDisabled(app));
}

/* FNV-1a — stable across sessions so generated capsule art is consistent */
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/* Deterministic two-tone gradient per app — replaces the old blob
   placeholder. Real images override this whenever they exist. */
function buildCapsuleArt(name) {
    const h = hashString((name || '?').trim().toLowerCase());
    const hue = h % 360;
    const hue2 = (hue + 42) % 360;

    const art = document.createElement('div');
    art.className = 'capsule-art';
    art.style.background = `linear-gradient(135deg, hsl(${hue} 62% 40%) 0%, hsl(${hue2} 68% 22%) 100%)`;

    const stripes = document.createElement('div');
    stripes.className = 'capsule-stripes';

    const initial = document.createElement('span');
    initial.className = 'capsule-initial';
    initial.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';

    art.append(stripes, initial);
    return art;
}

function buildArt(app) {
    if (app.image) {
        const img = document.createElement('img');
        img.src = window.STATIC_URL + 'img/apps' + app.image;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            img.replaceWith(buildCapsuleArt(app.name));
        });
        return img;
    }
    return buildCapsuleArt(app.name);
}

/* ────────────────────────────────────────────────────────────────
   Rendering
   ──────────────────────────────────────────────────────────────── */

function renderSkeleton() {
    const container = document.getElementById('shelves-container');
    if (!container) return;
    container.innerHTML = '';

    for (let s = 0; s < 2; s++) {
        const shelf = document.createElement('div');
        shelf.className = 'skel-shelf';

        const title = document.createElement('div');
        title.className = 'skeleton skel-title';
        shelf.appendChild(title);

        const row = document.createElement('div');
        row.className = 'skel-row';
        for (let i = 0; i < 4; i++) {
            const card = document.createElement('div');
            card.className = 'skeleton skel-card';
            row.appendChild(card);
        }
        shelf.appendChild(row);
        container.appendChild(shelf);
    }
}

function render() {
    hidePanel();

    const container = document.getElementById('shelves-container');
    if (!container) return;
    container.innerHTML = '';

    buildHero();

    let renderedAny = false;

    // 1. Recent — compact capsules
    if (config.show_recent) {
        const recentApps = [...new Set(config.recent_apps)]
            .map(getAppById)
            .filter(app => app && !isAppDisabled(app));

        if (recentApps.length > 0) {
            container.appendChild(buildShelf({
                title: 'Recent',
                apps: recentApps,
                shelfKey: '__recent__',
                small: true,
                canDisableShelf: true,
            }));
            renderedAny = true;
        }
    }

    // 2. Favorites — compact capsules, never disableable
    const favoritedApps = config.favorited_apps
        .map(getAppById)
        .filter(app => app && !isAppDisabled(app));

    if (favoritedApps.length > 0) {
        container.appendChild(buildShelf({
            title: 'Favorites',
            apps: favoritedApps,
            shelfKey: '__favorites__',
            small: true,
        }));
        renderedAny = true;
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
        renderedAny = true;
    });

    // 4. Collapsible disabled section
    const disabledApps = config.disabled_apps.map(getAppById).filter(Boolean);
    const hasDisabledContent =
        (!config.show_recent && config.recent_apps.map(getAppById).filter(Boolean).length > 0) ||
        disabledApps.length > 0 ||
        config.disabled_shelves.length > 0;

    if (hasDisabledContent) {
        container.appendChild(buildDisabledSection(disabledApps));
    }

    // 5. Nothing at all?
    if (!renderedAny && !hasDisabledContent) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<h3>Nothing here yet</h3><p>All your apps are hidden or unavailable.</p>';
        container.appendChild(empty);
    }
}

/* ── Featured hero banner ────────────────────────────────────────── */

function buildHero() {
    const slot = document.getElementById('hero-slot');
    if (!slot) return;
    slot.innerHTML = '';

    // Prefer the most recently opened interactive app; fall back to any.
    const featured =
        config.recent_apps
            .map(getAppById)
            .find(app => app && !isAppDisabled(app) && isInteractive(app)) ||
        apps.find(app => !isAppDisabled(app) && isInteractive(app));

    if (!featured) return;

    const hero = document.createElement('section');
    hero.className = 'hero';
    hero.setAttribute('role', 'link');
    hero.tabIndex = 0;
    hero.setAttribute('aria-label', `Open ${featured.name}`);

    const art = document.createElement('div');
    art.className = 'hero-art';
    art.appendChild(buildArt(featured));

    const scrim = document.createElement('div');
    scrim.className = 'hero-scrim';

    const content = document.createElement('div');
    content.className = 'hero-content';

    const badge = document.createElement('span');
    badge.className = 'hero-badge';
    badge.textContent = `Featured · ${featured.type || 'App'}`;

    const title = document.createElement('h2');
    title.className = 'hero-title';
    title.textContent = featured.name;

    content.append(badge, title);

    if (featured.description) {
        const desc = document.createElement('p');
        desc.className = 'hero-desc';
        desc.textContent = featured.description;
        content.appendChild(desc);
    }

    const btn = document.createElement('span');
    btn.className = 'btn btn-primary btn-lg hero-btn';
    btn.innerHTML = '&#9654;&nbsp; Open App';
    content.appendChild(btn);

    hero.append(art, scrim, content);

    const activate = () => openApp(featured);
    hero.addEventListener('click', activate);
    hero.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
        }
    });

    slot.appendChild(hero);
}

/* ── Disabled section ────────────────────────────────────────────── */

function buildDisabledSection(disabledApps) {
    const wrapper = document.createElement('section');
    wrapper.id = 'disabled-section';

    const toggle = document.createElement('button');
    toggle.id = 'disabled-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="chevron">&#9662;</span><span>Hidden &amp; disabled</span>';
    toggle.addEventListener('click', () => {
        const expanded = wrapper.classList.toggle('expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
    });
    wrapper.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'disabled-content';

    if (!config.show_recent) {
        const recentApps = config.recent_apps.map(getAppById).filter(Boolean);
        if (recentApps.length > 0) {
            content.appendChild(buildShelf({
                title: 'Recent',
                apps: recentApps,
                shelfKey: '__recent__',
                small: true,
                disabled: true,
                headerRestore: true,
            }));
        }
    }

    if (disabledApps.length > 0) {
        content.appendChild(buildShelf({
            title: 'Disabled Apps',
            apps: disabledApps,
            shelfKey: '__disabled_apps__',
            small: true,
            disabled: true,
            cardRestore: true,
        }));
    }

    config.disabled_shelves.forEach(type => {
        const shelfApps = apps.filter(app => app.type === type);
        if (shelfApps.length === 0) return;
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

/* ── Shelf builder ───────────────────────────────────────────────── */

function buildShelf({
    title,
    apps: shelfApps,
    shelfKey,
    small = false,
    disabled = false,
    headerRestore = false,
    cardRestore = false,
    canDisableShelf = false,
}) {
    const shelf = document.createElement('section');
    shelf.className = `shelf${small ? '' : ''}${disabled ? ' shelf--disabled' : ''}`;
    shelf.dataset.shelf = shelfKey;

    const header = document.createElement('div');
    header.className = 'shelf-header';

    const heading = document.createElement('h2');
    heading.className = 'shelf-title';
    heading.textContent = title;
    header.appendChild(heading);

    const count = document.createElement('span');
    count.className = 'shelf-count';
    count.textContent = String(shelfApps.length);
    header.appendChild(count);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    header.appendChild(spacer);

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

    const body = document.createElement('div');
    body.className = 'shelf-body';

    const row = document.createElement('div');
    row.className = 'shelf-row';

    shelfApps.forEach((app, i) => {
        const card = buildCard(app, { disabled, cardRestore, small });
        if (!disabled) {
            card.classList.add('reveal');
            card.style.animationDelay = `${Math.min(i * 40, 480)}ms`;
        }
        row.appendChild(card);
    });

    body.appendChild(row);

    if (!disabled) {
        body.appendChild(buildFade('left'));
        body.appendChild(buildFade('right'));
        setupShelfNav(body, row);
    }

    shelf.appendChild(body);
    return shelf;
}

function buildFade(side) {
    const fade = document.createElement('div');
    fade.className = `fade ${side}`;
    return fade;
}

/* Chevron arrows + edge-fade state for one shelf row */
function setupShelfNav(body, row) {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'shelf-arrow prev';
    prev.setAttribute('aria-label', 'Scroll left');
    prev.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'shelf-arrow next';
    next.setAttribute('aria-label', 'Scroll right');
    next.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    const scroll = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
    prev.addEventListener('click', () => scroll(-1));
    next.addEventListener('click', () => scroll(1));

    const update = () => {
        const maxScroll = row.scrollWidth - row.clientWidth;
        const hasOverflow = maxScroll > 4;
        body.classList.toggle('no-nav', !hasOverflow);
        const canLeft = row.scrollLeft > 4;
        const canRight = row.scrollLeft < maxScroll - 4;
        body.classList.toggle('can-left', canLeft);
        body.classList.toggle('can-right', canRight);
        prev.disabled = !canLeft;
        next.disabled = !canRight;
    };

    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    body.append(prev, next);
    update();
}

/* ==========================================================================
   Card — artwork, overlaid name, tilt-on-hover, floating info panel
   ========================================================================== */

function buildCard(app, { disabled = false, cardRestore = false, small = false } = {}) {
    const interactive = isInteractive(app);

    const card = document.createElement('div');
    card.className = [
        'app-card',
        small ? 'app-card--sm' : '',
        disabled ? 'app-card--disabled' : '',
        interactive ? '' : ' app-card--placeholder',
    ].filter(Boolean).join(' ').trim();
    card.dataset.appId = app.id;

    const artWrap = document.createElement('div');
    artWrap.className = 'app-card-art';
    artWrap.appendChild(buildArt(app));

    const scrim = document.createElement('div');
    scrim.className = 'app-card-scrim';

    const name = document.createElement('h3');
    name.className = 'app-card-name';
    name.textContent = app.name;

    card.append(artWrap, scrim, name);

    /* Actions */
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
        const favActive = isAppFavorited(app);

        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = `app-action-btn favorite-btn${favActive ? ' active' : ''}`;
        favoriteBtn.type = 'button';
        favoriteBtn.title = favActive ? 'Remove from favorites' : 'Add to favorites';
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

    /* Interactions */
    if (!disabled) {
        if (CAN_HOVER) {
            bindTilt(card);
            bindHoverPanel(card, app, interactive);
        }

        if (interactive) {
            card.setAttribute('role', 'link');
            card.tabIndex = 0;
            card.addEventListener('click', () => openApp(app));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openApp(app);
                }
            });
        } else {
            card.classList.add('app-card--placeholder');
        }
    }

    return card;
}

/* ── 3D tilt — lifts and "presses down" under the cursor ────────── */

function bindTilt(card) {
    const MAX_TILT = 7; // degrees
    let raf = null;
    let hovering = false;

    card.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        hovering = true;
        // springy approach
        card.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1), border-color .2s ease, box-shadow .35s ease';
    });

    card.addEventListener('pointermove', (e) => {
        if (!hovering || e.pointerType !== 'mouse' || raf) return;
        raf = requestAnimationFrame(() => {
            raf = null;
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
            const py = (e.clientY - r.top) / r.height - 0.5;

            // Sign choice: the corner under the cursor dips BACK,
            // like pressing into the surface.
            const rx = (-py * 2 * MAX_TILT).toFixed(2);
            const ry = (px * 2 * MAX_TILT).toFixed(2);

            card.style.transition = 'transform .07s linear';
            card.style.transform =
                `perspective(900px) translateY(-6px) scale(1.02) rotateX(${rx}deg) rotateY(${ry}deg)`;
        });
    });

    card.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        hovering = false;
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        card.style.transition = 'transform .45s cubic-bezier(.22,1,.36,1), border-color .2s ease, box-shadow .35s ease';
        card.style.transform = '';
    });
}

/* ── Floating info panel — appears next to the hovered card ─────── */

const hoverPanel = document.getElementById('hover-panel');
let panelTimer = null;
let panelCard = null;

function bindHoverPanel(card, app, interactive) {
    card.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        showPanel(app, card, interactive);
    });
    card.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        hidePanel();
    });
}

function showPanel(app, card, interactive) {
    if (!hoverPanel) return;

    hoverPanel.querySelector('.hp-type').textContent = app.type || 'App';
    hoverPanel.querySelector('.hp-name').textContent = app.name;
    hoverPanel.querySelector('.hp-desc').textContent = app.description || 'No description yet.';
    hoverPanel.querySelector('.hp-hint').textContent = interactive ? '\u21B5 Click to open' : 'Coming soon';

    panelCard = card;
    clearTimeout(panelTimer);
    // small delay = no flicker when sweeping the cursor across a row
    panelTimer = setTimeout(() => {
        positionPanel();
        hoverPanel.classList.add('show');
    }, 130);
}

function hidePanel() {
    if (!hoverPanel) return;
    clearTimeout(panelTimer);
    panelCard = null;
    hoverPanel.classList.remove('show');
}

function positionPanel() {
    if (!panelCard) return;

    const r = panelCard.getBoundingClientRect();
    const pw = hoverPanel.offsetWidth;
    const ph = hoverPanel.offsetHeight;
    const m = 14; // viewport margin

    let left = r.right + m;
    if (left + pw > window.innerWidth - m) {
        left = r.left - pw - m; // flip to the left side
    }

    let top = r.top + r.height / 2 - ph / 2;
    top = Math.max(m, Math.min(top, window.innerHeight - ph - m));

    // No room on either side → drop below the card
    if (left < m) {
        left = Math.min(Math.max(r.left, m), window.innerWidth - pw - m);
        top = r.bottom + m;
        if (top + ph > window.innerHeight - m) {
            top = Math.max(m, r.top - ph - m);
        }
    }

    hoverPanel.style.left = `${Math.round(left)}px`;
    hoverPanel.style.top = `${Math.round(top)}px`;
}

/* ────────────────────────────────────────────────────────────────
   Actions — mutate local state, re-render, persist in background
   ──────────────────────────────────────────────────────────────── */

async function openApp(app) {
    config.recent_apps = [app.id, ...config.recent_apps.filter(id => id !== app.id)].slice(0, 10);
    await saveConfig();
    window.location.href = "/apps" + app.url;
}

function toggleFavorite(id) {
    config.favorited_apps = config.favorited_apps.includes(id)
        ? config.favorited_apps.filter(x => x !== id)
        : [...config.favorited_apps, id];
    render();
    saveConfig();
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