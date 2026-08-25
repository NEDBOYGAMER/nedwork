import { Widget } from '../Widget.js'

const CATEGORIES = ["bible", "science", "motivational", "haiku", "cinematic"]

const SCIENCE_QUOTES = [
    { text: "Somewhere, something incredible is waiting to be known.", source: "Carl Sagan" },
    { text: "If I have seen further, it is by standing on the shoulders of giants.", source: "Isaac Newton" },
    { text: "The good thing about science is that it's true whether or not you believe in it.", source: "Neil deGrasse Tyson" },
    { text: "Imagination is more important than knowledge.", source: "Albert Einstein" },
    { text: "We are a way for the cosmos to know itself.", source: "Carl Sagan" },
    { text: "Equipped with his five senses, man explores the universe around him and calls the adventure Science.", source: "Edwin Hubble" },
    { text: "If you want to make an apple pie from scratch, you must first create the universe.", source: "Carl Sagan" },
    { text: "The important thing is not to stop questioning.", source: "Albert Einstein" },
    { text: "The Earth is a cradle of the mind, but we cannot live forever in a cradle.", source: "Konstantin E. Tsiolkovsky" },
    { text: "Space is big. Really big.", source: "Douglas Adams" },
]

const MOTIVATIONAL_QUOTES = [
    { text: "The best way to get started is to quit talking and begin doing.", source: "Walt Disney" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", source: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", source: "Theodore Roosevelt" },
    { text: "Push yourself, because no one else is going to do it for you.", source: null },
    { text: "Small daily improvements are the key to staggering long-term results.", source: null },
    { text: "The journey is the reward.", source: "Taoist Saying" },
    { text: "Knowledge speaks, but wisdom listens.", source: "Jimi Hendrix" },
    { text: "Education is a progressive discovery of our own ignorance.", source: "Will Durant" },
]

const HAIKUS = [
    { text: "An old silent pond\na frog jumps into the pond\nsplash, silence again", author: "Matsuo Bashō" },
    { text: "The light of a candle\nis transferred to another candle\nspring twilight", author: "Yosa Buson" },
    { text: "O snail\nclimb Mount Fuji\nbut slowly, slowly", author: "Kobayashi Issa" },
    { text: "The old pond\nstillness all around\nwater sounds", author: "Matsuo Bashō" },
    { text: "Evening breeze blows\nwater ripples beneath the moon\nquiet summer night", author: "Yosa Buson" },
]

const CINEMATIC_QUOTES = [
    { text: "May the Force be with you.", source: "Star Wars: Episode IV" },
    { text: "There is no spoon.", source: "The Matrix" },
    { text: "I'll be back.", source: "The Terminator" },
    { text: "Houston, we have a problem.", source: "Apollo 13" },
    { text: "Fear is the mind-killer.", source: "Dune" },
    { text: "Live long and prosper.", source: "Star Trek" },
    { text: "Do, or do not. There is no try.", source: "Star Wars: Episode V" },
    { text: "You shall not pass!", source: "The Lord of the Rings" },
    { text: "Why so serious?", source: "The Dark Knight" },
    { text: "With great power comes great responsibility.", source: "Spider-Man" },
    { text: "War. War never changes.", source: "Fallout" },
    { text: "Nothing is true, everything is permitted.", source: "Assassin's Creed" },
    { text: "I'm going to make him an offer he can't refuse.", source: "The Godfather" },
    { text: "This is Sparta!", source: "300" },
]

const BIBLE_FALLBACK = [
    { text: "In the beginning, God created the heavens and the earth.", source: "Genesis 1:1, WEB" },
    { text: "The LORD is my shepherd; I shall lack nothing.", source: "Psalm 23:1, WEB" },
    { text: "For God so loved the world, that he gave his one and only Son.", source: "John 3:16, WEB" },
]

function hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
}

function todayKey() {
    return new Date().toISOString().slice(0, 10)
}

function pickFrom(list, seed) {
    return list[hashString(seed) % list.length]
}

export class QuoteWidget extends Widget {
    constructor(config, ctx) {
        super(config, ctx)

        const settings = config.settings

        this.category = settings.category || "mixed"
        this.font = settings.font || "serif"
        this.show_source = settings.show_source

        this.badgeEl = null
        this.textEl = null
        this.sourceEl = null
    }

    build() {
        this.buildShell()
        this.content.classList.add("quote-widget", `font-${this.font}`)

        this.badgeEl = document.createElement("span")
        this.badgeEl.className = "quote-badge"
        this.content.appendChild(this.badgeEl)

        this.textEl = document.createElement("blockquote")
        this.textEl.className = "quote-text"
        this.content.appendChild(this.textEl)

        this.sourceEl = document.createElement("cite")
        this.sourceEl.className = "quote-source"
        this.content.appendChild(this.sourceEl)

        this.load()
    }

    resolveCategory() {
        if (this.category !== "mixed") return this.category
        return pickFrom(CATEGORIES, `${this.id}-${todayKey()}-cat`)
    }

    async load() {
        const category = this.resolveCategory()
        this.badgeEl.innerText = category

        if (category === "bible") {
            await this.loadBibleVerse()
            return
        }

        const bank = category === "science" ? SCIENCE_QUOTES
            : category === "haiku" ? HAIKUS
            : category === "cinematic" ? CINEMATIC_QUOTES
            : MOTIVATIONAL_QUOTES

        this.render(pickFrom(bank, `${this.id}-${todayKey()}-${category}`))
    }

    async loadBibleVerse() {
        const cacheKey = `quote-widget-bible-${this.id}-${todayKey()}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
            this.render(JSON.parse(cached))
            return
        }

        try {
            const res = await fetch("https://bible-api.com/data/web/random")
            const data = await res.json()
            const v = data.random_verse
            const quote = { text: v.text.trim(), source: `${v.book} ${v.chapter}:${v.verse}, WEB` }
            localStorage.setItem(cacheKey, JSON.stringify(quote))
            this.render(quote)
        } catch (err) {
            console.error("QuoteWidget: bible-api.com failed, using fallback", err)
            this.render(pickFrom(BIBLE_FALLBACK, `${this.id}-${todayKey()}-bible`))
        }
    }

    render(quote) {
        this.textEl.innerText = quote.text
        this.sourceEl.innerText = quote.source || ""
        this.sourceEl.style.display = (this.show_source && quote.source) ? "" : "none"
    }
}