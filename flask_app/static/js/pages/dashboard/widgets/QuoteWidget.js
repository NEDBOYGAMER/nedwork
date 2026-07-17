import { Widget } from '../Widget.js'

const SCIENCE_QUOTES = [
    { text: "Somewhere, something incredible is waiting to be known.", source: "Carl Sagan" },
    { text: "If I have seen further, it is by standing on the shoulders of giants.", source: "Isaac Newton" },
    { text: "The good thing about science is that it's true whether or not you believe in it.", source: "Neil deGrasse Tyson" },
    { text: "Imagination is more important than knowledge.", source: "Albert Einstein" },
    { text: "We are a way for the cosmos to know itself.", source: "Carl Sagan" },
    { text: "Study hard what interests you the most, in the most undisciplined, irreverent and original manner possible.", source: "Richard Feynman" },
    { text: "Equipped with his five senses, man explores the universe around him and calls the adventure Science.", source: "Edwin Hubble" },
    { text: "If you want to make an apple pie from scratch, you must first create the universe.", source: "Carl Sagan (1934 -1996)" },
    { text: "It has become appallingly obvious that our technology has exceeded our humanity. ", source: "Albert Einstein (1879-1955)" },
    { text: "Stars are holes in the sky from which the light of the infinite shines.", source: "Confucius (551-479)" },
    { text: "While the other animals are prone and fix their gaze on the earth, the god gave man a face uplifted, bade him stand erect and turn his eyes to the stars.", source: "Publius Ovidius Naso (Metamorphoses I. 84-6)" },
    { text: "The greatest gain from space travel consists in the extension of our knowledge. In a hundred years this newly won knowledge will pay huge and unexpected dividends.", source: "Wernher von Braun (1912-1977)" },
    { text: "It's human nature to stretch, to go, to see, to understand. Exploration is not a choice, really; it's an imperative.", source: "Michael Collins (1930-)" },
    { text: "Don't tell me that man doesn't belong out there. Man belongs wherever he wants to go - and he'll do plenty well when he gets there.", source: "Wernher von Braun (1912-1977)" },
    { text: "What is now proved was once only imagined.", source: "William Blake (1757-1827)" },
    { text: "The universe is full of magical things patiently waiting for our wits to grow sharper.", source: "Eden Phillpotts (1862-1960)" },
    { text: "There is a single light of science, and to brighten it anywhere is to brighten it everywhere.", source: "Isaac Asimov (1920-1992)" },
    { text: "The most beautiful thing we can experience is the mysterious. It is the source of all true art and science.", source: "Albert Einstein (1879-1955)" },
    { text: "Imagination is more important than knowledge. Knowledge is limited. Imagination encircles the world.", source: "Albert Einstein (1879-1955)" },
    { text: "When I examine myself and my methods of thought, I come to the conclusion that the gift of fantasy has meant more to me than my talent for absorbing positive knowledge.", source: "Albert Einstein (1879-1955)" },
    { text: "As far as the laws of mathematics refer to reality, they are not certain; and as far as they are certain, they do not refer to reality.", source: "Albert Einstein (1879-1955)" },
    { text: "Any sufficiently advanced technology is indistinguishable from magic.", source: "Arthur C. Clarke (1917-2008)" },
    { text: "I don't know what you could say about a day in which you have seen four beautiful sunsets.", source: "John Glenn (1921-2016)" },
    { text: "It suddenly struck me that that tiny pea, pretty and blue, was the Earth. I put up my thumb and shut one eye, and my thumb blotted out the planet Earth. I didn't feel like a giant. I felt very, very small.", source: "Neil Armstrong (1930-2012)" },
    { text: "To confine our attention to terrestrial matters would be to limit the human spirit.", source: "Stephen Hawking (1942-2018)" },
    { text: "Science-fiction yesterday, fact today, obsolete tomorrow.", source: "Otto O. Binder (1911-1974)" },
    { text: "Man's mind and spirit grow with the space in which they are allowed to operate.", source: "Krafft A. Ehricke (1917-1984)" },
    { text: "The important thing is not to stop questioning.", source: "Albert Einstein (1879-1955)" },
    { text: "You would make a ship sail against the winds and currents by lighting a bonfire under her deck...I have no time for such nonsense.", source: "Napoleon Bonaparte (1769-1821)" },
    { text: "The Earth is a cradle of the mind, but we cannot live forever in a cradle.", source: "Konstantin E. Tsiolkovsky (1857-1935)" },
    { text: "Two possibilities exist: Either we are alone in the Universe or we are not. Both are equally terrifying.", source: "Arthur C. Clarke (1917-2008)" },
    { text: "Space isn't remote at all. It's only an hour's drive away, if your car could go straight upwards.", source: "Sir Fred Hoyle (1915-2001)" },
    { text: "Space is big. Really big.", source: "Douglas Adams (1952-2001)" },
    { text: "I measured the skies Now the shadows I measure Skybound was the mind Earthbound the body rests.", source: "Johannes Kepler (1571-1630)" },
    { text: "Discovery consists of seeing what everybody has seen and thinking what nobody has thought.", source: "Albert Szent-Gyorgyi (1893-1986)" },
    { text: "Whether outwardly or inwardly, whether in space or time, the farther we penetrate the unknown, the vaster and more marvellous it becomes.", source: "Charles A. Lindbergh (1902-1974)" }
]

