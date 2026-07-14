// widget.js
// Central orchestrator for all dashboard widgets.
//
// Each widget module now exports a class extending `Widget` (base_widget.js):
//   - `getDefinition()`: returns the shell config
//        { title, bodyHTML, showHeader, showStatusDot, dotId, extraCardClasses, contextMenuItems }
//   - `init(card)`: wires up behaviour on the already-built card. Per-instance
//        state (timers, DOM refs, cached settings) lives on `this`.
//
// widget.js owns the registry of widget types (type -> class) and the
// createWidget() factory: it instantiates the right class, builds the
// shared card shell from instance.getDefinition(), and calls instance.init(card).
//
// A widget can still react to the menu actions via the "widget:edit" and
// "widget:delete" custom events on the card element, e.g.:
//
//   card.addEventListener("widget:edit", () => { ... });
//   card.addEventListener("widget:delete", () => { clearInterval(this.id); });
//
// "widget:delete" fires *before* the card is removed from the DOM, so it's
// the right place to clear intervals/timeouts/listeners.

import { WeatherWidget } from './widgets/weather.js';
import { TimeWidget } from './widgets/time.js';
import { TimerWidget } from './widgets/timer.js';
import { NotesWidget } from './widgets/notes.js';

import { delete_widget } from './dashboard.js';

// type -> widget class. Add new widgets here.
const registry = {
    weather: WeatherWidget,
    time: TimeWidget,
    timer: TimerWidget,
    notes: NotesWidget,
};

let activeMenu = null;

/**
 * Build a widget end-to-end: look up widgetConfig.type in the registry,
 * instantiate that widget's class, build the card shell from
 * instance.getDefinition(), insert it into the grid, then call
 * instance.init(card) to wire up behaviour.
 *
 * widgetConfig matches the shape stored in the DB / WIDGET_DEFAULTS, e.g.:
 *   { type: "timer", id: "abc123", settings: { duration: 300, ... } }
 *   { type: "notes", id: "abc123", text: "...", settings: { ... } }
 *
 * The full widgetConfig (not just `settings`) is available to the instance
 * as `this.config`, so widgets can use `id`, `text`, or any other
 * top-level field alongside `settings`.
 *
 * @param {Object} widgetConfig
 * @param {string} widgetConfig.type - registry key, e.g. "weather", "timer"
 * @param {string} [widgetConfig.id] - persisted widget id, stored on the card as data-widget-id
 * @returns {HTMLElement|null} the created card element, or null if type is unrecognized
 */
export function createWidget(widgetConfig = {}) {
    const { type, id } = widgetConfig;

    const WidgetClass = registry[type];
    if (!WidgetClass) {
        console.error(`createWidget: unknown widget type "${type}"`, widgetConfig);
        return null;
    }

    const instance = new WidgetClass(widgetConfig);
    const definition = instance.getDefinition();

    const card = buildCardShell(type, definition);

    // Placeholder ids ("-") mean "not yet persisted" — don't tag the card with those.
    if (id && id !== "-") {
        card.dataset.widgetId = id;
    }

    // Keep the full config reachable from the card itself — the context
    // menu's default delete handler needs widgetConfig.id.
    card.widgetConfig = widgetConfig;
    instance.card = card;

    instance.init(card);

    return card;
}

/**
 * Build the shared card shell (optional header + status dot), append it to
 * the grid, and wire up the right-click context menu. Internal — widget
 * classes no longer build this directly, they just describe themselves via
 * getDefinition() and createWidget() does the building.
 */
function buildCardShell(type, definition = {}) {
    const {
        title = "",
        bodyHTML = "",
        showHeader = true,
        showStatusDot = true,
        dotId = null,
        extraCardClasses = [],
        contextMenuItems = null,
    } = definition;

    const grid = document.getElementById("card-grid");

    const card = document.createElement("div");
    card.classList.add("card", `${type}-widget`, ...extraCardClasses);
    card.dataset.widgetType = type;

    let headerHTML = "";
    if (showHeader) {
        headerHTML = `
        <div class="widget-header">
            <span class="widget-title">${title}</span>
            ${showStatusDot ? `<span class="status-dot"${dotId ? ` id="${dotId}"` : ""}></span>` : ""}
        </div>
        `;
    }

    card.innerHTML = headerHTML + bodyHTML;

    grid.appendChild(card);

    attachContextMenu(card, type, contextMenuItems);

    return card;
}

/**
 * Wire up right-click behaviour on a card. Kept generic/expandable so new
 * widget types (or new menu actions) can be added later without touching
 * the widgets that don't need them.
 */
function attachContextMenu(card, type, customItemsFn) {
    card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, card, type, customItemsFn);
    });
}

function defaultMenuItems(card) {
    return [
        {
            id: "ctx-edit",
            label: "Edit",
            onClick: () => {
                card.dispatchEvent(new CustomEvent("widget:edit"));
            },
        },
        {
            id: "ctx-delete",
            label: "Delete",
            onClick: () => {
                card.dispatchEvent(new CustomEvent("widget:delete"));
                console.log(card.widgetConfig.id)
                delete_widget(card.widgetConfig.id)
            },
        },
    ];
}

function showContextMenu(x, y, card, type, customItemsFn) {
    closeContextMenu();

    const items = customItemsFn ? customItemsFn(card, type) : defaultMenuItems(card);

    const menu = document.createElement("div");
    menu.classList.add("widget-context-menu");

    menu.innerHTML = items
        .map((item) => `<button class="context-menu-item" id="${item.id}">${item.label}</button>`)
        .join("");

    document.body.appendChild(menu);
    activeMenu = menu;

    items.forEach((item) => {
        menu.querySelector(`#${item.id}`).addEventListener("click", () => {
            item.onClick();
            closeContextMenu();
        });
    });

    // Position after the menu is in the DOM so we know its real size,
    // then clamp it so it doesn't spill off-screen.
    const { offsetWidth: menuWidth, offsetHeight: menuHeight } = menu;
    const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
    const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);
    menu.style.left = `${Math.max(clampedX, 8)}px`;
    menu.style.top = `${Math.max(clampedY, 8)}px`;

    // Close on the next click anywhere else.
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu, { once: true });
    }, 0);
}

function closeContextMenu() {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
}