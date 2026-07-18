import { WIDGET_SETTINGS_SCHEMA } from "./widget_default.js";
export class Widget {
    constructor(config) {
        this.type = config.type
        this.id = config.id
        this.title = config.settings.title
        this.card = null
        this.widgets = null
        this.dashboard_name = null
    }

    buildShell() {
        this.card = document.createElement("div")
        this.card.classList.add("card")
        let grid = document.getElementById("card-grid");
        grid.appendChild(this.card)

        if (this.title !== ""){
            let titleEl = document.createElement("span")
            titleEl.classList.add("widget-title")
            titleEl.innerText = this.title
            this.card.appendChild(titleEl)
        }

        this.getInfos()
    
        this.setUpContext()
    }

    async getInfos(){
        const dashboard_info = await fetch('/dashboard/api/load/main');
        const dashboard = await dashboard_info.json();
        this.widgets = dashboard.widgets
        this.dashboard_name = localStorage.getItem("dashboard_name");
    }

    setUpContext() {
        this.card.addEventListener("contextmenu", (event) => {
            event.preventDefault()


            let menu = document.getElementById("context-menu")
            menu?.remove()

            
            menu = document.createElement("ul")
            menu.classList.add("context-menu")
            menu.id = "context-menu"
            menu.style.left = `${event.pageX}px`
            menu.style.top = `${event.pageY}px`

            const editbutton = document.createElement("li")
            editbutton.classList.add("context-option")
            editbutton.id = "edit-context-option"
            editbutton.innerText = "Edit"

            const deletebutton = document.createElement("li")
            deletebutton.classList.add("context-option")
            deletebutton.id = "delete-context-option"
            deletebutton.innerText = "Delete"

            document.body.appendChild(menu)
            menu.appendChild(editbutton)
            menu.appendChild(deletebutton)



            deletebutton.addEventListener("click", () =>{
                this.deleteWidget()

            })


            editbutton.addEventListener("click", () =>{
                this.editWidget()

            })
            

        })

        document.addEventListener("click", () => {
            let menu = document.getElementById("context-menu")
            menu?.remove()
            
        })

    }

    async deleteWidget() {    
        const response = await fetch('/dashboard/api/update/update_widget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: this.dashboard_name,
                widgets: this.widgets
            })
        });

        this.card.dispatchEvent(new CustomEvent("widget:update", {bubbles: true,}))
    
    }

    editWidget(){
        this.setUpSettings()
    }


    setUpSettings(){
        let container = document.createElement("div")
        container.classList.add("modal")
        container.id = "settings-modal"

        let type = this.type

        let settings = WIDGET_SETTINGS_SCHEMA[type]

        console.log(settings)
        Object.entries(settings).forEach(([key, value]) => {
            let line = document.createElement("p");
            line.innerText = `${key}: ${value}`;
            container.appendChild(line);
        });

        document.body.appendChild(container);
    }
}

