import { Widget } from '../Widget.js'

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds))
    const hrs = Math.floor(s / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60

    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export class TimerWidget extends Widget {
    constructor(config) {
        super(config)

        const settings = config.settings

        this.duration = config.duration ?? 300  // total length in seconds
        this.started = config.started ?? 0      // wall-clock ms timestamp, 0 = not running

        this.offline = settings.offline
        this.sound = settings.sound
        this.autorestart = settings.autorestart

        this.tick = this.tick.bind(this)
        this.toggle = this.toggle.bind(this)
        this.reset = this.reset.bind(this)

        this.tickTimer = null

        this.ringEl = null
        this.displayEl = null
        this.toggleBtn = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("timer-widget")

        this.ringEl = document.createElement("div")
        this.ringEl.classList.add("timer-ring")

        const ringInner = document.createElement("div")
        ringInner.classList.add("timer-ring-inner")

        this.displayEl = document.createElement("h3")
        this.displayEl.classList.add("timer-display")

        ringInner.appendChild(this.displayEl)
        this.ringEl.appendChild(ringInner)
        this.content.appendChild(this.ringEl)

        const controls = document.createElement("div")
        controls.classList.add("timer-controls")

        this.toggleBtn = document.createElement("button")
        this.toggleBtn.classList.add("timer-btn")
        this.toggleBtn.addEventListener("click", this.toggle)

        const resetBtn = document.createElement("button")
        resetBtn.classList.add("timer-btn")
        resetBtn.innerText = "Reset"
        resetBtn.addEventListener("click", this.reset)

        controls.appendChild(this.toggleBtn)
        controls.appendChild(resetBtn)
        this.content.appendChild(controls)

        this.content.addEventListener("widget:update", () => {
            clearInterval(this.tickTimer)
        })

        this.tick()
        this.tickTimer = setInterval(this.tick, 1000)
    }

    get isRunning() {
        return this.started !== 0
    }

    get remaining() {
        if (!this.isRunning) return this.duration
        const elapsed = (Date.now() - this.started) / 1000
        return this.duration - elapsed
    }

    tick() {
        let remaining = this.remaining

        if (this.isRunning && remaining <= 0) {
            if (this.sound) this.playSound()

            if (this.autorestart) {
                this.started = Date.now()
                remaining = this.duration
            } else {
                this.started = 0
                remaining = 0
            }
            this.persist()
        }

        const progress = this.duration > 0 ? 1 - (remaining / this.duration) : 0
        this.ringEl.style.setProperty("--progress", Math.min(1, Math.max(0, progress)))

        this.displayEl.innerText = formatTime(remaining)
        this.toggleBtn.innerText = this.isRunning ? "Pause" : "Start"
        this.content.classList.toggle("timer-done", !this.isRunning && remaining <= 0)
    }

    toggle() {
        if (this.isRunning) {
            // pause: bank the remaining time into duration, stop the clock
            this.duration = Math.max(0, this.remaining)
            this.started = 0
        } else {
            if (this.duration <= 0) this.duration = 300
            this.started = Date.now()
        }
        this.persist()
        this.tick()
    }

    reset() {
        this.started = 0
        this.duration = 300
        this.persist()
        this.tick()
    }

    playSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = 880
            gain.gain.setValueAtTime(0.15, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
            osc.start()
            osc.stop(ctx.currentTime + 0.6)
        } catch (err) {
            console.error("TimerWidget: could not play sound", err)
        }
    }

    async persist() {
        try {
            const dashboard_info = await fetch('/dashboard/api/load/main')
            const dashboard = await dashboard_info.json()

            const widgets = dashboard.widgets.map(widget =>
                widget.id === this.id
                    ? { ...widget, duration: this.duration, started: this.started }
                    : widget
            )

            const dashboard_name = localStorage.getItem("dashboard_name")

            await fetch('/dashboard/api/update/update_widget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: dashboard_name,
                    widgets: widgets
                })
            })
        } catch (err) {
            console.error("TimerWidget: failed to persist state", err)
        }
    }
}