const MOTIVATIONAL_QUOTES = [
    { text: "The best way to get started is to quit talking and begin doing.", source: "Walt Disney" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", source: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", source: "Theodore Roosevelt" },
    { text: "Push yourself, because no one else is going to do it for you.", source: null },
    { text: "Dream it. Wish it. Do it.", source: null },
    { text: "Small daily improvements are the key to staggering long-term results.", source: null },
    { text: "Life is pleasant. Death is peaceful. It's the transition that's troublesome.", source: "Isaac Asimov (1920-1992)" },
    { text: "Be nice to people on your way up because you meet them on your way down.", source: "Jimmy Durante (1893-1980)" },
    { text: "Knowledge speaks, but wisdom listens.", source: "Jimi Hendrix (1942-1970)" },
    { text: "Education is a progressive discovery of our own ignorance.", source: "Will Durant (1885-1981)" },
    { text: "Obstacles are those frightful things you see when you take your eyes off your goal.", source: "Henry Ford (1863-1947)" },
    { text: "While we are postponing, life speeds by.", source: "Seneca (3BC-65AD)" },
    { text: "First they ignore you, then they laugh at you, then they fight you, then you win.", source: "Mahatma Gandhi (1869-1948)" },
    { text: "Most people would sooner die than think; in fact, they do so.", source: "Bertrand Russell (1872-1970)" },
    { text: "The mistakes are all waiting to be made. ", source: "Chessmaster Savielly Grigorievitch Tartakower (1887-1956)" },
    { text: "Try not. Do, or do not. There is no 'try'.", source: "Yoda" },
    { text: "I may not have gone where I intended to go, but I think I have ended up where I needed to be.", source: "Douglas Adams (1952-2001)" },
    { text: "Tell me, o Muse, of that ingenious hero who travelled far and wide...", source: "Homer's Odyssey (800BC)" },
    { text: "Whatever trip we start, it is for the search of happiness. But happiness is here.", source: "Quintus Flaccus (238-209)" },
    { text: "Nothing is constant but change.", source: "Sakyamuni, founder of Buddhism (563-483)" },
    { text: "The only ones who fly are the ones who dare to fly.", source: "Luis Sepulveda, Chilean writer (1949 -)" },
    { text: "The greatest thing You'll ever learn Is just to love and Be loved in return", source: "Eden Ahbez (1908-1995)" },
    { text: "May god stand between you and harm, in all the dark places you must walk.", source: "Ancient Egyptian Proverb" },
    { text: "To win one hundred victories in one hundred battles is not the highest skill. To subdue the enemy without fighting, is the highest skill.", source: "Sun-Tsu (500BC)" },
    { text: "There must be something worth living for There must be something worth trying for Even some things worth dying for And if one man can stand tall There must be some hope for us all Somewhere, somewhere in the spirit of man", source: "War of the Worlds musical by Jeff Wayne" },
    { text: "Mother, I saw a dream in the night. There were stars in the sky for me.", source: "The Epic of Gilgamesh (around 800 BC)" },
    { text: "To go places and do things that have never been done before - that's what living is all about.", source: "Michael Collins (1930-)" },
    { text: "Hold fast to dreams, for if dreams die, life is a broken bird that cannot fly.", source: "Langston Hughes (1902-1967)" },
    { text: "Minds are like parachutes - they only function when open.", source: "Thomas Dewar (1864-1930)" },
    { text: "Shoot for the moon. Even if you miss, you'll land among the stars.", source: "Les Brown (1945-)" },
    { text: "Even a fool knows you can't touch the stars, but it doesn't stop a wise man from trying.", source: "Harry Anderson (1952-2018)" },
    { text: "And if you gaze for long into an abyss, the abyss gazes also into you.", source: "Friedrich Nietzsche (1844-1900)" },
    { text: "Following the light of the sun, we left the Old World.", source: "Inscription on Columbus' caravels" },
    { text: "Throw your dreams into space like a kite, and you do not know what it will bring back, a new life, a new friend, a new love, a new country.", source: "Anais Nin (1903-1977)" },
    { text: "If you can imagine it, you can achieve it. If you can dream it, you can become it.", source: "William Arthur Ward (1921-1994)" },
    { text: "Imagination is the only weapon in the war against reality.", source: "Jules de Gautier (1811-1872)" },
    { text: "The journey is the reward.", source: "Taoist Saying" },
    { text: "It is good to have an end to journey toward, but it is the journey that matters in the end.", source: "Ursula K. LeGuin (1929-2018)" },
    { text: "Your current safe boundaries were once unknown frontiers.", source: "Unknown" },
    { text: "The future belongs to those who believe in the beauty of their dreams.", source: "Eleanor Roosevelt (1884-1962)" },
    { text: "Dreams are renewable. No matter what our age or condition, there are still untapped possibilities within us and new beauty waiting to be born.", source: "Dale Turner" },
    { text: "Reality is that part of the imagination we all agree on.", source: "Unknown" },
    { text: "Time is the fire in which we burn.", source: "Delmore Schwartz (1913-1966)" },
    { text: "There shall be wings! If the accomplishment be not for me, 'tis for some other. The spirit cannot die; and man, who shall know all and shall have wings...", source: "Leonardo da Vinci (1452-1519)" }
]

