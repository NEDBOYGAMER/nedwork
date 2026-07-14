import { createBackground } from '../components/background.js';

let state = "login"

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

    loadLogin()

});


document.addEventListener('keydown', (e) => {
    if (e.code === "Enter"){
        if (state == "login"){
            login()
        }
        else if (state == "register"){
            register()
        }
    }
});

async function register() {
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

        console.log(JSON.stringify({
                username: username,
                password: password,
                email: email
            }))

        const response = await fetch("/auth/api/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password,
                email: email
            })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error("Registration failed on server:", response.status, text);
            return;
        }

        const data = await response.json();
        console.log(data);
    } catch (error) {
        console.error('Request failed:', error);
    }
}




async function login() {
    const response = await fetch("/auth/api/login", {
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
}


function loadLogin() {
    state = "login"
    const container = document.getElementById("container")
    container.innerHTML = ""

    const title = document.createElement("h2")
    const usernameLabel = document.createElement("h3")
    const usernameInput = document.createElement("input")
    const passwordLabel = document.createElement("h3")
    const passwordInput = document.createElement("input")
    const buttons = document.createElement("div")
    const loginButton = document.createElement("button")
    const registerButton = document.createElement("button")

    title.innerHTML = "LOGIN"

    usernameLabel.innerHTML = "Username"
    usernameInput.className = "login_input"
    usernameInput.id = "username"
    usernameInput.placeholder = "Username"
    usernameInput.required = true

    passwordLabel.innerHTML = "Password"
    passwordInput.className = "login_input"
    passwordInput.type = "password"
    passwordInput.id = "password"
    passwordInput.placeholder = "Password"
    passwordInput.required = true

    buttons.id = "buttons"

    loginButton.innerHTML = "LOGIN"
    loginButton.id = "active-button"

    if (loginButton) {
        loginButton.addEventListener('click', () => {
            login()
        });
    }
    
    registerButton.innerHTML = "Register"
    registerButton.id = "inactive-button"
    
    if (registerButton) {
        registerButton.addEventListener('click', () => {
            loadRegister()
        });
    }


    buttons.appendChild(loginButton)
    buttons.appendChild(registerButton)

    container.appendChild(title)
    container.appendChild(usernameLabel)
    container.appendChild(usernameInput)
    container.appendChild(passwordLabel)
    container.appendChild(passwordInput)
    container.appendChild(buttons)
}


function loadRegister() {
    state = "register"
    const container = document.getElementById("container")
    container.innerHTML = ""

    const title = document.createElement("h2")
    const usernameLabel = document.createElement("h3")
    const usernameInput = document.createElement("input")
    const passwordLabel = document.createElement("h3")
    const passwordInput = document.createElement("input")
    const password2Label = document.createElement("h3")
    const password2Input = document.createElement("input")
    const emailLabel = document.createElement("h3")
    const emailInfo = document.createElement("p")
    const emailInput = document.createElement("input")
    const buttons = document.createElement("div")
    const loginButton = document.createElement("button")
    const registerButton = document.createElement("button")

    title.innerHTML = "REGISTER"

usernameLabel.innerHTML = "How do you wanna be called?";
    usernameInput.className = "login_input";
    usernameInput.id = "username";
    usernameInput.placeholder = "Username";

    passwordLabel.innerHTML = "Enter a safe password";
    passwordInput.className = "login_input";
    passwordInput.type = "password";
    passwordInput.id = "password";
    passwordInput.placeholder = "Password";

    password2Label.innerHTML = "Again";
    password2Input.className = "login_input";
    password2Input.type = "password";
    password2Input.id = "password-repeat";
    password2Input.placeholder = "Repeat password";

    emailLabel.innerHTML = "Optional E-mail";
    emailInfo.innerHTML = "wip, no use atm";
    emailInput.className = "login_input";
    emailInput.id = "email";
    emailInput.placeholder = "E-mail";

    buttons.id = "buttons"

    loginButton.innerHTML = "Login"
    loginButton.id = "inactive-button"

    if (loginButton) {
        loginButton.addEventListener('click', () => {
            loadLogin()
        });
    }

    registerButton.innerHTML = "REGISTER"
    registerButton.id = "active-button"

    if (registerButton) {
        registerButton.addEventListener('click', () => {
            register()
        });
    }

    buttons.appendChild(registerButton)
    buttons.appendChild(loginButton)

    container.appendChild(title)
    container.appendChild(usernameLabel)
    container.appendChild(usernameInput)
    container.appendChild(passwordLabel)
    container.appendChild(passwordInput)
    container.appendChild(password2Label)
    container.appendChild(password2Input)
    container.appendChild(emailLabel)
    container.appendChild(emailInfo)
    container.appendChild(emailInput)
    container.appendChild(buttons)
}