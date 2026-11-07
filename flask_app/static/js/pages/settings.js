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
//   - Notification email stays in localStorage (no backend field yet); the
//     Events toggle is a real SettingsConfig.notify_events column saved
//     with the rest of the server-backed settings.
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
        window.toast(message, isError ? 'error' : 'info');
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

        function showPanel(target) {
            const match = document.querySelector(`.settings-nav-item[data-panel="${target}"]`);
            if (!match) return false;
            navItems.forEach(n => n.classList.toggle('active', n === match));
            panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
            // Give the browser a frame to render the panel, then measure.
            requestAnimationFrame(positionAllThumbs);
            return true;
        }

        navItems.forEach(item => {
            item.addEventListener('click', () => showPanel(item.dataset.panel));
        });

        // Deep links: /settings#account (the sidenav Account button) opens
        // the account panel directly; a missing or unknown hash keeps the
        // markup's default (the first, already-active panel).
        const requested = window.location.hash.replace('#', '');
        if (requested && !showPanel(requested)) {
            console.warn(`Unknown settings panel in hash: ${requested}`);
        }
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
    const notifyEventsToggle = document.getElementById('notify-events');
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
    // NOTIFICATIONS
    // (email address stays client-side; the Events toggle is stored in
    //  SettingsConfig and gates event notifications server-side)
    // =========================
    if (emailInput) {
        emailInput.value = load('email', '');
        emailInput.addEventListener('input', () => save('email', emailInput.value));
    }

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
            if (notifyEventsToggle) notifyEventsToggle.checked = s.notify_events !== false;

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
                    : undefined,
                notify_events: notifyEventsToggle ? notifyEventsToggle.checked : undefined
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
                    // leave the page after a successful save, same
                    // destination as the Cancel button
                    const cancelHref = document
                        .querySelector('.settings-actions a.btn-secondary')
                        ?.getAttribute('href') || '/';
                    window.location.assign(cancelHref);
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

    // =========================
    // DELETE ACCOUNT
    // =========================
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const deleteBackdrop = document.getElementById('deleteAccountBackdrop');
    const deleteConfirmInput = document.getElementById('deleteAccountConfirm');
    const deleteConfirmBtn = document.getElementById('deleteAccountConfirmBtn');
    const deleteCancelBtn = document.getElementById('deleteAccountCancel');

    if (deleteBtn && deleteBackdrop && deleteConfirmInput &&
            deleteConfirmBtn && deleteCancelBtn) {
        const expected = deleteConfirmBtn.dataset.username || '';
        const closeDelete = () => {
            deleteBackdrop.classList.remove('open');
            deleteConfirmInput.value = '';
            deleteConfirmBtn.disabled = true;
            deleteCancelBtn.disabled = false;
        };
        deleteBtn.addEventListener('click', () => {
            deleteConfirmInput.value = '';
            deleteConfirmBtn.disabled = true;
            deleteBackdrop.classList.add('open');
            deleteConfirmInput.focus();
        });
        deleteCancelBtn?.addEventListener('click', closeDelete);
        deleteBackdrop.addEventListener('click', (e) => {
            if (e.target === deleteBackdrop) closeDelete();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && deleteBackdrop.classList.contains('open')) {
                closeDelete();
            }
        });
        deleteConfirmInput.addEventListener('input', () => {
            deleteConfirmBtn.disabled =
                deleteConfirmInput.value.trim() !== expected;
        });
        deleteConfirmBtn.addEventListener('click', async () => {
            deleteConfirmBtn.disabled = true;
            deleteCancelBtn.disabled = true;
            try {
                const res = await fetch('/auth/api/delete_account', {
                    method: 'POST',
                });
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                window.location.assign('/auth/login');
            } catch (err) {
                console.error('Failed to delete account', err);
                showToast('Could not delete account', true);
                deleteConfirmBtn.disabled = false;
                deleteCancelBtn.disabled = false;
            }
        });
    }

    // =========================
    // CHANGE PASSWORD
    // =========================
    const pwBtn = document.getElementById('changePasswordBtn');
    const pwBackdrop = document.getElementById('changePasswordBackdrop');
    const pwCurrent = document.getElementById('pwCurrent');
    const pwNew = document.getElementById('pwNew');
    const pwConfirm = document.getElementById('pwConfirm');
    const pwError = document.getElementById('pwError');
    const pwSaveBtn = document.getElementById('pwSave');
    const pwCancelBtn = document.getElementById('pwCancel');

    if (pwBtn && pwBackdrop && pwCurrent && pwNew && pwConfirm &&
            pwError && pwSaveBtn && pwCancelBtn) {
        const closePw = () => {
            pwBackdrop.classList.remove('open');
            pwCurrent.value = '';
            pwNew.value = '';
            pwConfirm.value = '';
            pwError.hidden = true;
            pwError.textContent = '';
            pwSaveBtn.disabled = false;
        };
        const showPwError = (msg) => {
            pwError.textContent = msg;
            pwError.hidden = false;
        };
        pwBtn.addEventListener('click', () => {
            pwCurrent.value = '';
            pwNew.value = '';
            pwConfirm.value = '';
            pwError.hidden = true;
            pwError.textContent = '';
            pwBackdrop.classList.add('open');
            pwCurrent.focus();
        });
        pwCancelBtn.addEventListener('click', closePw);
        pwBackdrop.addEventListener('click', (e) => {
            if (e.target === pwBackdrop) closePw();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && pwBackdrop.classList.contains('open')) {
                closePw();
            }
        });
        [pwCurrent, pwNew, pwConfirm].forEach((el) => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    pwSaveBtn.click();
                }
            });
        });
        pwSaveBtn.addEventListener('click', async () => {
            const current = pwCurrent.value;
            const next = pwNew.value;
            if (!current || !next) {
                showPwError('Please fill in all fields.');
                return;
            }
            if (next.length < 4) {
                showPwError('New password must be at least 4 characters.');
                return;
            }
            if (next !== pwConfirm.value) {
                showPwError('New passwords do not match.');
                return;
            }
            pwSaveBtn.disabled = true;
            pwCancelBtn.disabled = true;
            try {
                const res = await fetch('/auth/api/change_password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: current,
                        new_password: next,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    showPwError(data.error || 'Could not change password.');
                } else {
                    closePw();
                    showToast('Password changed');
                }
            } catch (err) {
                console.error('Failed to change password', err);
                showPwError('Could not change password.');
            } finally {
                pwSaveBtn.disabled = false;
                pwCancelBtn.disabled = false;
            }
        });
    }
}