// Original haikus written for this widget, so there's no attribution or
// copyright ambiguity around reproducing someone else's work.
const HAIKUS = [
    { text: "An old silent pond\na frog jumps into the pond\nsplash, silence again", author: "Matsuo Bashō" },
    { text: "The light of a candle\nis transferred to another candle\nspring twilight", author: "Yosa Buson" },
    { text: "O snail\nclimb Mount Fuji\nbut slowly, slowly", author: "Kobayashi Issa" },
    { text: "Don’t worry spiders\nI keep house\ncasually", author: "Kobayashi Issa" },
    { text: "In the twilight rain\nthese brilliant hued hibiscus\nA beautiful sunset", author: "Matsuo Bashō" },
    { text: "A cicada shell\nit sang itself\nempty", author: "Kobayashi Issa" },
    { text: "The first cold shower\neven the monkey seems to want\na little coat of straw", author: "Matsuo Bashō" },
    { text: "A summer river being crossed\nhow pleasing\nwith sandals in my hands", author: "Yosa Buson" },
    { text: "On a withered branch\na crow has settled\nautumn evening", author: "Matsuo Bashō" },
    { text: "The snow is melting\nand the village is flooded\nwith children", author: "Kobayashi Issa" },
    { text: "The old pond\nstillness all around\nwater sounds", author: "Matsuo Bashō" },
    { text: "A world of dew\nand within every dewdrop\na world of struggle", author: "Kobayashi Issa" },
    { text: "First autumn morning\nthe mirror I stare into\nshows my father's face", author: "Kobayashi Issa" },
    { text: "A mountain village\nunder the piled up snow\nsound of water", author: "Yosa Buson" },
    { text: "The moon is bright\nin the evening breeze\nwaves in the grass", author: "Matsuo Bashō" },
    { text: "Spring has passed\nbirds cry and fishes' eyes\nare filled with tears", author: "Matsuo Bashō" },
    { text: "The temple bell stops\nbut the sound keeps coming\nout of the flowers", author: "Matsuo Bashō" },
    { text: "Everything I touch\nwith tenderness, alas\npricks like a bramble", author: "Kobayashi Issa" },
    { text: "A world of pain\nand yet the cherry blossoms\nare blooming", author: "Kobayashi Issa" },
    { text: "Evening breeze blows\nwater ripples beneath the moon\nquiet summer night", author: "Yosa Buson" }
];

