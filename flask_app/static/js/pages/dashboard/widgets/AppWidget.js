import { Widget } from '../Widget.js'

function hashString(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

function capsuleArt(name) {
    const h = hashString((name || '?').trim().toLowerCase())
    const hue = h % 360
    const hue2 = (hue + 42) % 360

    const art = document.createElement('div')
    art.className = 'app-widget-art app-widget-art--cap'
    art.style.background = `linear-gradient(135deg, hsl(${hue} 62% 40%) 0%, hsl(${hue2} 68% 22%) 100%)`
    art.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?'
    return art
}

function buildArt(app, fallback) {
    if (app.image) {
        const img = document.createElement('img')
        img.className = 'app-widget-art'
        img.src = (window.STATIC_URL || '/static/') + 'img/apps' + app.image
        img.alt = ''
        img.loading = 'lazy'
        img.addEventListener('error', () => img.replaceWith(fallback))
        return img
    }
    return fallback
}

/* Icon-only app tile. Full-bleed: the artwork fills (most of) the whole
   card - no title, no padding - and scales with the cell size, so a 2x2,
   3x3 or bigger tile gets a proportionally bigger icon. Clicking opens the
   app; /placeholder apps are "coming soon". Resizable in whole-cell steps
   like every other widget. */
export class AppWidget extends Widget {
    constructor(config, ctx) {
        config.fullBleed = true
        super(config, ctx)

        this.app = config.app || {}
        this.appUrl = this.app.url || ''
        this.interactive = Boolean(this.appUrl && this.appUrl !== '/placeholder')
    }

    build() {
        this.buildShell()
        this.card.classList.add(this.interactive ? 'card--app' : 'card--app-coming-soon')
        this.content.classList.add('app-widget')

        const fallback = capsuleArt(this.app.name || '?')
        const art = buildArt(this.app, fallback)
        this.content.appendChild(art)

        // scale the artwork with the tile: images fit into the whole tile
        // via CSS (max-width/max-height + object-fit), the capsule only
        // needs its letter sized to the tile
        this._ro = new ResizeObserver(() => {
            if (art.classList.contains("app-widget-art--cap")) {
                const s = Math.max(24, Math.round(this.card.clientWidth * 0.4))
                art.style.fontSize = `${s}px`
            }
        })
        this._ro.observe(this.card)

        this.card.title = this.app.name || 'App'

        if (this.interactive) {
            this.content.classList.add("app-widget--link")
            this.content.tabIndex = 0
            this.content.setAttribute("role", "link")
            this.content.setAttribute("aria-label", `Open ${this.app.name}`)
            this.content.addEventListener("click", () => this.open())
            this.content.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    this.open()
                }
            })
        } else {
            this.content.setAttribute("title", "Coming soon")
        }
    }

    dispose() {
        this._ro?.disconnect()
        this._ro = null
    }

    open() {
        window.location.href = "/apps" + this.appUrl
    }
}