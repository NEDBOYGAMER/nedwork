import { createBackground, colorMap, applyColor } from '../components/background.js';

let apps
let appCornerConfig
const types = new Set();

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


    const appCornerConfig = await loadJsonData();


    renderShelfs()



    // Fetch data and render cards
    const appsData = await loadJsonData();
    if (appsData && Array.isArray(appsData)) {
        apps = appsData
        renderAppCards();
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


function renderShelfs() {
    const grid = document.getElementById('grid');
    if (!grid) return;

    grid.innerHTML = '';

    
    if (appCornerConfig.recent_enabled){
        createShelf(name="Recent", oneline=true, style = "recent")
    }
    
    let favApps = appCornerConfig.favorited_apps

    if (favApps.length !== 0){
        createShelf(name="Favorites", oneline=false, style = "favorite_apps")
    }
    
    
    let favShelfs = favorited_shelfs
    
    
    favShelfs.forEach((shelf, index) => { // should be sorted when saved the the fisrt is always the first
        createShelf(name=shelf, oneline=false, style = "favorites")
    });
    
    
    apps.forEach(app => {
        if (!appCornerConfig.disabled_shelfs && !favShelfs.includes(app.type)){
            types.add(app.type);
        }
    });
    
    types.forEach(shelf =>{
        createShelf(name=shelf, oneline=false, style = "none")
    })

    let disShelfs = disabled_shelfs

    disShelfs.forEach((shelf, index) => {
        createShelf(name=shelf, oneline=false, style = "disabled")
    });

    createShelf(name=shelf, oneline=false, style = "disabled") // contains disabled apps

}

function createShelf(name, oneline, disabled){
    //make the code for the shelf here
    // oneline means no grid just one row, so it limited
}


function renderAppCards() {
    const grid = document.getElementById('grid');
    if (!grid) return;



    apps.forEach(app => {
        
        //create the card and so on here
        
        
        
        
        // add to correct shelf



        // for disabled apps in the disabled_shelf
        if (appCornerConfig.disabled_apps.includes(app.name)){
        }
        


        grid.appendChild(card);
    });
}


function saveNewConfig(){
    //figure this out yourself as i have no idea
}