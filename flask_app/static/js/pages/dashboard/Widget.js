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
        // card appearance style: "tech" default, see WIDGET_STYLES + the
        // [data-style="…"] rules in widgets.css. settings.style wins over a
        // legacy root-level style key.
        this.card.dataset.style = this.config.settings?.style || this.config.style || "tech"

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

        // re-sync derived UI when settings changed (e.g. the title)
        this.title = this.config.settings?.title || ""
        if (this.titleEl) this.titleEl.innerText = this.title

        // keep the card's appearance style in sync (e.g. changed via settings)
        if (this.card) this.card.dataset.style = this.config.settings?.style || this.config.style || "tech"
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

            const edit = document.createElement("li")
            edit.className = "context-option"
            edit.innerText = "Edit"
            edit.addEventListener("click", () => {
                menu.remove()
                this.edit()
            })

            let armed = false
            let del
            del = document.createElement("li")
            del.className = "context-option"
            del.innerText = "Delete"
            del.addEventListener("click", () => {
                if (armed) {
                    menu.remove()
                    this.delete()
                    return
                }
                // first click only arms the confirm
                armed = true
                del.innerText = "Confirm delete"
                del.classList.add("context-danger")
            })

            menu.append(edit, del)
            document.body.appendChild(menu)

            // position:fixed takes viewport coords — pageX/pageY are
            // document coords (and undefined outside Firefox), which put
            // the menu far below the click whenever the page is scrolled.
            // Clamped after appendChild so the real size is measurable
            // (same synchronous block, so nothing paints in between).
            const px = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8)
            const py = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8)
            menu.style.left = `${Math.max(8, px)}px`
            menu.style.top = `${Math.max(8, py)}px`
        })

        document.addEventListener("click", (event) => {
            // clicks inside the menu are handled by the menu itself
            if (event.target instanceof Element && event.target.closest("#context-menu")) return
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

        // accordion helper shared by every dropdown in this modal:
        // opening one closes all the others
        const closeDropdowns = (except) => {
            form.querySelectorAll(".select-dropdown.open").forEach(d => {
                if (d === except) return
                d.classList.remove("open")
                d.querySelector(".select-dropdown-trigger")?.setAttribute("aria-expanded", "false")
            })
        }

        // rows, grouped under mono eyebrow labels whenever the schema's
        // group key changes between entries
        let lastGroup = null
        Object.entries(schema).forEach(([key, def]) => {
            if (def.type === "na") return
            if (def.group && def.group !== lastGroup) {
                const groupLabel = document.createElement("div")
                groupLabel.className = "settings-group-label"
                groupLabel.innerText = def.group
                form.appendChild(groupLabel)
                lastGroup = def.group
            }
            form.appendChild(this._buildRow(key, def, draft, closeDropdowns))
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

        // outside click closes any open dropdown menu
        const onDocClick = (event) => {
            if (!(event.target instanceof Element)) return
            form.querySelectorAll(".select-dropdown.open").forEach(d => {
                if (!d.contains(event.target)) {
                    d.classList.remove("open")
                    d.querySelector(".select-dropdown-trigger")?.setAttribute("aria-expanded", "false")
                }
            })
        }
        document.addEventListener("click", onDocClick)

        // Escape closes the open dropdown first, then the modal
        const onEsc = (event) => {
            if (event.key !== "Escape") return
            if (form.querySelector(".select-dropdown.open")) {
                closeDropdowns()
                return
            }
            close()
        }
        document.addEventListener("keydown", onEsc)

        const close = () => {
            document.removeEventListener("click", onDocClick)
            document.removeEventListener("keydown", onEsc)
            overlay.remove()
        }
        closeBtn.addEventListener("click", close)
        cancelBtn.addEventListener("click", close)
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close()
        })
        saveBtn.addEventListener("click", () => {
            Object.assign(this.config, draft)
            this.save()
            close()
            // settings are read in the widget constructors — surface them
            // by re-rendering every widget instead of waiting for a reload
            if (this.ctx.onSettingsChanged) this.ctx.onSettingsChanged()
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

    _buildRow(key, def, draft, closeOthers) {
        const value = this._field(draft, key)
        const onChange = (v) => this._set(draft, key, v)
        const labelText = key.replace(/_/g, " ")

        // toggles and color pickers sit in a setting-item row: label left,
        // control right — the same row pattern as the site Settings page
        if (def.type === "boolean" || def.type === "color") {
            const row = document.createElement("div")
            row.className = "setting-item"

            const info = document.createElement("div")
            info.className = "setting-item-info"

            const label = document.createElement("h3")
            label.innerText = labelText
            info.appendChild(label)

            if (def.desc) {
                const desc = document.createElement("p")
                desc.innerText = def.desc
                info.appendChild(desc)
            }

            const control = document.createElement("div")
            control.className = "setting-item-control"

            row.append(info, control)
            control.appendChild(def.type === "boolean"
                ? this._switch(value, onChange)
                : this._color(value, onChange))

            return row
        }

        // text/dropdown/textarea fields read better with the label above
        // a full-width control
        const row = document.createElement("div")
        row.className = "settings-row stacked"

        const label = document.createElement("span")
        label.className = "settings-label"
        label.innerText = labelText
        row.appendChild(label)

        if (def.desc) {
            const desc = document.createElement("span")
            desc.className = "settings-desc"
            desc.innerText = def.desc
            row.appendChild(desc)
        }

        switch (def.type) {
            case "dropdown":
                row.appendChild(this._dropdown(def.options, value, onChange, closeOthers))
                break
            case "text_area":
                row.appendChild(this._textarea(value, onChange))
                break
            case "location":
            case "timezone":
            case "input_field":
            default:
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

    /* Custom select using the shared .select-dropdown component (same
       markup and behavior as the site Settings page). closeOthers gives
       the accordion: opening one dropdown closes the others. */
    _dropdown(options, value, onChange, closeOthers) {
        const wrap = document.createElement("div")
        wrap.className = "select-dropdown"

        const trigger = document.createElement("button")
        trigger.type = "button"
        trigger.className = "select-dropdown-trigger"
        trigger.setAttribute("aria-haspopup", "listbox")
        trigger.setAttribute("aria-expanded", "false")

        const valueEl = document.createElement("span")
        valueEl.className = "select-dropdown-value"
        valueEl.innerText = value ?? ""

        const caret = document.createElement("span")
        caret.className = "icon select-dropdown-caret"
        caret.style.setProperty("--icon",
            `url('${(window.STATIC_URL || "/static/")}img/icons/tabler-arrow-down.svg')`)

        trigger.append(valueEl, caret)

        const menu = document.createElement("ul")
        menu.className = "select-dropdown-menu"
        menu.setAttribute("role", "listbox")

        const setOpen = (open) => {
            wrap.classList.toggle("open", open)
            trigger.setAttribute("aria-expanded", String(open))
        }

        trigger.addEventListener("click", () => {
            const opening = !wrap.classList.contains("open")
            if (opening && closeOthers) closeOthers(wrap)
            setOpen(opening)
        })

        ;(options || []).forEach(option => {
            const opt = document.createElement("li")
            opt.className = "select-dropdown-option"
            opt.setAttribute("role", "option")
            opt.dataset.value = option
            opt.innerText = option
            if (option === value) opt.classList.add("selected")
            opt.addEventListener("click", () => {
                menu.querySelectorAll(".select-dropdown-option.selected")
                    .forEach(o => o.classList.remove("selected"))
                opt.classList.add("selected")
                valueEl.innerText = option
                setOpen(false)
                onChange(option)
            })
            menu.appendChild(opt)
        })

        wrap.append(trigger, menu)
        return wrap
    }

    _switch(value, onChange) {
        // global .switch component — the knob is drawn by
        // .switch-track::before, no extra element needed
        const label = document.createElement("label")
        label.className = "switch"

        const input = document.createElement("input")
        input.type = "checkbox"
        input.checked = !!value

        const track = document.createElement("span")
        track.className = "switch-track"

        label.append(input, track)
        input.addEventListener("change", () => onChange(input.checked))
        return label
    }
}