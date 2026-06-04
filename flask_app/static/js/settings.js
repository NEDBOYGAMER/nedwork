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

    // DROPDOWN CODE
    const dropdown = document.querySelector(".dropdown");
    const selected = dropdown.querySelector(".dropdown-selected");
    const options = dropdown.querySelectorAll(".dropdown-option");
    const checkbox = dropdown.querySelector("#drop");

    options.forEach(opt => {
      opt.addEventListener("click", () => {
        selected.textContent = opt.textContent;
        checkbox.checked = false;
      });
    });
});
