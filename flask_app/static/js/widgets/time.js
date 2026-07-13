import { createWidgetCard } from './widget.js';

export function time() {
    const card = createWidgetCard("time", {
        title: "TIME",
        bodyHTML: `
        <div class="clock">
            <span id="clock-time">00:00:00</span>
        </div>

        <div class="date" id="clock-date">
            Loading...
        </div>
        `
    });

    const timeEl = card.querySelector("#clock-time");
    const dateEl = card.querySelector("#clock-date");

    function updateTime() {
        const now = new Date();

        const timeStr = now.toLocaleTimeString("en-GB", {
            hour12: false
        });

        const dateStr = now.toLocaleDateString("en-GB", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric"
        });

        timeEl.textContent = timeStr;
        dateEl.textContent = dateStr;
    }

    updateTime();
    const intervalId = setInterval(updateTime, 1000);

    // Stop the clock from ticking in the background once the card is gone
    card.addEventListener("widget:delete", () => clearInterval(intervalId));
}