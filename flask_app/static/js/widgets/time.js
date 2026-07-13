// time.js
// No longer imports widget.js or builds its own card — widget.js's
// createWidget() builds the shell from `definition` below, then calls
// init(card, widgetConfig) to wire up behaviour.
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

export const definition = {
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

export function init(card, widgetConfig = {}) {
    const settings = widgetConfig.settings || {};
    const use24Hour = isTruthy(settings["24_format"]);
    const showSeconds = settings.show_seconds !== false; // default true
    const showDate = settings.show_date !== false; // default true
    const dateStyle = settings.date_style;

    const timeEl = card.querySelector("#clock-time");
    const dateEl = card.querySelector("#clock-date");

    if (!showDate) {
        dateEl.style.display = "none";
    }

    function updateTime() {
        const now = new Date();

        const timeStr = now.toLocaleTimeString("en-GB", {
            hour12: !use24Hour,
            hour: "2-digit",
            minute: "2-digit",
            second: showSeconds ? "2-digit" : undefined,
        });

        timeEl.textContent = timeStr;

        if (showDate) {
            dateEl.textContent = dateStyle
                ? formatDate(now, dateStyle)
                : now.toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                });
        }
    }

    updateTime();
    const intervalId = setInterval(updateTime, showSeconds ? 1000 : 60 * 1000);

    // Stop the clock from ticking in the background once the card is gone
    card.addEventListener("widget:delete", () => clearInterval(intervalId));
}