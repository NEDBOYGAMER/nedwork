// ---------------------------------------------------------------------------
// dashboard.js
// Orchestrates the dashboard: loads the dashboard data, creates the
// GridManager and one widget instance per entry, persists every change.
// Also owns the "add widget" modal (Apps / Standard / Other).
// ---------------------------------------------------------------------------

import { WIDGET_DEFAULTS } from "./widget_default.js";
import { createWidget } from "./widget_registry.js";
import { GridManager, DEFAULT_W, DEFAULT_H, uid } from "./grid.js";

let user = ""
let widgets = []          // live array of widget configs (persisted as-is)
let dashboard_name = ""
let current_dashboard = localStorage.getItem("current_dashboard") || "null"
let manager = null
let instances = []
let savePending = false

const gridEl = () => document.getElementById("card-grid")

document.addEventListener('DOMContentLoaded', () => {
    adjust_headers();
    adjust_grid();
    setup_modal();
    fill_dashboard(current_dashboard)
    setup_dashboard_switcher()
});

async function adjust_headers() {
    try {
        const response = await fetch('/auth/api/who');
        const info = await response.json();
        user = info.user || ""
    } catch (err) {
        console.warn("could not resolve user", err)
    }

    localStorage.setItem("username", user);
    const welcome = document.getElementById("dash-greeting")
    welcome.textContent = user ? `Welcome ${user}` : "Welcome"
}

function adjust_grid() {
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest(".widget")) e.preventDefault()
    })
}

/* ==========================================================================
   Load / render
   ========================================================================== */

async function fill_dashboard(name = current_dashboard) {
    close_popups()

    const dashboardsResponse = await fetch('/dashboard/api/list/owned');
    const data = await dashboardsResponse.json();
    const dashboards = data.dashboards || []

    if (name === "null" || !dashboards.includes(name)) {
        name = dashboards[0]
    }

    current_dashboard = name
    localStorage.setItem("current_dashboard", current_dashboard)

    const response = await fetch(`/dashboard/api/load/${name}`);
    const dashboard = await response.json();
    widgets = (dashboard.widgets || []).map(normalizeWidget)

    dashboard_name = dashboard.name
    localStorage.setItem("dashboard_name", dashboard_name)

    const dashname = document.getElementById("dash-name")
    dashname.textContent = "Dashboard: " + dashboard_name

    // tear down old instances + grid
    instances.forEach(inst => inst.dispose?.())
    instances = []
    gridEl().innerHTML = ""

    manager = new GridManager(gridEl(), { onLayoutChange: () => persist() })

    const ctx = {
        grid: gridEl(),
        manager,
        onSave: persist,
        onDelete: deleteWidget,
        editName: openSettingsFor,
        dashboard: () => dashboard_name,
    }

    widgets.forEach(widget => {
        const instance = createWidget(widget, ctx)
        if (instance) instances.push(instance)
    })
}

function persist() {
    savePending = true
    clearTimeout(persist._t)
    // snapshot name + widgets at schedule time so a dashboard switch during
    // the debounce window can never persist to the wrong dashboard
    const name = dashboard_name
    const snapshot = widgets.map(w => ({ ...w }))
    persist._t = setTimeout(async () => {
        try {
            await fetch('/dashboard/api/update/update_widget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, widgets: snapshot })
            })
        } catch (err) {
            console.error("Failed to save dashboard", err)
        } finally {
            savePending = false
        }
    }, 250)
}

async function deleteWidget(id) {
    widgets = widgets.filter(w => w.id !== id)
    await persistImmediate()
    fill_dashboard(current_dashboard)
}

async function persistImmediate() {
    await fetch('/dashboard/api/update/update_widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dashboard_name, widgets })
    })
}

/* ==========================================================================
   Add-widget modal
   ========================================================================== */

const STANDARD_WIDGETS = [
    { type: "time",          name: "Time",           icon: "🕐", desc: "Live clock, weekday and date" },
    { type: "weather",       name: "Weather",        icon: "⛅", desc: "Current conditions for any place" },
    { type: "calendar",      name: "Calendar",       icon: "📅", desc: "Month view with event dots" },
    { type: "timer",         name: "Timer",          icon: "⏱️", desc: "Countdown timer with ring" },
    { type: "quote",         name: "Quote",          icon: "💬", desc: "A fresh quote every day" },
    { type: "notes",         name: "Notes",          icon: "📝", desc: "Markdown scratchpad with preview" },
    { type: "welcome",       name: "Welcome",        icon: "👋", desc: "Time-of-day greeting with your name" },
    { type: "task",          name: "Tasks",          icon: "✅", desc: "Check off tasks with a progress bar" },
    { type: "event_manager", name: "Event Manager",  icon: "🗓️", desc: "Today + upcoming events" },
    { type: "finance",       name: "Finance Tracker",icon: "💰", desc: "Budgets, balance and transactions" },
    { type: "notifications", name: "Notifications",  icon: "🔔", desc: "Activity feed with mark-as-read" },
    { type: "news",          name: "News",           icon: "📰", desc: "Top headlines from Hacker News" },
]

