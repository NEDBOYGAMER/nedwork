// time.js
// Exports a TimeWidget class (extends Widget from base_widget.js).
// widget.js's createWidget() builds the card shell from getDefinition(),
// then calls instance.init(card) to wire up behaviour.
//
// Expected widgetConfig shape (see WIDGET_DEFAULTS.time):
//   {
//     type: "time",
//     id: "-",
//     settings: {
//       "24_format": "true",   // NOTE: string, not boolean — coerced below
//       show_seconds: true,
//       show_date: true,
//       date_style: "dd.m.jjjj",
//       style: "tech"
//     }
//   }

import { Widget } from './base_widget.js';

function isTruthy(value) {
    // settings sometimes send booleans, sometimes the strings "true"/"false"
    return value === true || value === "true";
}

// Very small date-format-token replacer. Supports the tokens seen in
// WIDGET_DEFAULTS ("dd.m.jjjj" — dd = day, m = month, jjjj = 4-digit year).
// Falls back gracefully for unrecognized tokens.
function formatDate(date, pattern) {
    const dd = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1);
    const mm = m.padStart(2, "0");
    const jjjj = String(date.getFullYear());

    return pattern
        .replace(/jjjj|yyyy/gi, jjjj)
        .replace(/mm/gi, mm)
        .replace(/dd/gi, dd)
        .replace(/\bm\b/gi, m);
}

export class TimeWidget extends Widget {
    getDefinition() {
        return {
            title: "TIME",
            bodyHTML: `
    <div class="clock">
        <span id="clock-time">00:00:00</span>
    </div>

    <div class="date" id="clock-date">
        Loading...
    </div>
    `,
        };
    }

    init(card) {
        const settings = this.config.settings || {};
        this.use24Hour = isTruthy(settings["24_format"]);
        this.showSeconds = settings.show_seconds !== false; // default true
        this.showDate = settings.show_date !== false; // default true
        this.dateStyle = settings.date_style;

        this.timeEl = card.querySelector("#clock-time");
        this.dateEl = card.querySelector("#clock-date");

        if (!this.showDate) {
            this.dateEl.style.display = "none";
        }

        this.updateTime();
        this.intervalId = setInterval(
            () => this.updateTime(),
            this.showSeconds ? 1000 : 60 * 1000
        );

        // Stop the clock from ticking in the background once the card is gone
        card.addEventListener("widget:delete", () => clearInterval(this.intervalId));
    }

    updateTime() {
        const now = new Date();

        const timeStr = now.toLocaleTimeString("en-GB", {
            hour12: !this.use24Hour,
            hour: "2-digit",
            minute: "2-digit",
            second: this.showSeconds ? "2-digit" : undefined,
        });

        this.timeEl.textContent = timeStr;

        if (this.showDate) {
            this.dateEl.textContent = this.dateStyle
                ? formatDate(now, this.dateStyle)
                : now.toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                });
        }
    }
}