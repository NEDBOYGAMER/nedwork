// widget.js
// Shared structure for all dashboard widgets.
//
// Every widget type (time, timer, weather, notes, ...) calls createWidgetCard()
// to get its <div class="card ...">, and gets a right-click context menu
// (Edit / Delete) for free.
//
// A widget can react to the menu actions by listening for the
// "widget:edit" and "widget:delete" custom events on the card element
// it gets back, e.g.:
//
//   card.addEventListener("widget:edit", () => { ... });
//   card.addEventListener("widget:delete", () => { clearInterval(id); });
//
// "widget:delete" fires *before* the card is removed from the DOM, so it's
// the right place to clear intervals/timeouts/listeners.

let activeMenu = null;

/**
 * Build the shared card shell (optional header + status dot), append it to
 * the grid, and wire up the right-click context menu.
 *
 * @param {string} type - widget type, used for the "<type>-widget" class
 * @param {Object} config
 * @param {string}  [config.title=""]          - text for .widget-title
 * @param {string}  [config.bodyHTML=""]        - the widget-specific markup
 * @param {boolean} [config.showHeader=true]    - render .widget-header block
 * @param {boolean} [config.showStatusDot=true] - render .status-dot (only if showHeader)
 * @param {string}  [config.dotId]              - optional id for the status dot
 * @param {string[]} [config.extraCardClasses]  - extra classes on the card
 * @param {Function} [config.contextMenuItems]  - (card, type) => items[], overrides default Edit/Delete menu
 * @returns {HTMLElement} the created card element
 */
export function createWidgetCard(type, config = {}) {
    const {
        title = "",
        bodyHTML = "",
        showHeader = true,
        showStatusDot = true,
        dotId = null,
        extraCardClasses = [],
        contextMenuItems = null,
    } = config;

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
                card.remove();
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