// timer.js
// Exports a TimerWidget class (extends Widget from base_widget.js).
// widget.js's createWidget() builds the card shell from getDefinition(),
// then calls instance.init(card) to wire up behaviour.

import { Widget } from './base_widget.js';

export class TimerWidget extends Widget {
    getDefinition() {
        return {
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
    `,
        };
    }

    init(card) {
        this.duration = 300; // default 5 minutes in seconds
        this.timeRemaining = this.duration;
        this.timerId = null;

        this.display = card.querySelector("#timer-time");
        this.toggleBtn = card.querySelector("#timer-toggle");
        this.resetBtn = card.querySelector("#timer-reset");
        this.dot = card.querySelector("#timer-dot");

        // Change duration by clicking the numbers
        this.display.addEventListener("click", () => this.editDuration());

        this.toggleBtn.addEventListener("click", () => {
            if (this.timerId === null) {
                this.startTimer();
            } else {
                this.pauseTimer();
            }
        });

        this.resetBtn.addEventListener("click", () => {
            this.pauseTimer();
            this.timeRemaining = this.duration;
            this.updateDisplay();
        });

        // Context-menu "Edit" reuses the same set-time prompt as clicking the display
        card.addEventListener("widget:edit", () => this.editDuration());

        this.updateDisplay();
    }

    updateDisplay() {
        const minutes = Math.floor(this.timeRemaining / 60).toString().padStart(2, "0");
        const seconds = (this.timeRemaining % 60).toString().padStart(2, "0");
        this.display.textContent = `${minutes}:${seconds}`;
    }

    startTimer() {
        if (this.timerId !== null) return;

        this.dot.classList.add("active-timer");
        this.toggleBtn.textContent = "PAUSE";

        this.timerId = setInterval(() => {
            if (this.timeRemaining > 0) {
                this.timeRemaining--;
                this.updateDisplay();
            } else {
                clearInterval(this.timerId);
                this.timerId = null;
                this.dot.classList.remove("active-timer");
                this.toggleBtn.textContent = "START";
                alert("Time's up!");
            }
        }, 1000);
    }

    pauseTimer() {
        clearInterval(this.timerId);
        this.timerId = null;
        this.dot.classList.remove("active-timer");
        this.toggleBtn.textContent = "START";
    }

    editDuration() {
        this.pauseTimer();
        const input = prompt("Enter minutes:", Math.floor(this.duration / 60));
        const mins = parseInt(input, 10);
        if (!isNaN(mins) && mins > 0) {
            this.duration = mins * 60;
            this.timeRemaining = this.duration;
            this.updateDisplay();
        }
    }
}