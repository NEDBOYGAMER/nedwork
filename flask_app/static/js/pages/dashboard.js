import { createBackground } from '../components/background.js';
import {time} from '../widgets/time.js'
import {timer} from '../widgets/timer.js'
import {weather} from '../widgets/weather.js'
import {notes} from '../widgets/notes.js'

let user = ""

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

});

const WIGET_FUNCTIONS = {
    time,
    weather,
    notes,
    timer
}


async function adjust_headers(){
    const response = await fetch('/auth/api/who');
    const info = await response.json();
    user = info.user

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
}

async function fill_dashboard(){
    const response = await fetch('/dashboard/api/load/main');
    const dashboard = await response.json();

    const widgets = dashboard.widgets
    const dashboard_name = dashboard.name
    const dashname = document.getElementById("dash-name")
    dashname.textContent = "Dashboard: " + dashboard_name

    

    const WigetFunctions = widgets.map(name => WIGET_FUNCTIONS[name]);


    WigetFunctions.forEach(widget => {
        widget();
    });
}