const UTILITY_WIDGETS = [
    { type: "link",       name: "Link",    icon: "🔗", desc: "Open any site — icon from its favicon" },
    { type: "speedtest",  name: "Speedtest", icon: "📶", desc: "Measure ping & download speed" },
]

function setup_modal() {
    const modal = document.getElementById("modal-menu");
    const openBtn = document.getElementById("add-widget-btn");
    const closeBtn = document.getElementById("closeMenuBtn");

    openBtn.addEventListener("click", () => {
        buildWidgetPicker()
        modal.classList.add("open")
    });

    closeBtn.addEventListener("click", () => modal.classList.remove("open"));

    window.addEventListener("click", (event) => {
        if (event.target === modal) modal.classList.remove("open")
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") modal.classList.remove("open")
    });
}

async function buildWidgetPicker() {
    const container = document.getElementById("add-widget-categories")
    const search = document.getElementById("picker-search")
    if (!container) return

    if (search) {
        search.value = ""
        search.oninput = () => applyPickerFilter(search.value)
    }
    container.innerHTML = ""

    const apps = await loadApps()

    container.appendChild(buildCategorySection("Standard Widgets", STANDARD_WIDGETS.map(makeWidgetEntry)))
    container.appendChild(buildCategorySection("Utilities", UTILITY_WIDGETS.map(makeWidgetEntry)))
    container.appendChild(buildCategorySection("Apps", apps.map(makeAppEntry)))
}

function makeAppEntry(app) {
    return {
        title: app.name,
        desc: app.description || "",
        icon: appIconEl(app),
        added: widgets.some(w => w.type === "app" && String(w.app?.id) === String(app.id)),
        click: () => addAppWidget(app),
    }
}

function makeWidgetEntry(widget) {
    return {
        title: widget.name,
        desc: widget.desc,
        icon: widget.icon,
        added: widgets.some(w => w.type === widget.type),
        click: () => addWidget(widget.type),
    }
}

function buildCategorySection(title, entries) {
    const section = document.createElement("div")
    section.className = "picker-category"

    const heading = document.createElement("h4")
    heading.className = "picker-category-title"
    heading.innerText = title
    section.appendChild(heading)

    const grid = document.createElement("div")
    grid.className = "picker-grid"
    section.appendChild(grid)

    entries.forEach(entry => grid.appendChild(buildPickerCard(entry)))
    return section
}

function buildPickerCard(entry) {
    const card = document.createElement("button")
    card.type = "button"
    card.className = "picker-card"
    if (entry.added) card.classList.add("added")
    card.dataset.search = `${entry.title} ${entry.desc}`.toLowerCase()

    if (entry.icon) {
        const icon = typeof entry.icon === "string"
            ? (() => { const s = document.createElement("span"); s.className = "picker-card-icon"; s.textContent = entry.icon; return s })()
            : entry.icon
        card.appendChild(icon)
    }

    const text = document.createElement("span")
    text.className = "picker-card-text"

    const name = document.createElement("strong")
    name.innerText = entry.title

    const desc = document.createElement("small")
    desc.innerText = entry.desc

    text.append(name, desc)
    card.appendChild(text)

    if (entry.added) {
        const badge = document.createElement("span")
        badge.className = "picker-added"
        badge.innerText = "Added"
        card.appendChild(badge)
    }

    card.addEventListener("click", () => {
        entry.click()
        close_popups()
    })

    return card
}

function applyPickerFilter(query) {
    const container = document.getElementById("add-widget-categories")
    if (!container) return

    const q = (query || "").trim().toLowerCase()

    container.querySelectorAll(".picker-category").forEach(section => {
        let visible = false
        section.querySelectorAll(".picker-card").forEach(card => {
            const match = !q || (card.dataset.search || "").includes(q)
            card.style.display = match ? "" : "none"
            if (match) visible = true
        })
        section.style.display = visible ? "" : "none"
    })
}

