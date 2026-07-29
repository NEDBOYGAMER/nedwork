document.addEventListener('DOMContentLoaded', () => {

        
    // Active button
    let activeId = "";

    console.log(window.location.pathname)
    switch (window.location.pathname) {
        case "/dashboard/":
            activeId = "home-btn";
            break;

        case "/events/":
            activeId = "events-btn";
            break;

        case "/tasks/":
            activeId = "tasks-btn";
            break;

        case "/app_corner/":
            activeId = "apps-btn";
            break;

        default:
            activeId = "";
    }


    const navButtonIds = [
        "home-btn",
        "events-btn",
        "tasks-btn",
        "apps-btn",
    ];

    
    navButtonIds.forEach(id => {
        if (id === activeId){
        document.getElementById(id).classList.add("active")
        console.log(document.getElementById(id).classList)
        }
        else{
        document.getElementById(id).classList.remove("active")
        }
        
    });


    document.getElementById("home-btn").addEventListener("click", () => {
        window.location.href = "/dashboard";
    });

    document.getElementById("events-btn").addEventListener("click", () => {
        // window.location.href = "/events";
    });

    document.getElementById("tasks-btn").addEventListener("click", () => {
        // window.location.href = "/tasks";
    });

    document.getElementById("apps-btn").addEventListener("click", () => {
        window.location.href = "/app_corner";
    });

    document.getElementById("about-btn").addEventListener("click", () => {
        // window.location.href = "/about";
    });

    document.getElementById("settings-btn").addEventListener("click", () => {
        window.location.href = "/settings";
    });

    document.getElementById("account-btn").addEventListener("click", () => {
        // window.location.href = "/account";
    });

    document.getElementById("logout-btn").addEventListener("click", () => {
        // window.location.href = "/auth/logout";
    });



})