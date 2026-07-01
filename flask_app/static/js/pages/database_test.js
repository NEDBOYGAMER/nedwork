document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded! Calling loadTableData now...");
    loadTableData();
});

let state = "table"

async function loadTableData() {
    try {
        const response = await fetch('/tests/api/v1/test-users');
        if (!response.ok) throw new Error("Failed to fetch database data");
        
        const users = await response.json();
        
        const tbody = document.querySelector("#user-table tbody");
        tbody.innerHTML = ""; 

        users.forEach(user => {
            const row = document.createElement("tr");

            const dashboardSpans = user.dashboards.map(d => `<span class="clickable-item" data-type="dashboard" data-value="${d}">${d}</span>`).join(', ') || 'None';
            const groupSpans = user.groups.map(g => `<span class="clickable-item" data-type="group" data-value="${g}">${g}</span>`).join(', ') || 'None';

            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${dashboardSpans}</td>
                <td>${groupSpans}</td>
            `;
            tbody.appendChild(row);
        });

        tbody.addEventListener('click', (event) => {
            if (event.target.classList.contains('clickable-item')) {
                const type = event.target.getAttribute('data-type'); 
                const value = event.target.getAttribute('data-value'); 
                
                console.log(`Clicked on ${type}: ${value}`);
                loadGroupData(value)
            }
        })

    } catch (error) {
        console.error("Error loading data:", error);
    }
}

async function loadGroupData(groupName) {
    try {
        const old_list = document.getElementById("user-table");
        if (old_list) {
            old_list.remove();
        }

        const old_ul = document.getElementById("user-list");
        if (old_ul) {
            old_ul.remove();
        }

        const response = await fetch(`/tests/api/v1/group_data/${groupName}`);
        const data = await response.json();

        const ul = document.createElement("ul");
        ul.id = "user-list";

        if (data && Array.isArray(data.users)) {
            data.users.forEach(username => {
                const li = document.createElement("li");
                li.textContent = username; 
                ul.appendChild(li);
            });
        } else {
            console.warn("No users found in the response data.");
        }

        ul.addEventListener('click', (event) => { 
            if (event.target.tagName === 'LI') {
                console.log(`Clicked on user: ${event.target.textContent}`);
            }
        });

        let p = document.getElementById("container")
        if (p) {
            p.appendChild(ul);
        } else {
            console.error("Could not find element with id 'container' in the DOM.");
        }

    } catch (error) {
        console.error("Error loading data:", error);
    }
}