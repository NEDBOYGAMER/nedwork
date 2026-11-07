/* Site-wide toast. Injected into every HTML page (create_app), so plain page
   scripts, ES modules and standalone app pages all share one implementation.
   window.toast(message, kind, action):
     kind   — info | success | error | warning | level (danger == error)
     action — optional { label, fn } button (e.g. Undo) */
(function () {
    "use strict";

    const LIMIT = 4;          // more than this on screen is noise
    const LIFE = 3600;        // ms before it starts leaving
    const LIFE_ACTION = 6500; // an actionable toast waits longer
    const LEAVE = 300;        // keep in sync with .toast.is-leaving

    const ICONS = {
        info:    "M12 8h.01M11 12h1v4h1",
        success: "m8 12 3 3 5-6",
        error:   "M9 9l6 6M15 9l-6 6",
        warning: "M12 8v4m0 4h.01",
        level:   "M8 12h8",
    };

    function host() {
        let el = document.getElementById("toastContainer");
        if (!el) {
            el = document.createElement("div");
            el.id = "toastContainer";
            el.className = "toast-container";
            document.body.appendChild(el);
        }
        return el;
    }

    function toast(message, kind, action) {
        kind = kind === "danger" ? "error" : (kind || "info");

        const box = document.createElement("div");
        box.className = "toast toast-" + kind;
        box.setAttribute("role", kind === "error" ? "alert" : "status");

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "toast-icon");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", ICONS[kind] || ICONS.info);
        svg.appendChild(path);
        box.appendChild(svg);

        const text = document.createElement("span");
        text.className = "toast-msg";
        text.textContent = message;
        box.appendChild(text);

        if (action && action.label) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "toast-action";
            btn.textContent = action.label;
            btn.addEventListener("click", () => {
                dismiss();
                if (action.fn) action.fn();
            });
            box.appendChild(btn);
        }

        const parent = host();
        parent.appendChild(box);
        while (parent.children.length > LIMIT) parent.firstElementChild.remove();

        let timer = setTimeout(dismiss, action ? LIFE_ACTION : LIFE);
        function dismiss() {
            clearTimeout(timer);
            box.classList.add("is-leaving");
            setTimeout(() => box.remove(), LEAVE);
        }
        // click anywhere but the action button dismisses early
        box.addEventListener("click", (e) => {
            if (!e.target.closest(".toast-action")) dismiss();
        });
        return box;
    }

    window.toast = toast;
    window.showToast = toast;   // settings.js's old name
})();
