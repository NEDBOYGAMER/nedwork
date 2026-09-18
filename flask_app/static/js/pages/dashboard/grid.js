// ---------------------------------------------------------------------------
// grid.js
// The dashboard grid engine. A cell grid, always visible, fills the whole
// dashboard area. Every widget sits on whole cells only:
//   - dragging moves the card by whole cells (grabbed point follows cursor)
//   - resizing snaps to whole cells (via the bottom-right handle)
//   - a ghost preview shows the exact footprint before the pointer is released
//   - nothing can be dropped/resized outside the visible grid
//
// Responsive (mobile): the number of columns is decided by CSS
// (--grid-cols in mobile.css: 12 on desktop, 4 on phones). Layouts are
// always PERSISTED in the 12-column space and mapped onto the effective
// column count for display, so desktop layout data is never rewritten by
// mobile rendering.
// ---------------------------------------------------------------------------

export const GRID_COLS = 12          // base (persisted) column count
export const MOBILE_MQ = "(max-width: 768px)"
export const ROW_H = 84              // px per cell row fallback (matches --grid-row-h)
export const DEFAULT_W = 4
export const DEFAULT_H = 2
export const MIN_W = 1
export const MIN_H = 1
export const MAX_ROWS = 60

export function uid() {
    return crypto.randomUUID()
}

function num(v, fallback) {
    return Number.isFinite(v) ? v : fallback
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v))
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y
}

export class GridManager {
    constructor(el, { onLayoutChange } = {}) {
        this.el = el
        this.onLayoutChange = onLayoutChange
        this.entries = new Map() // widget id -> { widget, card }
        this.ghost = null
        this.drag = null
        this._cols = null        // cached effective column count
        this._freeRows = false   // true while settleLayout() resolves overlaps

        // Re-map every widget when the breakpoint flips (rotate, resize,
        // dev tools). Desktop <-> mobile mapping is derived from CSS only.
        this._onBreakpoint = () => {
            if (this.drag) this.onCancel()
            this._cols = null
            this.applyAll()
            this.settleLayout()
        }
        this._mql = window.matchMedia(MOBILE_MQ)
        if (this._mql.addEventListener) this._mql.addEventListener("change", this._onBreakpoint)
        else if (this._mql.addListener) this._mql.addListener(this._onBreakpoint)
    }

    destroy() {
        if (this._mql) {
            if (this._mql.removeEventListener) this._mql.removeEventListener("change", this._onBreakpoint)
            else if (this._mql.removeListener) this._mql.removeListener("change", this._onBreakpoint)
        }
        this.clear()
    }

    /* ------------------------------------------------------------------ */
    /* columns                                                            */
    /* ------------------------------------------------------------------ */

    /* Effective column count - whatever the CSS grid currently resolves
       to (12 on desktop, fewer on phones). Read from computed style so
       CSS alone drives the responsive behavior. */
    cols() {
        if (this._cols) return this._cols
        let n = GRID_COLS
        try {
            const raw = getComputedStyle(this.el).gridTemplateColumns
            if (raw && raw !== "none") {
                const count = raw.trim().split(/\s+/).length
                if (count > 0) n = count
            }
        } catch { /* keep GRID_COLS */ }
        this._cols = n
        return n
    }

    /* ------------------------------------------------------------------ */
    /* registration                                                       */
    /* ------------------------------------------------------------------ */

    add(widget, card) {
        this.entries.set(widget.id, { widget, card })
        this.apply(widget)
    }

    remove(id) {
        this.entries.delete(id)
    }

    clear() {
        this.entries.clear()
        this.hideGhost()
        this.drag = null
    }

    /* ------------------------------------------------------------------ */
    /* coordinate spaces                                                  */
    /* ------------------------------------------------------------------ */

    /* Persisted (12-column) rect - identical to the original norm(). */
    stored(widget) {
        return {
            x: clamp(Math.round(num(widget.x, 0)), 0, GRID_COLS - 1),
            y: clamp(Math.round(num(widget.y, 0)), 0, MAX_ROWS),
            w: clamp(Math.round(num(widget.w, DEFAULT_W)), MIN_W, GRID_COLS),
            h: clamp(Math.round(num(widget.h, DEFAULT_H)), MIN_H, MAX_ROWS),
        }
    }

    /* Display rect: the stored rect mapped onto the effective columns.
       Identity on desktop. y/h are row-based and never scaled. */
    norm(widget) {
        const s = this.stored(widget)
        const C = this.cols()
        if (C === GRID_COLS) return s
        const w = clamp(Math.round(s.w * C / GRID_COLS), MIN_W, C)
        return {
            x: clamp(Math.round(s.x * C / GRID_COLS), 0, C - w),
            y: s.y,
            w,
            h: s.h,
        }
    }

    /* Map display-space coordinates back to the persisted 12-column space */
    toStoredX(x) {
        return Math.round(x * GRID_COLS / this.cols())
    }

