import { createBackground } from './background.js';

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

    const plusButton = document.getElementById("plus-button");
    const add_window = document.getElementById("add-window");
    const overlay = document.getElementById("overlay");
    const closeBtn = document.getElementById("close-add-window");
    
    if (!plusButton || !add_window || !overlay || !closeBtn) {
        console.warn('Modal elements missing');
        return;
    }
    
    function openAddWindow() {
        add_window.classList.remove("hidden");
        overlay.classList.remove("hidden");
    }
    
    function closeAddWindow() {
        add_window.classList.add("hidden");
        overlay.classList.add("hidden");
    }
    
    plusButton.addEventListener("click", openAddWindow);
    closeBtn.addEventListener("click", closeAddWindow);
    overlay.addEventListener("click", closeAddWindow);




    const settingsBtn = document.getElementById("settings-btn");
        settingsBtn.addEventListener('click', () => {
            window.location.href = '/settings';
        });
});

