// ---------------------------------------------------------------------------
// grid.js
// The dashboard grid engine. One 12-column grid, always visible, fills the
// whole dashboard area. Every widget sits on whole cells only:
//   - dragging moves the card by whole cells (grabbed point follows cursor)
//   - resizing snaps to whole cells (via the bottom-right handle)
//   - a ghost preview shows the exact footprint before the pointer is released
//   - nothing can be dropped/resized outside the visible grid
// ---------------------------------------------------------------------------

export const GRID_COLS = 12
export const ROW_H = 84          // px per cell row (matches --grid-row-h in grid.css)
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

export class GridManager {
    constructor(el, { onLayoutChange } = {}) {
        this.el = el
        this.onLayoutChange = onLayoutChange
        this.entries = new Map() // widget id -> { widget, card }
        this.ghost = null
        this.drag = null
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

    /* Normalize a widget to a legal cell rectangle */
    norm(widget) {
        return {
            x: clamp(Math.round(num(widget.x, 0)), 0, GRID_COLS - 1),
            y: clamp(Math.round(num(widget.y, 0)), 0, MAX_ROWS),
            w: clamp(Math.round(num(widget.w, DEFAULT_W)), MIN_W, GRID_COLS),
            h: clamp(Math.round(num(widget.h, DEFAULT_H)), MIN_H, MAX_ROWS),
        }
    }

    /* Place a card on its cells */
    apply(widget) {
        const e = this.entries.get(widget.id)
        if (!e) return
        const p = this.norm(widget)
        e.card.style.gridColumn = `${p.x + 1} / span ${p.w}`
        e.card.style.gridRow = `${p.y + 1} / span ${p.h}`
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
        const colW = (rect.width - gap * (GRID_COLS - 1)) / GRID_COLS
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
            col: clamp(col, 0, GRID_COLS - 1),
            row: clamp(row, 0, this.rowsVisible() - 1),
        }
    }

    /* First free row below all current widgets */
    nextSlot(w = DEFAULT_W, h = DEFAULT_H) {
        let bottom = 0
        this.entries.forEach(e => {
            const p = this.norm(e.widget)
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

    /* Nearest legal position: exact cell, then sideways, then rows below.
       y can never exceed the visible grid. */
    resolveDrop(id, x, y, w, h) {
        const maxY = Math.max(0, this.rowsVisible() - h)
        const px = clamp(x, 0, GRID_COLS - w)
        const py = clamp(y, 0, maxY)

        const ok = (cx, cy) => !this.collides(id, cx, cy, w, h)

        if (ok(px, py)) return { x: px, y: py }
        for (let d = 1; d < GRID_COLS; d++) {
            if (px - d >= 0 && ok(px - d, py)) return { x: px - d, y: py }
            if (px + d <= GRID_COLS - w && ok(px + d, py)) return { x: px + d, y: py }
        }
        for (let cy = py + 1; cy <= maxY; cy++) {
            if (ok(px, cy)) return { x: px, y: cy }
        }
        for (let cy = py - 1; cy >= 0; cy--) {
            if (ok(px, cy)) return { x: px, y: cy }
        }
        return { x: px, y: py }
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
    /* drag + resize                                                      */
    /* ------------------------------------------------------------------ */

    attach(widget, card, grip, resizeHandle) {
        this.add(widget, card)

        const move = (type, handle) => {
            handle.addEventListener("pointerdown", (event) => {
                event.stopPropagation()
                event.preventDefault()
                if (event.button !== 0) return

                const p = this.norm(widget)
                const { rect, colW, rowH, gap } = this.geom()
                const fx = (event.clientX - rect.left) / (colW + gap)
                const fy = (event.clientY - rect.top) / (rowH + gap)

                this.drag = {
                    type,
                    widget,
                    card,
                    start: p,
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

            let w = clamp(d.start.w + dw, MIN_W, GRID_COLS - d.start.x)
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
        Object.assign(d.widget, {
            x: p.x,
            y: p.y,
            w: p.w,
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

        Object.assign(d.widget, d.start)
        d.card.classList.remove("dragging", "resizing")
                document.body.classList.remove("is-dragging")
        this.hideGhost()
        this.apply(d.widget)
        this.drag = null
    }
}
