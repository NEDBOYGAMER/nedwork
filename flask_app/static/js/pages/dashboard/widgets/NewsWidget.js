import { Widget } from '../Widget.js'

const HN_API = "https://hacker-news.firebaseio.com/v0"

const FALLBACK_NEWS = [
    { title: "HN is down for some users", url: "https://news.ycombinator.com", time: Date.now() / 1000 - 1200, source: "Demo" },
    { title: "Show HN: A tiny static site generator", url: "https://news.ycombinator.com", time: Date.now() / 1000 - 3600, source: "Demo" },
    { title: "Ask HN: What are you working on this week?", url: "https://news.ycombinator.com", time: Date.now() / 1000 - 7200, source: "Demo" },
]

function hnUrl(id) {
    return `https://news.ycombinator.com/item?id=${id}`
}

function timeAgo(ts) {
    const seconds = Math.round(Date.now() / 1000 - ts)
    if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
    return `${Math.round(seconds / 86400)}d ago`
}

export class NewsWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.limit = config.settings?.limit || 8
        this.demo = false

        this.listEl = null
        this.statusEl = null
        this.refreshBtn = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("news-widget")

        const head = document.createElement("div")
        head.className = "news-head"

        const title = document.createElement("span")
        title.className = "news-title"
        title.innerText = "Hacker News"

        this.refreshBtn = document.createElement("button")
        this.refreshBtn.className = "btn btn-ghost btn-sm"
        this.refreshBtn.innerText = "↻"
        this.refreshBtn.title = "Refresh headlines"
        this.refreshBtn.addEventListener("click", () => this.load())

        head.append(title, this.refreshBtn)
        this.content.appendChild(head)

        this.statusEl = document.createElement("span")
        this.statusEl.className = "news-status"
        this.content.appendChild(this.statusEl)

        this.listEl = document.createElement("ol")
        this.listEl.className = "news-list"
        this.content.appendChild(this.listEl)

        this.load()
    }

    async fetchTopIds() {
        const res = await fetch(`${HN_API}/topstories.json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
    }

    async fetchItem(id) {
        const res = await fetch(`${HN_API}/item/${id}.json`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
    }

    async load() {
        this.statusEl.innerText = "Loading headlines…"
        this.refreshBtn.disabled = true

        try {
            const ids = await this.fetchTopIds()
            const stories = await Promise.all(
                ids.slice(0, this.limit).map(id => this.fetchItem(id))
            )

            const items = stories
                .filter(s => s && s.type === "story" && s.title)
                .slice(0, this.limit)

            if (items.length === 0) throw new Error("no stories")

            this.demo = false
            this.render(items.map(s => ({
                title: s.title,
                url: s.url || hnUrl(s.id),
                source: s.url ? new URL(s.url).hostname.replace(/^www\./, "") : "HN",
                time: s.time,
                score: s.score || 0,
            })))
            this.statusEl.innerText = "Top headlines from Hacker News"
        } catch (err) {
            console.warn("NewsWidget: HN fetch failed, using demo headlines", err)
            this.demo = true
            this.render(FALLBACK_NEWS)
            this.statusEl.innerText = "Offline — demo headlines"
        } finally {
            this.refreshBtn.disabled = false
        }
    }

    render(items) {
        this.listEl.innerHTML = ""

        items.forEach((item, index) => {
            const li = document.createElement("li")
            li.className = "news-item"

            const rank = document.createElement("span")
            rank.className = "news-rank"
            rank.innerText = String(index + 1)

            const body = document.createElement("div")
            body.className = "news-body"

            const link = document.createElement("a")
            link.className = "news-link"
            link.href = item.url
            link.target = "_blank"
            link.rel = "noopener noreferrer"
            link.innerText = item.title

            const meta = document.createElement("span")
            meta.className = "news-meta"
            meta.innerText = `${timeAgo(item.time)} · ${item.source}${item.score ? ` · ${item.score} pts` : ""}`

            body.append(link, meta)
            li.append(rank, body)
            this.listEl.appendChild(li)
        })
    }
}