import { Widget } from '../Widget.js'

const PLACEHOLDER_TASKS = [
    { id: "t1", text: "Review pull requests", done: true },
    { id: "t2", text: "Plan weekend hike", done: false },
    { id: "t3", text: "Water the plants", done: false },
    { id: "t4", text: "Update dashboard docs", done: false },
    { id: "t5", text: "Backup photos", done: true },
]

export class TaskWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.tasks = (config.tasks || PLACEHOLDER_TASKS).map(t => ({ ...t }))

        this.progressEl = null
        this.progressLabelEl = null
        this.listEl = null
        this.inputEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("task-widget")

        const progressWrap = document.createElement("div")
        progressWrap.className = "task-progress-wrap"

        this.progressLabelEl = document.createElement("span")
        this.progressLabelEl.className = "task-progress-label"

        this.progressEl = document.createElement("div")
        this.progressEl.className = "progress task-progress"

        const fill = document.createElement("div")
        fill.className = "progress-fill"
        this.progressEl.appendChild(fill)

        progressWrap.append(this.progressLabelEl, this.progressEl)
        this.content.appendChild(progressWrap)

        this.listEl = document.createElement("ul")
        this.listEl.className = "task-list"
        this.content.appendChild(this.listEl)

        const addRow = document.createElement("div")
        addRow.className = "task-add"

        this.inputEl = document.createElement("input")
        this.inputEl.type = "text"
        this.inputEl.placeholder = "Add a task…"
        this.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this.addTask()
        })

        const addBtn = document.createElement("button")
        addBtn.className = "btn btn-secondary btn-sm"
        addBtn.innerText = "+"
        addBtn.title = "Add task"
        addBtn.addEventListener("click", () => this.addTask())

        addRow.append(this.inputEl, addBtn)
        this.content.appendChild(addRow)

        this.render()
    }

    buildTaskItem(task) {
        const item = document.createElement("li")
        item.className = "task-item"
        if (task.done) item.classList.add("done")

        const label = document.createElement("label")
        label.className = "task-check"

        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        checkbox.checked = task.done
        checkbox.addEventListener("change", () => {
            task.done = checkbox.checked
            this.render()
            this.save({ tasks: this.tasks.map(t => ({ ...t })) })
        })

        const box = document.createElement("span")
        box.className = "task-box"

        const text = document.createElement("span")
        text.className = "task-text"
        text.innerText = task.text

        label.append(checkbox, box, text)

        const removeBtn = document.createElement("button")
        removeBtn.className = "task-remove"
        removeBtn.innerText = "✕"
        removeBtn.title = "Remove task"
        removeBtn.addEventListener("click", () => {
            this.tasks = this.tasks.filter(t => t.id !== task.id)
            this.render()
            this.save({ tasks: this.tasks.map(t => ({ ...t })) })
        })

        item.append(label, removeBtn)
        return item
    }

    addTask() {
        const text = this.inputEl.value.trim()
        if (!text) return
        this.tasks.push({ id: crypto.randomUUID(), text, done: false })
        this.inputEl.value = ""
        this.render()
        this.save({ tasks: this.tasks.map(t => ({ ...t })) })
    }

    render() {
        const done = this.tasks.filter(t => t.done).length
        const pct = this.tasks.length === 0 ? 0 : Math.round((done / this.tasks.length) * 100)

        this.progressLabelEl.innerText = this.tasks.length === 0
            ? "No tasks yet"
            : `${done}/${this.tasks.length} done · ${pct}%`

        this.progressEl.querySelector(".progress-fill").style.width = `${pct}%`

        this.listEl.innerHTML = ""
        this.tasks.forEach(task => this.listEl.appendChild(this.buildTaskItem(task)))

        if (this.tasks.length === 0) {
            const empty = document.createElement("li")
            empty.className = "task-empty"
            empty.innerText = "All clear — add a task above"
            this.listEl.appendChild(empty)
        }
    }
}