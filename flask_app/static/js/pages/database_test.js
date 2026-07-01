// flask_app/static/js/pages/database_test.js
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded! Calling loadTableData now...");
    loadTableData();
});

async function loadTableData() {
    try {
        // 1. Fetch data from your Flask endpoint
        const response = await fetch('/tests/api/v1/test-users');
        if (!response.ok) throw new Error("Failed to fetch database data");
        
        const users = await response.json();
        
        // 2. Select your tbody element
        const tbody = document.querySelector("#user-table tbody");
        tbody.innerHTML = ""; // Clear any placeholders or loading text

        // 3. Loop through and append rows
        users.forEach(user => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.dashboards.join(', ') || 'None'}</td>
                <td>${user.groups.join(', ') || 'None'}</td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        console.error("Error loading data:", error);
    }
}