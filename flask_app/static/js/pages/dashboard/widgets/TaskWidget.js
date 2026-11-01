import { Widget } from '../Widget.js'
import { TASK_SORTS } from '../widget_default.js'

// Real data comes from the tasks site API (same endpoints /tasks uses).
// csrf.js (injected into every page) attaches the X-CSRF-Token header to
// every state-changing fetch automatically.
const TASKS_API = "/tasks/api/get_tasks"

// same weights the tasks site uses for importance sorting
const IMPORTANCE_WEIGHT = { "low": 10, "medium": 20, "high": 50, "very high": 90 }

const IMPORTANCE_CLASS = {
    "low": "task-imp--low",
    "medium": "task-imp--medium",
    "high": "task-imp--high",
    "very high": "task-imp--very-high",
}

// completion celebration, ported from the tasks site (celebrateCard there)
const CELEBRATE_MS = 900
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches
const CONFETTI_COLORS = ["var(--success)", "var(--accent)", "var(--warning)", "var(--info)"]

function deadlineTs(task) {
    return task.deadline ? new Date(task.deadline).getTime() : Infinity
}

function byDeadline(a, b) {
    return deadlineTs(a) - deadlineTs(b)
}

export class TaskWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const s = config.settings || {}
        this.showProgress = s.show_progress === true   // default off
        this.allowAdd = s.allow_add !== false          // default on
        this.showDone = s.show_done === true           // default off
        this.showDeadline = s.show_deadline === true   // default off
        this.limit = Math.max(1, parseInt(s.limit, 10) || 4)
        this.sort = TASK_SORTS.includes(s.sort) ? s.sort : TASK_SORTS[0]

        // NOTE: legacy placeholder widgets stored their tasks in
        // config.tasks — that data is dead now and deliberately ignored.
        this.tasks = []
        this.loaded = false
        this.loadError = false

        // task ids currently playing their completion animation; entries
        // keep a just-completed task visible even when show_done is off,
        // then expire (see toggleTask) and the next render drops it
        this.celebrating = new Set()

        // size gates: descriptions from 4 rows of height on, subtasks in
        // a right-hand column from 5 columns wide AND 4 rows tall on
        // (the grid manager keeps card.dataset.w/h current)
        this.sizeObserver = null

        this.progressEl = null
        this.progressLabelEl = null
        this.listEl = null
        this.inputEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("task-widget")

        if (this.showProgress) {
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
        }

        this.listEl = document.createElement("ul")
        this.listEl.className = "task-list"
        this.content.appendChild(this.listEl)

        if (this.allowAdd) {
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
        }

        // size-gated extras (descriptions / subtask column); the observer
        // keeps the gate classes current while the user resizes the card
        this.updateSizeClasses()
        this.attachSizeObserver()

        this.render()
        this.refresh()
    }

    /* ------------------------------------------------------------------ */
    /* size gates                                                          */
    /* ------------------------------------------------------------------ */

    updateSizeClasses() {
        if (!this.card) return
        const w = parseInt(this.card.dataset.w ?? this.config.w, 10) || 0
        const h = parseInt(this.card.dataset.h ?? this.config.h, 10) || 0
        this.card.classList.toggle("task-room-desc", h >= 4)
        this.card.classList.toggle("task-room-subs", w >= 5 && h >= 4)
    }

    attachSizeObserver() {
        if (!this.card || typeof MutationObserver === "undefined") return
        this.sizeObserver = new MutationObserver(() => this.updateSizeClasses())
        this.sizeObserver.observe(this.card, { attributes: true, attributeFilter: ["data-w", "data-h"] })
    }

    /* ------------------------------------------------------------------ */
    /* data                                                                */
    /* ------------------------------------------------------------------ */

    async refresh() {
        try {
            const res = await fetch(TASKS_API, { cache: "no-store" })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            // private tasks arrive as ciphertext envelopes ("enc:v1:…") the
            // widget has no key for — they are hidden entirely by design
            this.tasks = (data.tasks || []).filter(t => !t.private)
            this.loadError = false
        } catch (err) {
            console.error("TaskWidget: load failed", err)
            this.loadError = true
        }
        this.loaded = true
        this.render()
    }

    async toggleTask(task, checked) {
        const previous = task.done
        task.done = checked

        // completing a task: keep it visible for the celebration window,
        // then let the follow-up render hide it again (show_done off)
        if (checked && !previous && !REDUCED_MOTION) {
            this.celebrating.add(task.id)
            this.playChime()
            setTimeout(() => {
                this.celebrating.delete(task.id)
                this.render()
            }, CELEBRATE_MS)
        } else {
            this.celebrating.delete(task.id)
        }
        this.render()

        try {
            const res = await fetch(`${TASKS_API}/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ done: checked }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()

            // adopt server truth (completed_at, …) into the local copy
            Object.assign(task, data.task)
            // completing a recurring task makes the server spawn its next
            // instance — show it right away, same as the tasks site does
            if (data.spawned) this.tasks.push(data.spawned)
        } catch (err) {
            console.error("TaskWidget: toggle failed", err)
            task.done = previous   // revert on failure
            this.celebrating.delete(task.id)
        }
        this.render()
    }

    /* completion celebration, same trick the tasks site uses in
       celebrateCard(): a pop animation on the card plus confetti bits
       flying outward, colored from the shared palette */
    playChime() {
        if (REDUCED_MOTION) return
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const now = ctx.currentTime
            ;[[523.25, 0], [783.99, .12]].forEach(([freq, offset]) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = "sine"
                osc.frequency.value = freq
                gain.gain.setValueAtTime(0.0001, now + offset)
                gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02)
                gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35)
                osc.connect(gain).connect(ctx.destination)
                osc.start(now + offset)
                osc.stop(now + offset + 0.4)
            })
            setTimeout(() => ctx.close().catch(() => {}), 1500)
        } catch { /* audio unavailable */ }
    }

    async addTask() {
        const name = this.inputEl.value.trim()
        if (!name) return

        // full payload — the create endpoint requires every field
        const payload = {
            name,
            text: null,
            importance: "medium",
            tags: [],
            subtasks: [],
            deadline: null,
            private: false,
            done: false,
            working: false,
            recurrence: null,
        }
        this.inputEl.value = ""

        try {
            const res = await fetch(TASKS_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            this.tasks.push(data.task)
            this.loadError = false
        } catch (err) {
            console.error("TaskWidget: create failed", err)
        }
        this.render()
    }

    /* ------------------------------------------------------------------ */
    /* cleanup                                                             */
    /* ------------------------------------------------------------------ */

    dispose() {
        this.sizeObserver?.disconnect()
        this.sizeObserver = null
    }

    /* ------------------------------------------------------------------ */
    /* presentation                                                        */
    /* ------------------------------------------------------------------ */

    sortTasks(list) {
        const arr = [...list]
        switch (this.sort) {
            case "deadline":
                arr.sort(byDeadline)   // undated tasks sink to the bottom
                break
            case "importance":
                arr.sort((a, b) =>
                    (IMPORTANCE_WEIGHT[b.importance] ?? 0) - (IMPORTANCE_WEIGHT[a.importance] ?? 0)
                    || byDeadline(a, b))
                break
            case "newest":
                arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                break
            default:   // "position" — the manual order from the tasks site
                arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        }
        return arr
    }

    visibleTasks() {
        const open = this.sortTasks(this.tasks.filter(t => !t.done))
        // done tasks stay hidden unless show_done is on — except ones
        // still playing their completion celebration
        const done = this.sortTasks(this.tasks.filter(t =>
            t.done && (this.showDone || this.celebrating.has(t.id))))
        // open first, completed after — the limit spans both
        const visible = [...open, ...done].slice(0, this.limit)

        // a just-completed task must never be sliced away mid-celebration
        for (const id of this.celebrating) {
            if (!visible.some(t => t.id === id)) {
                const task = this.tasks.find(t => t.id === id)
                if (task && task.done) visible.push(task)
            }
        }
        return visible
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
        checkbox.addEventListener("change", () => this.toggleTask(task, checkbox.checked))

        const box = document.createElement("span")
        box.className = "task-box"

        const dot = document.createElement("span")
        dot.className = "task-imp"
        if (!task.done) dot.classList.add(IMPORTANCE_CLASS[task.importance] || "task-imp--medium")
        dot.title = `Importance: ${task.importance}`

        // name + (size-gated) description stacked in one column
        const textwrap = document.createElement("span")
        textwrap.className = "task-textwrap"

        const text = document.createElement("span")
        text.className = "task-text"
        text.innerText = task.name
        text.title = task.text || task.name
        textwrap.appendChild(text)

        if (task.text) {
            const desc = document.createElement("span")
            desc.className = "task-desc"
            desc.innerText = task.text
            desc.title = task.text
            textwrap.appendChild(desc)
        }

        label.append(checkbox, box, dot, textwrap)

        item.appendChild(label)

        const chip = this.buildDeadlineChip(task)
        if (chip) item.appendChild(chip)

        if ((task.subtasks ?? []).length) item.appendChild(this.buildSubtaskList(task))

        if (this.celebrating.has(task.id)) this.attachCelebration(item)

        return item
    }

    /* subtask column shown to the right of the task when the widget is
       at least 5 columns wide and 4 rows tall (card.task-room-subs) */
    buildSubtaskList(task) {
        const subs = task.subtasks ?? []

        const list = document.createElement("ul")
        list.className = "task-subs"

        const doneCount = subs.filter(s => s.done).length
        const head = document.createElement("li")
        head.className = "task-subs-count"
        head.innerText = `${doneCount}/${subs.length}`
        list.appendChild(head)

        subs.forEach((sub, index) => {
            const li = document.createElement("li")
            if (sub.done) li.classList.add("is-done")

            const label = document.createElement("label")
            label.className = "task-sub"

            const checkbox = document.createElement("input")
            checkbox.type = "checkbox"
            checkbox.checked = !!sub.done
            checkbox.addEventListener("change", () => this.toggleSubtask(task, index, checkbox.checked))

            const box = document.createElement("span")
            box.className = "task-box"

            const name = document.createElement("span")
            name.className = "task-sub-name"
            name.innerText = sub.name
            name.title = sub.name

            label.append(checkbox, box, name)
            li.appendChild(label)
            list.appendChild(li)
        })
        return list
    }

    /* same optimistic patch pattern as toggleTask — the subtasks array is
       sent in full, exactly like the tasks site does */
    async toggleSubtask(task, index, checked) {
        const snapshot = (task.subtasks ?? []).map(s => ({ ...s }))
        task.subtasks = snapshot.map((s, i) => (i === index ? { ...s, done: checked } : s))
        this.render()

        try {
            const res = await fetch(`${TASKS_API}/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subtasks: task.subtasks }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            Object.assign(task, data.task)
        } catch (err) {
            console.error("TaskWidget: subtask toggle failed", err)
            task.subtasks = snapshot   // revert on failure
        }
        this.render()
    }

    attachCelebration(item) {
        item.classList.add("is-celebrating")

        const count = 14
        for (let i = 0; i < count; i++) {
            const bit = document.createElement("span")
            bit.className = "confetti-bit"
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
            const dist = 30 + Math.random() * 40   // widget cards are small
            bit.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`)
            bit.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist - 25)}px`)
            bit.style.setProperty("--rot", `${Math.round(Math.random() * 360)}deg`)
            bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
            item.appendChild(bit)
        }
    }

    buildDeadlineChip(task) {
        if (!this.showDeadline || !task.deadline || task.done) return null

        const chip = document.createElement("span")
        chip.className = "task-dl"

        const startOfDay = d => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c }
        const diff = Math.round((startOfDay(new Date(task.deadline)) - startOfDay(new Date())) / 86400000)

        if (diff < 0) {
            chip.classList.add("task-dl--overdue")
            chip.innerText = "Overdue"
        } else if (diff === 0) {
            chip.classList.add("task-dl--soon")
            chip.innerText = "Today"
        } else if (diff === 1) {
            chip.classList.add("task-dl--soon")
            chip.innerText = "Tomorrow"
        } else {
            chip.innerText = new Date(task.deadline).toLocaleDateString([], { day: "numeric", month: "short" })
        }
        return chip
    }

    render() {
        if (this.progressEl) {
            const done = this.tasks.filter(t => t.done).length
            const pct = this.tasks.length === 0 ? 0 : Math.round((done / this.tasks.length) * 100)

            this.progressLabelEl.innerText = this.tasks.length === 0
                ? "No tasks yet"
                : `${done}/${this.tasks.length} done · ${pct}%`

            this.progressEl.querySelector(".progress-fill").style.width = `${pct}%`
        }

        this.listEl.innerHTML = ""

        if (!this.loaded) {
            this.listEl.appendChild(this.stateRow("task-empty", "Loading tasks…"))
        } else if (this.loadError) {
            const row = this.stateRow("task-empty task-error", "Couldn't load tasks — click to retry")
            row.addEventListener("click", () => this.refresh())
            this.listEl.appendChild(row)
        } else {
            const visible = this.visibleTasks()
            visible.forEach(task => this.listEl.appendChild(this.buildTaskItem(task)))

            if (visible.length === 0) {
                this.listEl.appendChild(this.stateRow("task-empty",
                    this.tasks.length === 0
                        ? (this.allowAdd ? "All clear — add a task above" : "All clear")
                        : "Nothing to show — all done tasks hidden"))
            }
        }
    }

    stateRow(className, text) {
        const row = document.createElement("li")
        row.className = className
        row.innerText = text
        return row
    }
}
