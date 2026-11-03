/* Announcement module — one bold callout, host-authored in edit mode.
   The tone picks the color (info / important / urgent); view mode is
   read-only like Description. */
import { el } from "../ui.js";

export function renderAnnouncement(root, ctx) {
    const config = ctx.module.config || {};
    const text = (config.text || "").trim();
    if (!text) {
        root.appendChild(el("p", "module-empty", "No announcement yet."));
        return;
    }
    const tone = ["info", "important", "urgent"].includes(config.tone)
        ? config.tone : "info";
    const box = el("p", "announcement-box announcement-" + tone, text);
    root.appendChild(box);
}
