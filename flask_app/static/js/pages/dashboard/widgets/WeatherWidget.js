import { Widget } from '../Widget.js'

// Open-Meteo WMO weather codes -> label + icon
const WEATHER_CODES = {
    0: { label: "Clear sky", icon: "☀️" },
    1: { label: "Mostly clear", icon: "🌤️" },
    2: { label: "Partly cloudy", icon: "⛅" },
    3: { label: "Overcast", icon: "☁️" },
    45: { label: "Fog", icon: "🌫️" },
    48: { label: "Fog", icon: "🌫️" },
    51: { label: "Light drizzle", icon: "🌦️" },
    53: { label: "Drizzle", icon: "🌦️" },
    55: { label: "Heavy drizzle", icon: "🌧️" },
    61: { label: "Light rain", icon: "🌧️" },
    63: { label: "Rain", icon: "🌧️" },
    65: { label: "Heavy rain", icon: "🌧️" },
    71: { label: "Light snow", icon: "🌨️" },
    73: { label: "Snow", icon: "🌨️" },
    75: { label: "Heavy snow", icon: "❄️" },
    80: { label: "Rain showers", icon: "🌦️" },
    81: { label: "Rain showers", icon: "🌦️" },
    82: { label: "Violent showers", icon: "⛈️" },
    95: { label: "Thunderstorm", icon: "⛈️" },
    96: { label: "Thunderstorm", icon: "⛈️" },
    99: { label: "Thunderstorm", icon: "⛈️" },
}

function describeCode(code) {
    return WEATHER_CODES[code] || { label: "Unknown", icon: "❔" }
}

const REFRESH_MS = 10 * 60 * 1000 // refresh every 10 minutes

export class WeatherWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings

        this.location = settings.location
        this.unit = settings.unit === "fahrenheit" ? "fahrenheit" : "celsius"
        this.show_humidity = settings.show_humidity
        this.show_wind = settings.show_wind

        this.refreshTimer = null

        this.iconEl = null
        this.tempEl = null
        this.conditionEl = null
        this.locationEl = null
        this.detailsEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("weather-widget")

        this.iconEl = document.createElement("div")
        this.iconEl.className = "weather-icon"
        this.content.appendChild(this.iconEl)

        this.tempEl = document.createElement("h3")
        this.tempEl.className = "weather-temp"
        this.content.appendChild(this.tempEl)

        this.conditionEl = document.createElement("span")
        this.conditionEl.className = "weather-condition"
        this.content.appendChild(this.conditionEl)

        this.locationEl = document.createElement("span")
        this.locationEl.className = "weather-location"
        this.content.appendChild(this.locationEl)

        if (this.show_humidity || this.show_wind) {
            this.detailsEl = document.createElement("div")
            this.detailsEl.className = "weather-details"
            this.content.appendChild(this.detailsEl)
        }

        this.refresh()
        this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS)
    }

    dispose() {
        clearInterval(this.refreshTimer)
        this.refreshTimer = null
    }

    async geocode(query) {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
        const res = await fetch(url)
        const data = await res.json()

        if (!data.results || data.results.length === 0) {
            throw new Error(`Location "${query}" not found`)
        }

        const { latitude, longitude, name, country } = data.results[0]
        return { latitude, longitude, label: country ? `${name}, ${country}` : name }
    }

    async refresh() {
        try {
            const place = await this.geocode(this.location)
            this.locationEl.innerText = place.label

            const tempUnitParam = this.unit === "fahrenheit" ? "&temperature_unit=fahrenheit" : ""
            const windUnitParam = this.unit === "fahrenheit" ? "&wind_speed_unit=mph" : ""
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
                `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code${tempUnitParam}${windUnitParam}`

            const res = await fetch(url)
            const data = await res.json()
            const current = data.current

            const { label, icon } = describeCode(current.weather_code)

            this.iconEl.innerText = icon
            this.tempEl.innerText = `${Math.round(current.temperature_2m)}°${this.unit === "fahrenheit" ? "F" : "C"}`
            this.conditionEl.innerText = label

            if (this.detailsEl) {
                this.detailsEl.innerHTML = ""

                if (this.show_humidity) {
                    const hum = document.createElement("span")
                    hum.className = "weather-detail"
                    hum.innerText = `💧 ${Math.round(current.relative_humidity_2m)}%`
                    this.detailsEl.appendChild(hum)
                }

                if (this.show_wind) {
                    const wind = document.createElement("span")
                    wind.className = "weather-detail"
                    wind.innerText = `🌬️ ${Math.round(current.wind_speed_10m)} ${this.unit === "fahrenheit" ? "mph" : "km/h"}`
                    this.detailsEl.appendChild(wind)
                }
            }
        } catch (err) {
            console.error("WeatherWidget refresh failed:", err)
            this.iconEl.innerText = "⚠️"
            this.tempEl.innerText = "--°"
            this.conditionEl.innerText = "Unavailable"
        }
    }
}