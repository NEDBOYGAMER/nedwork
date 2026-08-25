// ---------------------------------------------------------------------------
// Widget.js
// Base class for every dashboard widget. A widget is built into a card that
// lives on the grid; it talks to the rest of the app only through a small
// context object:
//   ctx.grid       - the #card-grid element
//   ctx.manager    - the active GridManager (for drag/resize + placement)
//   ctx.onSave     - persist callback (called after any save()/delete)
//   ctx.edit       - edit callback (opens the schema-driven settings modal)
//   ctx.dashboard  - dashboard name string
// Subclasses call build() then buildShell(); the shell is: grip, title,
// content, resize handle + context menu.
// ---------------------------------------------------------------------------

import { WIDGET_SETTINGS_SCHEMA } from "./widget_default.js"

export class Widget {
    constructor(config, ctx) {
        this.type = config.type
        this.id = config.id
        this.config = config
        this.ctx = ctx || {}
        this.title = config.settings?.title || ""

        // fullBleed: the widget takes over the whole card - no title, no
        // padding, the content spans every pixel. Used by icon-only tiles
        // like app widgets (set via config.fullBleed).
        this.fullBleed = config.fullBleed === true

        this.card = null
        this.content = null
    }

    /* Called by subclasses at the end of their build() */
    buildShell() {
        const grid = this.ctx.grid || document.getElementById("card-grid")

        this.card = document.createElement("div")
        this.card.className = "card widget"
        if (this.fullBleed) this.card.classList.add("widget--full-bleed")
        this.card.dataset.id = this.id
        this.card.dataset.type = this.type

        this.grip = document.createElement("span")
        this.grip.className = "card-grip"
        this.grip.title = "Drag to move"
        this.grip.setAttribute("aria-hidden", "true")

        this.resizeHandle = document.createElement("span")
        this.resizeHandle.className = "card-resize"
        this.resizeHandle.title = "Drag to resize"
        this.resizeHandle.setAttribute("aria-hidden", "true")

        this.card.appendChild(this.grip)

        // regular widgets get a title bar; full-bleed widgets get the whole
        // card for their own content
        if (!this.fullBleed) {
            this.titleEl = document.createElement("span")
            this.titleEl.className = "widget-title"
            this.titleEl.innerText = this.title
            this.card.appendChild(this.titleEl)
        }

        this.content = document.createElement("div")
        this.content.className = "widget-content"
        this.card.appendChild(this.content)

        // locked widgets keep a fixed size - no resize handle at all
        if (!this.config.locked) {
            this.resizeHandle = document.createElement("span")
            this.resizeHandle.className = "card-resize"
            this.resizeHandle.title = "Drag to resize"
            this.resizeHandle.setAttribute("aria-hidden", "true")
            this.card.appendChild(this.resizeHandle)
        }

        grid.appendChild(this.card)

        if (this.ctx.manager) {
            this.ctx.manager.attach(this.config, this.card, this.grip, this.resizeHandle)
        }

        this.setUpContext()
    }

    /* Persist this widget's current state */
    save(delta) {
        if (delta) Object.assign(this.config, delta)
        if (this.ctx.onSave) this.ctx.onSave()
    }

    /* Cleanup hook - subclasses with timers/intervals override this */
    dispose() {}

    /* ------------------------------------------------------------------ */
    /* context menu (edit / delete)                                       */
    /* ------------------------------------------------------------------ */

    setUpContext() {
        this.card.addEventListener("contextmenu", (event) => {
            event.preventDefault()

            document.getElementById("context-menu")?.remove()

            const menu = document.createElement("ul")
            menu.id = "context-menu"
            menu.className = "context-menu"
            menu.style.left = `${event.pageX}px`
            menu.style.top = `${event.pageY}px`

            const edit = document.createElement("li")
            edit.className = "context-option"
            edit.innerText = "Edit"
            edit.addEventListener("click", () => this.edit())

            const del = document.createElement("li")
            del.className = "context-option"
            del.innerText = "Delete"
            del.addEventListener("click", () => this.delete())

            menu.append(edit, del)
            document.body.appendChild(menu)
        })

        document.addEventListener("click", () => {
            document.getElementById("context-menu")?.remove()
        }, { capture: true })
    }

    edit() {
        if (this.ctx.editName) this.ctx.editName(this.config)
    }

    async delete() {
        if (this.ctx.onDelete) await this.ctx.onDelete(this.id)
    }

    /* ------------------------------------------------------------------ */
    /* Schema-driven edit modal                                            */
    /* ------------------------------------------------------------------ */

