import { Widget } from '../Widget.js'
import { NEWS_SOURCES, NEWS_PRESETS } from '../widget_default.js'

/* All sources are fetched client-side and verified to send open CORS
   headers (no keys, no proxy):
   - srf         Tagesschau/SRF RSS 2.0 (Swiss)
   - tagesschau  Tagesschau RSS 2.0 (German national)
   - dw          Deutsche Welle RDF 1.0 (DE/world)
   - heise       heise RSS (tech)
   - devto       DEV Community JSON API (dev community) */
const SOURCES = {
    srf: {
        label: "SRF News",
        type: "rss",
        url: "https://www.srf.ch/news/bnf/rss/1646",
    },
    tagesschau: {
        label: "Tagesschau",
        type: "rss",
        url: "https://www.tagesschau.de/index~rss2.xml",
    },
    dw: {
        label: "DW",
        type: "rss",
        url: "https://rss.dw.com/rdf/rss-de-all",
    },
    heise: {
        label: "heise online",
        type: "rss",
        url: "https://www.heise.de/rss/heise.rdf",
    },
    devto: {
        label: "DEV Community",
        type: "json",
        url: "https://dev.to/api/articles?per_page=100",
    },
}

/* shown only while the network fetch fails */
const FALLBACK_NEWS = [
    { title: "News widget is offline right now", link: "", author: "", source: "Demo", description: "The configured feed could not be reached and no cached headlines are available. Try the refresh button once you are back online.", time: Date.now() / 1000 },
    { title: "Cached headlines keep working offline", link: "", author: "", source: "Demo", description: "Headlines are persisted after every successful load, so the widget usually shows the last result even without a connection.", time: Date.now() / 1000 - 3600 },
]

/* hero preset rotation: how long one cover stays up (paused while hovered) */
const HERO_INTERVAL_MS = 7000

function parseItemTime(raw) {
    const d = raw ? new Date(raw) : null
    return d && !isNaN(d.getTime()) ? d.getTime() / 1000 : 0
}

/* RSS descriptions embed escaped HTML - SRF e.g. starts with
   <img src="..." ...>. Parse it in a detached document and pull out the
   first image plus the clean text. Only real http(s) URLs survive */
function extractImageAndText(raw) {
    if (!raw) return { image: "", snippet: "" }
    const doc = new DOMParser().parseFromString(raw, "text/html")
    let image = ""
    const img = doc.querySelector("img")
    if (img) {
        const src = img.getAttribute("src") || ""
        if (src.startsWith("https://") || src.startsWith("http://")) image = src
    }
    const snippet = (doc.body.textContent || "").replace(/\s+/g, " ").trim()
    return { image, snippet }
}

