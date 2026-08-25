import { Widget } from '../Widget.js'

const DEMO_CATEGORIES = [
    { name: "Groceries", budget: 600, spent: 412 },
    { name: "Transport", budget: 200, spent: 134 },
    { name: "Fun", budget: 300, spent: 289 },
    { name: "Subscriptions", budget: 120, spent: 96 },
]

const DEMO_TRANSACTIONS = [
    { name: "Migros", amount: -58.40, date: "2h ago" },
    { name: "Salary", amount: 3850, date: "1d ago" },
    { name: "Spotify", amount: -11.99, date: "2d ago" },
    { name: "Coop", amount: -34.20, date: "3d ago" },
]

export class FinanceWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        this.categories = config.categories || DEMO_CATEGORIES
        this.transactions = config.transactions || DEMO_TRANSACTIONS

        const currency = config.settings?.currency || "CHF"
        this.formatAmount = new Intl.NumberFormat([], { style: "currency", currency }).format

        this.balanceEl = null
        this.categoriesEl = null
        this.transactionsEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("finance-widget")

        this.balanceEl = document.createElement("div")
        this.balanceEl.className = "finance-balance"
        this.content.appendChild(this.balanceEl)

        this.appendLabel("Budgets")
        this.categoriesEl = document.createElement("div")
        this.categoriesEl.className = "finance-categories"
        this.content.appendChild(this.categoriesEl)

        this.appendLabel("Recent")
        this.transactionsEl = document.createElement("ul")
        this.transactionsEl.className = "finance-transactions"
        this.content.appendChild(this.transactionsEl)

        this.render()
    }

    appendLabel(text) {
        const label = document.createElement("span")
        label.className = "widget-section-label"
        label.innerText = text
        this.content.appendChild(label)
    }

    render() {
        this.balanceEl.innerHTML = ""

        const label = document.createElement("span")
        label.className = "finance-balance-label"
        label.innerText = "Available"

        const value = document.createElement("span")
        value.className = "finance-balance-value"
        const totalBudget = this.categories.reduce((s, c) => s + c.budget, 0)
        const totalSpent = this.categories.reduce((s, c) => s + c.spent, 0)
        value.innerText = this.formatAmount(totalBudget - totalSpent)

        this.balanceEl.append(label, value)

        this.categoriesEl.innerHTML = ""
        this.categories.forEach(cat => {
            const pct = Math.min(100, Math.round((cat.spent / cat.budget) * 100))

            const row = document.createElement("div")
            row.className = "finance-cat"

            const head = document.createElement("div")
            head.className = "finance-cat-head"

            const name = document.createElement("span")
            name.className = "finance-cat-name"
            name.innerText = cat.name

            const spent = document.createElement("span")
            spent.className = "finance-cat-spent"
            spent.innerText = `${this.formatAmount(cat.spent)} / ${this.formatAmount(cat.budget)}`

            head.append(name, spent)

            const bar = document.createElement("div")
            bar.className = "finance-cat-bar"
            const fill = document.createElement("div")
            fill.className = "finance-cat-fill"
            if (pct >= 90) fill.classList.add("over")
            fill.style.width = `${pct}%`
            bar.appendChild(fill)

            row.append(head, bar)
            this.categoriesEl.appendChild(row)
        })

        this.transactionsEl.innerHTML = ""
        this.transactions.forEach(tx => {
            const item = document.createElement("li")
            item.className = "finance-tx"

            const name = document.createElement("span")
            name.className = "finance-tx-name"
            name.innerText = tx.name

            const meta = document.createElement("span")
            meta.className = "finance-tx-meta"

            const date = document.createElement("span")
            date.className = "finance-tx-date"
            date.innerText = tx.date

            const amount = document.createElement("span")
            amount.className = "finance-tx-amount"
            amount.classList.add(tx.amount < 0 ? "negative" : "positive")
            amount.innerText = (tx.amount < 0 ? "−" : "+") + this.formatAmount(Math.abs(tx.amount))

            meta.append(date, amount)
            item.append(name, meta)
            this.transactionsEl.appendChild(item)
        })
    }
}