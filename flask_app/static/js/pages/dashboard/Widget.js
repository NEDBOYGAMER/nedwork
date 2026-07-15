export class Widget {
    constructor(config) {
        this.type = config.type
        this.id = config.id
        this.title = config.settings.title
        this.card = null
    }

    active_widget = null

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

            active_widget = this.id

            const menu = document.getElementById("card-context-menu")

            menu.style.left = `${event.pageX}px`
            menu.style.top = `${event.pageY}px`

            menu.classList.remove("context-hidden")
        })

        document.addEventListener("click", () => {
            document.getElementById("card-context-menu").classList.add("context-hidden")
        })
    }
}