// weather.js
// Exports a WeatherWidget class (extends Widget from base_widget.js).
// widget.js's createWidget() builds the card shell from getDefinition(),
// then calls instance.init(card) to wire up behaviour.
//
// Expected widgetConfig shape (see WIDGET_DEFAULTS.weather):
//   {
//     type: "weather",
//     id: "-",
//     settings: { location: "default", unit: "celsius", style: "tech" }
//   }

import { Widget } from '../base_widget.js';

export class WeatherWidget extends Widget {
    getDefinition() {
        return {
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
    }

    init(card) {
        const settings = this.config.settings || {};
        this.location = settings.location && settings.location !== "default" ? settings.location : "";
        this.useFahrenheit = settings.unit === "fahrenheit";
        this.unitSymbol = this.useFahrenheit ? "°F" : "°C";

        this.tempEl = card.querySelector("#weather-temp");
        this.conditionEl = card.querySelector("#weather-condition");

        this.updateWeather();
        // Refresh weather data every 15 minutes
        this.intervalId = setInterval(() => this.updateWeather(), 15 * 60 * 1000);
        // Context-menu "Edit" doubles as a manual refresh
        card.addEventListener("widget:edit", () => this.updateWeather());
    }

    async updateWeather() {
        try {
            // Empty location falls back to wttr.in's IP-based geolocation
            const response = await fetch(`https://wttr.in/${encodeURIComponent(this.location)}?format=j1`);
            if (!response.ok) throw new Error("Weather data fetch failed");

            const data = await response.json();

            const currentCondition = data.current_condition[0];
            const temp = this.useFahrenheit ? currentCondition.temp_F : currentCondition.temp_C;
            const desc = currentCondition.weatherDesc[0].value;

            this.tempEl.textContent = `${temp}${this.unitSymbol}`;
            this.conditionEl.textContent = desc.toUpperCase();
        } catch (error) {
            console.error("Error updating weather:", error);
            this.conditionEl.textContent = "OFFLINE";
        }
    }
}