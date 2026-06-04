import { createBackground } from './background.js';

document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    if (!cursor || !ring || !canvas) {
        console.warn('Missing background elements');
        return;
    }

    const background = createBackground({
        cursor,
        ring,
        canvas
    });

    background.start();

    //main
    const logButton = document.getElementById('log-button');
    if (logButton) {
        logButton.addEventListener('click', async () => {
            //login
            const response = await fetch("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: document.getElementById('username').value,
                    password: document.getElementById('password').value
                })
            });

            if (!response.ok) {
                const text = await response.text();
                console.error("Login failed:", response.status, text);
                return;
            }

            const data = await response.json();
            if (data.success) {
            window.location.href = '/dashboard';
            }
            else {
                console.log("Invalid username or password");
            }
            console.log(data);
        });
    }

    //switch
    const regButton = document.getElementById('reg-button');
    if (regButton) {
        regButton.addEventListener('click', () => {
            window.location.href = '/register';
        });
    }
});
