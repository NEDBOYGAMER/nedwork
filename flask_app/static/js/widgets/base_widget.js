// base_widget.js
// Shared base class for all widget types. widget.js's createWidget()
// instantiates the right subclass for a given widgetConfig.type, asks it
// for a `definition` (shell config: title/bodyHTML/etc, same shape as
// before), builds the card from that, and then calls instance.init(card)
// to wire up behaviour.
//
// Subclasses override:
//   - getDefinition()      -> { title, bodyHTML, showHeader, showStatusDot,
//                                dotId, extraCardClasses, contextMenuItems }
//   - init(card)            -> wire up DOM refs / listeners / intervals
//
// Per-instance state (timers, cached settings, DOM refs) belongs on `this`
// instead of being closed over inside init(), e.g. `this.intervalId`
// instead of a local `intervalId` variable.
//
// Lifecycle is still communicated via the "widget:edit" / "widget:delete"
// custom events dispatched on the card (unchanged from before), so the
// context-menu wiring in widget.js didn't need to change.

export class Widget {
    constructor(config = {}) {
        this.config = config;
        this.card = null;
    }

    // Override in subclasses. Returns the shell definition used to build
    // the card (title, bodyHTML, ...). Has access to this.config.
    getDefinition() {
        return {};
    }

    // Override in subclasses. `card` is the already-built shell element.
    init(card) {
        // no-op by default
    }
}