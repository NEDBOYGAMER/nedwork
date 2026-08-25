import { Widget } from '../Widget.js'

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds))
    const hrs = Math.floor(s / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60

    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export class TimerWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings

        this.duration = config.duration ?? 300
        this.started = config.started ?? 0

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
        this.ringEl.className = "timer-ring"

        const ringInner = document.createElement("div")
        ringInner.className = "timer-ring-inner"

        this.displayEl = document.createElement("h3")
        this.displayEl.className = "timer-display"

        ringInner.appendChild(this.displayEl)
        this.ringEl.appendChild(ringInner)
        this.content.appendChild(this.ringEl)

        const controls = document.createElement("div")
        controls.className = "timer-controls"

        this.toggleBtn = document.createElement("button")
        this.toggleBtn.className = "timer-btn"
        this.toggleBtn.addEventListener("click", this.toggle)

        const resetBtn = document.createElement("button")
        resetBtn.className = "timer-btn"
        resetBtn.innerText = "Reset"
        resetBtn.addEventListener("click", this.reset)

        controls.append(this.toggleBtn, resetBtn)
        this.content.appendChild(controls)

        this.tick()
        this.tickTimer = setInterval(this.tick, 1000)
    }

    dispose() {
        clearInterval(this.tickTimer)
        this.tickTimer = null
    }

    get isRunning() {
        return this.started !== 0
    }

    get remaining() {
        if (!this.isRunning) return this.duration
        return this.duration - (Date.now() - this.started) / 1000
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
            this.save()
        }

        const progress = this.duration > 0 ? 1 - (remaining / this.duration) : 0
        this.ringEl.style.setProperty("--progress", Math.min(1, Math.max(0, progress)))

        this.displayEl.innerText = formatTime(remaining)
        this.toggleBtn.innerText = this.isRunning ? "Pause" : "Start"
        this.content.classList.toggle("timer-done", !this.isRunning && remaining <= 0)
    }

    toggle() {
        if (this.isRunning) {
            this.duration = Math.max(0, this.remaining)
            this.started = 0
        } else {
            if (this.duration <= 0) this.duration = 300
            this.started = Date.now()
        }
        this.save()
        this.tick()
    }

    reset() {
        this.started = 0
        this.duration = 300
        this.save()
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
}