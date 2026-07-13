// weather.js
// No longer imports widget.js or builds its own card — widget.js's
// createWidget() builds the shell from `definition` below, then calls
// init(card, widgetConfig) to wire up behaviour.
//
// Expected widgetConfig shape (see WIDGET_DEFAULTS.weather):
//   {
//     type: "weather",
//     id: "-",
//     settings: { location: "default", unit: "celsius", style: "tech" }
//   }

export const definition = {
    title: "WEATHER",
    bodyHTML: `
    <div class="weather-display">
        <span id="weather-temp">--°C</span>
    </div>

    <div class="weather-desc" id="weather-condition">
        Loading...
    </div>
    `,
};

export function init(card, widgetConfig = {}) {
    const settings = widgetConfig.settings || {};
    const location = settings.location && settings.location !== "default" ? settings.location : "";
    const useFahrenheit = settings.unit === "fahrenheit";
    const unitSymbol = useFahrenheit ? "°F" : "°C";

    const tempEl = card.querySelector("#weather-temp");
    const conditionEl = card.querySelector("#weather-condition");

    async function updateWeather() {
        try {
            // Empty location falls back to wttr.in's IP-based geolocation
            const response = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
            if (!response.ok) throw new Error("Weather data fetch failed");

            const data = await response.json();

            const currentCondition = data.current_condition[0];
            const temp = useFahrenheit ? currentCondition.temp_F : currentCondition.temp_C;
            const desc = currentCondition.weatherDesc[0].value;

            tempEl.textContent = `${temp}${unitSymbol}`;
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