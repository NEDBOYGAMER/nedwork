/* Events — API layer. Thin fetch wrapper + the since-cursor store used
   by the poller to tell the UI which sections changed. Event-scoped API
   paths build off BASE.events ("/events/api/events" — the page URL in
   BASE.event is ONLY for navigation). Zero-padded templates (…/0) from
   the template cover the single-object endpoints (module/item/ride/…). */

const BASE = window.EVENTS_API || {};

const ev = (id) => `${BASE.events}/${id}`;   // /events/api/events/<id>

export const eventsUrl = () => BASE.events;
export const friendsUrl = () => BASE.friends;
export const upcomingUrl = () => BASE.upcoming;
export const notificationsUrl = () => BASE.notifications;
export const notificationsReadUrl = () => BASE.notificationsRead;

export const eventUrl = (id) => ev(id);      // PATCH /events/api/events/<id>
export const dataUrl = (id) => `${ev(id)}/data`;
export const memberUrl = (id) => `${ev(id)}/members`;
export const byKeyUrl = (id) => `${ev(id)}/members/by-key`;
export const leaveUrl = (id) => `${ev(id)}/leave`;
export const transferUrl = (id) => `${ev(id)}/transfer-host`;
export const rsvpUrl = (id) => `${ev(id)}/rsvp`;
export const needsRideUrl = (id) => `${ev(id)}/needs-ride`;
export const publishUrl = (id) => `${ev(id)}/publish`;
export const unpublishUrl = (id) => `${ev(id)}/unpublish`;
export const archiveUrl = (id) => `${ev(id)}/archive`;
export const inviteUrl = (id) => `${ev(id)}/invite`;
export const joinUrl = (id) => `${ev(id)}/join`;
export const modulesUrl = (id) => `${ev(id)}/modules`;
export const reorderUrl = (id) => `${ev(id)}/modules/reorder`;

// …/api/<thing>/0 templates from the page (module/item/ride/chat message).
// No trailing slash — those routes are defined without one and Flask 404s
// a trailing-slash request to a slash-less rule.
const zero = (tpl, id) => tpl.replace(/\/0\/?/, `/${id}`);
export const moduleUrl = (mid) => zero(BASE.module, mid);
export const itemUrl = (iid) => zero(BASE.item, iid);
export const rideUrl = (rid) => zero(BASE.ride, rid);
export const chatMsgUrl = (msgId) => zero(BASE.chatMsg, msgId);

// module-scoped subresources
export const moduleContentUrl = (mid) => moduleUrl(mid) + "/content";
export const imageUploadUrl = (mid) => moduleUrl(mid) + "/image";
export const optionsUrl = (mid) => moduleUrl(mid) + "/options";
export const optionUrl = (mid, oid) => `${optionsUrl(mid)}/${oid}`;
export const voteUrl = (mid) => moduleUrl(mid) + "/vote";
export const resetVotesUrl = (mid) => moduleUrl(mid) + "/votes";
export const finalizeUrl = (mid) => moduleUrl(mid) + "/finalize";
export const itemsUrl = (mid) => moduleUrl(mid) + "/items";
export const claimUrl = (iid) => itemUrl(iid) + "/claim";
export const ridesUrl = (mid) => moduleUrl(mid) + "/rides";
export const passengersUrl = (rid) => rideUrl(rid) + "/passengers";
export const chatUrl = (mid) => moduleUrl(mid) + "/chat";

export async function api(url, options = {}) {
    // FormData bodies must NOT get a Content-Type — the browser supplies
    // it together with the multipart boundary (a forced application/json
    // header made every image upload fail server-side)
    const isForm = options.body instanceof FormData;
    const res = await fetch(url, {
        credentials: "same-origin",
        headers: isForm ? {} : { "Content-Type": "application/json" },
        ...options,
    });
    if (res.status === 401) {
        window.location.href = window.LOGIN_URL;
        throw new Error("Session expired — redirecting to login");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

/* Since-cursor store: for each section the last id we've seen. The poller
   uses these to mark sections "changed" (badges) and to refetch the
   full event when a server-side count mismatches. */
export const since = {
    chat: null, votes: null, options: null, items: null, claims: null, rides: null,

    mark(section, rows, key = "id") {
        if (Array.isArray(rows) && rows.length) {
            this[section] = rows.reduce((a, r) => Math.max(a, r[key] ?? 0), 0);
        }
    },
};
