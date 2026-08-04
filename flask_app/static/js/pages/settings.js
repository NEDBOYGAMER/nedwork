// ==========================================================================
// settings.js
// Wires up the settings sidebar (category switching, no scroll-jumping)
// plus every control on the page. The reusable pieces (segmented control,
// dropdown, range fill) are small helpers so new settings panels can reuse
// them without copy-pasting wiring code.
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;

    // =========================
    // Load Settings
    // =========================
    settings = fetch("settings/api/load")


    // =========================
    // STORAGE HELPERS
    // =========================
    const save = (key, value) => localStorage.setItem("_" + key, value);
    const load = (key, fallback) => localStorage.getItem("_" + key) ?? fallback;

    // =========================
    // BUTTON SAVE
    // Shows/hides panels in place - no scrolling or anchor jumping.
    // =========================
    const saveButton = document.getElementById("save-btn")

    saveButton.addEventListener("click", e => {
        const settings = {};

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);

            if (key.startsWith("_")) {
                let value = localStorage.getItem(key);

                key = key.slice(1);

                if (value === "true" || value === "false") {
                    value = value === "true";
                }

                settings[key] = value;
            }
        }

        fetch("/settings/api/save", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(settings)
        });
    });

    // =========================
    // SIDEBAR NAVIGATION
    // Shows/hides panels in place - no scrolling or anchor jumping.
    // =========================
    function initSettingsNav() {
        const navItems = document.querySelectorAll('.settings-nav-item');
        const panels = document.querySelectorAll('.settings-panel');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.panel;
                navItems.forEach(n => n.classList.toggle('active', n === item));
                panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
            });
        });
    }

    // =========================
    // SEGMENTED CONTROL
    // Positions the sliding thumb behind the active option. Re-run on
    // resize since option widths can change with the viewport.
    // =========================
    function initSegmented(container, { onChange, initial } = {}) {
        const options = [...container.querySelectorAll('.segmented-option')];
        const thumb = container.querySelector('.segmented-thumb');

        function setActive(value, animate = true) {
            const active = options.find(o => o.dataset.value === value) || options[0];
            if (!active) return;

            options.forEach(o => o.classList.toggle('active', o === active));

            if (thumb) {
                thumb.style.transition = animate ? '' : 'none';
                thumb.style.left = active.offsetLeft + 'px';
                thumb.style.width = active.offsetWidth + 'px';
                if (!animate) thumb.offsetHeight; // force reflow before re-enabling transition
                thumb.style.transition = '';
            }
        }

        options.forEach(o => {
            o.addEventListener('click', () => {
                setActive(o.dataset.value);
                if (onChange) onChange(o.dataset.value);
            });
        });

        window.addEventListener('resize', () => {
            const current = options.find(o => o.classList.contains('active'));
            if (current) setActive(current.dataset.value, false);
        });

        if (initial) setActive(initial, false);
        return setActive;
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

    initSettingsNav();
    document.querySelectorAll('input[type="range"]').forEach(initRangeFill);

    // =========================
    // THEME
    // =========================
    const applyTheme = (theme) => {
        root.setAttribute('data-theme', theme);
        save('theme', theme);
    };

    const themeSegmented = document.getElementById('theme-segmented');
    if (themeSegmented) {
        const savedTheme = load('theme', 'dark');
        initSegmented(themeSegmented, { onChange: applyTheme, initial: savedTheme });
        applyTheme(savedTheme);
    }

    // =========================
    // ACCENT COLOR
    // =========================
    const applyAccent = (accent) => {
        root.setAttribute('data-accent', accent);
        save('accent', accent);
    };

    const accentSegmented = document.getElementById('accent-segmented');
    if (accentSegmented) {
        const savedAccent = load('accent', 'violet');
        initSegmented(accentSegmented, { onChange: applyAccent, initial: savedAccent });
        applyAccent(savedAccent);
    }

    // =========================
    // BACKGROUND
    // =========================
    const applyBackground = (mode) => {
        document.body.classList.toggle('no-ambient', mode === 'none');
        save('background', mode);
    };

    const backgroundSegmented = document.getElementById('background-segmented');
    if (backgroundSegmented) {
        const savedBackground = load('background', 'grid');
        initSegmented(backgroundSegmented, { onChange: applyBackground, initial: savedBackground });
        applyBackground(savedBackground);
    }

    // =========================
    // LANGUAGE
    // =========================
    const languageDropdown = document.getElementById('language-dropdown');
    if (languageDropdown) {
        const savedLang = load('language', 'English');
        const valueEl = languageDropdown.querySelector('.select-dropdown-value');
        const options = languageDropdown.querySelectorAll('.select-dropdown-option');
        if (valueEl) valueEl.textContent = savedLang;
        options.forEach(o => o.classList.toggle('selected', o.dataset.value === savedLang));

        initDropdown(languageDropdown, {
            onSelect: (lang) => save('language', lang)
        });
    }

    // =========================
    // NOTIFICATION EMAIL
    // =========================
    const emailInput = document.querySelector('.notif-email');
    if (emailInput) {
        emailInput.value = load('email', '');
        emailInput.addEventListener('input', () => save('email', emailInput.value));
    }

    // =========================
    // NOTIFICATION SWITCHES
    // =========================
    document.querySelectorAll('.switch input[data-key]').forEach(sw => {
        const key = sw.dataset.key;
        sw.checked = load(key, 'false') === 'true';
        sw.addEventListener('change', () => save(key, sw.checked));
    });
});