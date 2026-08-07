let state = "login";

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#authTabs .tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    loadLogin();
});

document.addEventListener('keydown', (e) => {
    if (e.code === "Enter") {
        if (state === "login") login();
        else if (state === "register") register();
    }
});

function switchTab(name) {
    document.querySelectorAll('#authTabs .tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === name);
    });
    if (name === "login") loadLogin();
    else loadRegister();
}

async function register() {
    const username = document.getElementById('username')?.value;
    const password = document.getElementById('password')?.value;
    const passwordRepeat = document.getElementById('password-repeat')?.value;
    const email = document.getElementById('email')?.value;

    if (!username || !password) {
        console.error('Username and password required');
        return;
    }

    if (password !== passwordRepeat) {
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
        const response = await fetch("/auth/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, email })
        });

        if (!response.ok) {
            const text = await response.text();
            console.error("Registration failed on server:", response.status, text);
            return;
        }

        const data = await response.json();
        console.log(data);
        loadLogin()
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
        const passwordEl = document.getElementById('password');
        passwordEl?.classList.add("wrong");
        setTimeout(() => passwordEl?.classList.remove("wrong"), 800);
        return;
    }

    const data = await response.json();
    if (data.success) {
        window.location.href = '/dashboard';
    } else {
        console.log("Invalid username or password");
    }
}

function field(labelText, { id, type = "text", placeholder = "" } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'field';

    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.placeholder = placeholder;

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
}

function loadLogin() {
    state = "login";
    const container = document.getElementById("formArea");
    container.innerHTML = "";

    container.appendChild(field("Username", { id: "username", placeholder: "Username" }));
    container.appendChild(field("Password", { id: "password", type: "password", placeholder: "Password" }));

    const submit = document.createElement('button');
    submit.className = "btn btn-primary";
    submit.textContent = "Log in";
    submit.addEventListener('click', login);

    container.appendChild(submit);
}

function loadRegister() {
    state = "register";
    const container = document.getElementById("formArea");
    container.innerHTML = "";

    container.appendChild(field("How do you want to be called?", { id: "username", placeholder: "Username" }));
    container.appendChild(field("Enter a safe password", { id: "password", type: "password", placeholder: "Password" }));
    container.appendChild(field("Again", { id: "password-repeat", type: "password", placeholder: "Repeat password" }));
    container.appendChild(field("E-mail (optional)", { id: "email", type: "email", placeholder: "E-mail" }));

    const hint = document.createElement('p');
    hint.className = "hint";
    hint.textContent = "Not used for anything yet — just here for account recovery later.";
    container.insertBefore(hint, container.lastChild);

    const submit = document.createElement('button');
    submit.className = "btn btn-primary";
    submit.textContent = "Create account";
    submit.addEventListener('click', register);

    container.appendChild(submit);
}