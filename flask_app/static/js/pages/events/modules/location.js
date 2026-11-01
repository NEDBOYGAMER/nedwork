/* Location module — view mode. Interactive OSM map (vendored Leaflet,
   no CDN, tiles from openstreetmap.org — attribution shown by the map).
   Clicking the marker shows the location details in a popup. Edit-mode
   settings (address + search + draggable marker) live in settings.js. */
import { el } from "../ui.js";

export function renderLocation(root, ctx) {
    const config = ctx.module.config || {};
    if (config.note) {
        root.appendChild(el("p", "location-note", config.note));
    }
    if (config.address) {
        root.appendChild(el("p", "location-address", config.address));
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
    if (!config.address && !hasPoint) {
        root.appendChild(el("p", "module-empty", "No location set yet."));
    }
}

function renderLeafletMap(root, config) {
    const holder = el("div", "location-map-wrap");
    const mapDiv = el("div", "location-map location-map-view");
    holder.appendChild(mapDiv);
    root.appendChild(holder);

    const map = window.L.map(mapDiv, { scrollWheelZoom: true })
        .setView([config.lat, config.lng], 15);
    keepMapSized(map);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    ctrlWheelOnly(holder);

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

/* Plain scroll must scroll the page, Ctrl+scroll (or pinch) zooms the
   map: swallow wheel events without Ctrl in the capture phase so they
   never reach Leaflet's zoom handler. */
export function ctrlWheelOnly(holder) {
    holder.addEventListener("wheel", (e) => {
        if (!e.ctrlKey) e.stopPropagation();
    }, { capture: true, passive: true });
    const hint = el("span", "location-zoom-hint", "Ctrl + scroll to zoom");
    holder.appendChild(hint);
}

/* popup content as a DOM node — text nodes, no HTML injection */
export function locationPopup(config) {
    const box = document.createElement("div");
    box.className = "location-popup";
    if (config.address) {
        const a = document.createElement("strong");
        a.textContent = config.address;
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
