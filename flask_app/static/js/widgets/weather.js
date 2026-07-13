import { createWidgetCard } from './widget.js';

export function weather() {
    const card = createWidgetCard("weather", {
        title: "WEATHER",
        bodyHTML: `
        <div class="weather-display">
            <span id="weather-temp">--°C</span>
        </div>

        <div class="weather-desc" id="weather-condition">
            Loading...
        </div>
        `
    });

    const tempEl = card.querySelector("#weather-temp");
    const conditionEl = card.querySelector("#weather-condition");

    async function updateWeather() {
        try {
            // Fetches weather based on the user's IP location using wttr.in JSON format
            const response = await fetch("https://wttr.in/?format=j1");
            if (!response.ok) throw new Error("Weather data fetch failed");

            const data = await response.json();

            const currentCondition = data.current_condition[0];
            const tempC = currentCondition.temp_C;
            const desc = currentCondition.weatherDesc[0].value;

            tempEl.textContent = `${tempC}°C`;
            conditionEl.textContent = desc.toUpperCase();
        } catch (error) {
            console.error("Error updating weather:", error);
            conditionEl.textContent = "OFFLINE";
        }
    }

    updateWeather();
    // Refresh weather data every 15 minutes
    const intervalId = setInterval(updateWeather, 15 * 60 * 1000);

    card.addEventListener("widget:delete", () => clearInterval(intervalId));
    // Context-menu "Edit" doubles as a manual refresh
    card.addEventListener("widget:edit", updateWeather);
}