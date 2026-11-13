import { Widget } from '../Widget.js'

/* Accepts bare hosts ("google.com"), full URLs and internal paths.
   A value without a scheme would resolve relative to the dashboard
   (/dashboard/google.com), so bare hosts get https:// prefixed. */
function normalizeUrl(raw) {
    const value = (raw || "").trim()
    if (!value) return ""

    // protocol-relative URLs ("//host/path") need a scheme, not a path
    if (value.startsWith("//")) return `https:${value}`
    // internal paths / anchors / query strings stay relative
    if (/^[/#?]/.test(value)) return value
    // explicit schemes (http, https, ftp, ...) are used as typed; mailto
    // and friends have no // but are still valid absolute URLs
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
    if (/^(mailto|tel|sms|geo|magnet):/i.test(value)) return value

    return `https://${value}`
}

function hostOf(raw) {
    try {
        return new URL(raw).hostname
    } catch {
        return (raw || "").replace(/^https?:\/\//, "").split("/")[0] || "link"
    }
}

function defaultName(url) {
    return hostOf(url).replace(/^www\./, "")
}

function faviconUrl(url) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`
}

function hashString(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

/* Letter chip shown while the favicon loads or when it can't be fetched */
function fallbackIcon(url) {
    const name = defaultName(url) || "?"
    const el = document.createElement("span")
    el.className = "link-widget-icon link-widget-icon--fallback"
    const hue = hashString(name.toLowerCase()) % 360
    el.style.background = `linear-gradient(135deg, hsl(${hue} 62% 40%) 0%, hsl(${(hue + 42) % 360} 68% 22%) 100%)`
    el.textContent = name.charAt(0).toUpperCase()
    return el
}

/* Generic link opener: icon comes from the site's favicon, the name
   falls back to the hostname when no title is set. */
export class LinkWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.url = normalizeUrl(config.settings?.url)
        this.customTitle = (config.settings?.title || "").trim()

        // widgets created before this setting existed always opened in a new
        // tab; expose that as the actual value so the toggle reflects it
        const settings = config.settings || (config.settings = {})
        if (settings.open_new_tab === undefined) {
            settings.open_new_tab = config.open_new_tab !== false
        }
        this.openNewTab = settings.open_new_tab !== false
    }

    build() {
        this.buildShell()
        this.content.classList.add("link-widget")

        // no url configured yet - render a quiet placeholder instead of a
        // dead <a href=""> that just reloads the dashboard
        if (!this.url.trim()) {
            const empty = document.createElement("span")
            empty.className = "link-widget-empty"
            empty.innerText = "No URL set — right-click to edit"
            this.content.appendChild(empty)
            return
        }

        const inner = document.createElement("a")
        inner.className = "link-widget-link"
        inner.href = this.url
        inner.target = this.openNewTab ? "_blank" : "_self"
        if (this.openNewTab) inner.rel = "noopener noreferrer"

        const icon = document.createElement("span")
        icon.className = "link-widget-icon"

        const img = document.createElement("img")
        img.className = "link-widget-favicon"
        img.src = faviconUrl(this.url)
        img.alt = ""
        img.loading = "lazy"
        img.addEventListener("error", () => img.replaceWith(fallbackIcon(this.url)))
        icon.appendChild(img)

        const text = document.createElement("div")
        text.className = "link-widget-text"

        const name = document.createElement("h3")
        name.className = "link-widget-name"
        name.innerText = this.customTitle || defaultName(this.url)

        const host = document.createElement("span")
        host.className = "link-widget-host"
        host.innerText = hostOf(this.url)

        text.append(name, host)

        const hint = document.createElement("span")
        hint.className = "link-widget-hint"
        hint.innerText = "Open ↗"

        inner.append(icon, text, hint)
        this.content.appendChild(inner)
    }
}