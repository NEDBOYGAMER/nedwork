import { Widget } from '../Widget.js'

function daysFromNow(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(14, 0, 0, 0)
    return d
}

function demoEvents() {
    return [
        { id: 1, name: "Team standup", date: daysFromNow(0), color: "accent" },
        { id: 2, name: "Design review", date: daysFromNow(2), color: "success" },
        { id: 3, name: "Game night", date: daysFromNow(5), color: "warning" },
        { id: 4, name: "Server maintenance", date: daysFromNow(8), color: "danger" },
        { id: 5, name: "Monthly sync", date: daysFromNow(12), color: "accent" },
    ]
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate()
}

export class CalendarWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.events = (config.events || demoEvents()).map(e => ({ ...e, date: new Date(e.date) }))
        this.startSunday = config.settings?.start_sunday === true

        const now = new Date()
        this.view = new Date(now.getFullYear(), now.getMonth(), 1)
        this.selected = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        this.titleEl = null
        this.gridEl = null
        this.eventsEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("calendar-widget")

        const nav = document.createElement("div")
        nav.className = "calendar-nav"

        const prev = document.createElement("button")
        prev.className = "calendar-nav-btn"
        prev.type = "button"
        prev.innerText = "‹"
        prev.title = "Previous month"
        prev.addEventListener("click", () => this.shiftMonth(-1))

        this.titleEl = document.createElement("span")
        this.titleEl.className = "calendar-title"

        const next = document.createElement("button")
        next.className = "calendar-nav-btn"
        next.type = "button"
        next.innerText = "›"
        next.title = "Next month"
        next.addEventListener("click", () => this.shiftMonth(1))

        nav.append(prev, this.titleEl, next)
        this.content.appendChild(nav)

        const weekdays = document.createElement("div")
        weekdays.className = "calendar-weekdays"
        const names = this.startSunday
            ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        names.forEach(name => {
            const cell = document.createElement("span")
            cell.className = "calendar-weekday"
            cell.innerText = name
            weekdays.appendChild(cell)
        })
        this.content.appendChild(weekdays)

        this.gridEl = document.createElement("div")
        this.gridEl.className = "calendar-grid"
        this.content.appendChild(this.gridEl)

        this.eventsEl = document.createElement("div")
        this.eventsEl.className = "calendar-day-events"
        this.content.appendChild(this.eventsEl)

        this.render()
    }

    shiftMonth(delta) {
        this.view = new Date(this.view.getFullYear(), this.view.getMonth() + delta, 1)
        this.render()
    }

    eventsFor(day) {
        return this.events.filter(e => sameDay(e.date, day))
    }

    render() {
        const year = this.view.getFullYear()
        const month = this.view.getMonth()

        this.titleEl.innerText = this.view.toLocaleDateString([], { month: "long", year: "numeric" })

        const first = new Date(year, month, 1)
        const offset = (first.getDay() + (this.startSunday ? 0 : 6)) % 7
        const total = offset + daysInMonth(year, month)

        this.gridEl.innerHTML = ""

        for (let i = 0; i < total; i++) {
            const day = i - offset + 1
            const cell = document.createElement("div")

            if (day < 1 || day > daysInMonth(year, month)) {
                cell.className = "calendar-day blank"
                this.gridEl.appendChild(cell)
                continue
            }

            const date = new Date(year, month, day)
            cell.className = "calendar-day"
            cell.innerText = String(day)
            if (sameDay(date, new Date())) cell.classList.add("today")
            if (sameDay(date, this.selected)) cell.classList.add("selected")
            if (this.eventsFor(date).length > 0) cell.classList.add("has-events")

            cell.addEventListener("click", () => {
                this.selected = date
                this.render()
            })

            this.gridEl.appendChild(cell)
        }

        this.renderDay()
    }

    renderDay() {
        this.eventsEl.innerHTML = ""

        const heading = document.createElement("span")
        heading.className = "calendar-day-heading"
        heading.innerText = this.selected.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })
        this.eventsEl.appendChild(heading)

        const todays = this.eventsFor(this.selected)

        if (todays.length === 0) {
            const empty = document.createElement("span")
            empty.className = "calendar-event-empty"
            empty.innerText = "No events"
            this.eventsEl.appendChild(empty)
            return
        }

        todays.forEach(event => {
            const item = document.createElement("span")
            item.className = "calendar-event"

            const dot = document.createElement("span")
            dot.className = `calendar-event-dot event-${event.color}`
            dot.setAttribute("aria-hidden", "true")

            const name = document.createElement("span")
            name.innerText = event.name

            item.append(dot, name)
            this.eventsEl.appendChild(item)
        })
    }
}