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
            console.log(this.title)
        }
    
        this.setUpContext()
    }


    setUpContext() {
        this.card.addEventListener("contextmenu", (event) => {
            event.preventDefault()

            console.log("context")

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
            

        })

        document.addEventListener("click", () => {
            let menu = document.getElementById("context-menu")
            menu?.remove()
            
        })

    }

}
