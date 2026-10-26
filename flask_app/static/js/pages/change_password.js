/*  change_password.js
    Forces a user with must_change_password set (bootstrapped admin first
    login, admin-forced reset) to set a new password before anything else.
*/

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

function showError(message) {
    const container = document.getElementById("formArea");
    if (!container) return;
    let msg = document.getElementById("pw-error");
    if (!msg) {
        msg = document.createElement("p");
        msg.id = "pw-error";
        msg.className = "hint";
        msg.style.color = "var(--danger, #e5484d)";
        msg.style.margin = "8px 0";
        container.appendChild(msg);
    }
    msg.textContent = message;
    setTimeout(() => { msg.textContent = ""; }, 6000);
}

async function submit() {
    const current = document.getElementById("current-password")?.value;
    const next = document.getElementById("new-password")?.value;
    const repeat = document.getElementById("new-password-repeat")?.value;

    if (!current || !next) { showError("Fill in all fields"); return; }
    if (next.length < 8) { showError("New password must be at least 8 characters"); return; }
    if (next !== repeat) { showError("New passwords do not match"); return; }

    try {
        const response = await fetch("/auth/api/change_password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                current_password: current,
                new_password: next
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
            showError(data.error || `Failed (status ${response.status})`);
            return;
        }

        // admins land in the console, everyone else on the dashboard
        try {
            const who = await (await fetch("/auth/api/who")).json();
            window.location.href = who.is_admin ? "/admin" : "/dashboard";
        } catch (e) {
            window.location.href = "/dashboard";
        }
    } catch (error) {
        showError("Request failed — see console");
        console.error(error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById("formArea");
    if (!container) return;

    container.appendChild(field("Current password", { id: "current-password", type: "password", placeholder: "Password" }));
    container.appendChild(field("New password", { id: "new-password", type: "password", placeholder: "At least 8 characters" }));
    container.appendChild(field("Again", { id: "new-password-repeat", type: "password", placeholder: "Repeat password" }));

    const submitBtn = document.createElement('button');
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = "Set password";
    submitBtn.addEventListener('click', submit);
    container.appendChild(submitBtn);

    document.addEventListener('keydown', (e) => {
        if (e.code === "Enter") submit();
    });
});
