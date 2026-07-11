export function weather() {
    const grid = document.getElementById("card-grid");

    const card = document.createElement("div");
    card.classList.add("card", "weather-widget");

    card.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">WEATHER</span>
            <span class="status-dot"></span>
        </div>

        <div class="weather-display">
            <span id="weather-temp">--°C</span>
        </div>

        <div class="weather-desc" id="weather-condition">
            Loading...
        </div>
    `;

    grid.appendChild(card);

    updateWeather();
    // Refresh weather data every 15 minutes
    setInterval(updateWeather, 15 * 60 * 1000);
}

async function updateWeather() {
    try {
        // Fetches weather based on the user's IP location using wttr.in JSON format
        const response = await fetch("https://wttr.in/?format=j1");
        if (!response.ok) throw new Error("Weather data fetch failed");
        
        const data = await response.json();
        
        const currentCondition = data.current_condition[0];
        const tempC = currentCondition.temp_C;
        const desc = currentCondition.weatherDesc[0].value;

        document.getElementById("weather-temp").textContent = `${tempC}°C`;
        document.getElementById("weather-condition").textContent = desc.toUpperCase();
    } catch (error) {
        console.error("Error updating weather:", error);
        document.getElementById("weather-condition").textContent = "OFFLINE";
    }
}