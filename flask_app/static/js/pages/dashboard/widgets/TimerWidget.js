// ---------------------------------------------------------------------------
// TimerWidget.js
// Countdown timer with four presentation views:
//   ring - conic progress circle around the digits (default)
//   text - bare giant digits
//   bar  - digits + linear progress bar
//   flip - split-flap cards (MM:SS under an hour, H:MM:SS above it)
//
// The widget renders itself from currentColor + alpha mixes and sizes
// everything in container-query units, so it adapts to every card style
// (tech / borderless / transparent / opaque / glassy) and every card size.
// All styling lives in timer.css - keep it loaded after widgets.css.
// ---------------------------------------------------------------------------

import { Widget } from '../Widget.js'
import { TIMER_VIEWS } from '../widget_default.js'

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds))
    const hrs = Math.floor(s / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60

    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

/* one split-flap card: the halves already show the NEW digit while the
   flap (a copy of the OLD top half) folds down over the seam; restarting
   the animation is what triggers the CSS flap-drop keyframes */
function setFlipDigit(card, next) {
    const cur = card.dataset.digit
    if (cur === next) return

    card.dataset.digit = next
    card.querySelector(".flip-flap i").textContent = cur
    card.querySelector(".flip-half.top i").textContent = next
    card.querySelector(".flip-half.bottom i").textContent = next

    card.classList.remove("flipping")
    void card.offsetWidth
    card.classList.add("flipping")
}

export class TimerWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings || {}

        this.duration = config.duration ?? 300
        // what Reset should return to: the last full duration the user
        // started from (pausing shrinks this.duration, baseDuration keeps
        // the original so Reset doesn't fall back to a hardcoded 300)
        this.baseDuration = this.duration
        // settings.duration acts as the "designed" default and what Reset
        // restores to once the user has it configured
        const configured = parseInt(settings.duration, 10)
        this.configuredDuration = Number.isFinite(configured) && configured > 0 ? configured : 0
        if (config.duration == null && this.configuredDuration > 0) this.duration = this.configuredDuration
        this.resetDuration = () => this.configuredDuration > 0 ? this.configuredDuration : this.baseDuration

        this.started = config.started ?? 0

        this.sound = settings.sound !== false
        this.autorestart = settings.autorestart === true
        // legacy configs stored the view at the top level (the settings
        // modal writes there when the key is absent from settings)
        const view = settings.view ?? config.view
        this.view = TIMER_VIEWS.includes(view) ? view : "ring"

        this.tick = this.tick.bind(this)
        this.toggle = this.toggle.bind(this)
        this.reset = this.reset.bind(this)

        this.tickTimer = null

        // per-view element refs (reset whenever the content is rebuilt)
        this.ringEl = null
        this.displayEl = null
        this.flipClock = null
        this.flipDigits = null
        this.flipLayout = null
        this.toggleBtn = null

        // which presentation the current DOM was built for
        this._builtView = null
    }

    build() {
        this.buildShell()
        this._buildContent()
    }

    dispose() {
        this.stopTicker()
    }

    /* ------------------------------------------------------------------ */
    /* content construction (shared by build() and settings rebuilds)      */
    /* ------------------------------------------------------------------ */

    _buildContent() {
        this.stopTicker()
        this.content.innerHTML = ""

        this.content.classList.add("timer-widget")
        if (this._builtView) this.content.classList.remove(`timer-${this._builtView}`)
        this.content.classList.add(`timer-${this.view}`)
        this._builtView = this.view

        this.ringEl = null
        this.displayEl = null
        this.flipClock = null
        this.flipDigits = null
        this.flipLayout = null

        // the stage centers whichever view is active and soaks up the
        // space between the title bar and the controls
        const stage = document.createElement("div")
        stage.className = "timer-stage"
        stage.setAttribute("role", "timer") // implicit aria-live="off": no per-second chatter
        this.content.appendChild(stage)

        if (this.view === "ring") {
            this.ringEl = document.createElement("div")
            this.ringEl.className = "timer-ring-dial"

            const ringInner = document.createElement("div")
            ringInner.className = "timer-ring-inner"

            this.displayEl = document.createElement("h3")
            this.displayEl.className = "timer-display"

            ringInner.appendChild(this.displayEl)
            this.ringEl.appendChild(ringInner)
            stage.appendChild(this.ringEl)
        } else if (this.view === "flip") {
            this.flipClock = document.createElement("div")
            this.flipClock.className = "flip-clock"
            stage.appendChild(this.flipClock)
            // cards are built on the first tick - the count depends on
            // whether the countdown is over an hour (H:MM:SS) or not (MM:SS)
        } else {
            this.displayEl = document.createElement("h3")
            this.displayEl.className = "timer-display"
            stage.appendChild(this.displayEl)

            if (this.view === "bar") {
                const track = document.createElement("div")
                track.className = "timer-bar-track"
                const fill = document.createElement("div")
                fill.className = "timer-bar-fill"
                track.appendChild(fill)
                stage.appendChild(track)
            }
        }

        const controls = document.createElement("div")
        controls.className = "timer-controls"

        this.toggleBtn = document.createElement("button")
        this.toggleBtn.className = "timer-btn"
        this.toggleBtn.type = "button"
        this.toggleBtn.addEventListener("click", this.toggle)

        const resetBtn = document.createElement("button")
        resetBtn.className = "timer-btn"
        resetBtn.type = "button"
        resetBtn.innerText = "Reset"
        resetBtn.addEventListener("click", this.reset)

        controls.append(this.toggleBtn, resetBtn)
        this.content.appendChild(controls)

        this.tick()
        this.syncTicker()
    }

    /* the interval only burns cycles while a countdown is actually running;
       paused/idle/done timers just get a single tick for the ring/display */
    startTicker() {
        this.stopTicker()
        this.tickTimer = setInterval(this.tick, 1000)
    }

    stopTicker() {
        if (this.tickTimer) clearInterval(this.tickTimer)
        this.tickTimer = null
    }

    syncTicker() {
        if (this.isRunning) this.startTicker()
        else this.stopTicker()
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

        // one progress value drives ring + bar through CSS (see timer.css);
        // sweeping it on the content root keeps tick() free of per-view writes
        const progress = this.duration > 0 ? 1 - (remaining / this.duration) : 0
        const clamped = Math.min(1, Math.max(0, progress))
        this.content.style.setProperty("--progress", clamped.toFixed(4))

        if (this.view === "flip") this.updateFlip(remaining)
        else if (this.displayEl) this.displayEl.innerText = formatTime(remaining)

        this.content.classList.toggle("is-running", this.isRunning)
        this.content.classList.toggle("timer-done", !this.isRunning && remaining <= 0)
        // text/ring views shrink a step once the countdown crosses an hour
        this.content.classList.toggle("timer-hms", this.view !== "flip" && remaining >= 3600)

        if (this.toggleBtn) {
            this.toggleBtn.innerText = this.isRunning ? "Pause" : "Start"
            this.toggleBtn.classList.toggle("timer-btn--primary", !this.isRunning)
        }

        // countdown hit zero and won't restart - no more ticking needed
        if (!this.isRunning) this.stopTicker()
    }

    /* flip mode: MM:SS under an hour, H:MM:SS (+ .compact for smaller
       cards) above it. A layout change rebuilds the card row once; after
       that each tick only animates the digits that actually changed. */
    updateFlip(remaining) {
        if (!this.flipClock) return

        const str = formatTime(remaining)
        const layout = str.split(":").length === 3 ? "hms" : "ms"

        if (this.flipLayout !== layout) {
            this.buildFlipClock(str, layout)
            return
        }

        let i = 0
        for (const ch of str) {
            if (ch === ":") continue
            setFlipDigit(this.flipDigits[i++], ch)
        }
    }

    buildFlipClock(str, layout) {
        this.flipLayout = layout
        this.flipClock.classList.toggle("compact", layout === "hms")
        this.flipClock.innerHTML = ""
        this.flipDigits = []

        for (const ch of str) {
            if (ch === ":") {
                const colon = document.createElement("span")
                colon.className = "flip-colon"
                this.flipClock.appendChild(colon)
                continue
            }

            const card = document.createElement("span")
            card.className = "flip-digit"
            card.dataset.digit = ch
            card.innerHTML =
                `<span class="flip-half top"><i>${ch}</i></span>` +
                `<span class="flip-half bottom"><i>${ch}</i></span>` +
                `<span class="flip-flap"><i>${ch}</i></span>`
            this.flipDigits.push(card)
            this.flipClock.appendChild(card)
        }
    }

    toggle() {
        if (this.isRunning) {
            this.duration = Math.max(0, this.remaining)
            this.started = 0
        } else {
            if (this.duration <= 0) this.duration = this.resetDuration()
            this.baseDuration = this.duration
            this.started = Date.now()
        }
        this.save()
        this.tick()
        this.syncTicker()
    }

    reset() {
        this.started = 0
        this.duration = this.resetDuration()
        this.save()
        this.tick()
        this.syncTicker()
    }

    /* persist + re-sync: settings changed through the modal take effect
       immediately - a view change rebuilds the content, sound/autorestart
       swap in live, and a changed duration snaps an idle timer (a paused
       timer keeps its remainder; otherwise it applies on Reset, as before) */
    save(delta) {
        const before = {
            view: this.view,
            sound: this.sound,
            autorestart: this.autorestart,
            configured: this.configuredDuration,
        }

        super.save(delta)

        const settings = this.config.settings || {}
        this.sound = settings.sound !== false
        this.autorestart = settings.autorestart === true
        const configured = parseInt(settings.duration, 10)
        this.configuredDuration = Number.isFinite(configured) && configured > 0 ? configured : 0
        const view = settings.view ?? this.config.view
        this.view = TIMER_VIEWS.includes(view) ? view : "ring"

        if (before.view !== this.view) {
            this._buildContent()
            return
        }

        const prevTarget = before.configured > 0 ? before.configured : this.baseDuration
        if (before.configured !== this.configuredDuration && this.started === 0 && this.duration === prevTarget) {
            this.duration = this.resetDuration()
            this.tick()
        }
    }

    playSound() {
        // three short pulses - unmistakable as "the timer is done"
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            if (ctx.state === "suspended") ctx.resume()
            for (let i = 0; i < 3; i++) {
                const start = ctx.currentTime + i * 0.3
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.frequency.value = 880
                gain.gain.setValueAtTime(0.15, start)
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2)
                osc.start(start)
                osc.stop(start + 0.2)
            }
        } catch (err) {
            console.error("TimerWidget: could not play sound", err)
        }
    }
}