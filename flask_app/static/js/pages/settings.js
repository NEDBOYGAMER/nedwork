// ==========================================================================
// settings.js
// Wires up the settings sidebar (category switching, no scroll-jumping)
// plus every control on the page. The reusable pieces (segmented control,
// dropdown, range fill) are small helpers so new settings panels can reuse
// them without copy-pasting wiring code.
//
// Persistence:
//   - dark_mode, grid, accent_color, accent_color_soft, accent_color_ink,
//     and language are backed by the server (SettingsConfig) and only
//     persist when the Save button is pressed. A copy is cached in
//     localStorage purely so the pre-paint script in base.html can apply
//     the right theme/accent before first paint on the next page load.
//   - Notification prefs (email + toggles) have no backend field yet, so
//     they stay in localStorage only, saved live as they're changed.
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    const root = document.documentElement;

    // =========================
    // STORAGE HELPERS (local cache only, see note above)
    // =========================
    const cacheSet = (key, value) => localStorage.setItem('_' + key, value);
    const load = (key, fallback) => localStorage.getItem('_' + key) ?? fallback;
    const save = (key, value) => localStorage.setItem('_' + key, value);

    // =========================
    // TOAST
    // =========================
    function showToast(message, isError = false) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        if (isError) toast.style.borderLeftColor = 'var(--danger)';
        toast.textContent = message;

        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

// =========================
// SIDEBAR NAVIGATION
// Shows/hides panels in place - no scrolling or anchor jumping.
// After the panel becomes visible, re-position any segmented thumbs
// inside it: while the panel was display:none their offsets were 0.
// =========================
    function initSettingsNav() {
        const navItems = document.querySelectorAll('.settings-nav-item');
        const panels = document.querySelectorAll('.settings-panel');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.panel;
                navItems.forEach(n => n.classList.toggle('active', n === item));
                panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
                // Give the browser a frame to render the panel, then measure.
                requestAnimationFrame(positionAllThumbs);
            });
        });
    }