function hashString(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

/* Small capsule preview for app cards - same look as the app widget art */
function appIconEl(app) {
    const el = document.createElement("span")
    el.className = "picker-card-icon picker-card-icon-app"

    const fallback = () => {
        const hue = hashString((app.name || "?").trim().toLowerCase()) % 360
        el.style.background = `linear-gradient(135deg, hsl(${hue} 62% 40%) 0%, hsl(${(hue + 42) % 360} 68% 22%) 100%)`
        el.style.color = "#ffffff"
        el.textContent = (app.name || "?").trim().charAt(0).toUpperCase() || "?"
    }

    if (app.image) {
        const img = document.createElement("img")
        img.className = "picker-card-img"
        img.src = (window.STATIC_URL || "/static/") + "img/apps" + app.image
        img.alt = ""
        img.addEventListener("error", fallback)
        el.appendChild(img)
    } else {
        fallback()
    }

    return el
}

let appsCache = null

async function loadApps() {
    if (appsCache) return appsCache
    try {
        const response = await fetch('/dashboard/api/apps')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        appsCache = await response.json()
        return Array.isArray(appsCache) ? appsCache : []
    } catch (err) {
        console.error("Failed to load apps:", err)
        return []
    }
}

function addWidget(type) {
    const base = WIDGET_DEFAULTS[type]
    if (!base) {
        console.error("Unknown widget:", type)
        return
    }

    const slot = manager ? manager.nextSlot(DEFAULT_W, DEFAULT_H) : { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H }

    widgets.push({
        ...structuredClone(base),
        id: uid(),
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
    })

    persistImmediate().then(() => fill_dashboard(current_dashboard))
}

/* App widgets are locked to a fixed 1x1 tile (matching TierForge) - they
   can be moved but never resized. This also migrates any existing app
   widget (e.g. Colors at 2x2) up front. */
function normalizeWidget(widget) {
    // old "todo" type was renamed to "task"
    if (widget.type === "todo") {
        widget.type = "task"
        if (widget.settings?.title === "Todo") widget.settings.title = "Tasks"
    }

    // old "nextcloud" type became the generic "link" widget - the name
    // falls back to the hostname when the title is empty
    if (widget.type === "nextcloud") {
        widget.type = "link"
        if (widget.settings?.title === "Nextcloud") widget.settings.title = ""
    }

    if (widget.type === "app") {
        widget.w = 1
        widget.h = 1
        widget.locked = true
        widget.x = Math.min(widget.x ?? 0, 11)
        widget.y = Math.max(widget.y ?? 0, 0)
    }
    return widget
}

function addAppWidget(app) {
    const slot = manager ? manager.nextSlot(1, 1) : { x: 0, y: 0, w: 1, h: 1 }

    widgets.push({
        type: "app",
        id: uid(),
        app: {
            id: app.id,
            name: app.name,
            image: app.image || "",
            url: app.url || "/placeholder",
            description: app.description || "",
            type: app.type || "App",
        },
        settings: { title: app.name },
        style: "tech",
        locked: true,
        x: slot.x,
        y: slot.y,
        w: 1,
        h: 1,
    })

    persistImmediate().then(() => fill_dashboard(current_dashboard))
}

/* ==========================================================================
   Edit settings (delegated to the widget's schema-driven modal)
   ========================================================================== */

function openSettingsFor(config) {
    const instance = instances.find(i => i.id === config.id)
    if (instance) instance.setUpSettings()
}

/* ==========================================================================
   Dashboard switcher
   ========================================================================== */

function setup_dashboard_switcher() {
    const dashNameEl = document.getElementById("dash-name")
    dashNameEl.classList.add("dash-name-clickable")

    dashNameEl.addEventListener("click", (event) => {
        event.stopPropagation()

        const existing = document.getElementById("dashboard-switcher")
        if (existing) {
            existing.remove()
            return
        }

        open_dashboard_switcher(dashNameEl)
    })

    document.addEventListener("click", () => {
        document.getElementById("dashboard-switcher")?.remove()
    })
}

async function open_dashboard_switcher(anchor) {
    const response = await fetch('/dashboard/api/list/owned');
    const data = await response.json();
    const dashboards = data.dashboards || []

    const list = document.createElement("div")
    list.id = "dashboard-switcher"
    list.className = "dashboard-switcher"

    if (dashboards.length === 0) {
        const empty = document.createElement("span")
        empty.className = "dashboard-switcher-empty"
        empty.innerText = "No dashboards found"
        list.appendChild(empty)
    }

    dashboards.forEach(name => {
        const item = document.createElement("button")
        item.className = "nav-item dashboard-switcher-item"
        if (name === dashboard_name) item.classList.add("active")
        item.innerText = name

        item.addEventListener("click", (event) => {
            event.stopPropagation()
            list.remove()
            if (name !== dashboard_name) switch_dashboard(name)
        })

        list.appendChild(item)
    })

    const rect = anchor.getBoundingClientRect()
    list.style.top = `${rect.bottom + 8}px`
    list.style.left = `${rect.left}px`

    document.body.appendChild(list)
}

async function switch_dashboard(name) {
    localStorage.setItem("dashboard_name", name)
    localStorage.setItem("current_dashboard", name)
    await fill_dashboard(name)
}

function close_popups() {
    document.getElementById("modal-menu")?.classList.remove("open")
    document.getElementById("context-menu")?.remove()
}