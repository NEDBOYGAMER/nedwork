import { Widget } from '../Widget.js'

const SAMPLE_NOTES = `# Welcome to Notes

This is your personal scratchpad.

- Write **markdown** here
- It renders live in preview mode
- Everything autosaves`

export class NotesWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.text = config.text ?? SAMPLE_NOTES
        this.mode = config.mode || "edit"
        this.font = config.settings?.font || "default"

        this.toggleBtn = null
        this.container = null
        this.textarea = null
        this.previewEl = null
        this._timer = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("notes-widget", `font-${this.font}`)

        this.toggleBtn = document.createElement("button")
        this.toggleBtn.className = "notes-toggle"
        this.toggleBtn.innerText = "👁"
        this.toggleBtn.title = "Toggle preview"
        this.toggleBtn.addEventListener("click", () => this.toggleMode())
        this.content.appendChild(this.toggleBtn)

        this.container = document.createElement("div")
        this.container.className = "notes-container"
        this.content.appendChild(this.container)

        this.textarea = document.createElement("textarea")
        this.textarea.className = "notes-textarea"
        this.textarea.placeholder = "Write your notes…"
        this.textarea.value = this.text
        this.textarea.addEventListener("input", () => {
            this.text = this.textarea.value
            clearTimeout(this._timer)
            this._timer = setTimeout(() => this.persistNow(), 400)
        })

        this.previewEl = document.createElement("div")
        this.previewEl.className = "notes-preview"

        this.container.append(this.textarea, this.previewEl)
        this.renderMode()
    }

    dispose() {
        clearTimeout(this._timer)
    }

    renderMode() {
        const preview = this.mode === "preview"
        this.textarea.style.display = preview ? "none" : ""
        this.previewEl.style.display = preview ? "" : "none"
        this.toggleBtn.innerText = preview ? "✎" : "👁"

        if (preview) {
            const renderMarkdown = window.marked || ((md) => md)
            this.previewEl.innerHTML = renderMarkdown(this.text || "")
            this.sanitizePreview()
        }
    }

    /* marked output is injected as HTML - strip anything active (self-XSS
       guard): dangerous elements, inline event handlers and script URLs */
    sanitizePreview() {
        this.previewEl.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button")
            .forEach(el => el.remove())

        this.previewEl.querySelectorAll("*").forEach(el => {
            for (const attr of [...el.attributes]) {
                const name = attr.name.toLowerCase()
                if (name.startsWith("on")) {
                    el.removeAttribute(attr.name)
                } else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
                    el.removeAttribute(attr.name)
                }
            }
        })
    }

    toggleMode() {
        this.mode = this.mode === "edit" ? "preview" : "edit"
        this.renderMode()
        this.persistNow()
    }

    persistNow() {
        super.save({ text: this.text, mode: this.mode })
    }
}