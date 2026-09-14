let tasks = [];

const container = document.getElementById("container");
const template  = document.querySelector("#task-template");
const shelfTemplate = document.querySelector("#shelf-template");

document.addEventListener("DOMContentLoaded", async () => {
    console.log("HTML is loaded!");
    await getTasks();
    displayPriority();
});

async function getTasks() {
    try {
        const res  = await fetch(window.TASKS_API_URL, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();

        tasks = data.tasks;
    }
    catch (err) {
        console.error(err);
        container.textContent = "Could not load tasks.";
    }
}

// DISPLAY OPTIONS ==================================================================
function displayRandom() {
    for (const task of tasks) {
        makeCard(task);
    }
}

function displayPriority() {
    const shelf = shelfTemplate.content.firstElementChild.cloneNode(true);
    setText(shelf, "title", "Priority");
    container.appendChild(shelf)
    tasks.sort((a, b) => calcPriority(b)- calcPriority(a))

    for (const task of tasks) {
        makeCard(task, shelf);
    }
}

function makeCard(task, parent) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.taskId = task.id;

    console.log(task.name)

    setText(card, "name",      task.name);
    setText(card, "urgency",   calcUrgency(task), true);
    setText(card, "importance", task.importance, true);
    setText(card, "text",      task.text ?? "");

    setColor(card, "urgency", calcUrgency(task))
    setColor(card, "importance", task.importance)

    const privEl = card.querySelector('[data-field="private"]');
    privEl.hidden = !task.private;

    const dlEl = card.querySelector('[data-field="deadline"]');
    dlEl.textContent = task.deadline
        ? new Date(task.deadline).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
            })
        : "—";

    const tagsEl = card.querySelector('[data-field="tags"]');
    (task.tags ?? []).forEach(tag => {
        const badge = document.createElement("span");
        badge.className = "task-tag";
        badge.textContent = tag;
        tagsEl.appendChild(badge);
    });

    const subEl   = card.querySelector('[data-field="subtasks"]');
    const subLbl  = card.querySelector(".task-subtasks-label");
    const subs    = task.subtasks ?? [];
    subEl.innerHTML = "";
    if (subs.length === 0) {
        subLbl.style.display = "none";
        subEl.style.display  = "none";
    } else {
        subLbl.style.display = "";
        subEl.style.display  = "";
        subs.forEach(sub => {
            const li = document.createElement("li");
            const cb = document.createElement("input");
            cb.type    = "checkbox";
            cb.checked = !!sub.done;
            cb.disabled = true;
            const span = document.createElement("span");
            span.textContent = sub.name;
            if (sub.done) span.style.textDecoration = "line-through";
            li.append(cb, span);
            subEl.appendChild(li);
        });
    }

    const toggleBtn = card.querySelector('[data-action="toggle-done"]');
    if (task.done) {
        card.classList.add("is-done");
        toggleBtn.textContent = "completed";
    }
    toggleBtn.addEventListener("click", () => toggleDone(task.id, card));
    card.querySelector('[data-action="delete"]')
        .addEventListener("click", () => deleteTask(task.id, card));

    parent.appendChild(card);
}


function setText(root, field, value, tag) {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (el) {
        if (!tag){
            el.textContent = value
            return
        }
        const textEl = el.querySelector("[data-field-text]");
        if (textEl) textEl.textContent = value;
    }
}

function setColor(root, field, value) {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (!el) return;

    el.classList.remove(
        "tag-color-very-low",
        "tag-color-low",
        "tag-color-medium",
        "tag-color-high",
        "tag-color-very-high"
    );

    el.classList.add(`tag-color-${value.replace(" ", "-")}`);
}

async function toggleDone(id, card) {
    const done = !card.classList.contains("is-done");
    await fetch(`${window.TASKS_API_URL}/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done })
    });
    card.classList.toggle("is-done", done);
}

async function deleteTask(id, card) {
    const res = await fetch(`${window.TASKS_API_URL}/${id}`, {
        method: "DELETE",
        credentials: "same-origin"
    });
    if (res.ok) card.remove();
}






// HELPERS==========================================================
function calcUrgency(task){
    const now = Date.now();
    var deadline = new Date(task.deadline).getTime();
    if (Number.isNaN(deadline)) deadline = 0;

    const hoursLeft = (deadline - now) / 3_600_000;

    let urgency;

    if (hoursLeft > 504) {
        urgency = "very low";    // more than 1 week
    } else if (hoursLeft > 168 ) {
        urgency = "low";         // 1 to 3 weeks
    } else if (hoursLeft > 24) {
        urgency = "medium";      // 1 to 7 days
    } else if (hoursLeft > 6) {
        urgency = "high";        // 6 to 24 hours
    } else if (hoursLeft <= 0){
        urgency = "very low" // tasks with no deadline
    } else {
        urgency = "very high";   // less than 6 hours
    }
    return urgency
}


function calcPriority(task){
    if (!task.deadline) return null;

    const importanceMap = {
        "low":       10,
        "medium":    20,
        "high":      50,
        "very high": 90,
    };
    const importance = importanceMap[task.importance] ?? 0;

    const now = Date.now();
    const deadline = new Date(task.deadline).getTime();
    if (Number.isNaN(deadline)) return 0;

    const hoursLeft = (deadline - now) / 3_600_000;

    if (hoursLeft <= 0) return importance*10000000000;
    return importance / hoursLeft;
}
