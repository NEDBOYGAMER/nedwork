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

        this.greetingEl = null
        this.dateEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("welcome-widget")

        this.greetingEl = document.createElement("h3")
        this.greetingEl.className = "welcome-greeting"
        this.content.appendChild(this.greetingEl)

        this.dateEl = document.createElement("span")
        this.dateEl.className = "welcome-date"
        this.content.appendChild(this.dateEl)

        this.subEl = document.createElement("p")
        this.subEl.className = "welcome-sub"
        this.content.appendChild(this.subEl)

        this.render()
    }

    render() {
        const now = new Date()
        const username = localStorage.getItem("username") || "there"

        this.greetingEl.innerText = `${greetingFor(now.getHours())}, ${username}`
        this.dateEl.innerText = now.toLocaleDateString([], {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        })
        this.subEl.innerText = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
}