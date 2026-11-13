import { Widget } from '../Widget.js'
import { SPEEDTEST_DEFAULT_INTERVAL, SPEEDTEST_INTERVALS } from '../widget_default.js'

const PING_URL = "https://speed.cloudflare.com/__down?bytes=0"
const DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=25000000"
const UP_URL = "https://speed.cloudflare.com/__up"
const UPLOAD_BYTES = 10_000_000
const PING_SAMPLES = 4
const MEASURE_TIMEOUT_MS = 20000
const HISTORY_MAX = 8
// wait a moment after the dashboard renders before saturating the line
const START_DELAY_MS = 800
const COUNTDOWN_TICK_MS = 1000
// ring is full at this download speed
const GAUGE_SCALE_MBPS = 500

function fmtMbps(mbps) {
    if (!Number.isFinite(mbps)) return "--"
    return mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1)
}

function fmtAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000)
    if (mins <= 0) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

function intervalMs(label) {
    const minutes = parseInt(label, 10)
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0
}

function fmtCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function withTimeout(promise, ms, label) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function speedTier(mbps) {
    if (!Number.isFinite(mbps)) return ""
    if (mbps >= 100) return "good"
    if (mbps >= 20) return "mid"
    return "poor"
}

export class SpeedtestWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings || {}
        const label = SPEEDTEST_INTERVALS.includes(settings.interval)
            ? settings.interval
            : SPEEDTEST_DEFAULT_INTERVAL
        this.intervalMs = intervalMs(label)

        this.demo = false
        this.running = false
        this.hadError = false

        // continuous-mode bookkeeping: recursive timeout (never overlapping
        // runs) plus a 1 s countdown so the widget visibly stays live
        this._disposed = false
        this._nextTimer = null
        this._countdownTimer = null
        this._nextRunAt = 0
        this._lastRunAt = 0
        this._abortController = null

        this.gauge = null
        this.valueEl = null
        this.phaseEl = null
        this.statEls = {}
        this.pingEl = null
        this.statusEl = null
        this.historyEl = null
        this.runBtn = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("speedtest-widget")

        // central ring gauge, same conic-gradient language as the timer ring;
        // the download speed is the headline it sweeps to
        this.gauge = document.createElement("div")
        this.gauge.className = "speedtest-gauge"

        const hole = document.createElement("div")
        hole.className = "speedtest-gauge-hole"

        this.valueEl = document.createElement("span")
        this.valueEl.className = "speedtest-value"
        this.valueEl.innerText = "--"

        const unit = document.createElement("span")
        unit.className = "speedtest-unit"
        unit.innerText = "Mbps"

        this.phaseEl = document.createElement("span")
        this.phaseEl.className = "speedtest-phase"

        hole.append(this.valueEl, unit, this.phaseEl)
        this.gauge.appendChild(hole)
        this.content.appendChild(this.gauge)

        // one compact stat per result; the gauge only tracks download
        const stats = document.createElement("div")
        stats.className = "speedtest-stats"
        this.statEls.download = this.buildStat("Download", fmtMbps)
        this.statEls.upload = this.buildStat("Upload", fmtMbps)
        this.statEls.ping = this.buildStat("Ping", v => Number.isFinite(v) ? `${Math.round(v)} ms` : "--")
        stats.append(this.statEls.download.root, this.statEls.upload.root, this.statEls.ping.root)
        this.content.appendChild(stats)

        this.historyEl = document.createElement("div")
        this.historyEl.className = "speedtest-history"
        this.content.appendChild(this.historyEl)

        this.statusEl = document.createElement("span")
        this.statusEl.className = "speedtest-status"
        this.content.appendChild(this.statusEl)

        this.runBtn = document.createElement("button")
        this.runBtn.className = "btn btn-primary btn-sm"
        this.runBtn.innerText = this.intervalMs > 0 ? "Check now" : "Run test"
        this.runBtn.addEventListener("click", () => this.run())
        this.content.appendChild(this.runBtn)

        // show the last result persisted after the previous run instead of
        // starting blind from "--"
        const last = this.config.speedtest_last
        if (last && Number.isFinite(last.download)) {
            this.applyResult(last.download, last.upload, last.ping)
            this.setStatus(`Last test ${fmtAgo(last.ts)}`)
        } else {
            this.setStatus(this.intervalMs > 0
                ? "Live — starting first check…"
                : "Ready — press Run test")
        }
        this.renderHistory()
        this.statusEl.classList.toggle("live", this.intervalMs > 0)

        // continuous mode follows the dashboard lifetime: pause while the tab
        // is hidden, resume when it comes back, stop on dispose()
        this.onVisibility = () => this.handleVisibility()
        document.addEventListener("visibilitychange", this.onVisibility)

        if (this.intervalMs > 0) {
            // a fresh persisted result shouldn't trigger an immediate repeat
            // (e.g. right after saving settings and re-rendering the grid):
            // count down the remainder of its interval instead
            const lastTs = Number(last?.ts)
            if (Number.isFinite(lastTs)) this._lastRunAt = lastTs
            const remaining = Number.isFinite(lastTs) ? this.intervalMs - (Date.now() - lastTs) : START_DELAY_MS
            const wait = Math.min(this.intervalMs, Math.max(START_DELAY_MS, remaining))
            if (!document.hidden) this.scheduleNext(wait)
        }
    }

    buildStat(label, format) {
        const root = document.createElement("div")
        root.className = "speedtest-stat"

        const name = document.createElement("span")
        name.className = "speedtest-stat-label"
        name.innerText = label

        const val = document.createElement("span")
        val.className = "speedtest-stat-value"
        val.innerText = "--"

        root.append(name, val)
        return {
            root,
            valueEl: val,
            set(v) { val.innerText = format(v) }
        }
    }

    setGauge(mbps) {
        this.gauge.style.setProperty("--progress",
            String(Number.isFinite(mbps) ? Math.min(1, Math.max(0, mbps) / GAUGE_SCALE_MBPS) : 0))
        this.gauge.dataset.tier = speedTier(mbps)
        this.valueEl.innerText = Number.isFinite(mbps) ? fmtMbps(mbps) : "--"
    }

    setPhase(text) {
        this.phaseEl.innerText = text
    }

    renderHistory() {
        const history = this.config.speedtest_history
        this.historyEl.replaceChildren()
        if (!history || history.length === 0) return

        history.forEach((entry) => {
            const bar = document.createElement("span")
            bar.className = "speedtest-history-bar"
            const dl = Number.isFinite(entry.download) ? entry.download : 0
            bar.style.height = `${Math.max(8, Math.min(100, (dl / GAUGE_SCALE_MBPS) * 100))}%`
            const up = Number.isFinite(entry.upload) ? fmtMbps(entry.upload) : "--"
            bar.title = `${fmtMbps(entry.download)}/${up} Mbps · ${fmtAgo(entry.ts)}`
            this.historyEl.appendChild(bar)
        })
    }

    applyResult(download, upload, ping) {
        this.setGauge(download)
        this.statEls.download.set(download)
        this.statEls.upload.set(upload)
        this.statEls.ping.set(ping)
    }

    setStatus(text, isError = false) {
        this.statusEl.innerText = text
        this.statusEl.classList.toggle("error", isError)
    }

    /* ------------------------------------------------------------------ */
    /* continuous mode                                                    */
    /* ------------------------------------------------------------------ */

    scheduleNext(delay = this.intervalMs) {
        if (this._disposed || this.intervalMs <= 0) return

        this.clearSchedule()
        if (this.running || document.hidden) return

        const wait = Math.max(0, delay)
        this._nextRunAt = Date.now() + wait
        this._nextTimer = setTimeout(() => {
            this._nextTimer = null
            this._nextRunAt = 0
            this.run()
        }, wait)

        this.updateCountdown()
        this._countdownTimer = setInterval(() => this.updateCountdown(), COUNTDOWN_TICK_MS)
    }

    clearSchedule() {
        if (this._nextTimer) clearTimeout(this._nextTimer)
        this._nextTimer = null
        this._nextRunAt = 0
        this.stopCountdown()
    }

    stopCountdown() {
        if (this._countdownTimer) clearInterval(this._countdownTimer)
        this._countdownTimer = null
    }

    updateCountdown() {
        if (this._disposed || this.running || !this._nextRunAt) return
        const label = this.hadError ? "Live check failed" : "Live"
        this.setStatus(`${label} · next check in ${fmtCountdown(this._nextRunAt - Date.now())}`, this.hadError)
    }

    handleVisibility() {
        if (this._disposed) return

        if (document.hidden) {
            // no point measuring a tab nobody is looking at
            this.clearSchedule()
            if (!this.running) this.setStatus("Live check paused — tab hidden")
            return
        }

        if (this.intervalMs <= 0 || this.running) return

        const elapsed = this._lastRunAt ? Date.now() - this._lastRunAt : Infinity
        const wait = this.intervalMs - elapsed
        if (wait <= 0) this.run()
        else this.scheduleNext(wait)
    }

    dispose() {
        this._disposed = true
        this.clearSchedule()
        this.stopCountdown()
        this._abortController?.abort()
        if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility)
        this.onVisibility = null
    }

    measurePing() {
        const samples = []

        const one = () => new Promise((resolve) => {
            const start = performance.now()
            fetch(PING_URL, {
                cache: "no-store",
                mode: "cors",
                signal: this._abortController?.signal,
            })
                .then(() => resolve(performance.now() - start))
                .catch(() => resolve(null))
        })

        return (async () => {
            for (let i = 0; i < PING_SAMPLES; i++) {
                if (this._disposed) break
                const sample = await one()
                if (sample !== null) samples.push(sample)
            }
            if (samples.length === 0) throw new Error("ping failed")
            return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]
        })()
    }

    // streams the response body so onProgress gets the live byte count —
    // the gauge sweeps while the test runs instead of jumping at the end
    measureDownload(onProgress) {
        return new Promise((resolve, reject) => {
            const start = performance.now()
            fetch(DOWNLOAD_URL, {
                cache: "no-store",
                mode: "cors",
                signal: this._abortController?.signal,
            })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    if (!res.body) return res.arrayBuffer().then(buffer => {
                        resolve((buffer.byteLength * 8) / ((performance.now() - start) / 1000 * 1e6))
                    })
                    const reader = res.body.getReader()
                    let bytes = 0
                    const pump = ({ done, value }) => {
                        if (done) {
                            resolve((bytes * 8) / ((performance.now() - start) / 1000 * 1e6))
                            return
                        }
                        bytes += value.byteLength
                        if (onProgress) onProgress(bytes, (performance.now() - start) / 1000)
                        return reader.read().then(pump)
                    }
                    reader.read().then(pump)
                })
                .catch(reject)
        })
    }

    // ArrayBuffer body keeps Content-Type unset → simple CORS request,
    // no preflight round-trip distorting the measurement
    measureUpload() {
        return new Promise((resolve, reject) => {
            const start = performance.now()
            fetch(`${UP_URL}?bytes=${UPLOAD_BYTES}`, {
                method: "POST",
                mode: "cors",
                cache: "no-store",
                body: new ArrayBuffer(UPLOAD_BYTES),
                signal: this._abortController?.signal,
            })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    return res.arrayBuffer()
                })
                .then(() => {
                    const seconds = (performance.now() - start) / 1000
                    resolve((UPLOAD_BYTES * 8) / (seconds * 1e6))
                })
                .catch(reject)
        })
    }

    simulate() {
        this.demo = true
        const ping = 18 + Math.random() * 30
        const download = 40 + Math.random() * 160
        const upload = 10 + Math.random() * 30
        return new Promise(resolve => setTimeout(() => resolve({ ping, download, upload }), 900))
    }

    finishRun() {
        this.running = false
        if (this._disposed) return
        this.content.classList.remove("is-running")
        this.runBtn.disabled = false
        this.runBtn.innerText = this.intervalMs > 0 ? "Check now" : "Test again"
    }

    async run() {
        if (this.running || this._disposed) return

        // a manual "Check now" restarts the cycle: drop the pending timeout
        // and countdown before measuring
        this.clearSchedule()
        this.running = true
        this.demo = false
        this._abortController = new AbortController()
        this.runBtn.disabled = true
        this.content.classList.add("is-running")
        // continuous mode keeps the last result on screen while re-checking -
        // only the live download progress should move the gauge, not a blank
        // reset every interval
        if (!this.config.speedtest_last) this.setGauge(NaN)
        this.setPhase("ping")
        this.setStatus("Measuring ping…")

        let results
        try {
            const ping = await withTimeout(this.measurePing(), MEASURE_TIMEOUT_MS, "ping")
            if (this._disposed) return

            this.setPhase("down")
            this.setStatus("Measuring download…")
            let download = null
            try {
                download = await withTimeout(
                    this.measureDownload((bytes, seconds) => {
                        if (seconds > 0.1) this.setGauge((bytes * 8) / (seconds * 1e6))
                    }),
                    MEASURE_TIMEOUT_MS, "download")
                if (this._disposed) return
            } catch (err) {
                if (this._disposed) return
                console.warn("SpeedtestWidget: download failed", err)
            }

            this.setPhase("up")
            this.setStatus("Measuring upload…")
            let upload = null
            try {
                upload = await withTimeout(this.measureUpload(), MEASURE_TIMEOUT_MS, "upload")
                if (this._disposed) return
            } catch (err) {
                if (this._disposed) return
                console.warn("SpeedtestWidget: upload failed", err)
            }

            if (download === null && upload === null) throw new Error("download and upload both failed")
            results = { ping, download, upload }
        } catch (err) {
            if (this._disposed) return
            console.warn("SpeedtestWidget: network test unavailable, using demo mode", err)
            results = await this.simulate()
            if (this._disposed) return
        }

        const now = Date.now()
        this._lastRunAt = now
        this.hadError = this.demo

        this.setPhase("")
        this.applyResult(results.download, results.upload, results.ping)

        // persist for instant display on the next dashboard visit, keeping
        // the last HISTORY_MAX results for the sparkline
        const history = Array.isArray(this.config.speedtest_history)
            ? [...this.config.speedtest_history, { ts: now, download: results.download, upload: results.upload }]
            : [{ ts: now, download: results.download, upload: results.upload }]
        while (history.length > HISTORY_MAX) history.shift()
        this.save({
            speedtest_last: {
                download: results.download,
                upload: results.upload,
                ping: results.ping,
                demo: this.demo,
                ts: now
            },
            speedtest_history: history
        })
        this.renderHistory()
        this.finishRun()

        if (this.demo) {
            this.setStatus("Demo mode — network test blocked", true)
        } else {
            this.setStatus("Test complete")
        }

        // continuous mode: start counting down to the next check. scheduleNext
        // overwrites the transient status with the live countdown.
        this.scheduleNext(this.intervalMs)
    }
}
