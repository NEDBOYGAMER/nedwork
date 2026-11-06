/* Location module — view mode. Interactive OSM map (vendored Leaflet,
   no CDN, tiles from openstreetmap.org — attribution shown by the map).
   Clicking the marker shows the location details in a popup. Edit-mode
   settings (address + search + draggable marker) live in settings.js. */
import { el } from "../ui.js";

/* Compose the attendee-facing address line from the structured parts
   captured at geocode time: "Street HouseNumber, Town" (street first).
   Older events only have the flat `address` string — callers fall back
   to that. */
export function composeAddress(config) {
    const c = config || {};
    const streetLine = [c.street, c.houseNumber]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ");
    const town = String(c.town || "").trim();
    return [streetLine, town].filter(Boolean).join(", ");
}

export function renderLocation(root, ctx) {
    const config = ctx.module.config || {};
    if (config.note) {
        root.appendChild(el("p", "location-note", config.note));
    }
    const address = composeAddress(config) || config.address || "";
    if (address) {
        root.appendChild(el("p", "location-address", address));
    }
    const hasPoint = Number.isFinite(config.lat) && Number.isFinite(config.lng);
    if (hasPoint && window.L) {
        renderLeafletMap(root, config);
    } else if (hasPoint) {
        // vendor missing (dev without static/vendor) — plain embed fallback
        const d = 0.004;   // ~±450 m window around the pin
        const bbox = `${config.lng - d}%2C${config.lat - d}%2C${config.lng + d}%2C${config.lat + d}`;
        const iframe = el("iframe", "location-map");
        iframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${config.lat}%2C${config.lng}`;
        iframe.loading = "lazy";
        iframe.title = "Event location map";
        root.appendChild(iframe);
    }
    if (hasPoint) {
        const links = el("div", "location-links");
        const google = el("a", "btn btn-secondary btn-sm", "Open in Google Maps");
        google.href = `https://www.google.com/maps/search/?api=1&query=${config.lat},${config.lng}`;
        google.target = "_blank";
        google.rel = "noopener noreferrer";
        const apple = el("a", "btn btn-secondary btn-sm", "Open in Apple Maps");
        apple.href = `https://maps.apple.com/?ll=${config.lat},${config.lng}` +
            `&q=${encodeURIComponent(address || "Event location")}`;
        apple.target = "_blank";
        apple.rel = "noopener noreferrer";
        links.append(google, apple);
        root.appendChild(links);
    }
    if (!address && !hasPoint) {
        root.appendChild(el("p", "module-empty", "No location set yet."));
    }
}

function renderLeafletMap(root, config) {
    const holder = el("div", "location-map-wrap");
    const mapDiv = el("div", "location-map location-map-view");
    holder.appendChild(mapDiv);
    root.appendChild(holder);

    const map = window.L.map(mapDiv, {
        scrollWheelZoom: true,
        zoomControl: false,   // re-added bottom-left below
    }).setView([config.lat, config.lng], 15);
    window.L.control.zoom({ position: "bottomleft" }).addTo(map);
    keepMapSized(map);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    setupMapInteraction(map, holder, mapDiv);

    const marker = window.L.marker([config.lat, config.lng]).addTo(map);
    marker.bindPopup(locationPopup(config));
    marker.on("click", () => marker.openPopup());
}

/* Leaflet measures the container once at init — if the card isn't laid
   out yet (detached node / pending grid layout), tiles land offset in a
   corner. Re-measure whenever the container actually gets its size. */
export function keepMapSized(map) {
    new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());
}

const MOBILE_MAP_QUERY = "(max-width: 768px)";

export function mapIsMobile() {
    return window.matchMedia(MOBILE_MAP_QUERY).matches;
}

/* Wire the two map interaction models:
   - desktop: plain scroll scrolls the page, Ctrl+scroll zooms the map;
   - phones: the map starts locked behind a transparent overlay. The first
     tap activates it; the next page scroll locks it again. This keeps a
     normal vertical swipe scrolling the page instead of panning the map. */
export function setupMapInteraction(map, holder, mapEl = holder) {
    guardWheel(holder, mapEl);
    addMapLock(map, mapEl);
    if (!mapIsMobile()) addZoomHint(mapEl);
}

/* Plain scroll must scroll the page, Ctrl+scroll (or pinch) zooms the
   map: swallow wheel events without Ctrl in the capture phase so they
   never reach Leaflet's zoom handler. Only events over the map itself are
   swallowed - the holder can be wider than the centered map, and the
   gutter must keep scrolling the page. */
function guardWheel(holder, mapEl) {
    holder.addEventListener("wheel", (e) => {
        if (e.ctrlKey) return;
        if (!mapEl.contains(e.target)) return;
        e.stopPropagation();
    }, { capture: true, passive: true });
}

function addZoomHint(mapEl) {
    const hint = el("span", "location-zoom-hint", "Ctrl + scroll to zoom");
    mapEl.appendChild(hint);
}

/* Mobile lock overlay: a transparent full-map layer that keeps every
   pointer/touch event away from Leaflet until the user taps it. Then it
   gets out of the way; a page scroll brings it back. */
function addMapLock(map, mapEl) {
    const overlay = el("div", "location-map-lock");
    overlay.setAttribute("role", "button");
    overlay.setAttribute("tabindex", "0");
    overlay.setAttribute("aria-label", "Tap to interact with the map");
    overlay.appendChild(el("span", "location-map-lock-hint",
        "Tap to interact"));

    // swallow map gestures without preventing page scroll (touch-action
    // is pan-y on the overlay) — the first tap must not pan the map,
    // drop the edit pin or open the marker popup
    for (const type of ["mousedown", "touchstart", "pointerdown", "wheel",
        "click", "dblclick"]) {
        overlay.addEventListener(type, (e) => e.stopPropagation());
    }

    // Leaflet sets touch-action: none on the container while drag/zoom
    // handlers are active — flip it back to pan-y so swipes over the
    // locked map still scroll the page.
    mapEl.classList.add("is-map-locked");

    const unlock = () => {
        overlay.classList.add("is-unlocked");
        overlay.setAttribute("aria-hidden", "true");
        mapEl.classList.remove("is-map-locked");
    };
    const lock = () => {
        overlay.classList.remove("is-unlocked");
        overlay.removeAttribute("aria-hidden");
        mapEl.classList.add("is-map-locked");
    };
    overlay.addEventListener("click", unlock);
    overlay.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            unlock();
        }
    });

    const onScroll = () => {
        if (overlay.classList.contains("is-unlocked")) lock();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    map.on("unload", () => window.removeEventListener("scroll", onScroll));

    mapEl.appendChild(overlay);
}

/* popup content as a DOM node — text nodes, no HTML injection */
export function locationPopup(config) {
    const box = document.createElement("div");
    box.className = "location-popup";
    const address = composeAddress(config) || config.address || "";
    if (address) {
        const a = document.createElement("strong");
        a.textContent = address;
        box.appendChild(a);
    }
    if (config.note) {
        box.appendChild(document.createElement("br"));
        box.appendChild(document.createTextNode(config.note));
    }
    box.appendChild(document.createElement("br"));
    const coords = document.createElement("span");
    coords.className = "mono";
    coords.textContent = `${config.lat}, ${config.lng}`;
    box.appendChild(coords);
    return box;
}
