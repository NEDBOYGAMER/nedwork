document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded! Calling loadTableData now...");
    loadTableData();
});

let state = "table"

async function loadTableData(selected) {
    try {
        const response = await fetch('/tests/api/v1/test-users');
        if (!response.ok) throw new Error("Failed to fetch database data");
        const users = await response.json();
        
        const title = document.getElementById("title");
        title.innerHTML = "Users";
        
        const table = document.getElementById("user-table");
        table.innerHTML = ""; 

        users.forEach(user => {
            if (selected && user.username !== selected){
                return
            }
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
            table.appendChild(row);
        });

        table.addEventListener('click', (event) => {
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
        const response = await fetch(`/tests/api/v1/group/${(groupName)}`);
        if (!response.ok) throw new Error("Failed to fetch group data");

        const data = await response.json();

        const table = document.getElementById("user-table");
        if (!table) return;

        table.innerHTML = "";

        const title = document.getElementById("title");
        title.innerHTML = groupName;


        (data.users || []).forEach(user => {
            const row = document.createElement("tr");

            const userSpans = `<span class="clickable-item" data-type="dashboard" data-value="${user.name}">${user.name}</span>`


            row.innerHTML = `
            <td>${userSpans}</td>
            <td>${user.role}</td>
            `;
            table.appendChild(row);
        });

            table.addEventListener('click', (event) => {
            if (event.target.classList.contains('clickable-item')) {
                const type = event.target.getAttribute('data-type'); 
                const value = event.target.getAttribute('data-value'); 
                
                console.log(`Clicked on ${type}: ${value}`);
                loadTableData(value)
            }
        })

    } catch (error) {
        console.error("Error loading group data:", error);
    }
}