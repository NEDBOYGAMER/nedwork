import { Widget } from '../Widget.js'

export class TimeWidget extends Widget {
    constructor(config) {
        super(config)

        this.display = this.display.bind(this)

        const settings = config.settings

        this.format24 = settings.format24
        this.show_seconds = settings.show_seconds
        this.show_date = settings.show_date
        this.show_time = settings.show_time
        this.show_weekday = settings.show_weekday
        this.date_style = settings.date_style
        this.timezone = settings.timezone

        this.timeEl = null
        this.dateEl = null
    }


    build(){
        this.buildShell()

        this.timeEl = document.createElement("h3")
        this.dateEl = document.createElement("h3")

        if (this.show_time){
            this.card.appendChild(this.timeEl)
        }

        if (this.show_date){
            this.card.appendChild(this.dateEl)
        }

        this.display()
    }


    display(){
        const now = new Date()

        if (this.show_time){
            this.timeEl.innerText = now.toLocaleTimeString([], {
                timeZone: this.timezone,
                hour: "2-digit",
                minute: "2-digit",
                second: this.show_seconds ? "2-digit" : undefined,
                hour12: !this.format24
            })
        }


        if (this.show_date){
            this.dateEl.innerText = now.toLocaleDateString([], {
                timeZone: this.timezone,
                weekday: this.show_weekday ? "long" : undefined,
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            })
        }

        requestAnimationFrame(this.display)
    }
}