// =========================
// SEGMENTED CONTROL
// Positions the sliding thumb behind the active option. Re-run on
// resize since option widths can change with the viewport.
//
// IMPORTANT: thumb position is only measurable while the container is
// actually rendered. Settings panels are display:none until opened, so
// if the control is hidden we just track the active value and defer the
// positioning until the panel is shown (see initSettingsNav above).
// =========================
    const segmentedInstances = [];

    function initSegmented(container, { onChange, initial } = {}) {
        const options = [...container.querySelectorAll('.segmented-option')];
        const thumb = container.querySelector('.segmented-thumb');
        let currentValue = null;

        const isVisible = () => container.offsetParent !== null;

        function positionThumb(animate = true) {
            const active = options.find(o => o.dataset.value === currentValue) || options[0];
            if (!active) return;

            options.forEach(o => o.classList.toggle('active', o === active));

            // offsetLeft/offsetWidth are 0 inside a display:none panel -
            // store the value, position later once the panel is visible.
            if (thumb && isVisible()) {
                thumb.style.transition = animate ? '' : 'none';
                thumb.style.left = active.offsetLeft + 'px';
                thumb.style.width = active.offsetWidth + 'px';
                if (!animate) thumb.offsetHeight; // force reflow before re-enabling transition
                thumb.style.transition = '';
            }
        }

        function setActive(value, animate = true) {
            currentValue = value;
            positionThumb(animate);
        }

        options.forEach(o => {
            o.addEventListener('click', () => {
                setActive(o.dataset.value);
                if (onChange) onChange(o.dataset.value);
            });
        });

        window.addEventListener('resize', () => {
            if (currentValue) setActive(currentValue, false);
        });

        if (initial) setActive(initial, false);

        segmentedInstances.push({ reposition: () => positionThumb(false) });
        return setActive;
    }

    function positionAllThumbs() {
        segmentedInstances.forEach(seg => seg.reposition());
    }   

    // =========================
    // DROPDOWN (custom select)
    // =========================
    function initDropdown(el, { onSelect } = {}) {
        if (el.getAttribute('aria-disabled') === 'true') return;

        const trigger = el.querySelector('.select-dropdown-trigger');
        const valueEl = el.querySelector('.select-dropdown-value');
        const options = [...el.querySelectorAll('.select-dropdown-option')];

        trigger.addEventListener('click', () => {
            el.classList.toggle('open');
            trigger.setAttribute('aria-expanded', el.classList.contains('open'));
        });

        options.forEach(opt => {
            opt.addEventListener('click', () => {
                options.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                if (valueEl) valueEl.textContent = opt.textContent.trim();
                el.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
                if (onSelect) onSelect(opt.dataset.value || opt.textContent.trim());
            });
        });

        document.addEventListener('click', (e) => {
            if (!el.contains(e.target)) {
                el.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function setDropdownValue(el, value) {
        if (!el || !value) return;
        const valueEl = el.querySelector('.select-dropdown-value');
        const options = el.querySelectorAll('.select-dropdown-option');
        if (valueEl) valueEl.textContent = value;
        options.forEach(o => o.classList.toggle('selected', o.dataset.value === value));
    }

    // =========================
    // RANGE SLIDER FILL
    // =========================
    function initRangeFill(input) {
        const update = () => {
            const min = Number(input.min) || 0;
            const max = Number(input.max) || 100;
            const val = Number(input.value);
            const pct = ((val - min) / (max - min)) * 100;
            input.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--surface-2) ${pct}%)`;
            const valueEl = input.parentElement.querySelector('.range-value');
            if (valueEl) valueEl.textContent = `${val}%`;
        };
        input.addEventListener('input', update);
        update();
    }

    // =========================
    // COLOR CONVERSION
    // Color <input> only accepts 6-digit hex, but the backend default for
    // accent_color_soft is an rgba() string - normalize whatever comes
    // back from the server into a hex value the input can display.
    // =========================
    function toHex(color) {
        if (!color) return '#000000';
        color = color.trim();

        if (color.startsWith('#')) {
            if (color.length === 4) { // #rgb -> #rrggbb
                return '#' + [...color.slice(1)].map(c => c + c).join('');
            }
            return color.slice(0, 7).toLowerCase();
        }

        const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m) {
            const part = n => Number(n).toString(16).padStart(2, '0');
            return '#' + part(m[1]) + part(m[2]) + part(m[3]);
        }

        return '#000000';
    }

    initSettingsNav();
    document.querySelectorAll('input[type="range"]').forEach(initRangeFill);

    // =========================
    // ELEMENTS
    // =========================
    const themeSegmented = document.getElementById('theme-segmented');
    const backgroundSegmented = document.getElementById('background-segmented');
    const languageDropdown = document.getElementById('language-dropdown');
    const accentInput = document.getElementById('accent-color-picker');
    const accentSoftInput = document.getElementById('accent-soft-picker');
    const accentInkInput = document.getElementById('accent-ink-picker');
    const emailInput = document.querySelector('.notif-email');
    const saveBtn = document.getElementById('save-btn');

    // =========================
    // LIVE-APPLY HELPERS
    // (change the page immediately; persistence happens separately)
    // =========================
    const applyTheme = (theme) => root.setAttribute('data-theme', theme);

    const applyGrid = (showGrid) => document.body.classList.toggle('no-ambient', !showGrid);

    const setAccentVar = (varName, hex) => root.style.setProperty(varName, hex);

    function updateColorLabel(input) {
        const label = input.parentElement.querySelector('.color-picker-value');
        if (label) label.textContent = input.value.toUpperCase();
    }

    // =========================
    // THEME + BACKGROUND SEGMENTED CONTROLS
    // =========================
    let setActiveTheme = null;
    if (themeSegmented) {
        setActiveTheme = initSegmented(themeSegmented, { onChange: applyTheme });
    }

    let setActiveBackground = null;
    if (backgroundSegmented) {
        setActiveBackground = initSegmented(backgroundSegmented, {
            onChange: (v) => applyGrid(v === 'grid')
        });
    }

    if (languageDropdown) {
        initDropdown(languageDropdown, {});
    }

    // =========================
    // COLOR PICKERS (live preview as you drag)
    // =========================
    const colorInputs = [
        [accentInput, '--accent'],
        [accentSoftInput, '--accent-soft'],
        [accentInkInput, '--accent-ink']
    ];

    colorInputs.forEach(([input, varName]) => {
        if (!input) return;
        input.addEventListener('input', () => {
            setAccentVar(varName, input.value);
            updateColorLabel(input);
        });
    });

    // =========================
    // NOTIFICATIONS (client-only, no backend field)
    // =========================
    if (emailInput) {
        emailInput.value = load('email', '');
        emailInput.addEventListener('input', () => save('email', emailInput.value));
    }

    document.querySelectorAll('.switch input[data-key]').forEach(sw => {
        const key = sw.dataset.key;
        sw.checked = load(key, 'false') === 'true';
        sw.addEventListener('change', () => save(key, sw.checked));
    });

    // =========================
    // LOAD SETTINGS FROM SERVER
    // =========================
    try {
        const res = await fetch('/settings/api/load');
        const data = await res.json();

        if (data.success) {
            const s = data.settings;

            const themeValue = s.dark_mode ? 'dark' : 'light';
            applyTheme(themeValue);
            if (setActiveTheme) setActiveTheme(themeValue, false);

            applyGrid(!!s.grid);
            if (setActiveBackground) setActiveBackground(s.grid ? 'grid' : 'none', false);

            if (accentInput) {
                accentInput.value = toHex(s.accent_color);
                setAccentVar('--accent', accentInput.value);
                updateColorLabel(accentInput);
            }
            if (accentSoftInput) {
                accentSoftInput.value = toHex(s.accent_color_soft);
                setAccentVar('--accent-soft', accentSoftInput.value);
                updateColorLabel(accentSoftInput);
            }
            if (accentInkInput) {
                accentInkInput.value = toHex(s.accent_color_ink);
                setAccentVar('--accent-ink', accentInkInput.value);
                updateColorLabel(accentInkInput);
            }

            setDropdownValue(languageDropdown, s.language);

            // cache so next page load can pre-paint the right look
            cacheSet('dark_mode', !!s.dark_mode);
            cacheSet('grid', !!s.grid);
            cacheSet('accent_color', accentInput ? accentInput.value : '');
            cacheSet('accent_color_soft', accentSoftInput ? accentSoftInput.value : '');
            cacheSet('accent_color_ink', accentInkInput ? accentInkInput.value : '');
            positionAllThumbs();
        } else {
            showToast('Could not load settings', true);
        }
    } catch (err) {
        console.error('Failed to load settings', err);
        showToast('Could not load settings', true);
    }

    // =========================
    // SAVE
    // =========================
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const payload = {
                dark_mode: root.getAttribute('data-theme') === 'dark',
                grid: !document.body.classList.contains('no-ambient'),
                accent_color: accentInput ? accentInput.value : undefined,
                accent_color_soft: accentSoftInput ? accentSoftInput.value : undefined,
                accent_color_ink: accentInkInput ? accentInkInput.value : undefined,
                language: languageDropdown
                    ? languageDropdown.querySelector('.select-dropdown-value').textContent.trim()
                    : undefined
            };

            saveBtn.disabled = true;

            try {
                const res = await fetch('/settings/api/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (data.success) {
                    cacheSet('dark_mode', payload.dark_mode);
                    cacheSet('grid', payload.grid);
                    cacheSet('accent_color', payload.accent_color || '');
                    cacheSet('accent_color_soft', payload.accent_color_soft || '');
                    cacheSet('accent_color_ink', payload.accent_color_ink || '');
                    showToast('Settings saved');
                } else {
                    showToast('Could not save settings', true);
                }
            } catch (err) {
                console.error('Failed to save settings', err);
                showToast('Could not save settings', true);
            } finally {
                saveBtn.disabled = false;
            }
        });
    }
}