/* Notification metadata — the ONE place a notification type's label,
   dot-colour slug and human message live. Shared by the dashboard
   NotificationsWidget and the /notifications page; add a new type here
   once and both surfaces pick it up. */

// type -> { label, slug, message(payload) }
export const NOTIFICATION_TYPES = {
    event_published:    { label: "Event", slug: "event", message: (p) => `You're invited: ${p.title || "event"}` },
    member_added:       { label: "Event", slug: "event", message: (p) => `You were added to ${p.title || "an event"}` },
    date_finalized:     { label: "Event", slug: "event", message: (p) => `Date finalized: ${p.title || "event"}` },
    date_changed:       { label: "Event", slug: "event", message: (p) => `Date changed: ${p.title || "event"} — re-confirm` },
    event_reminder:     { label: "Event", slug: "event", message: (p) => `Starting soon: ${p.title || "event"}` },
    event_announcement: { label: "Event", slug: "event", message: (p) => `Announcement: ${p.title || "event"}` },
    ride_cancelled:     { label: "Event", slug: "event", message: (p) => `A ride was cancelled: ${p.title || "event"}` },
    event:              { label: "Event", slug: "event", message: (p) => p.title || "Event update" },

    friend_request:     { label: "Social", slug: "message", message: (p) => `${p.actor || "Someone"} sent you a friend request` },
    friend_accepted:    { label: "Social", slug: "message", message: (p) => `${p.actor || "Someone"} accepted your friend request` },
    group_join_request: { label: "Social", slug: "message", message: (p) => `${p.actor || "Someone"} wants to join ${p.group || "your group"}` },
    group_joined:       { label: "Social", slug: "message", message: (p) => `${p.actor || "An admin"} approved you into ${p.group || "a group"}` },
    group_denied:       { label: "Social", slug: "message", message: (p) => `Your request to join ${p.group || "a group"} was denied` },
    group_added:        { label: "Social", slug: "message", message: (p) => `${p.actor || "An admin"} added you to ${p.group || "a group"}` },
    group_removed:      { label: "Social", slug: "message", message: (p) => `You were removed from ${p.group || "a group"}` },

    tierforge_join_request:    { label: "TierForge", slug: "message", message: (p) => `${p.actor || "Someone"} invited you to ${p.session_title || "a TierForge session"}` },
    tierforge_invite_approved: { label: "TierForge", slug: "message", message: (p) => `${p.actor || "The host"} approved your invite to ${p.session_title || "a TierForge session"}` },
    tierforge_invite_denied:   { label: "TierForge", slug: "message", message: (p) => `Your invite to ${p.session_title || "a TierForge session"} was declined` },

    task_deadline:      { label: "Task", slug: "task", message: (p) => `Due soon: ${p.title || "a task"}` },
    task:               { label: "Task", slug: "task", message: (p) => p.title || "Task update" },

    system:             { label: "System", slug: "system", message: (p) => p.title || "System update" },
    welcome:            { label: "Welcome", slug: "system", message: (p) => p.title || "Welcome to nedwork" },
}

export function notificationText(n) {
    const meta = NOTIFICATION_TYPES[n.type]
    return meta?.message(n.payload || {}) || meta?.label || n.type
}

export function relativeTime(date) {
    const seconds = Math.round((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
}