    setUpSettings() {
        document.getElementById("settings-modal")?.remove()

        const schema = WIDGET_SETTINGS_SCHEMA[this.type]
        if (!schema) {
            console.warn(`No settings schema for type "${this.type}"`)
            return
        }

        const draft = structuredClone(this.config)

        const overlay = document.createElement("div")
        overlay.className = "modal-backdrop"
        overlay.id = "settings-modal"

        const box = document.createElement("div")
        box.className = "modal"
        overlay.appendChild(box)

        const header = document.createElement("div")
        header.className = "settings-header"

        const heading = document.createElement("h3")
        heading.innerText = `Edit ${this.title || this.type}`
        header.appendChild(heading)

        const closeBtn = document.createElement("span")
        closeBtn.className = "close-btn"
        closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
        header.appendChild(closeBtn)
        box.appendChild(header)

        const form = document.createElement("div")
        form.className = "settings-form"
        box.appendChild(form)

        Object.entries(schema).forEach(([key, def]) => {
            if (def.type === "na") return
            form.appendChild(this._buildRow(key, def, draft))
        })

        const actions = document.createElement("div")
        actions.className = "modal-actions"
        box.appendChild(actions)

        const cancelBtn = document.createElement("button")
        cancelBtn.className = "btn btn-secondary"
        cancelBtn.type = "button"
        cancelBtn.innerText = "Cancel"

        const saveBtn = document.createElement("button")
        saveBtn.className = "btn btn-primary"
        saveBtn.type = "button"
        saveBtn.innerText = "Save"

        actions.append(cancelBtn, saveBtn)
        document.body.appendChild(overlay)
        overlay.classList.add("open")

        const close = () => overlay.remove()
        closeBtn.addEventListener("click", close)
        cancelBtn.addEventListener("click", close)
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close()
        })
        saveBtn.addEventListener("click", () => {
            Object.assign(this.config, draft)
            this.save()
            close()
        })
    }

    _field(draft, key) {
        if (Object.prototype.hasOwnProperty.call(draft.settings, key)) return draft.settings[key]
        return draft[key]
    }

    _set(draft, key, value) {
        if (Object.prototype.hasOwnProperty.call(draft.settings, key)) {
            draft.settings[key] = value
        } else {
            draft[key] = value
        }
    }

    _buildRow(key, def, draft) {
        const row = document.createElement("div")
        row.className = "settings-row"

        const label = document.createElement("span")
        label.className = "settings-label"
        label.innerText = key.replace(/_/g, " ")
        row.appendChild(label)

        const value = this._field(draft, key)
        const onChange = (v) => this._set(draft, key, v)

        switch (def.type) {
            case "boolean":
                row.appendChild(this._switch(value, onChange))
                break
            case "dropdown":
                row.classList.add("stacked")
                row.appendChild(this._dropdown(key, def.options, value, onChange))
                break
            case "text_area":
                row.classList.add("stacked")
                row.appendChild(this._textarea(value, onChange))
                break
            case "color":
                row.appendChild(this._color(value, onChange))
                break
            case "location":
            case "timezone":
            case "input_field":
            default:
                row.classList.add("stacked")
                row.appendChild(this._input(value, onChange))
                break
        }

        return row
    }

    _input(value, onChange) {
        const input = document.createElement("input")
        input.type = "text"
        input.className = "ui-input"
        input.value = value ?? ""
        input.addEventListener("input", () => onChange(input.value))
        return input
    }

    _textarea(value, onChange) {
        const textarea = document.createElement("textarea")
        textarea.className = "ui-input"
        textarea.rows = 4
        textarea.value = value ?? ""
        textarea.addEventListener("input", () => onChange(textarea.value))
        return textarea
    }

    _color(value, onChange) {
        const input = document.createElement("input")
        input.type = "color"
        input.className = "color-input"
        input.value = value || "#515ada"
        input.addEventListener("input", () => onChange(input.value))
        return input
    }

    _dropdown(key, options, value, onChange) {
        const wrap = document.createElement("div")
        wrap.className = "dropdown"

        const uid = `drop-${key}-${this.id}`
        const toggle = document.createElement("input")
        toggle.type = "checkbox"
        toggle.id = uid

        const header = document.createElement("label")
        header.className = "dropdown-header dropdown-box"
        header.setAttribute("for", uid)

        const selected = document.createElement("span")
        selected.className = "dropdown-selected"
        selected.innerText = value ?? ""

        const arrow = document.createElement("span")
        arrow.className = "dropdown-arrow"
        arrow.innerText = "▾"

        header.append(selected, arrow)

        const menu = document.createElement("div")
        menu.className = "dropdown-menu"
        ;(options || []).forEach(option => {
            const opt = document.createElement("div")
            opt.className = "dropdown-option"
            opt.innerText = option
            opt.addEventListener("click", () => {
                selected.innerText = option
                toggle.checked = false
                onChange(option)
            })
            menu.appendChild(opt)
        })

        wrap.append(toggle, header, menu)
        return wrap
    }

    _switch(value, onChange) {
        const label = document.createElement("label")
        label.className = "switch"

        const input = document.createElement("input")
        input.type = "checkbox"
        input.checked = !!value

        const track = document.createElement("span")
        track.className = "switch-track"
        const knob = document.createElement("span")
        knob.className = "switch-knob"
        track.appendChild(knob)

        label.append(input, track)
        input.addEventListener("change", () => onChange(input.checked))
        return label
    }
}