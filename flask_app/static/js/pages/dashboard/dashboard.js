import { WIDGET_DEFAULTS } from "./widget_default.js";
import { createWidget } from "./widget_registry.js";

let user = ""

let widgets = []
let dashboard_name = ""
let current_dashboard = localStorage.getItem("current_dashboard") || null

document.addEventListener('DOMContentLoaded', () => {
    adjust_headers();
    adjust_grid();
    setup_modal();
    fill_dashboard(current_dashboard)
    setup_listeners()
    setup_dashboard_switcher()

});

async function adjust_headers(){
    const response = await fetch('/auth/api/who');
    const info = await response.json();
    user = info.user

    localStorage.setItem("username", user);

    const welcome = document.getElementById("dash-greeting")
    welcome.textContent = "Welcome " + user
}

function adjust_grid() {
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });
}


function setup_modal(){
    // Get DOM elements
    const modal = document.getElementById("modal-menu");
    const openBtn = document.getElementById("add-widget-btn");
    const closeBtn = document.getElementById("closeMenuBtn");

    // Open the modal (change display to flex so it centers perfectly)
    openBtn.addEventListener("click", () => {
    modal.style.display = "flex";
    });

    // Close the modal when clicking the 'X'
    closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
    });

    // Close the modal when clicking anywhere outside of the menu content box
    window.addEventListener("click", (event) => {
    if (event.target === modal) {
        modal.style.display = "none";
    }
    });



    const add_time_widget = document.getElementById("add_time_widget")
    const add_timer_widget = document.getElementById("add_timer_widget")
    const add_notes_widget = document.getElementById("add_notes_widget")
    const add_weather_widget = document.getElementById("add_weather_widget")
    const add_quote_widget = document.getElementById("add_quote_widget")

    add_time_widget.addEventListener("click", () => {
        add_widget("time");
    });

    add_timer_widget.addEventListener("click", () => {
        add_widget("timer");
    });

    add_notes_widget.addEventListener("click", () => {
        add_widget("notes");
    });

    add_weather_widget.addEventListener("click", () => {
        add_widget("weather");
    });

    add_quote_widget.addEventListener("click", () => {
        add_widget("quote");
    });
}

async function fill_dashboard(name = current_dashboard){
    close_popups()

    const dashboard_response = await fetch('/dashboard/api/list/owned');
    const data = await dashboard_response.json();
    const dashboards = data.dashboards

    if (name = null){
        name = dashboards[0]
    }

    current_dashboard = name
    const grid = document.getElementById("card-grid");
    grid.innerHTML = ""

    const response = await fetch(`/dashboard/api/load/${name}`);
    const dashboard = await response.json();
    widgets = dashboard.widgets
    dashboard_name = dashboard.name
    const dashname = document.getElementById("dash-name")

    localStorage.setItem("dashboard_name", dashboard_name);
    localStorage.setItem("current_dashboard", current_dashboard);
    dashname.textContent = "Dashboard: " + dashboard_name
    widgets.forEach(createWidget);
}



function close_popups(){
    const modal = document.getElementById("modal-menu");
    modal.style.display = "none";
};

function add_widget(widgetName) {
    const widget = WIDGET_DEFAULTS[widgetName];

    if (!widget) {
        console.error("Unknown widget:", widgetName);
        return;
    }

    widget.id = crypto.randomUUID();

    widgets.push(structuredClone(widget));

    update_widgets()
}

async function update_widgets() {
    const response = await fetch('/dashboard/api/update/update_widget', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: dashboard_name,
            widgets: widgets
        })
    });
    fill_dashboard()
}


function setup_dashboard_switcher(){
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

    // click anywhere else closes it
    document.addEventListener("click", () => {
        document.getElementById("dashboard-switcher")?.remove()
    })
}

async function open_dashboard_switcher(anchor){
    const response = await fetch('/dashboard/api/list/owned');
    const data = await response.json();
    const dashboards = data.dashboards || []

    const list = document.createElement("div")
    list.id = "dashboard-switcher"
    list.classList.add("dashboard-switcher")

    if (dashboards.length === 0) {
        const empty = document.createElement("span")
        empty.classList.add("dashboard-switcher-empty")
        empty.innerText = "No dashboards found"
        list.appendChild(empty)
    }

    dashboards.forEach((name) => {
        const item = document.createElement("button")
        item.classList.add("nav-item", "dashboard-switcher-item")
        if (name === dashboard_name) item.classList.add("active")
        item.innerText = name

        item.addEventListener("click", (event) => {
            event.stopPropagation()
            list.remove()
            if (name !== dashboard_name) {
                switch_dashboard(name)
            }
        })

        list.appendChild(item)
    })

    const rect = anchor.getBoundingClientRect()
    list.style.top = `${rect.bottom + 8}px`
    list.style.left = `${rect.left}px`

    document.body.appendChild(list)
}

async function switch_dashboard(name){
    localStorage.setItem("dashboard_name", name);
    localStorage.setItem("current_dashboard", name);
    await fill_dashboard(name)
}

function setup_listeners() {
    document.addEventListener("widget:update", () => {
        fill_dashboard()
    })
    setup_drag_and_drop()
}

function setup_drag_and_drop() {
    const grid = document.getElementById("card-grid");

    grid.addEventListener("dragstart", (event) => {
        // Don't hijack drags that start on interactive controls inside a
        // widget (text inputs, buttons, dropdowns, links, etc) - only the
        // card chrome itself should initiate a reorder.
        const interactive = event.target.closest(
            "input, textarea, button, select, a, .dropdown, [contenteditable='true']"
        );
        if (interactive) {
            event.preventDefault();
            return;
        }

        const card = event.target.closest(".card");
        if (!card) return;

        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.widgetId);
    });

    grid.addEventListener("dragover", (event) => {
        event.preventDefault();

        const dragging = grid.querySelector(".card.dragging");
        const target = event.target.closest(".card");
        if (!dragging || !target || target === dragging) return;

        const rect = target.getBoundingClientRect();
        const isPastMidpoint = event.clientX > rect.left + rect.width / 2;

        if (isPastMidpoint) {
            target.after(dragging);
        } else {
            target.before(dragging);
        }
    });

    grid.addEventListener("drop", (event) => {
        event.preventDefault();
    });

    grid.addEventListener("dragend", (event) => {
        const card = event.target.closest(".card");
        card?.classList.remove("dragging");
        persist_widget_order();
    });
}

async function persist_widget_order() {
    const grid = document.getElementById("card-grid");
    const orderedIds = Array.from(grid.children).map((card) => card.dataset.widgetId);

    widgets.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

    await fetch('/dashboard/api/update/update_widget', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: dashboard_name,
            widgets: widgets
        })
    });
}