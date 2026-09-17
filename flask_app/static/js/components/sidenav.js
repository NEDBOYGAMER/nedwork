/*  sidenav.js
    Active-state highlighting + routing for the shared side nav, plus the
    mobile off-canvas drawer (hamburger toggle, backdrop, Esc/close wiring).

    The drawer markup (toggle + backdrop) is created here, so every page
    that includes the sidenav gets mobile support for free — no HTML
    changes needed in base.html or the individual pages.
*/

document.addEventListener('DOMContentLoaded', () => {

    const aside = document.getElementById('side-nav');
    const isMobileNav = window.matchMedia('(max-width: 768px)');

    /* ── Active button ─────────────────────────────────────────────── */
    let activeId = "";

    switch (window.location.pathname) {
        case "/dashboard/":   activeId = "home-btn";   break;
        case "/events/":      activeId = "events-btn"; break;
        case "/tasks/":       activeId = "tasks-btn";  break;
        case "/app_corner/":  activeId = "apps-btn";   break;
        default:              activeId = "";
    }

    ["home-btn", "events-btn", "tasks-btn", "apps-btn"].forEach((id) => {
        document.getElementById(id)?.classList.toggle("active", id === activeId);
    });

    /* ── Routing ───────────────────────────────────────────────────── */
    const routes = {
        "home-btn":     "/dashboard",
        "events-btn":   "/events",
        "tasks-btn":    "/tasks",
        "apps-btn":     "/app_corner",
        "settings-btn": "/settings",
    };

    Object.entries(routes).forEach(([id, url]) => {
        document.getElementById(id)?.addEventListener("click", () => {
            closeMobileNav();
            window.location.href = url;
        });
    });

    document.getElementById("about-btn")?.addEventListener("click", () => {
        closeMobileNav();
        // window.location.href = "/about";
    });

    document.getElementById("account-btn")?.addEventListener("click", () => {
        closeMobileNav();
        // window.location.href = "/account";
    });

    document.getElementById("logout-btn")?.addEventListener("click", async () => {
        closeMobileNav();
        const response = await fetch("/auth/api/logout", { method: "POST" });
        if (response.redirected) {
            window.location.href = response.url;
        }
    });

    /* ── Mobile drawer ─────────────────────────────────────────────── */

    let toggle = null;

    function drawerOpen() {
        return document.body.classList.contains("sidenav-open");
    }

    function setDrawer(open) {
        document.body.classList.toggle("sidenav-open", open);
        aside?.classList.toggle("open", open);
        toggle?.classList.toggle("open", open);
        toggle?.setAttribute("aria-expanded", String(open));
        toggle?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");

        // Closed drawer: remove it from tab order / a11y tree on mobile
        if (aside) {
            if (open) aside.removeAttribute("inert");
            else if (isMobileNav.matches) aside.setAttribute("inert", "");
        }
    }

    function closeMobileNav() {
        if (drawerOpen()) setDrawer(false);
    }

    function initMobileNav() {
        if (!aside || aside.dataset.mobileBound) return;
        aside.dataset.mobileBound = "true";

        // Hamburger — lives on <body>, fixed top-left; hidden on desktop via CSS
        toggle = document.createElement("button");
        toggle.className = "sidenav-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-controls", "side-nav");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
        toggle.innerHTML = '<span class="bar"></span><span class="bar"></span><span class="bar"></span>';
        document.body.appendChild(toggle);

        // Dimmed backdrop behind the open drawer
        const backdrop = document.createElement("div");
        backdrop.className = "sidenav-backdrop";
        document.body.appendChild(backdrop);

        toggle.addEventListener("click", () => setDrawer(!drawerOpen()));
        backdrop.addEventListener("click", closeMobileNav);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeMobileNav();
        });

        // Tapping any nav item closes the drawer (covers no-op buttons too)
        aside.querySelectorAll(".nav-item").forEach((btn) => {
            btn.addEventListener("click", closeMobileNav);
        });

        // React to viewport changes (rotate, window drag, dev tools)
        const applyMode = () => {
            if (isMobileNav.matches) {
                if (!drawerOpen()) aside.setAttribute("inert", "");
            } else {
                setDrawer(false);
                aside.removeAttribute("inert");
            }
        };
        applyMode();
        isMobileNav.addEventListener("change", applyMode);
    }

    initMobileNav();
});