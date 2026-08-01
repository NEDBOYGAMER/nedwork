import { WIDGET_SETTINGS_SCHEMA } from "./widget_default.js";
export class Widget {
    constructor(config) {
        this.type = config.type
        this.id = config.id
        this.title = config.settings.title
        this.card = null
        this.widgets = null
        this.dashboard_name = null
        this.content = null
    }

    buildShell() {
        this.card = document.createElement("div")
        this.card.classList.add("card")
        this.card.draggable = true
        this.card.dataset.widgetId = this.id
        let grid = document.getElementById("card-grid");
        grid.appendChild(this.card)

        if (this.title !== ""){
            let titleEl = document.createElement("span")
            titleEl.classList.add("widget-title")
            titleEl.innerText = this.title
            this.card.appendChild(titleEl)
        }

        this.content = document.createElement("div")
        this.content.classList.add("widget-content")
        this.card.appendChild(this.content)

        this.getInfos()
    
        this.setUpContext()
    }

    async getInfos(){
        const dashboard_info = await fetch('/dashboard/api/load/main');
        const dashboard = await dashboard_info.json();
        this.widgets = dashboard.widgets
        this.dashboard_name = localStorage.getItem("dashboard_name");
    }

    setUpContext() {
        this.card.addEventListener("contextmenu", (event) => {
            event.preventDefault()


            let menu = document.getElementById("context-menu")
            menu?.remove()

            
            menu = document.createElement("ul")
            menu.classList.add("context-menu")
            menu.id = "context-menu"
            menu.style.left = `${event.pageX}px`
            menu.style.top = `${event.pageY}px`

            const editbutton = document.createElement("li")
            editbutton.classList.add("context-option")
            editbutton.id = "edit-context-option"
            editbutton.innerText = "Edit"

            const deletebutton = document.createElement("li")
            deletebutton.classList.add("context-option")
            deletebutton.id = "delete-context-option"
            deletebutton.innerText = "Delete"

            document.body.appendChild(menu)
            menu.appendChild(editbutton)
            menu.appendChild(deletebutton)



            deletebutton.addEventListener("click", () =>{
                this.deleteWidget()

            })


            editbutton.addEventListener("click", () =>{
                this.editWidget()

            })
            

        })

        document.addEventListener("click", () => {
            let menu = document.getElementById("context-menu")
            menu?.remove()
            
        })

    }

