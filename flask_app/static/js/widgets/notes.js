// notes.js
// Exports a NotesWidget class (extends Widget from base_widget.js).
// widget.js's createWidget() builds the card shell from getDefinition(),
// then calls instance.init(card) to wire up behaviour.
//
// Expected widgetConfig shape (see WIDGET_DEFAULTS.notes):
//   {
//     type: "notes",
//     id: "-",
//     text: "default",   // "default" is a sentinel for "no saved text yet"
//     settings: { style: "tech" }
//   }

import { Widget } from './base_widget.js';

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

export class NotesWidget extends Widget {
    getDefinition() {
        // Notes has its own absolute-positioned toggle button instead of the
        // shared widget-header, so it opts out of that part of the shell.
        return {
            showHeader: false,
            bodyHTML: `
    <button id="toggle-mode-btn" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
        ${tickIcon}
    </button>
    <div class="notes-container">
        <textarea id="notes-textarea" placeholder="Type your thoughts here..."></textarea>
        <div id="notes-preview" style="display: none;"></div>
    </div>
    `,
        };
    }

    init(card) {
        const savedText = this.config.text && this.config.text !== "default" ? this.config.text : "";

        this.textarea = card.querySelector("#notes-textarea");
        this.preview = card.querySelector("#notes-preview");
        this.toggleBtn = card.querySelector("#toggle-mode-btn");

        this.textarea.value = savedText;
        this.isPreviewMode = false;

        this.toggleBtn.addEventListener("click", () => this.togglePreview());

        // Context-menu "Edit" drops back into the editable textarea and focuses it
        card.addEventListener("widget:edit", () => {
            if (this.isPreviewMode) this.togglePreview();
            this.textarea.focus();
        });
    }

    // Toggle Mode using the 'marked' library
    togglePreview() {
        if (!this.isPreviewMode) {
            this.preview.innerHTML = marked.parse(this.textarea.value);

            this.textarea.style.display = "none";
            this.preview.style.display = "block";
            this.toggleBtn.innerHTML = penIcon; // Switch to the pen icon
        } else {
            this.textarea.style.display = "block";
            this.preview.style.display = "none";
            this.toggleBtn.innerHTML = tickIcon; // Switch back to the tick icon
        }
        this.isPreviewMode = !this.isPreviewMode;
    }
}