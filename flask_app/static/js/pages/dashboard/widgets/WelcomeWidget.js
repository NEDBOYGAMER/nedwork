import { Widget } from '../Widget.js'

function greetingFor(hour) {
    if (hour >= 5 && hour < 12) return "Good morning"
    if (hour >= 12 && hour < 18) return "Good afternoon"
    if (hour >= 18 && hour < 22) return "Good evening"
    return "Good night"
}

export class WelcomeWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings || {}

        this.show_date = settings.show_date !== false
        this.show_time = settings.show_time !== false

        this.greetingEl = null
        this.dateEl = null
        this.subEl = null
        this.timerId = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("welcome-widget")

        this.greetingEl = document.createElement("h3")
        this.greetingEl.className = "welcome-greeting"
        this.content.appendChild(this.greetingEl)

        if (this.show_date) {
            this.dateEl = document.createElement("span")
            this.dateEl.className = "welcome-date"
            this.content.appendChild(this.dateEl)
        }

        if (this.show_time) {
            this.subEl = document.createElement("p")
            this.subEl.className = "welcome-sub"
            this.content.appendChild(this.subEl)
        }

        this.render()

        // a dashboard can sit open all day - refresh once a minute so the
        // greeting/date/time never goes stale (cheap: pure local date math)
        this.timerId = setInterval(() => this.render(), 60 * 1000)

        this.onVisibility = () => { if (!document.hidden) this.render() }
        document.addEventListener("visibilitychange", this.onVisibility)
    }

    dispose() {
        clearInterval(this.timerId)
        this.timerId = null
        if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility)
        this.onVisibility = null
    }

    render() {
        const now = new Date()
        const username = localStorage.getItem("username") || "there"

        this.greetingEl.innerText = `${greetingFor(now.getHours())}, ${username}`

        if (this.dateEl) {
            this.dateEl.innerText = now.toLocaleDateString([], {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
            })
        }

        if (this.subEl) {
            this.subEl.innerText = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
    }
}
