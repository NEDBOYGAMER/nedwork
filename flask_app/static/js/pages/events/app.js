/* Events app entry — switches list / view / edit by URL (SPA-style, one
   template). window.EVENT_ID set by the template on /events/<id>/...;
   the edit path (…/edit/) renders the host editor instead of the view. */
import { renderListView, initCreateModal } from "./list_view.js";
import { renderDetailView, stopPolling } from "./detail_view.js";
import { renderEditor, stopEditor } from "./editor.js";
import { initConfirm } from "./ui.js";
import { initPicker } from "./picker.js";

const container = document.getElementById("container");
const eventId = window.EVENT_ID || null;
const isEdit = window.EVENT_EDIT_MODE === true;

initConfirm();
initPicker();
initCreateModal((event) => {
    // jump straight into the fresh draft's editor
    window.location.href = window.EVENTS_API.edit.replace("/0/", `/${event.id}/`);
});

if (eventId && isEdit) {
    renderEditor(container, eventId);
} else if (eventId) {
    renderDetailView(container, eventId);
} else {
    renderListView(container, (id) => {
        window.location.href = window.EVENTS_API.event.replace("/0/", `/${id}/`);
    });
}

// leaving the page stops polling
window.addEventListener("pagehide", () => {
    stopPolling();
    stopEditor();
});
