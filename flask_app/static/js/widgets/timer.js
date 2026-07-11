export function timer() {
    const grid = document.getElementById("card-grid");

    const card = document.createElement("div");
    card.classList.add("card", "timer-widget");

    card.innerHTML = `
        <div class="widget-header">
            <span class="widget-title">TIMER</span>
            <span class="status-dot" id="timer-dot"></span>
        </div>

        <div class="timer-display">
            <span id="timer-time" title="Click to set time">05:00</span>
        </div>

        <div class="timer-controls">
            <button id="timer-toggle">START</button>
            <button id="timer-reset">RESET</button>
        </div>
    `;

    grid.appendChild(card);

    let duration = 300; // default 5 minutes in seconds
    let timeRemaining = duration;
    let timerId = null;

    const display = card.querySelector("#timer-time");
    const toggleBtn = card.querySelector("#timer-toggle");
    const resetBtn = card.querySelector("#timer-reset");
    const dot = card.querySelector("#timer-dot");

    function updateDisplay() {
        const minutes = Math.floor(timeRemaining / 60).toString().padStart(2, "0");
        const seconds = (timeRemaining % 60).toString().padStart(2, "0");
        display.textContent = `${minutes}:${seconds}`;
    }

    function startTimer() {
        if (timerId !== null) return;
        
        dot.classList.add("active-timer");
        toggleBtn.textContent = "PAUSE";
        
        timerId = setInterval(() => {
            if (timeRemaining > 0) {
                timeRemaining--;
                updateDisplay();
            } else {
                clearInterval(timerId);
                timerId = null;
                dot.classList.remove("active-timer");
                toggleBtn.textContent = "START";
                alert("Time's up!");
            }
        }, 1000);
    }

    function pauseTimer() {
        clearInterval(timerId);
        timerId = null;
        dot.classList.remove("active-timer");
        toggleBtn.textContent = "START";
    }

    // Change duration by clicking the numbers
    display.addEventListener("click", () => {
        pauseTimer();
        const input = prompt("Enter minutes:", Math.floor(duration / 60));
        const mins = parseInt(input, 10);
        if (!isNaN(mins) && mins > 0) {
            duration = mins * 60;
            timeRemaining = duration;
            updateDisplay();
        }
    });

    toggleBtn.addEventListener("click", () => {
        if (timerId === null) {
            startTimer();
        } else {
            pauseTimer();
        }
    });

    resetBtn.addEventListener("click", () => {
        pauseTimer();
        timeRemaining = duration;
        updateDisplay();
    });

    updateDisplay();
}