    toStoredW(w) {
        return Math.max(MIN_W, Math.round(w * GRID_COLS / this.cols()))
    }

    /* Tier of a widget cell rect: how much room it has to show info */
    tierOf(w, h) {
        const cells = w * h
        if (cells <= 2) return "small"     // 1x1, 1x2, 2x1 - minimal info
        if (cells > 8 || h >= 3) return "large"
        return "standard"
    }

    /* Place a card on its cells. Position uses display space; tier /
       orientation data attributes come from the persisted rect so a widget
       shows the same content it would on desktop. */
    apply(widget) {
        const e = this.entries.get(widget.id)
        if (!e) return
        const p = this.norm(widget)
        const s = this.stored(widget)
        e.card.style.gridColumn = `${p.x + 1} / span ${p.w}`
        e.card.style.gridRow = `${p.y + 1} / span ${p.h}`
        e.card.dataset.w = s.w
        e.card.dataset.h = s.h
        e.card.dataset.cells = s.w * s.h
        e.card.dataset.tier = this.tierOf(s.w, s.h)
        e.card.dataset.orientation = s.w > s.h ? "wide" : s.h > s.w ? "tall" : "square"
    }

    applyAll() {
        this.entries.forEach(e => this.apply(e.widget))
    }

    /* ------------------------------------------------------------------ */
    /* geometry                                                           */
    /* ------------------------------------------------------------------ */

    geom() {
        const rect = this.el.getBoundingClientRect()
        const cs = getComputedStyle(this.el)
        const gap = parseFloat(cs.columnGap) || 16
        const rowH = parseFloat(cs.gridAutoRows) || ROW_H
        const C = this.cols()
        const colW = (rect.width - gap * (C - 1)) / C
        return { rect, gap, rowH, colW }
    }

    /* Number of rows that fit in the visible grid area */
    rowsVisible() {
        const { rect, rowH, gap } = this.geom()
        if (!rect.height) return 12
        return Math.max(1, Math.floor((rect.height + gap) / (rowH + gap)))
    }

    /* Cell (col, row) under a screen position, clamped into the grid */
    cellAt(clientX, clientY) {
        const { rect, colW, rowH, gap } = this.geom()
        const col = Math.floor((clientX - rect.left) / (colW + gap))
        const row = Math.floor((clientY - rect.top) / (rowH + gap))
        return {
            col: clamp(col, 0, this.cols() - 1),
            row: clamp(row, 0, this.rowsVisible() - 1),
        }
    }

    /* First free row below all current widgets (persisted space) */
    nextSlot(w = DEFAULT_W, h = DEFAULT_H) {
        let bottom = 0
        this.entries.forEach(e => {
            const p = this.stored(e.widget)
            bottom = Math.max(bottom, p.y + p.h)
        })
        return { x: 0, y: bottom, w, h }
    }

    /* ------------------------------------------------------------------ */
    /* collisions                                                         */
    /* ------------------------------------------------------------------ */

