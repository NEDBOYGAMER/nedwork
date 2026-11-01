import { Widget } from '../Widget.js'
import { TIME_FIELDS } from '../widget_default.js'

const TICK_MS = 1000 // 1s is enough - the smallest thing we show is a second

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
        this.timerId = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("time-widget")

        if (this.show_time) this.timeEl = this.field("clock", "time")
        if (this.show_weekday) this.weekdayEl = this.field("weekday", "weekday")
        if (this.show_date) this.dateEl = this.field("date", "date")

        this.display()
        this.startClock()

        // don't burn cycles redrawing the clock while the tab is hidden
        this.onVisibility = () => document.hidden ? this.stopClock() : this.startClock()
        document.addEventListener("visibilitychange", this.onVisibility)
    }

    startClock() {
        this.stopClock()
        this.display()
        this.timerId = setInterval(this.display, TICK_MS)
    }

    stopClock() {
        if (this.timerId) clearInterval(this.timerId)
        this.timerId = null
    }

    dispose() {
        this.stopClock()
        if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility)
        this.onVisibility = null
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
            const parts = new Intl.DateTimeFormat([], {
                timeZone: this.timezone,
                hour: "2-digit",
                minute: "2-digit",
                second: this.show_seconds ? "2-digit" : undefined,
                hour12: !this.format24
            }).formatToParts(now)

            let digits = ""
            let meridiem = ""
            parts.forEach(p => {
                if (p.type === "dayPeriod") meridiem = p.value
                else if (p.type !== "literal") digits += p.value
                else digits += p.value
            })

            // 12h mode: render the AM/PM as a small quiet suffix instead of
            // letting it blow up at full clock size
            if (meridiem) {
                this.timeEl.innerHTML = `${digits.trim()}<span class="meridiem">${meridiem}</span>`
            } else {
                this.timeEl.innerText = digits.trim()
            }
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
    }
}