    async deleteWidget() {    
        const response = await fetch('/dashboard/api/update/update_widget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: this.dashboard_name,
                widgets: this.widgets
            })
        });

        this.card.dispatchEvent(new CustomEvent("widget:update", {bubbles: true,}))
    
    }

    editWidget(){
        this.setUpSettings()
    }


    // Builds and opens the edit modal for this widget, generated entirely
    // from WIDGET_SETTINGS_SCHEMA[this.type] - add/remove/retype a field in
    // the schema and the form picks it up automatically, no widget-specific
    // UI code needed here.
    setUpSettings(){
        document.getElementById("settings-modal")?.remove()

        const schema = WIDGET_SETTINGS_SCHEMA[this.type]
        const target = this.widgets?.find(w => w.id === this.id)

        if (!schema || !target) {
            console.error("No schema or widget data found for", this.type, this.id)
            return
        }

        // Work on a deep clone so nothing is written back until Save is hit.
        const draft = structuredClone(target)

        const overlay = document.createElement("div")
        overlay.classList.add("modal-backdrop")
        overlay.id = "settings-modal"

        const content = document.createElement("div")
        content.classList.add("modal")
        overlay.appendChild(content)

        const header = document.createElement("div")
        header.classList.add("settings-header")
        content.appendChild(header)

        const heading = document.createElement("h3")
        heading.innerText = `Edit ${this.title || this.type}`
        header.appendChild(heading)

        const closeBtn = document.createElement("span")
        closeBtn.classList.add("close-btn")
        closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
        header.appendChild(closeBtn)

        const form = document.createElement("div")
        form.classList.add("settings-form")
        content.appendChild(form)

        Object.entries(schema).forEach(([key, def]) => {
            if (def.type === "na") return // internal bookkeeping, not user-editable
            form.appendChild(this.buildSettingsRow(key, def, draft))
        })

        const actions = document.createElement("div")
        actions.classList.add("modal-actions")
        content.appendChild(actions)

        const cancelBtn = document.createElement("button")
        cancelBtn.classList.add("btn", "btn-secondary")
        cancelBtn.type = "button"
        cancelBtn.innerText = "Cancel"

        const saveBtn = document.createElement("button")
        saveBtn.classList.add("btn", "btn-primary")
        saveBtn.type = "button"
        saveBtn.innerText = "Save"

        actions.appendChild(cancelBtn)
        actions.appendChild(saveBtn)

        document.body.appendChild(overlay)
        overlay.style.display = "flex"

        const closeModal = () => overlay.remove()

        closeBtn.addEventListener("click", closeModal)
        cancelBtn.addEventListener("click", closeModal)
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) closeModal()
        })

        saveBtn.addEventListener("click", async () => {
            saveBtn.disabled = true
            await this.saveWidget(draft)
            closeModal()
        })
    }

    // A widget's editable fields can live either inside .settings (title,
    // font, ...) or at the top level of the widget object itself (style,
    // and notes' "text"). Rather than hardcode which key lives where per
    // widget type, we just check where it currently exists on the draft.
    getFieldValue(draft, key){
        if (Object.prototype.hasOwnProperty.call(draft.settings, key)) {
            return draft.settings[key]
        }
        return draft[key]
    }

    setFieldValue(draft, key, value){
        if (Object.prototype.hasOwnProperty.call(draft.settings, key)) {
            draft.settings[key] = value
        } else {
            draft[key] = value
        }
    }

    buildSettingsRow(key, def, draft){
        const row = document.createElement("div")
        row.classList.add("settings-row")

        const label = document.createElement("span")
        label.classList.add("settings-label")
        label.innerText = key.replace(/_/g, " ")
        row.appendChild(label)

        const value = this.getFieldValue(draft, key)
        const onChange = (v) => this.setFieldValue(draft, key, v)

        switch (def.type) {
            case "boolean":
                row.appendChild(this.buildSwitchControl(value, onChange))
                break

            case "dropdown":
                row.classList.add("stacked")
                row.appendChild(this.buildDropdownControl(key, def.options, value, onChange))
                break

            case "text_area":
                row.classList.add("stacked")
                row.appendChild(this.buildTextAreaControl(value, onChange))
                break

            case "color":
                row.appendChild(this.buildColorControl(value, onChange))
                break

            // "location", "timezone" and "input_field" are all free text -
            // they only differ in what the user is expected to type.
            case "location":
            case "timezone":
            case "input_field":
            default:
                row.classList.add("stacked")
                row.appendChild(this.buildInputControl(value, onChange))
                break
        }

        return row
    }

    buildSwitchControl(value, onChange){
        const label = document.createElement("label")
        label.classList.add("switch")

        const input = document.createElement("input")
        input.type = "checkbox"
        input.checked = !!value

        const track = document.createElement("span")
        track.classList.add("switch-track")

        const knob = document.createElement("span")
        knob.classList.add("switch-knob")
        track.appendChild(knob)

        label.appendChild(input)
        label.appendChild(track)

        input.addEventListener("change", () => onChange(input.checked))

        return label
    }

    buildInputControl(value, onChange){
        const input = document.createElement("input")
        input.type = "text"
        input.classList.add("ui-input")
        input.value = value ?? ""

        input.addEventListener("input", () => onChange(input.value))

        return input
    }

    buildTextAreaControl(value, onChange){
        const textarea = document.createElement("textarea")
        textarea.classList.add("ui-input")
        textarea.rows = 4
        textarea.value = value ?? ""

        textarea.addEventListener("input", () => onChange(textarea.value))

        return textarea
    }

    buildColorControl(value, onChange){
        const input = document.createElement("input")
        input.type = "color"
        input.classList.add("color-input")
        input.value = value || "#515ada"

        input.addEventListener("input", () => onChange(input.value))

        return input
    }

    buildDropdownControl(key, options, value, onChange){
        const wrap = document.createElement("div")
        wrap.classList.add("dropdown")

        const uid = `drop-${key}-${this.id}`

        const toggle = document.createElement("input")
        toggle.type = "checkbox"
        toggle.id = uid

        const header = document.createElement("label")
        header.classList.add("dropdown-header", "dropdown-box")
        header.setAttribute("for", uid)

        const selected = document.createElement("span")
        selected.classList.add("dropdown-selected")
        selected.innerText = value ?? ""

        const arrow = document.createElement("span")
        arrow.classList.add("dropdown-arrow")
        arrow.innerText = "▾"

        header.appendChild(selected)
        header.appendChild(arrow)

        const menu = document.createElement("div")
        menu.classList.add("dropdown-menu")

        ;(options || []).forEach((option) => {
            const optionEl = document.createElement("div")
            optionEl.classList.add("dropdown-option")
            optionEl.innerText = option

            optionEl.addEventListener("click", () => {
                selected.innerText = option
                toggle.checked = false
                onChange(option)
            })

            menu.appendChild(optionEl)
        })

        wrap.appendChild(toggle)
        wrap.appendChild(header)
        wrap.appendChild(menu)

        return wrap
    }

    async saveWidget(draft){
        const index = this.widgets.findIndex(w => w.id === this.id)
        if (index === -1) return

        this.widgets[index] = draft

        await fetch('/dashboard/api/update/update_widget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: this.dashboard_name,
                widgets: this.widgets
            })
        })

        this.card.dispatchEvent(new CustomEvent("widget:update", { bubbles: true }))
    }
}