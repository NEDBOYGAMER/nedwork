/* =========================================================================
   BUTTON / STICK POSITIONS
   All coordinates are in "image space" — i.e. pixel coordinates as if the
   source image (img/controller_img.png) were displayed at its native
   resolution below. Edit these numbers to line the overlays up with your
   image; everything is rescaled automatically no matter how big the
   controller is drawn on screen.

   IMAGE_SIZE must match the actual width/height (in px) of your source
   image file, or the math will be off.

   Each button entry: { x, y, r }  -> circle center (x,y), radius r
   Set an entry to null to skip drawing it (e.g. LB/RB/LT/RT aren't visible
   on a front-facing controller image).
   ========================================================================= */

const IMAGE_SIZE = { width: 924, height: 686 };

const BUTTON_POS = {
    A:          { x: 647, y: 247, r: 27 },
    B:          { x: 701, y: 193, r: 27 },
    X:          { x: 593, y: 193, r: 27 },
    Y:          { x: 647, y: 140, r: 27 },

    LB:         null,
    RB:         null,
    LT:         null,
    RT:         null,

    View:       { x: 379, y: 191, r: 20 },
    Menu:       { x: 497, y: 191, r: 20 },

    LS:         { x: 228, y: 195, r: 44 },   // stick click darkens the cap
    RS:         { x: 546, y: 317, r: 44 },

    DPadUp:     { x: 330, y: 280, r: 20 },
    DPadDown:   { x: 330, y: 373, r: 20 },
    DPadLeft:   { x: 283, y: 325, r: 20 },
    DPadRight:  { x: 378, y: 325, r: 20 },

    Home:       { x: 438, y: 111, r: 32 }
};

/* Which stick each axis pair belongs to, and how far (in image-space px)
   the ring is allowed to drag from center. */
const STICK_POS = {
    LS: { ...BUTTON_POS.LS, ringPad: 12, maxDrag: 26, axisX: "LeftStickX",  axisY: "LeftStickY"  },
    RS: { ...BUTTON_POS.RS, ringPad: 12, maxDrag: 26, axisX: "RightStickX", axisY: "RightStickY" }
};

const buttonNames = [
    "A", "B", "X", "Y",
    "LB", "RB", "LT", "RT",
    "View", "Menu",
    "LS", "RS",
    "DPadUp", "DPadDown", "DPadLeft", "DPadRight",
    "Home"
];

const axisNames = [
    "LeftStickX",
    "LeftStickY",
    "RightStickX",
    "RightStickY"
];

/* =========================================================================
   SETUP
   ========================================================================= */

const wrap = document.getElementById("wrap");
const img = document.getElementById("controller");
const statusBadge = document.getElementById("statusBadge");

const buttonEls = {};   // name -> { el, pos }
const stickEls = {};    // "LS"/"RS" -> { ring, pos }

function build_overlays() {
    for (const name in BUTTON_POS) {
        const pos = BUTTON_POS[name];
        if (!pos) continue;

        const el = document.createElement("div");
        el.className = "btn-overlay";
        el.dataset.button = name;
        wrap.appendChild(el);
        buttonEls[name] = { el, pos };
    }

    for (const stick in STICK_POS) {
        const pos = STICK_POS[stick];

        const ring = document.createElement("div");
        ring.className = "stick-ring";
        wrap.appendChild(ring);

        stickEls[stick] = { ring, pos };
    }
}

/* Recompute pixel positions/sizes for every overlay based on the image's
   current rendered size. Called on load and on resize. */
function layout_overlays() {
    const scale = img.clientWidth / IMAGE_SIZE.width;

    for (const name in buttonEls) {
        const { el, pos } = buttonEls[name];
        const d = pos.r * 2 * scale;
        el.style.width = d + "px";
        el.style.height = d + "px";
        el.style.left = (pos.x * scale - pos.r * scale) + "px";
        el.style.top = (pos.y * scale - pos.r * scale) + "px";
    }

    for (const stick in stickEls) {
        const { ring, pos } = stickEls[stick];
        const d = (pos.r + pos.ringPad) * 2 * scale;
        ring.style.width = d + "px";
        ring.style.height = d + "px";
        // base (centered) position; per-frame drag offset is applied on top
        ring.dataset.baseLeft = pos.x * scale - (pos.r + pos.ringPad) * scale;
        ring.dataset.baseTop = pos.y * scale - (pos.r + pos.ringPad) * scale;
        ring.dataset.scale = scale;
        ring.style.left = ring.dataset.baseLeft + "px";
        ring.style.top = ring.dataset.baseTop + "px";
        ring.style.transform = "translate(0px, 0px)";
    }
}

function set_up() {
    build_overlays();

    if (img.complete) {
        layout_overlays();
    } else {
        img.addEventListener("load", layout_overlays);
    }

    window.addEventListener("resize", layout_overlays);
}

/* =========================================================================
   GAMEPAD POLLING
   ========================================================================= */

function flatten(obj, prefix = "", result = []) {
    for (const key in obj) {
        if (typeof obj[key] === "object" && obj[key] !== null) {
            flatten(obj[key], prefix + key + ".", result);
        } else {
            result.push(prefix + key + ": " + obj[key]);
        }
    }
    return result.join("\n");
}

function apply_button_state(name, pressed) {
    const entry = buttonEls[name];
    if (entry) {
        entry.el.classList.toggle("pressed", pressed);
    }
    // LS/RS are both a button (click) and a stick (ring) - darken the ring too
    const stickEntry = stickEls[name];
    if (stickEntry) {
        stickEntry.ring.classList.toggle("pressed", pressed);
    }
}

function apply_stick_offset(stick, axisXVal, axisYVal) {
    const entry = stickEls[stick];
    if (!entry) return;

    const scale = parseFloat(entry.ring.dataset.scale) || 1;
    const maxDragPx = entry.pos.maxDrag * scale;

    const dx = axisXVal * maxDragPx;
    const dy = axisYVal * maxDragPx;

    entry.ring.style.transform = `translate(${dx}px, ${dy}px)`;
}

function update() {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0];

    if (gamepad) {
        const state = { buttons: {}, axes: {} };

        gamepad.buttons.forEach((button, i) => {
            const name = buttonNames[i] ?? `Button${i}`;
            state.buttons[name] = { pressed: button.pressed };
            apply_button_state(name, button.pressed);
        });

        const axisVals = {};
        gamepad.axes.forEach((axis, i) => {
            const name = axisNames[i] ?? `Axis${i}`;
            axisVals[name] = axis;
            state.axes[name] = axis.toFixed(2);
        });

        for (const stick in STICK_POS) {
            const { axisX, axisY } = STICK_POS[stick];
            apply_stick_offset(stick, axisVals[axisX] ?? 0, axisVals[axisY] ?? 0);
        }

        document.getElementById("output").innerText = flatten(state);
        statusBadge.textContent = gamepad.id;
    } else {
        document.getElementById("output").innerText = "No controller connected";
        statusBadge.textContent = "No controller";
    }

    requestAnimationFrame(update);
}

/* Credits toggle */
const creditsToggle = document.getElementById("creditsToggle");
const creditsPanel = document.getElementById("creditsPanel");
creditsToggle.addEventListener("click", () => {
    const isHidden = creditsPanel.hasAttribute("hidden");
    if (isHidden) {
        creditsPanel.removeAttribute("hidden");
        creditsToggle.textContent = "Hide credits";
    } else {
        creditsPanel.setAttribute("hidden", "");
        creditsToggle.textContent = "Show credits";
    }
});

set_up();
update();