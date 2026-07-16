import { Widget } from '../Widget.js'

// Short, well-known, freely-attributed science quotes.
// No reliable free "science quotes" API exists, so this is a curated local set.
const SCIENCE_QUOTES = [
    { text: "Somewhere, something incredible is waiting to be known.", source: "Carl Sagan" },
    { text: "The important thing is not to stop questioning.", source: "Albert Einstein" },
    { text: "Nothing in life is to be feared, it is only to be understood.", source: "Marie Curie" },
    { text: "For small creatures such as we, the vastness is bearable only through love.", source: "Carl Sagan" },
    { text: "If I have seen further, it is by standing on the shoulders of giants.", source: "Isaac Newton" },
    { text: "The good thing about science is that it's true whether or not you believe in it.", source: "Neil deGrasse Tyson" },
    { text: "Imagination is more important than knowledge.", source: "Albert Einstein" },
    { text: "We are a way for the cosmos to know itself.", source: "Carl Sagan" },
    { text: "Study hard what interests you the most, in the most undisciplined, irreverent and original manner possible.", source: "Richard Feynman" },
    { text: "Equipped with his five senses, man explores the universe around him and calls the adventure Science.", source: "Edwin Hubble" },
]

// ZenQuotes/They Said So etc. either require a key or block direct browser
// requests via CORS, so this is a curated local set too.
const MOTIVATIONAL_QUOTES = [
    { text: "The best way to get started is to quit talking and begin doing.", source: "Walt Disney" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", source: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", source: "Theodore Roosevelt" },
    { text: "It always seems impossible until it's done.", source: "Nelson Mandela" },
    { text: "Do what you can, with what you have, where you are.", source: "Theodore Roosevelt" },
    { text: "The only way to do great work is to love what you do.", source: "Steve Jobs" },
    { text: "Great things never come from comfort zones.", source: null },
    { text: "Push yourself, because no one else is going to do it for you.", source: null },
    { text: "Dream it. Wish it. Do it.", source: null },
    { text: "Small daily improvements are the key to staggering long-term results.", source: null },
]

// Original haikus written for this widget, so there's no attribution or
// copyright ambiguity around reproducing someone else's work.
const HAIKUS = [
    { text: "Winter breath on glass\na single leaf still hanging\nwaits for the north wind", source: "Original" },
    { text: "Server room hums low\ncooling fans keep quiet watch\nover sleeping code", source: "Original" },
    { text: "Mountain holds its snow\nfar below the valley wakes\nto a thin grey light", source: "Original" },
    { text: "Coffee steam rises\npast the window, past the roofs\nmorning starts again", source: "Original" },
    { text: "Tide pulls back the sand\nleaving small and perfect shells\nfor no one to find", source: "Original" },
    { text: "Old clock on the wall\nkeeps counting what it can't keep\nsecond after second", source: "Original" },
    { text: "Rain taps on the roof\nsomewhere a seed remembers\nhow to become green", source: "Original" },
    { text: "City lights flicker\nstars behind them wait patient\nfor the power to fail", source: "Original" },
]

// Small public-domain (WEB translation) fallback set, used only if the
// live bible-api.com request fails.
const BIBLE_FALLBACK = [
    { text: "In the beginning, God created the heavens and the earth.", source: "Genesis 1:1, WEB" },
    { text: "The LORD is my shepherd; I shall lack nothing.", source: "Psalm 23:1, WEB" },
    { text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.", source: "John 3:16, WEB" },
    { text: "Trust in the LORD with all your heart, and don't lean on your own understanding.", source: "Proverbs 3:5, WEB" },
]

const CATEGORIES = ["bible", "science", "motivational", "haiku"]

function hashString(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
}

function todayKey() {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function pickFrom(list, seed) {
    return list[hashString(seed) % list.length]
}

export class QuoteWidget extends Widget {
    constructor(config) {
        super(config)

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
        this.card.classList.add("quote-widget", `font-${this.font}`)

        this.badgeEl = document.createElement("span")
        this.badgeEl.classList.add("quote-badge")
        this.card.appendChild(this.badgeEl)

        this.textEl = document.createElement("blockquote")
        this.textEl.classList.add("quote-text")
        this.card.appendChild(this.textEl)

        this.sourceEl = document.createElement("cite")
        this.sourceEl.classList.add("quote-source")
        this.card.appendChild(this.sourceEl)

        this.load()
    }

    resolveCategory() {
        if (this.category !== "mixed") return this.category
        const cat = pickFrom(CATEGORIES, `${this.id}-${todayKey()}-cat`)
        return cat
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
            : MOTIVATIONAL_QUOTES

        const quote = pickFrom(bank, `${this.id}-${todayKey()}-${category}`)
        this.render(quote)
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

            const quote = {
                text: v.text.trim(),
                source: `${v.book} ${v.chapter}:${v.verse}, WEB`
            }

            localStorage.setItem(cacheKey, JSON.stringify(quote))
            this.render(quote)
        } catch (err) {
            console.error("QuoteWidget: bible-api.com fetch failed, using fallback", err)
            this.render(pickFrom(BIBLE_FALLBACK, `${this.id}-${todayKey()}-bible`))
        }
    }

    render(quote) {
        this.textEl.innerText = quote.text
        this.sourceEl.innerText = quote.source || ""
        this.sourceEl.style.display = (this.show_source && quote.source) ? "" : "none"
    }
}