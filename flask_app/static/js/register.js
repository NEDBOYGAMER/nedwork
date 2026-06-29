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
    const regButton = document.getElementById('reg-button');
    if (regButton) {
        regButton.addEventListener('click', async (event) => {
            event.preventDefault();

            const username = document.getElementById('username')?.value;
            const password = document.getElementById('password')?.value;
            const passwordRepeat = document.getElementById('password-repeat')?.value;
            const email = document.getElementById('email')?.value;

            if (!username || !password) {
                console.error('Username and password required');
                return;
            }

            if (password != passwordRepeat){
                const passwordEl = document.getElementById('password');
                const repeatEl = document.getElementById('password-repeat');
                passwordEl.classList.add("wrong");
                repeatEl.classList.add("wrong");
                console.error('Passwords have to match');
                setTimeout(() => {
                    passwordEl.classList.remove("wrong");
                    repeatEl.classList.remove("wrong");
                }, 800);
                return;
            }

            try {
                const response = await fetch("/auth/register", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        username: username,
                        password: password
                    })
                });

                const data = await response.json();
                console.log(data);
            } catch (error) {
                console.error('Request failed:', error);
            }
        });
    }

    //switch
    const logButton = document.getElementById('log-button');
    if (logButton) {
        logButton.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
});

