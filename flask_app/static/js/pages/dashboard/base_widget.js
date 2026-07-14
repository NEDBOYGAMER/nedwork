// base_widget.js


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