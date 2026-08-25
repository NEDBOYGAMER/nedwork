import { Widget } from '../Widget.js'

function daysFromNow(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(14, 0, 0, 0)
    return d
}

function demoEvents() {
    const month = new Date().toLocaleDateString([], { month: "long", year: "numeric" })
    return [
        { id: 1, name: "Team standup", date: daysFromNow(0), color: "accent" },
        { id: 2, name: "Design review", date: daysFromNow(2), color: "success" },
        { id: 3, name: "Game night", date: daysFromNow(5), color: "warning" },
        { id: 4, name: "Server maintenance", date: daysFromNow(8), color: "danger" },
        { id: 5, name: `Monthly sync (${month})`, date: daysFromNow(12), color: "accent" },
    ]
}

const EVENT_ICONS = {
    accent: "📌",
    success: "🎉",
    warning: "⏰",
    danger: "🔧",
}

export class EventManagerWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.events = (config.events || demoEvents()).map(e => ({ ...e, date: new Date(e.date) }))

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
            .filter(e => e.date >= now)
            .sort((a, b) => a.date - b.date)
            .slice(0, 5)

        upcoming.forEach(event => {
            const item = document.createElement("li")
            item.className = "event-item"

            const icon = document.createElement("span")
            icon.className = "event-icon"
            icon.innerText = EVENT_ICONS[event.color] || "📅"

            const info = document.createElement("div")
            info.className = "event-info"

            const name = document.createElement("span")
            name.className = "event-name"
            name.innerText = event.name

            const when = document.createElement("span")
            when.className = "event-when"
            when.innerText = this.friendlyDate(event.date)

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