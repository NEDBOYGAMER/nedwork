import { Widget } from '../Widget.js'
import { onLive, TOPICS } from '../../../components/liveEvents.js'

// Real upcoming events come from the Events site API. Demo data is only a
// silent fallback when the API is unreachable.
const API_URL = '/events/api/upcoming'
const POLL_MS = 60_000

function daysFromNow(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(14, 0, 0, 0)
    return d
}

function demoEvents() {
    return [
        { id: 1, title: "Game night", event_date: daysFromNow(5).toISOString(), attending: 3, member_count: 5 },
    ]
}

const RSVP_BADGES = {
    attending: "Going",
    maybe: "Maybe",
    cant: "Can't",
    pending: "Invited",
}

export class EventManagerWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.events = []
        this.live = false
        this.limit = Math.max(1, parseInt(config.settings?.limit, 10) || 5)
        this.pollTimer = null
        this.liveUnsub = null

        this.todayEl = null
        this.listEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("events-widget")

        this.todayEl = document.createElement("div")
        this.todayEl.className = "events-today"
        this.content.appendChild(this.todayEl)

        const heading = document.createElement("span")
        heading.className = "events-heading"
        heading.innerText = "Upcoming"
        this.content.appendChild(heading)

        this.listEl = document.createElement("ul")
        this.listEl.className = "events-list"
        this.content.appendChild(this.listEl)

        this.fetchEvents()
        this.pollTimer = setInterval(() => this.fetchEvents(), POLL_MS)
        this.liveUnsub = onLive(TOPICS.events, (detail) => {
            if (detail.type === "sync" || detail.payload?.list) {
                this.fetchEvents()
            }
        })

        this.render()
    }

    dispose() {
        clearInterval(this.pollTimer)
        this.liveUnsub?.()
        this.liveUnsub = null
    }

    async fetchEvents() {
        try {
            const res = await fetch(API_URL, { credentials: "same-origin" })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            const rows = data.events || []
            this.live = true
            this.events = rows.map(e => ({
                ...e,
                date: e.event_date ? new Date(e.event_date) : null,
            }))
        } catch (err) {
            if (!this.live) this.events = demoEvents().map(e => ({ ...e, date: new Date(e.event_date) }))
        }
        this.render()
    }

    render() {
        const now = new Date()

        this.todayEl.innerHTML = ""
        const day = document.createElement("span")
        day.className = "events-day"
        day.innerText = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })
        this.todayEl.appendChild(day)

        this.listEl.innerHTML = ""
        const upcoming = this.events
            .filter(e => e.date && e.date >= now)
            .sort((a, b) => a.date - b.date)
            .slice(0, this.limit)

        upcoming.forEach(event => {
            const item = document.createElement("li")
            item.className = "event-item"
            if (event.id) {
                item.style.cursor = "pointer"
                item.title = "Open event"
                item.addEventListener("click", () => {
                    window.location.href = `/events/${event.id}/`
                })
            }

            const icon = document.createElement("span")
            icon.className = "event-icon"
            icon.innerText = "📅"

            const info = document.createElement("div")
            info.className = "event-info"

            const name = document.createElement("span")
            name.className = "event-name"
            name.innerText = event.title

            const when = document.createElement("span")
            when.className = "event-when"
            when.innerText = [
                this.friendlyDate(event.date),
                this.countdown(event.date),
                RSVP_BADGES[event.my_rsvp] || "",
                `${event.attending}/${event.member_count} going`,
            ].filter(Boolean).join(" · ")

            info.append(name, when)
            item.append(icon, info)
            this.listEl.appendChild(item)
        })

        if (upcoming.length === 0) {
            const empty = document.createElement("li")
            empty.className = "event-empty"
            empty.innerText = "No upcoming events"
            this.listEl.appendChild(empty)
        }
    }

    countdown(date) {
        const ms = date - new Date()
        const minutes = Math.round(ms / 60000)
        if (minutes < 60) return `in ${Math.max(1, minutes)} min`
        const hours = Math.round(minutes / 60)
        if (hours < 24) return `in ${hours}h`
        const days = Math.round(hours / 24)
        return `in ${days} day${days === 1 ? "" : "s"}`
    }

    friendlyDate(date) {
        const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate())
        const now = new Date()
        const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000)

        if (diff === 0) return "Today"
        if (diff === 1) return "Tomorrow"
        if (diff === -1) return "Yesterday"
        if (diff > 1 && diff < 7) return date.toLocaleDateString([], { weekday: "long" })
        return date.toLocaleDateString([], { day: "numeric", month: "short" })
    }
}
