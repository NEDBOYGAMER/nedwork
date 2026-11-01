import { Widget } from '../Widget.js'

const PING_URL = "https://speed.cloudflare.com/__down?bytes=0"
const DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=25000000"
const UP_URL = "https://speed.cloudflare.com/__up"
const UPLOAD_BYTES = 10_000_000
const PING_SAMPLES = 4
const MEASURE_TIMEOUT_MS = 20000
const HISTORY_MAX = 8
// ring is full at this download speed
const GAUGE_SCALE_MBPS = 500

function fmtMbps(mbps) {
    if (!isFinite(mbps)) return "--"
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

function withTimeout(promise, ms, label) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function speedTier(mbps) {
    if (!isFinite(mbps)) return ""
    if (mbps >= 100) return "good"
    if (mbps >= 20) return "mid"
    return "poor"
}

export class SpeedtestWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.demo = false
        this.running = false

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
        this.statEls.download = this.buildStat("Download")
        this.statEls.upload = this.buildStat("Upload")
        this.statEls.ping = this.buildStat("Ping")
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
        this.runBtn.innerText = "Run test"
        this.runBtn.addEventListener("click", () => this.run())
        this.content.appendChild(this.runBtn)

        // show the last result persisted after the previous run instead of
        // starting blind from "--"
        const last = this.config.speedtest_last
        if (last && isFinite(last.download)) {
            this.applyResult(last.download, last.upload, last.ping)
            this.statusEl.innerText = `Last test ${fmtAgo(last.ts)}`
            this.runBtn.innerText = "Test again"
        } else {
            this.statusEl.innerText = "Ready — press Run test"
        }
        this.renderHistory()

        // settings.auto_run: start a test shortly after the dashboard opens
        // (skipped when the tab opens hidden in the background)
        if (config.settings?.auto_run === true && !document.hidden) {
            setTimeout(() => this.run(), 800)
        }
    }

    buildStat(label) {
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
            set(v) { val.innerText = isFinite(v) ? fmtMbps(v) : (v === null || v === undefined ? "--" : `${Math.round(v)} ms`) }
        }
    }

    setGauge(mbps) {
        this.gauge.style.setProperty("--progress",
            String(isFinite(mbps) ? Math.min(1, Math.max(0, mbps) / GAUGE_SCALE_MBPS) : 0))
        this.gauge.dataset.tier = speedTier(mbps)
        this.valueEl.innerText = isFinite(mbps) ? fmtMbps(mbps) : "--"
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
            const dl = isFinite(entry.download) ? entry.download : 0
            bar.style.height = `${Math.max(8, Math.min(100, (dl / GAUGE_SCALE_MBPS) * 100))}%`
            const up = isFinite(entry.upload) ? fmtMbps(entry.upload) : "--"
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

    measurePing() {
        const samples = []

        const one = () => new Promise((resolve) => {
            const start = performance.now()
            fetch(PING_URL, { cache: "no-store", mode: "cors" })
                .then(() => resolve(performance.now() - start))
                .catch(() => resolve(null))
        })

        return (async () => {
            for (let i = 0; i < PING_SAMPLES; i++) {
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
            fetch(DOWNLOAD_URL, { cache: "no-store", mode: "cors" })
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
                body: new ArrayBuffer(UPLOAD_BYTES)
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

    async run() {
        if (this.running) return
        this.running = true
        this.runBtn.disabled = true
        this.content.classList.add("is-running")
        this.setGauge(NaN)
        this.setPhase("ping")
        this.setStatus("Measuring ping…")

        let results
        try {
            const ping = await withTimeout(this.measurePing(), MEASURE_TIMEOUT_MS, "ping")

            this.setPhase("down")
            this.setStatus("Measuring download…")
            let download = null
            try {
                download = await withTimeout(
                    this.measureDownload((bytes, seconds) => {
                        if (seconds > 0.1) this.setGauge((bytes * 8) / (seconds * 1e6))
                    }),
                    MEASURE_TIMEOUT_MS, "download")
            } catch (err) {
                console.warn("SpeedtestWidget: download failed", err)
            }

            this.setPhase("up")
            this.setStatus("Measuring upload…")
            let upload = null
            try {
                upload = await withTimeout(this.measureUpload(), MEASURE_TIMEOUT_MS, "upload")
            } catch (err) {
                console.warn("SpeedtestWidget: upload failed", err)
            }

            if (download === null && upload === null) throw new Error("download and upload both failed")
            results = { ping, download, upload }
        } catch (err) {
            console.warn("SpeedtestWidget: network test unavailable, using demo mode", err)
            results = await this.simulate()
        }

        this.setPhase("")
        this.applyResult(results.download, results.upload, results.ping)

        // persist for instant display on the next dashboard visit, keeping
        // the last HISTORY_MAX results for the sparkline
        const history = Array.isArray(this.config.speedtest_history)
            ? [...this.config.speedtest_history, { ts: Date.now(), download: results.download, upload: results.upload }]
            : [{ ts: Date.now(), download: results.download, upload: results.upload }]
        while (history.length > HISTORY_MAX) history.shift()
        this.save({
            speedtest_last: {
                download: results.download,
                upload: results.upload,
                ping: results.ping,
                demo: this.demo,
                ts: Date.now()
            },
            speedtest_history: history
        })
        this.renderHistory()

        if (this.demo) {
            this.setStatus("Demo mode — network test blocked", true)
        } else {
            this.setStatus("Test complete")
        }

        this.content.classList.remove("is-running")
        this.running = false
        this.runBtn.disabled = false
        this.runBtn.innerText = "Test again"
    }
}