    collides(id, x, y, w, h) {
        for (const [otherId, e] of this.entries) {
            if (otherId === id) continue
            const p = this.norm(e.widget)
            if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) {
                return true
            }
        }
        return false
    }

    /* Nearest legal position: exact cell, then sideways, then rows below
       or above. During settleLayout() rows are unbounded so the grid can
       grow beyond the initial viewport height. */
    resolveDrop(id, x, y, w, h) {
        const C = this.cols()
        const rowLimit = this._freeRows ? MAX_ROWS : this.rowsVisible()
        const maxY = Math.max(0, rowLimit - h)
        const px = clamp(x, 0, C - w)
        const py = clamp(y, 0, maxY)

        const ok = (cx, cy) => !this.collides(id, cx, cy, w, h)

        if (ok(px, py)) return { x: px, y: py }
        for (let d = 1; d < C; d++) {
            if (px - d >= 0 && ok(px - d, py)) return { x: px - d, y: py }
            if (px + d <= C - w && ok(px + d, py)) return { x: px + d, y: py }
        }
        for (let cy = py + 1; cy <= maxY; cy++) {
            if (ok(px, cy)) return { x: px, y: cy }
        }
        for (let cy = py - 1; cy >= 0; cy--) {
            if (ok(px, cy)) return { x: px, y: cy }
        }
        return { x: px, y: py }
    }

    /* Mobile-only: mapping 12 columns onto 4 can collide after rounding
       (two desktop columns can land on the same phone column). Walk the
       widgets in insertion order and push any overlap to the nearest free
       cell, exactly like a drop. In-memory only - nothing is persisted
       until the user actually drags/saves. No-op on desktop. */
    settleLayout() {
        if (this.cols() === GRID_COLS) return
        this._freeRows = true
        const settled = []
        this.entries.forEach((e, id) => {
            const p = this.norm(e.widget)
            const target = settled.some(q => rectsOverlap(p, q))
                ? this.resolveDrop(id, p.x, p.y, p.w, p.h)
                : p
            if (target.x !== p.x || target.y !== p.y || target.w !== p.w) {
                Object.assign(e.widget, {
                    x: this.toStoredX(target.x),
                    y: target.y,
                    w: this.toStoredW(target.w),
                })
            }
            this.apply(e.widget)
            settled.push(this.norm(e.widget))
        })
        this._freeRows = false
    }

    /* ------------------------------------------------------------------ */
    /* ghost preview                                                      */
    /* ------------------------------------------------------------------ */

    showGhost(x, y, w, h) {
        if (!this.ghost) {
            this.ghost = document.createElement("div")
            this.ghost.className = "grid-ghost"
            this.el.appendChild(this.ghost)
        }
        this.ghost.style.gridColumn = `${x + 1} / span ${w}`
        this.ghost.style.gridRow = `${y + 1} / span ${h}`
    }

    hideGhost() {
        this.ghost?.remove()
        this.ghost = null
    }

    /* ------------------------------------------------------------------ */
    /* drag + resize (pointer events cover mouse + touch; the handles have
       touch-action: none, so dragging a grip never scrolls the page)     */
    /* ------------------------------------------------------------------ */

    attach(widget, card, grip, resizeHandle) {
        this.add(widget, card)

        const move = (type, handle) => {
            handle.addEventListener("pointerdown", (event) => {
                event.stopPropagation()
                event.preventDefault()
                if (event.button !== 0) return

                const p = this.norm(widget)
                const startStored = this.stored(widget)
                const { rect, colW, rowH, gap } = this.geom()
                const fx = (event.clientX - rect.left) / (colW + gap)
                const fy = (event.clientY - rect.top) / (rowH + gap)

                this.drag = {
                    type,
                    widget,
                    card,
                    start: p,
                    startStored,
                    // whole-cell grab offset: keeps the grabbed point on the
                    // cursor while the card advances in whole-cell steps
                    grabCol: type === "move" ? fx - p.x : 0,
                    grabRow: type === "move" ? fy - p.y : 0,
                    pointerX: event.clientX,
                    pointerY: event.clientY,
                    pending: { ...p },
                }

                card.classList.add(type === "move" ? "dragging" : "resizing")
                document.body.classList.add("is-dragging")
                this.showGhost(p.x, p.y, p.w, p.h)

                handle.setPointerCapture(event.pointerId)
            })

            handle.addEventListener("pointermove", (event) => this.onMove(event))
            handle.addEventListener("pointerup", (event) => this.onUp(event))
            handle.addEventListener("pointercancel", (event) => this.onCancel())
        }

        if (grip) move("move", grip)
        if (resizeHandle) move("resize", resizeHandle)
    }

    onMove(event) {
        if (!this.drag) return
        event.preventDefault()

        const d = this.drag
        const { rect, colW, rowH, gap } = this.geom()
        const C = this.cols()

        if (d.type === "move") {
            const fx = (event.clientX - rect.left) / (colW + gap)
            const fy = (event.clientY - rect.top) / (rowH + gap)
            const x = Math.round(fx - d.grabCol)
            const y = Math.round(fy - d.grabRow)
            const target = this.resolveDrop(d.widget.id, x, y, d.start.w, d.start.h)
            d.pending = { ...target, w: d.start.w, h: d.start.h }
        } else {
            const dw = Math.round((event.clientX - d.pointerX) / (colW + gap))
            const dh = Math.round((event.clientY - d.pointerY) / (rowH + gap))

            let w = clamp(d.start.w + dw, MIN_W, C - d.start.x)
            let h = clamp(d.start.h + dh, MIN_H, this.rowsVisible() - d.start.y)

            // shrink back so the resize never overlaps a neighbor
            while (this.collides(d.widget.id, d.start.x, d.start.y, w, h) && (w > MIN_W || h > MIN_H)) {
                if (w > MIN_W) w--
                else h--
            }

            d.pending = { x: d.start.x, y: d.start.y, w, h }
        }

        const p = d.pending
        this.showGhost(p.x, p.y, p.w, p.h)
    }

    onUp() {
        const d = this.drag
        if (!d) return

        const p = d.pending
        // display space -> persisted 12-column space (identity on desktop)
        Object.assign(d.widget, {
            x: this.toStoredX(p.x),
            y: p.y,
            w: this.toStoredW(p.w),
            h: p.h,
        })

        d.card.classList.remove("dragging", "resizing")
        document.body.classList.remove("is-dragging")
        this.hideGhost()
        this.apply(d.widget)
        this.drag = null

        if (this.onLayoutChange) this.onLayoutChange(d.widget)
    }

    onCancel() {
        const d = this.drag
        if (!d) return

        Object.assign(d.widget, d.startStored)
        d.card.classList.remove("dragging", "resizing")
        document.body.classList.remove("is-dragging")
        this.hideGhost()
        this.apply(d.widget)
        this.drag = null
    }
}