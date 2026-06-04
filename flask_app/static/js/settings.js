import { createBackground, colorMap, applyColor } from './background.js';

document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    if (!cursor || !ring || !canvas) {
        console.warn('Missing background elements');
        return;
    }

    const background = createBackground({
        cursor,
        ring,
        canvas
    });

    background.start();

    const root = document.documentElement;

    // =========================
    // STORAGE HELPERS
    // =========================
    const save = (key, value) => localStorage.setItem(key, value);
    const load = (key, fallback) => localStorage.getItem(key) ?? fallback;

    // =========================
    // THEME TOGGLE
    // =========================
    const themeSwitch = document.getElementById('switch');

    const applyTheme = (theme) => {
        if (theme === 'light') {
            document.body.setAttribute('data-theme', 'light');
        } else {
            document.body.removeAttribute('data-theme');
        }
        save('theme', theme);
    };

    const savedTheme = load('theme', 'dark');
    themeSwitch.checked = savedTheme === 'light';
    applyTheme(savedTheme);

    themeSwitch.addEventListener('change', () => {
        applyTheme(themeSwitch.checked ? 'light' : 'dark');
    });

    // =========================
    // ACCENT COLOR
    // =========================
    const colorInputs = document.querySelectorAll('input[name="color"]');

    const savedColor = load('accent', 'optviolet');
    const savedColorInput = document.getElementById(savedColor);
    if (savedColorInput) savedColorInput.checked = true;
    applyColor(savedColor);

    colorInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) applyColor(input.id);
        });
    });

    // =========================
    // BACKGROUND MODE
    // =========================
    const bgInputs = document.querySelectorAll('input[name="background"]');

    const applyBackground = (mode) => {
        save('background', mode);

        if (!background || !background.setMode) return;

        background.setMode(mode);
    };

    const savedBg = load('background', 'optgrid');
    const savedBgInput = document.getElementById(savedBg);
    if (savedBgInput) savedBgInput.checked = true;
    applyBackground(savedBg);

    bgInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) applyBackground(input.id);
        });
    });

    // =========================
    // LANGUAGE DROPDOWN
    // =========================
    const dropdown = document.querySelector(".dropdown");
    const selected = dropdown.querySelector(".dropdown-selected");
    const options = dropdown.querySelectorAll(".dropdown-option");
    const checkbox = dropdown.querySelector("#drop");

    const applyLanguage = (lang) => {
        selected.textContent = lang;
        save('language', lang);
    };

    const savedLang = load('language', 'English');
    applyLanguage(savedLang);

    options.forEach(opt => {
        opt.addEventListener("click", () => {
            applyLanguage(opt.textContent);
            checkbox.checked = false;
        });
    });

    // =========================
    // EMAIL INPUT
    // =========================
    const emailInput = document.querySelector('.ui-input[type="email"]');

    if (emailInput) {
        emailInput.value = load('email', '');

        emailInput.addEventListener('input', () => {
            save('email', emailInput.value);
        });
    }

    // =========================
    // NOTIFICATION SWITCHES
    // =========================
    const switches = document.querySelectorAll('.switch input');

    switches.forEach((sw, i) => {
        const key = `notif_${i}`;

        sw.checked = load(key, 'false') === 'true';

        sw.addEventListener('change', () => {
            save(key, sw.checked);
        });
    });

    console.log('Settings loaded');
});