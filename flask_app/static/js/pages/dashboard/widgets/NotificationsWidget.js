import { Widget } from '../Widget.js'

function minutesAgo(minutes) {
    const d = new Date()
    d.setMinutes(d.getMinutes() - minutes)
    return d
}

const DEMO_NOTIFICATIONS = [
    { id: "n1", category: "system", title: "Server backup complete", time: minutesAgo(25), read: false },
    { id: "n2", category: "message", title: "Lena sent you a message", time: minutesAgo(80), read: false },
    { id: "n3", category: "event", title: "Game night starts in 3 days", time: minutesAgo(200), read: false },
    { id: "n4", category: "task", title: "Task 'Update docs' is due tomorrow", time: minutesAgo(320), read: true },
    { id: "n5", category: "system", title: "New device signed in", time: minutesAgo(1400), read: true },
]

const CATEGORY_META = {
    system:  { label: "System" },
    message: { label: "Message" },
    event:   { label: "Event" },
    task:    { label: "Task" },
}

function relativeTime(date) {
    const seconds = Math.round((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
}

export class NotificationsWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const stored = Array.isArray(config.read_ids) ? config.read_ids : []
        this.read_ids = new Set(stored)

        this.items = (config.items || DEMO_NOTIFICATIONS).map(n => ({ ...n, time: new Date(n.time) }))
        this.items.forEach(n => {
            if (this.read_ids.has(n.id)) n.read = true
        })

        this.headEl = null
        this.markAllBtn = null
        this.listEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("notifications-widget")

        this.headEl = document.createElement("div")
        this.headEl.className = "notifications-head"
        this.content.appendChild(this.headEl)

        const title = document.createElement("span")
        title.className = "notifications-title"
        title.innerText = "Notifications"
        this.headEl.appendChild(title)

        this.markAllBtn = document.createElement("button")
        this.markAllBtn.className = "btn btn-ghost btn-sm"
        this.markAllBtn.innerText = "Mark all read"
        this.markAllBtn.addEventListener("click", () => this.markAllRead())
        this.headEl.appendChild(this.markAllBtn)

        this.listEl = document.createElement("ul")
        this.listEl.className = "notifications-list"
        this.content.appendChild(this.listEl)

        this.render()
    }

    unreadCount() {
        return this.items.filter(n => !n.read).length
    }

    render() {
        this.listEl.innerHTML = ""

        const sorted = [...this.items].sort((a, b) => b.time - a.time)

        sorted.forEach(notification => {
            const meta = CATEGORY_META[notification.category] || CATEGORY_META.system

            const item = document.createElement("li")
            item.className = "notification-item"
            if (notification.read) item.classList.add("read")

            const dot = document.createElement("span")
            dot.className = `notification-dot dot-${notification.category}`
            dot.setAttribute("aria-hidden", "true")

            const body = document.createElement("div")
            body.className = "notification-body"

            const head = document.createElement("div")
            head.className = "notification-row"

            const cat = document.createElement("span")
            cat.className = "notification-category"
            cat.innerText = meta.label

            const time = document.createElement("span")
            time.className = "notification-time"
            time.innerText = relativeTime(notification.time)

            head.append(cat, time)

            const message = document.createElement("span")
            message.className = "notification-message"
            message.innerText = notification.title

            body.append(head, message)
            item.appendChild(dot)
            item.appendChild(body)

            if (!notification.read) {
                const markBtn = document.createElement("button")
                markBtn.className = "notification-mark"
                markBtn.innerText = "Mark read"
                markBtn.addEventListener("click", () => this.markRead(notification.id))
                item.appendChild(markBtn)
            }

            this.listEl.appendChild(item)
        })

        this.markAllBtn.style.display = this.unreadCount() > 0 ? "" : "none"

        if (this.items.length === 0) {
            const empty = document.createElement("li")
            empty.className = "notification-empty"
            empty.innerText = "You're all caught up"
            this.listEl.appendChild(empty)
        }
    }

    markRead(id) {
        const item = this.items.find(n => n.id === id)
        if (item) {
            item.read = true
            this.read_ids.add(id)
        }
        this.save({ read_ids: [...this.read_ids] })
        this.render()
    }

    markAllRead() {
        this.items.forEach(n => {
            n.read = true
            this.read_ids.add(n.id)
        })
        this.save({ read_ids: [...this.read_ids] })
        this.render()
    }
}