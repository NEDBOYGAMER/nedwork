import { Widget } from '../Widget.js'

const PING_URL = "https://speed.cloudflare.com/__down?bytes=0"
const DOWNLOAD_URL = "https://speed.cloudflare.com/__down?bytes=20000000"
const PING_SAMPLES = 4

function fmtMbps(mbps) {
    if (!isFinite(mbps)) return "--"
    return mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1)
}

export class SpeedtestWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.demo = false
        this.running = false

        this.pingEl = null
        this.uploadEl = null
        this.downloadEl = null
        this.statusEl = null
        this.runBtn = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("speedtest-widget")

        const gauge = document.createElement("div")
        gauge.className = "speedtest-gauge"

        const valueWrap = document.createElement("div")
        valueWrap.className = "speedtest-gauge-value"

        this.downloadEl = document.createElement("span")
        this.downloadEl.className = "speedtest-value"
        this.downloadEl.innerText = "--"

        const unit = document.createElement("span")
        unit.className = "speedtest-unit"
        unit.innerText = "Mbps"

        valueWrap.append(this.downloadEl, unit)
        gauge.appendChild(valueWrap)
        this.content.appendChild(gauge)

        const stats = document.createElement("div")
        stats.className = "speedtest-stats"

        this.pingEl = this.buildStat("Ping", "– ms")
        this.uploadEl = this.buildStat("Server", "auto")
        stats.append(this.pingEl, this.uploadEl)
        this.content.appendChild(stats)

        this.statusEl = document.createElement("span")
        this.statusEl.className = "speedtest-status"
        this.statusEl.innerText = "Ready — press Run test"
        this.content.appendChild(this.statusEl)

        this.runBtn = document.createElement("button")
        this.runBtn.className = "btn btn-primary btn-sm"
        this.runBtn.innerText = "Run test"
        this.runBtn.addEventListener("click", () => this.run())
        this.content.appendChild(this.runBtn)
    }

    buildStat(label, value) {
        const wrap = document.createElement("div")
        wrap.className = "speedtest-stat"

        const name = document.createElement("span")
        name.className = "speedtest-stat-label"
        name.innerText = label

        const val = document.createElement("span")
        val.className = "speedtest-stat-value"
        val.innerText = value

        wrap.append(name, val)
        return wrap
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

    measureDownload() {
        return new Promise((resolve, reject) => {
            const start = performance.now()
            fetch(DOWNLOAD_URL, { cache: "no-store", mode: "cors" })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    return res.arrayBuffer()
                })
                .then(buffer => {
                    const seconds = (performance.now() - start) / 1000
                    resolve((buffer.byteLength * 8) / (seconds * 1e6))
                })
                .catch(reject)
        })
    }

    simulate() {
        this.demo = true
        const ping = 18 + Math.random() * 30
        const download = 40 + Math.random() * 160
        return new Promise(resolve => setTimeout(() => resolve({ ping, download }), 900))
    }

    async run() {
        if (this.running) return
        this.running = true
        this.runBtn.disabled = true
        this.setStatus("Measuring ping…")

        let results
        try {
            const ping = await this.measurePing()
            this.setStatus("Measuring download…")

            let download = null
            try {
                download = await this.measureDownload()
            } catch (err) {
                console.warn("SpeedtestWidget: download failed", err)
            }

            if (download === null) throw new Error("download failed")
            results = { ping, download }
        } catch (err) {
            console.warn("SpeedtestWidget: network test unavailable, using demo mode", err)
            results = await this.simulate()
        }

        this.pingEl.querySelector(".speedtest-stat-value").innerText = `${Math.round(results.ping)} ms`
        this.downloadEl.innerText = fmtMbps(results.download)

        if (this.demo) {
            this.setStatus("Demo mode — network test blocked", true)
            this.uploadEl.querySelector(".speedtest-stat-value").innerText = "sim"
        } else {
            this.setStatus("Test complete")
            this.uploadEl.querySelector(".speedtest-stat-value").innerText = "live"
        }

        this.running = false
        this.runBtn.disabled = false
        this.runBtn.innerText = "Test again"
    }
}