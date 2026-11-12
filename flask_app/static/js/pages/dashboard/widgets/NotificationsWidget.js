import { Widget } from '../Widget.js'
import { NOTIFICATION_TYPES, notificationText, relativeTime } from '../../../components/notifications.js'
import { getHub } from '../../../components/notificationHub.js'

// In-app notifications. The Notification model and its writers live in
// flask_app/notifications.py; the shared notification hub owns the socket
// and the REST list (/notifications/api/list). Demo data is only a silent
// fallback when the API has never responded (e.g. offline).

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
        this.unread = 0
        this.live = false          // true once the real API has responded
        this.hub = null
        this.unsubscribe = null

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

        this.hub = getHub()
        this.hub.start()
        this.unsubscribe = this.hub.subscribe(state => this.applyState(state))
    }

    dispose() {
        if (this.unsubscribe) {
            this.unsubscribe()
            this.unsubscribe = null
        }
    }

    applyState(state) {
        if (state.loaded) {
            this.live = true
            this.items = (state.items || []).map(n => ({
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
            this.unread = state.unread || 0
        } else if (!this.live) {
            // silent fallback to demo data — the widget must never look
            // broken when the notifications API is unreachable
            this.items = DEMO_NOTIFICATIONS.map(n => ({
                ...n,
                category: NOTIFICATION_TYPES[n.type]?.slug || "event",
            }))
            this.unread = this.items.filter(n => !n.read).length
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
        this.unread = await this.hub.markRead([id])
        this.render()
    }

    async markAllRead() {
        this.items.forEach(n => { n.read = true })
        this.render()
        this.unread = await this.hub.markRead(null, true)
        this.render()
    }
}
