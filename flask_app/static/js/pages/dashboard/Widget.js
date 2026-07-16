export class Widget {
    constructor(config) {
        this.type = config.type
        this.id = config.id
        this.title = config.settings.title
        this.card = null
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
    
        this.setUpContext()
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
                this.deleteWidget()

            })
            

        })

        document.addEventListener("click", () => {
            let menu = document.getElementById("context-menu")
            menu?.remove()
            
        })

    }

    async deleteWidget() {
    
        const dashboard_info = await fetch('/dashboard/api/load/main');
        const dashboard = await dashboard_info.json();
    
        let widgets = dashboard.widgets
        
        console.log(widgets)
        widgets = widgets.filter(widget => widget.id !== this.id);
        console.log(widgets)
    
        let dashboard_name = localStorage.getItem("dashboard_name");
    
        const response = await fetch('/dashboard/api/update/update_widget', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: dashboard_name,
                widgets: widgets
            })
        });

        this.card.dispatchEvent(new CustomEvent("widget:update", {bubbles: true,}))
    
    }
}