// Small public-domain (WEB translation) fallback set, used only if the
// live bible-api.com request fails.
const BIBLE_FALLBACK = [
    { text: "In the beginning, God created the heavens and the earth.", source: "Genesis 1:1, WEB" },
    { text: "The LORD is my shepherd; I shall lack nothing.", source: "Psalm 23:1, WEB" },
    { text: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.", source: "John 3:16, WEB" },
    { text: "Trust in the LORD with all your heart, and don't lean on your own understanding.", source: "Proverbs 3:5, WEB" },
]

const CINEMATIC_QUOTES = [
    // --- Sci-Fi & Space Operas ---
    { text: "May the Force be with you.", source: "Star Wars: Episode IV - A New Hope" },
    { text: "There is no spoon.", source: "The Matrix" },
    { text: "I'll be back.", source: "The Terminator" },
    { text: "Hasta la vista, baby.", source: "Terminator 2: Judgment Day" },
    { text: "Houston, we have a problem.", source: "Apollo 13" },
    { text: "Fear is the mind-killer.", source: "Dune" },
    { text: "I've seen things you people wouldn't believe. Attack ships on fire off the shoulder of Orion...", source: "Blade Runner" },
    { text: "Live long and prosper.", source: "Star Trek" },
    { text: "Do, or do not. There is no try.", source: "Star Wars: Episode V - The Empire Strikes Back" },
    { text: "We're not in Kansas anymore.", source: "The Wizard of Oz" },

    // --- High Fantasy & Epic Sagas ---
    { text: "You shall not pass!", source: "The Lord of the Rings: The Fellowship of the Ring" },
    { text: "For Frodo.", source: "The Lord of the Rings: The Return of the King" },
    { text: "All we have to decide is what to do with the time that is given us.", source: "The Lord of the Rings: The Fellowship of the Ring" },
    { text: "I would have followed you, my brother... my captain... my king.", source: "The Lord of the Rings: The Fellowship of the Ring" },
    { text: "My precious.", source: "The Lord of the Rings: The Two Towers" },
    { text: "You're a wizard, Harry.", source: "Harry Potter and the Sorcerer's Stone" },
    { text: "Winter is coming.", source: "Game of Thrones" },
    { text: "We do not sow.", source: "Game of Thrones" },
    { text: "What do we say to the God of Death? Not today.", source: "Game of Thrones" },
    { text: "Chaos isn't a pit. Chaos is a ladder.", source: "Game of Thrones" },

    // --- Superhero & Comic Lore ---
    { text: "Why so serious?", source: "The Dark Knight" },
    { text: "If you're good at something, never do it for free.", source: "The Dark Knight" },
    { text: "I am Iron Man.", source: "Avengers: Endgame" },
    { text: "With great power comes great responsibility.", source: "Spider-Man" },
    { text: "Wakanda Forever!", source: "Black Panther" },
    { text: "I can do this all day.", source: "Captain America: The First Avenger" },
    { text: "That's my secret, Cap. I'm always angry.", source: "The Avengers" },
    { text: "On your left.", source: "Captain America: The Winter Soldier" },
    { text: "I am Groot.", source: "Guardians of the Galaxy" },
    { text: "Dormammu, I've come to bargain.", source: "Doctor Strange" },
    { text: "Bring me Thanos!", source: "Avengers: Infinity War" },
    { text: "I see this as an absolute win!", source: "Avengers: Endgame" },
    { text: "Avengers, assemble!", source: "Avengers: Endgame" },
    { text: "I love you 3000.", source: "Avengers: Endgame" },

    // --- Gaming & Dark Fantasy Lore ---
    { text: "Silver for monsters, steel for humans.", source: "The Witcher" },
    { text: "Evil is evil. Lesser, greater, middling... makes no difference.", source: "The Witcher" },
    { text: "War. War never changes.", source: "Fallout" },
    { text: "Nothing is true, everything is permitted.", source: "Assassin's Creed" },
    { text: "Boy!", source: "God of War" },
    { text: "It's time to kick ass and chew bubblegum... and I'm all out of gum.", source: "Duke Nukem / They Live" },

    // --- Classic Badass & Action ---
    { text: "I'm going to make him an offer he can't refuse.", source: "The Godfather" },
    { text: "Keep your friends close, but your enemies closer.", source: "The Godfather Part II" },
    { text: "Are you not entertained?", source: "Gladiator" },
    { text: "The name's Bond. James Bond.", source: "Dr. No" },
    { text: "This is Sparta!", source: "300" },
    { text: "They may take our lives, but they'll never take our freedom!", source: "Braveheart" },
    { text: "Go ahead, make my day.", source: "Sudden Impact" },
    { text: "Say hello to my little friend!", source: "Scarface" },
    { text: "You're gonna need a bigger boat.", source: "Jaws" },
    { text: "The first rule of Fight Club is: You do not talk about Fight Club.", source: "Fight Club" },
    { text: "You talking to me?", source: "Taxi Driver" },
    { text: "I am the one who knocks.", source: "Breaking Bad" },
    { text: "I am the danger.", source: "Breaking Bad" },
    { text: "You can't handle the truth!", source: "A Few Good Men" },
    { text: "Welcome to Jurassic Park.", source: "Jurassic Park" },
    { text: "Shaken, not stirred.", source: "Goldfinger" },

    // --- Adventure, Drama & Modern Classics ---
    { text: "Captain... Jack... Sparrow.", source: "Pirates of the Caribbean: The Curse of the Black Pearl" },
    { text: "Carpe diem. Seize the day, boys. Make your lives extraordinary.", source: "Dead Poets Society" },
    { text: "Here's looking at you, kid.", source: "Casablanca" },
    { text: "Remember who you are.", source: "The Lion King" },
    { text: "My mama always said life was like a box of chocolates. You never know what you're gonna get.", source: "Forrest Gump" },
    { text: "I'm the king of the world!", source: "Titanic" },
    { text: "May the odds be ever in your favor.", source: "The Hunger Games" },
    { text: "Show me the money!", source: "Jerry Maguire" },

    // --- Animation & Pop Culture Fun ---
    { text: "To infinity and beyond!", source: "Toy Story" },
    { text: "Just keep swimming.", source: "Finding Nemo" },
    { text: "Vote for Pedro.", source: "Napoleon Dynamite" },
    { text: "Inconceivable!", source: "The Princess Bride" },
    { text: "My name is Inigo Montoya. You killed my father. Prepare to die.", source: "The Princess Bride" }
];

const CATEGORIES = ["bible", "science", "motivational", "haiku", "cinematic"]

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
            : category === "cinematic" ? CINEMATIC_QUOTES
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