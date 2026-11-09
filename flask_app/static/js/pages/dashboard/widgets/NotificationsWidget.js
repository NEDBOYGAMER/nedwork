import { Widget } from '../Widget.js'
import { NOTIFICATION_TYPES, notificationText, relativeTime } from '../../../components/notifications.js'

// In-app notifications. The Notification model and its writers live in
// flask_app/notifications.py; this widget reads the Events API surface,
// the /notifications page reads /notifications/api/list (same rows, plus
// per-row actions). Demo data is only a silent fallback when the API is
// unreachable (e.g. offline).
const API_URL = '/events/api/notifications'
const READ_URL = '/events/api/notifications/read'
const POLL_MS = 60_000

function minutesAgo(minutes) {
    const d = new Date()
    d.setMinutes(d.getMinutes() - minutes)
    return d
}

const DEMO_NOTIFICATIONS = [
    { id: 1, type: "event", title: "Game night starts in 3 days", time: minutesAgo(200), read: false },
    { id: 2, type: "task", title: "Task 'Update docs' is due tomorrow", time: minutesAgo(320), read: true },
    { id: 3, type: "system", title: "New device signed in", time: minutesAgo(1400), read: true },
]

export class NotificationsWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.showCategories = config.settings?.show_categories !== false   // default on
        this.items = []
        this.live = false          // true once the real API has responded
        this.pollTimer = null

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

        this.fetchNotifications()
        this.pollTimer = setInterval(() => this.fetchNotifications(), POLL_MS)

        this.render()
    }

    dispose() {
        clearInterval(this.pollTimer)
    }

    async fetchNotifications() {
        try {
            const res = await fetch(API_URL, { credentials: "same-origin" })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const rows = data.notifications || []
            this.live = true
            this.items = rows.map(n => ({
                id: n.id,
                type: n.type,
                category: NOTIFICATION_TYPES[n.type]?.slug || "event",
                title: notificationText(n),
                time: new Date(n.created_at),
                read: !!n.read,
                link: (n.payload && n.payload.session_token)
                    ? `/apps/tierforge?s=${n.payload.session_token}`
                    : null,
            }))
            this.unread = data.unread || 0
        } catch (err) {
            // silent fallback to demo data — the plan says the widget must
            // never look broken when the events site is unreachable
            if (!this.live) {
                this.items = DEMO_NOTIFICATIONS.map(n => ({
                    ...n,
                    category: NOTIFICATION_TYPES[n.type]?.slug || "event",
                }))
            }
        }
        this.render()
    }

    unreadCount() {
        return this.items.filter(n => !n.read).length
    }

    render() {
        this.listEl.innerHTML = ""

        const sorted = [...this.items].sort((a, b) => b.time - a.time)

        sorted.forEach(notification => {
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

            if (this.showCategories) {
                const cat = document.createElement("span")
                cat.className = "notification-category"
                cat.innerText = NOTIFICATION_TYPES[notification.type]?.label || "Event"
                head.appendChild(cat)
            }

            const time = document.createElement("span")
            time.className = "notification-time"
            time.innerText = relativeTime(notification.time)
            head.appendChild(time)

            const message = document.createElement("span")
            message.className = "notification-message"
            message.innerText = notification.title

            body.append(head, message)
            item.appendChild(dot)
            item.appendChild(body)

            if (notification.link) {
                item.classList.add("notification-link")
                item.addEventListener("click", (e) => {
                    if (e.target.closest("button")) return
                    window.location.href = notification.link
                })
            }

            if (!notification.read) {
                const markBtn = document.createElement("button")
                markBtn.className = "notification-mark"
                markBtn.innerText = "Mark read"
                markBtn.addEventListener("click", (e) => {
                    e.stopPropagation()
                    this.markRead(notification.id)
                })
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

    async markRead(id) {
        const item = this.items.find(n => n.id === id)
        if (item) item.read = true
        this.render()
        try {
            const res = await fetch(READ_URL, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [id] }),
            })
            if (res.ok) {
                const data = await res.json()
                this.unread = data.unread
            }
        } catch (err) { /* offline — local state already updated */ }
    }

    async markAllRead() {
        this.items.forEach(n => { n.read = true })
        this.render()
        try {
            const res = await fetch(READ_URL, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ all: true }),
            })
            if (res.ok) {
                const data = await res.json()
                this.unread = data.unread
            }
        } catch (err) { /* offline — local state already updated */ }
    }
}
