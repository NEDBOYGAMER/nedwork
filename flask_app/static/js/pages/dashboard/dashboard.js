import { createBackground } from '../../components/background.js';
import { WIDGET_DEFAULTS } from "./widget_default.js";
import { createWidget } from "./widget_registry.js";

let user = ""

let widgets = []
let dashboard_name = ""

document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    if (!cursor || !ring || !canvas) {
        console.warn('Missing background elements');
        return;
    }

    const background = createBackground({
        cursor,
        ring,
        canvas
    });

    background.start();

    adjust_headers();
    adjust_grid();
    setup_modal();
    fill_dashboard()
    setup_listeners()

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
}

async function fill_dashboard(){
    close_popups()
    const grid = document.getElementById("card-grid");
    grid.innerHTML = ""
    
    const response = await fetch('/dashboard/api/load/main');
    const dashboard = await response.json();
    widgets = dashboard.widgets
    dashboard_name = dashboard.name
    const dashname = document.getElementById("dash-name")

    localStorage.setItem("dashboard_name", dashboard_name);
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


function setup_listeners() {
    document.addEventListener("widget:update", () => {
        fill_dashboard()
    })
}