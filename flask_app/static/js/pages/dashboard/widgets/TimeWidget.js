import { Widget } from '../Widget.js'

const TIME_FIELDS = ["time", "weekday", "date"]

export class TimeWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.display = this.display.bind(this)

        const settings = config.settings

        this.format24 = settings.format24
        this.show_seconds = settings.show_seconds
        this.show_time = settings.show_time
        this.show_weekday = settings.show_weekday
        this.show_date = settings.show_date
        this.date_style = settings.date_style
        this.timezone = settings.timezone

        this.primary = TIME_FIELDS.includes(settings.primary) ? settings.primary : "time"

        this.timeEl = null
        this.weekdayEl = null
        this.dateEl = null
        this._raf = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("time-widget")

        if (this.show_time) this.timeEl = this.field("clock", "time")
        if (this.show_weekday) this.weekdayEl = this.field("weekday", "weekday")
        if (this.show_date) this.dateEl = this.field("date", "date")

        this.display()
    }

    field(cssClass, name) {
        const el = document.createElement("h3")
        el.classList.add(cssClass, name === this.primary ? "field-primary" : "field-secondary")
        this.content.appendChild(el)
        return el
    }

    getDateParts(now) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: this.timezone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }).formatToParts(now)

        const map = {}
        parts.forEach(p => map[p.type] = p.value)
        return map
    }

    formatDate(now) {
        const { day, month, year } = this.getDateParts(now)

        switch (this.date_style) {
            case "mm/dd/yyyy": return `${month}/${day}/${year}`
            case "yyyy-mm-dd": return `${year}-${month}-${day}`
            default: return `${day}.${month}.${year}`
        }
    }

    display() {
        const now = new Date()

        if (this.timeEl) {
            this.timeEl.innerText = now.toLocaleTimeString([], {
                timeZone: this.timezone,
                hour: "2-digit",
                minute: "2-digit",
                second: this.show_seconds ? "2-digit" : undefined,
                hour12: !this.format24
            })
        }

        if (this.weekdayEl) {
            this.weekdayEl.innerText = now.toLocaleDateString([], {
                timeZone: this.timezone,
                weekday: "long"
            })
        }

        if (this.dateEl) {
            this.dateEl.innerText = this.formatDate(now)
        }

        this._raf = requestAnimationFrame(this.display)
    }

    dispose() {
        if (this._raf) cancelAnimationFrame(this._raf)
        this._raf = null
    }
}