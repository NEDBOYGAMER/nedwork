export function notes() {
    const grid = document.getElementById("card-grid");

    const card = document.createElement("div");
    card.classList.add("card", "notes-widget");

    // Inline SVGs for clean, sharp, white icons
    const tickIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    `;

    const penIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
    `;

    // Starts in edit mode, so the checkmark (tick) icon is visible to "save" or preview
    card.innerHTML = `
        <button id="toggle-mode-btn" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
            ${tickIcon}
        </button>
        <div class="notes-container">
            <textarea id="notes-textarea" placeholder="Type your thoughts here..."></textarea>
            <div id="notes-preview" style="display: none;"></div>
        </div>
    `;

    grid.appendChild(card);

    const textarea = card.querySelector("#notes-textarea");
    const preview = card.querySelector("#notes-preview");
    const toggleBtn = card.querySelector("#toggle-mode-btn");

    // Toggle Mode using the 'marked' library
    let isPreviewMode = false;
    toggleBtn.addEventListener("click", () => {
        if (!isPreviewMode) {
            preview.innerHTML = marked.parse(textarea.value);
            
            textarea.style.display = "none";
            preview.style.display = "block";
            toggleBtn.innerHTML = penIcon; // Switch to the pen icon
        } else {
            textarea.style.display = "block";
            preview.style.display = "none";
            toggleBtn.innerHTML = tickIcon; // Switch back to the tick icon
        }
        isPreviewMode = !isPreviewMode;
    });
}