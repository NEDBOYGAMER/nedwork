/* Description module — free text block (formerly "notes"). Content is
   edited in EDIT mode only (§1); view mode renders it read-only. */
import { el } from "../ui.js";

export function renderDescription(root, ctx) {
    const text = ctx.module.config?.text || "";
    if (!text.trim()) {
        root.appendChild(el("p", "module-empty", "No description yet."));
        return;
    }
    const pre = el("p", "notes-text");
    pre.textContent = text;
    root.appendChild(pre);
}