function feedItem(docItem, sourceLabel) {
    const get = tag => {
        const el = docItem.getElementsByTagName(tag)[0]
        return el ? el.textContent.trim() : ""
    }
    const { image: imgFromHtml, snippet } = extractImageAndText(get("description") || get("summary"))

    // some feeds instead put the picture in an <enclosure>
    let image = imgFromHtml
    if (!image) {
        const enc = docItem.getElementsByTagName("enclosure")[0]
        const encUrl = enc ? enc.getAttribute("url") || "" : ""
        const encType = enc ? enc.getAttribute("type") || "" : ""
        if (encType.startsWith("image") && (encUrl.startsWith("https://") || encUrl.startsWith("http://"))) {
            image = encUrl
        }
    }

    return {
        title: get("title"),
        link: get("link"),
        description: snippet,
        image,
        author: get("dc:creator") || get("author"),
        source: sourceLabel,
        time: parseItemTime(get("pubDate")),
    }
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

        // the setting is a free-text limit plus a source dropdown - clamp
        // the limit to sane bounds
        this.limit = Math.min(30, Math.max(3, parseInt(config.settings?.limit, 10) || 8))
        this.sourceKey = NEWS_SOURCES.includes(config.settings?.source) ? config.settings.source : NEWS_SOURCES[0]
        this.source = SOURCES[this.sourceKey]
        // the settings modal writes keys that old widget configs don't have
        // in their settings object to the config ROOT (see Widget._set) - so
        // read preset like style is read: settings first, legacy root second
        const presetRaw = config.settings?.preset ?? config.preset
        this.preset = NEWS_PRESETS.includes(presetRaw) ? presetRaw : NEWS_PRESETS[0]
        this.demo = false

        this.listEl = null
        this.statusEl = null
        this.refreshBtn = null
        this.titleEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("news-widget")
        // drives every visual option (images, borders, font scale, meta
        // layout) - see the [data-news-preset="…"] rules in widgets.css
        this.content.dataset.newsPreset = this.preset

        const head = document.createElement("div")
        head.className = "news-head"

        this.titleEl = document.createElement("span")
        this.titleEl.className = "news-title"
        this.titleEl.innerText = this.source.label

        this.refreshBtn = document.createElement("button")
        this.refreshBtn.className = "btn btn-ghost btn-sm"
        this.refreshBtn.innerText = "↻"
        this.refreshBtn.title = "Refresh headlines"
        this.refreshBtn.addEventListener("click", () => this.load())

        head.append(this.titleEl, this.refreshBtn)
        this.content.appendChild(head)

        this.statusEl = document.createElement("span")
        this.statusEl.className = "news-status"
        this.content.appendChild(this.statusEl)

        this.listEl = document.createElement("ol")
        this.listEl.className = "news-list"
        this.content.appendChild(this.listEl)

        // render the last good headlines instantly (persisted on every
        // successful load) instead of an empty list while fetching - only
        // if the cache belongs to the currently selected source
        const cached = this.config.news_data
        if (cached && cached.source === this.sourceKey && Array.isArray(cached.items) && cached.items.length) {
            this.demo = false
            this.render(cached.items)
            this.statusEl.innerText = "Cached headlines — updating…"
        }

        this.load()
    }

    /* ---------- fetching + parsing ---------- */

    async load() {
        this.statusEl.innerText = `Loading headlines from ${this.source.label}…`
        this.refreshBtn.disabled = true

        try {
            const items = this.source.type === "json"
                ? await this.loadJsonFeed()
                : await this.loadRssFeed()

            if (items.length === 0) throw new Error("no stories")

            this.demo = false
            this.render(items.slice(0, this.limit))
            // persist for instant render on the next dashboard load
            this.save({ news_data: { source: this.sourceKey, items: items.slice(0, this.limit) } })
            this.statusEl.innerText = `Headlines from ${this.source.label}`
        } catch (err) {
            console.warn("NewsWidget: feed fetch failed", err)
            this.demo = true
            this.render(FALLBACK_NEWS)
            this.statusEl.innerText = `Offline — demo headlines`
        } finally {
            this.refreshBtn.disabled = false
        }
    }

    async loadRssFeed() {
        const res = await fetch(this.source.url, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const text = await res.text()
        const doc = new DOMParser().parseFromString(text, "text/xml")

        if (doc.querySelector("parsererror")) throw new Error("XML parse error")

        return Array.from(doc.getElementsByTagName("item"))
            .map(el => feedItem(el, this.source.label))
            .filter(it => it.title && it.link)
    }

    async loadJsonFeed() {
        const res = await fetch(this.source.url, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        return data.map(a => ({
            title: a.title,
            link: a.url || "",
            description: a.description || "",
            image: (a.cover_image && a.cover_image.startsWith("http")) ? a.cover_image
                : (a.social_image && a.social_image.startsWith("http")) ? a.social_image : "",
            author: (a.user && a.user.name) ? a.user.name.split(" ")[0] : "",
            source: this.source.label,
            time: Date.parse(a.published_at) / 1000 || 0,
        })).filter(it => it.title)
    }

    /* ---------- rendering ---------- */

    /* what the active preset shows; the pixels are all in widgets.css */
    presetAllows() {
        return {
            images: this.preset !== "compact" && this.preset !== "ticker",
            // magazine tiles + hero cover paint the image under the text
            fill: this.preset === "magazine" || this.preset === "hero",
            rank: this.preset === "classic" || this.preset === "compact",
            snippet: this.preset === "classic" || this.preset === "cards" || this.preset === "reader",
            timeOnly: this.preset === "ticker",
        }
    }

    render(items) {
        this.listEl.innerHTML = ""
        this.titleEl.innerText = this.demo ? `${this.source.label} (demo)` : this.source.label

        if (this.preset === "hero") {
            this.renderHero(items)
            return
        }

        const allow = this.presetAllows()
        // magazine photo tiles have no body wrapper - the image fills the
        // tile and the story text sits on top of it; every other preset
        // keeps the rank/body side-by-side flow
        const tile = this.preset === "magazine"

        items.forEach((item, index) => {
            const li = document.createElement("li")
            li.className = "news-item"

            const host = tile ? li : document.createElement("div")
            if (!tile) host.className = "news-body"

            // optional image straight from the feed - never present in
            // presets that hide pictures, never innerHTML-injected
            const imgUrl = allow.images ? (item.image || "") : ""
            if (imgUrl) {
                const image = document.createElement("img")
                image.className = allow.fill ? "news-image news-image--fill" : "news-image news-image--side"
                image.loading = "lazy"
                image.referrerPolicy = "no-referrer"
                image.alt = ""
                image.src = imgUrl
                host.appendChild(image)
            }

            // rank number, only where the preset wants one
            if (allow.rank) {
                const rank = document.createElement("span")
                rank.className = "news-rank"
                rank.innerText = String(index + 1)
                li.appendChild(rank)
            }

            const text = document.createElement("div")
            text.className = "news-text"

            const link = document.createElement("a")
            link.className = "news-link"
            link.href = item.link || "#"
            link.target = "_blank"
            link.rel = "noopener noreferrer"
            link.innerText = item.title

            text.appendChild(link)

            // teaser/first sentence under the headline - pure text, never
            // markup from the feed
            if (allow.snippet && item.description) {
                const snippet = document.createElement("p")
                snippet.className = "news-snippet"
                snippet.innerText = item.description
                text.appendChild(snippet)
            }

            // metadata line: source chip + author/time details, clearly
            // styled apart from the news text
            const meta = document.createElement("span")
            meta.className = "news-meta"
            const chip = document.createElement("span")
            chip.className = "news-chip"
            chip.innerText = item.source || this.source.label
            const detail = document.createElement("span")
            detail.className = "news-detail"
            const bits = []
            if (!allow.timeOnly) {
                if (item.author) bits.push(item.author)
            }
            if (item.time) bits.push(timeAgo(item.time))
            detail.innerText = bits.join(" · ")
            meta.append(chip, detail)

            text.appendChild(meta)
            host.appendChild(text)
            if (!tile) li.appendChild(host)
            this.listEl.appendChild(li)
        })
    }

    /* ------------- hero: one big rotating cover at a time ------------- */

    renderHero(items) {
        // rotate through the items that actually have a picture; without
        // any, show plain headline covers (still readable over the scrim)
        const withImages = items.filter(it => it.image)
        this.heroItems = withImages.length ? withImages : items
        if (!this.heroItems.length) return
        this.heroIndex = 0
        this.renderHeroSlide()
        this.startCycle()
    }

    renderHeroSlide() {
        const item = this.heroItems[this.heroIndex]
        if (!item) return
        this.listEl.innerHTML = ""

        const slide = document.createElement("article")
        slide.className = "news-hero"

        if (item.image) {
            const image = document.createElement("img")
            image.className = "news-image news-image--fill"
            image.referrerPolicy = "no-referrer"
            image.alt = ""
            image.src = item.image
            slide.appendChild(image)
        }

        const count = document.createElement("span")
        count.className = "news-hero-count"
        count.innerText = `${this.heroIndex + 1}/${this.heroItems.length}`
        slide.appendChild(count)

        // manual cycling only makes sense with something to cycle through
        if (this.heroItems.length > 1) {
            const prev = document.createElement("button")
            prev.type = "button"
            prev.className = "news-hero-btn news-hero-btn--prev"
            prev.title = "Previous headline"
            prev.innerText = "‹"
            prev.addEventListener("click", () => this.prevHero())

            const next = document.createElement("button")
            next.type = "button"
            next.className = "news-hero-btn news-hero-btn--next"
            next.title = "Next headline"
            next.innerText = "›"
            next.addEventListener("click", () => this.nextHero())

            slide.append(prev, next)
        }

        slide.appendChild(this.buildStoryText(item))

        // hover pauses the rotation
        slide.addEventListener("mouseenter", () => this.stopCycle())
        slide.addEventListener("mouseleave", () => this.startCycle())

        this.listEl.appendChild(slide)
    }

    /* headline + meta block, shared by the item loop and the hero slide */
    buildStoryText(item) {
        const text = document.createElement("div")
        text.className = "news-text"

        const link = document.createElement("a")
        link.className = "news-link"
        link.href = item.link || "#"
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.innerText = item.title
        text.appendChild(link)

        const meta = document.createElement("span")
        meta.className = "news-meta"
        const chip = document.createElement("span")
        chip.className = "news-chip"
        chip.innerText = item.source || this.source.label
        const detail = document.createElement("span")
        detail.className = "news-detail"
        const bits = []
        if (item.author) bits.push(item.author)
        if (item.time) bits.push(timeAgo(item.time))
        detail.innerText = bits.join(" · ")
        meta.append(chip, detail)
        text.appendChild(meta)

        return text
    }

    startCycle() {
        this.stopCycle()
        if (this.heroItems.length < 2) return
        this._cycleTimer = window.setInterval(() => this.advanceHero(), HERO_INTERVAL_MS)
    }

    advanceHero() {
        this.heroIndex = (this.heroIndex + 1) % this.heroItems.length
        this.renderHeroSlide()
    }

    /* manual cycling from the arrow buttons - a click also restarts the
       auto-rotation countdown so the next auto advance feels natural */
    nextHero() {
        this.stopCycle()
        this.heroIndex = (this.heroIndex + 1) % this.heroItems.length
        this.renderHeroSlide()
        this.startCycle()
    }

    prevHero() {
        this.stopCycle()
        this.heroIndex = (this.heroIndex - 1 + this.heroItems.length) % this.heroItems.length
        this.renderHeroSlide()
        this.startCycle()
    }

    stopCycle() {
        if (this._cycleTimer) {
            window.clearInterval(this._cycleTimer)
            this._cycleTimer = null
        }
    }

    /* base-class cleanup hook - kill the rotation timer */
    dispose() {
        this.stopCycle()
    }
}
