import { createWidgetCard } from './widget.js';

export function timer() {
    const card = createWidgetCard("timer", {
        title: "TIMER",
        dotId: "timer-dot",
        bodyHTML: `
        <div class="timer-display">
            <span id="timer-time" title="Click to set time">05:00</span>
        </div>

        <div class="timer-controls">
            <button id="timer-toggle">START</button>
            <button id="timer-reset">RESET</button>
        </div>
        `
    });

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

    function editDuration() {
        pauseTimer();
        const input = prompt("Enter minutes:", Math.floor(duration / 60));
        const mins = parseInt(input, 10);
        if (!isNaN(mins) && mins > 0) {
            duration = mins * 60;
            timeRemaining = duration;
            updateDisplay();
        }
    }

    // Change duration by clicking the numbers
    display.addEventListener("click", editDuration);

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

    // Context-menu "Edit" reuses the same set-time prompt as clicking the display
    card.addEventListener("widget:edit", editDuration);
    // Make sure the interval doesn't keep running once the card is removed
    card.addEventListener("widget:delete", pauseTimer);

    updateDisplay();
}