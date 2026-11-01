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
    77: { label: "Snow grains", icon: "🌨️" },
    80: { label: "Rain showers", icon: "🌦️" },
    81: { label: "Rain showers", icon: "🌦️" },
    82: { label: "Violent showers", icon: "⛈️" },
    85: { label: "Snow showers", icon: "🌨️" },
    86: { label: "Snow showers", icon: "❄️" },
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
        this.show_humidity = settings.show_humidity !== false
        this.show_wind = settings.show_wind === true
        this.show_feels_like = settings.show_feels_like === true
        this.show_forecast = settings.show_forecast === true

        // resolved place (lat/lon + label) - cached per location string so a
        // refresh only hits the weather API, not the geocoder
        this.place = null

        this.refreshTimer = null
        this._refreshing = false

        this.iconEl = null
        this.tempEl = null
        this.conditionEl = null
        this.locationEl = null
        this.detailsEl = null
        this.forecastEl = null
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

        if (this.show_humidity || this.show_wind || this.show_feels_like) {
            this.detailsEl = document.createElement("div")
            this.detailsEl.className = "weather-details"
            this.content.appendChild(this.detailsEl)
        }

        if (this.show_forecast) {
            this.forecastEl = document.createElement("div")
            this.forecastEl.className = "weather-forecast"
            this.content.appendChild(this.forecastEl)
        }

        // show the last known state immediately (persisted after every
        // successful refresh) instead of flashing "--°" while loading
        this.render(lastWeatherData(this.config, this.location))

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
        if (this._refreshing) return
        this._refreshing = true

        try {
            const cached = cachedPlace(this.config, this.location)

            // geocode once per location, then reuse the coordinates forever
            if (cached) {
                this.place = cached
            } else {
                this.place = await this.geocode(this.location)
                this.config.geo = { loc: this.location, ...this.place }
            }

            this.locationEl.innerText = this.place.label

            const tempUnitParam = this.unit === "fahrenheit" ? "&temperature_unit=fahrenheit" : ""
            const windUnitParam = this.unit === "fahrenheit" ? "&wind_speed_unit=mph" : ""
            let fields = "temperature_2m"
            if (this.show_feels_like) fields += ",apparent_temperature"
            if (this.show_humidity) fields += ",relative_humidity_2m"
            if (this.show_wind) fields += ",wind_speed_10m"
            fields += ",weather_code"

            const forecastParams = this.show_forecast
                ? "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto"
                : ""

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.place.latitude}&longitude=${this.place.longitude}` +
                `&current=${fields}${tempUnitParam}${windUnitParam}${forecastParams}`

            const res = await fetch(url)
            const data = await res.json()

            this.render(data)
            // keep the last good state for instant render on the next load
            this.save({ weather_data: { loc: this.location, current: data.current, daily: data.daily || null } })
        } catch (err) {
            console.error("WeatherWidget refresh failed:", err)
            // never wipe already-shown data - the stale data stays until the
            // next retry succeeds, we only dim it (CSS .weather-widget.stale)
            if (!this.tempEl.innerText || this.tempEl.innerText === "--°") {
                this.iconEl.innerText = "⚠️"
                this.tempEl.innerText = "--°"
                this.conditionEl.innerText = "Unavailable"
                this.content.classList.remove("stale")
            } else {
                this.content.classList.add("stale")
            }
        } finally {
            this._refreshing = false
        }
    }

    render(data) {
        this.content.classList.remove("stale")
        if (!data?.current) return
        const current = data.current

        const { label, icon } = describeCode(current.weather_code)

        this.iconEl.innerText = icon
        this.tempEl.innerText = `${Math.round(current.temperature_2m)}°${this.unit === "fahrenheit" ? "F" : "C"}`
        this.conditionEl.innerText = label

        if (this.detailsEl) {
            this.detailsEl.innerHTML = ""

            if (this.show_humidity && current.relative_humidity_2m != null) {
                this.detailsEl.appendChild(this.detail(`💧 ${Math.round(current.relative_humidity_2m)}%`))
            }
            if (this.show_feels_like && current.apparent_temperature != null) {
                this.detailsEl.appendChild(this.detail(`🥵 ${Math.round(current.apparent_temperature)}°`))
            }
            if (this.show_wind && current.wind_speed_10m != null) {
                this.detailsEl.appendChild(this.detail(`🌬️ ${Math.round(current.wind_speed_10m)} ${this.unit === "fahrenheit" ? "mph" : "km/h"}`))
            }
        }

        if (this.forecastEl) this.renderForecast(data.daily)
    }

    renderForecast(daily) {
        if (!daily) {
            this.forecastEl.innerHTML = ""
            return
        }

        const windUnitSuffix = this.unit === "fahrenheit" ? "F" : "C"

        this.forecastEl.innerHTML = ""

        daily.time.forEach((iso, i) => {
            const date = new Date(`${iso}T12:00:00`)
            const { icon } = describeCode(daily.weather_code[i])

            const col = document.createElement("div")
            col.className = "weather-forecast-col"

            const day = document.createElement("span")
            day.className = "weather-forecast-day"
            day.innerText = date.toLocaleDateString([], { weekday: "short" })

            const ico = document.createElement("span")
            ico.className = "weather-forecast-icon"
            ico.innerText = icon

            const temps = document.createElement("span")
            temps.className = "weather-forecast-temps"
            temps.innerText = `${Math.round(daily.temperature_2m_max[i])}°/${Math.round(daily.temperature_2m_min[i])}°`

            col.append(day, ico, temps)
            this.forecastEl.appendChild(col)
        })
    }

    detail(text) {
        const el = document.createElement("span")
        el.className = "weather-detail"
        el.innerText = text
        return el
    }
}

/* ---- persisted-state helpers ----------------------------------------- */

function cachedPlace(config, location) {
    const geo = config.geo
    return geo && geo.loc === location ? { latitude: geo.latitude, longitude: geo.longitude, label: geo.label } : null
}

function lastWeatherData(config, location) {
    const data = config.weather_data
    return data && data.loc === location ? data : null
}
