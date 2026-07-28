import { createBackground, colorMap, applyColor } from '../components/background.js';

document.addEventListener('DOMContentLoaded', async () => {
    const cursor = document.getElementById('cursor');
    const ring = document.getElementById('cursor-ring');
    const canvas = document.getElementById('bg-canvas');

    if (cursor && ring && canvas) {
        const background = createBackground({ cursor, ring, canvas });
        background.start();
    } else {
        console.warn('Missing background elements');
    }

    // Fetch data and render cards
    const appsData = await loadJsonData();
    if (appsData && Array.isArray(appsData)) {
        renderAppCards(appsData);
    }
});

async function loadJsonData() {
    try {
        const response = await fetch('/app_corner/api/apps-data');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to load JSON file:', error);
        return [];
    }
}

function renderAppCards(apps) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    grid.innerHTML = ''; // Clear existing content

    apps.forEach(app => {
        // Create container
        const card = document.createElement('div');
        card.className = 'app-card';

        // Title
        const title = document.createElement('h3');
        title.textContent = app.name;
        card.appendChild(title);

        // Optional Description (Remove if unwanted)
        if (app.description) {
            const desc = document.createElement('p');
            desc.textContent = app.description;
            card.appendChild(desc);
        }

        if (app.url && app.url !== '/placeholder') {
            const btn = document.createElement('a');
            
            // Ensure leading slash to avoid relative path issues
            btn.href = `/apps${app.url}`; 
            btn.className = 'app-btn';
            btn.textContent = 'Open App';
            card.appendChild(btn);
        } else {
            const disabledBtn = document.createElement('span');
            disabledBtn.className = 'app-btn disabled';
            disabledBtn.textContent = 'Coming Soon';
            card.appendChild(disabledBtn);
        }

        grid.appendChild(card);
    });
}