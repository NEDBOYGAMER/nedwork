export function time() {
    const grid = document.getElementById("card-grid");

    const card = document.createElement("div");
    card.classList.add("card", "time-widget");

    card.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">TIME</span>
            <span class="status-dot"></span>
        </div>

        <div class="clock">
            <span id="clock-time">00:00:00</span>
        </div>

        <div class="date" id="clock-date">
            Loading...
        </div>
    `;

    grid.appendChild(card);

    updateTime();

    setInterval(updateTime, 1000);
}


function updateTime() {
    const now = new Date();

    const time = now.toLocaleTimeString("en-GB", {
        hour12: false
    });

    const date = now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric"
    });

    document.getElementById("clock-time").textContent = time;
    document.getElementById("clock-date").textContent = date;
}