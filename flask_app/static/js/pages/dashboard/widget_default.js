// ---------------------------------------------------------------------------
// Shared option lists - the single source of truth for every "pick one of N"
// setting. Both WIDGET_DEFAULTS (initial value) and WIDGET_SETTINGS_SCHEMA
// (dropdown options) read from these, so a value only ever needs to be typed
// here once.
//
// The individual widget classes (QuoteWidget.js, TimeWidget.js, ...) should
// import these too, instead of keeping their own separate copies
// (CATEGORIES, TIME_FIELDS, the date_style switch) - otherwise you still have
// two places to update when a value is added or renamed.
// ---------------------------------------------------------------------------

// Card-level appearance styles (one per visual shell variant, see the
// [data-style="…"] rule block in widgets.css):
//   tech        - current tech look
//   borderless  - surface background, no border/shadow
//   transparent - fully see-through, no border
//   opaque      - solid flat surface, no blur/shadow
//   glassy      - translucent surface + backdrop blur
export const WIDGET_STYLES = ["tech", "borderless", "transparent", "opaque", "glassy"]

export const TIME_FIELDS = ["time", "weekday", "date"]
export const DATE_STYLES = ["dd.mm.yyyy", "mm/dd/yyyy", "yyyy-mm-dd"]
export const WEATHER_UNITS = ["celsius", "fahrenheit"]
export const QUOTE_CATEGORIES = ["mixed", "bible", "science", "motivational", "haiku", "cinematic"]
export const QUOTE_FONTS = ["serif", "sans", "mono"]
export const NOTES_FONTS = ["default", "Orbitron", "serif", "mono"]
// timer presentation: ring (conic circle), text (giant digits), bar (linear progress)
export const TIMER_VIEWS = ["ring", "text", "bar", "flip"]
// CORS-open, key-free general news sources (client-side fetch, see NewsWidget.js)
export const NEWS_SOURCES = ["srf", "tagesschau", "dw", "heise", "devto"]
// news presentations (one bundled look each, see the [data-news-preset="…"]
// rules in widgets.css):
//   classic  - rank + headline + 2-line snippet + meta line (former default)
//   compact  - tight headlines, tiny meta, no snippet
//   ticker   - one-line rows, time-only meta, most items per column
//   cards    - bordered boxes with side thumbnails
//   magazine - 2-across photo tiles, dimmed feed image, story text on top
//   reader   - large comfortable text, side thumbnails, 4-line snippets
//   hero     - one big rotating cover at a time, headline + byline on the image
export const NEWS_PRESETS = ["classic", "compact", "ticker", "cards", "magazine", "reader", "hero"]
// task widget ordering (see TaskWidget.js; "position" = the manual order
// the user set on the /tasks site)
export const TASK_SORTS = ["position", "deadline", "importance", "newest"]

export const WIDGET_DEFAULTS = {
    time: {
        "type": "time",
        "id": "-",
        "settings": {
            title: "Time",
            show_time: true,
            show_weekday: true,
            show_date: true,
            primary: TIME_FIELDS[0],
            format24: true,
            show_seconds: true,
            date_style: DATE_STYLES[0],
            timezone: "Europe/Zurich",
        },
        style: WIDGET_STYLES[0]
    },

    weather: {
        "type": "weather",
        "id": "-",
        "settings": {
            title: "Weather",
            "location": "Zurich, Switzerland",
            "unit": WEATHER_UNITS[0],
            "show_humidity": true,
            "show_wind": false,
            "show_feels_like": false,
            "show_forecast": false,
        },
        style: WIDGET_STYLES[0]
    },

    timer: {
        type: "timer",
        "id": "-",
        settings: {
            title: "Timer",
            // discarded: offline - the timer is offline by nature, nothing to toggle
            view: TIMER_VIEWS[0],
            duration: 300, // seconds - what Reset returns to when configured
            sound: true,
            autorestart: false,
        },
        style: WIDGET_STYLES[0],
        duration: 300,
        started: 0,
    },

    quote: {
        "type": "quote",
        "id": "-",
        "settings": {
            title: "Quote",
            "category": QUOTE_CATEGORIES[0],
            "font": QUOTE_FONTS[0],
            "show_source": true,
        },
        style: WIDGET_STYLES[0]
    },

    welcome: {
        "type": "welcome",
        "id": "-",
        settings: {
            title: "Welcome",
            show_date: true,
            show_time: true,
        },
        style: WIDGET_STYLES[0]
    },

    task: {
        "type": "task",
        "id": "-",
        "settings": {
            title: "Tasks",
            show_progress: false,
            allow_add: true,
            show_done: false,
            limit: 4,
            sort: TASK_SORTS[0],
            show_deadline: false,
        },
        style: WIDGET_STYLES[0]
    },

    calendar: {
        "type": "calendar",
        "id": "-",
        "settings": {
            title: "Calendar",
            start_sunday: false,
        },
        style: WIDGET_STYLES[0]
    },

    event_manager: {
        "type": "event_manager",
        "id": "-",
        settings: {
            title: "Events",
            // discarded: show_upcoming - upcoming is the only mode this widget has
            limit: 5,
        },
        style: WIDGET_STYLES[0]
    },

    finance: {
        "type": "finance",
        "id": "-",
        "settings": {
            title: "Finance",
            currency: "CHF",
            show_transactions: true,
        },
        style: WIDGET_STYLES[0]
    },

    notifications: {
        "type": "notifications",
        "id": "-",
        "settings": {
            title: "Notifications",
            show_categories: true,
        },
        style: WIDGET_STYLES[0]
    },

    link: {
        "type": "link",
        "id": "-",
        "settings": {
            title: "",
            url: "https://nedwork.ch",
        },
        style: WIDGET_STYLES[0]
    },

    speedtest: {
        "type": "speedtest",
        "id": "-",
        "settings": {
            title: "Speedtest",
            auto_run: false,
        },
        style: WIDGET_STYLES[0]
    },

    news: {
        "type": "news",
        "id": "-",
        settings: {
            title: "News",
            limit: 8,
            source: NEWS_SOURCES[0],
            preset: NEWS_PRESETS[0],
        },
        style: WIDGET_STYLES[0]
    },

    notes: {
        "type": "notes",
        "id": "-",
        text: "",
        mode: "edit",
        settings: {
            title: "Notes",
            font: NOTES_FONTS[0],
        },
        style: WIDGET_STYLES[0]
    },
};


//
// Each entry is { type, options? }:
//   - type tells the settings UI which control to render
//   - options (when present) is the exhaustive list to populate it with,
//     pulled from the shared constants above - so editing a list up there
//     updates the dropdown down here automatically, no double-editing.
//   - group (optional) groups rows under a small section label; leave out
//     for small schemas - grouped only when a widget has enough fields
//   - desc (optional) one-line explanation under the field label
//
// Control types used here:
//   "na"            - not user-editable (internal bookkeeping)
//   "input_field"   - free text
//   "text_area"     - free text, multiline
//   "dropdown"      - options[] is exhaustive, pick one
//   "boolean"       - yes/no toggle
//   "color"         - color picker, no fixed options
//   "location"      - free-text place name, resolved via geocoding
//   "timezone"      - IANA timezone string (kept distinct from "location",
//                     it isn't geocoded, it's passed straight to Intl APIs)
// ---------------------------------------------------------------------------

export const WIDGET_SETTINGS_SCHEMA = {
    time: {
        title:        { type: "input_field", group: "General" },
        style:        { type: "dropdown", options: WIDGET_STYLES, group: "General",
                        desc: "Card appearance, shared by every widget type" },
        show_time:    { type: "boolean", group: "Clock" },
        show_weekday: { type: "boolean", group: "Clock" },
        show_date:    { type: "boolean", group: "Clock" },
        primary:      { type: "dropdown", options: TIME_FIELDS, group: "Clock",
                        desc: "Which value is displayed large" },
        format24:     { type: "boolean", group: "Clock" },
        show_seconds: { type: "boolean", group: "Clock" },
        date_style:   { type: "dropdown", options: DATE_STYLES, group: "Format",
                        desc: "Date display format" },
        timezone:     { type: "timezone", group: "Format",
                        desc: "IANA name, passed straight to Intl APIs" }, // was missing from the old flat map entirely
    },

    weather: {
        title:          { type: "input_field", group: "General" },
        style:          { type: "dropdown", options: WIDGET_STYLES, group: "General",
                          desc: "Card appearance, shared by every widget type" },
        location:       { type: "location", group: "Location",
                          desc: "Place name, resolved via geocoding" },
        unit:           { type: "dropdown", options: WEATHER_UNITS, group: "Location" }, // old map called this "3optionsslider" - only 2 values ever appear in WeatherWidget.js
        show_humidity:  { type: "boolean", group: "Details" },
        show_wind:      { type: "boolean", group: "Details" },
        show_feels_like: { type: "boolean", group: "Details" },
        show_forecast:  { type: "boolean", group: "Details" },
    },

    notes: {
        title: { type: "input_field" },
        style: { type: "dropdown", options: WIDGET_STYLES,
                 desc: "Card appearance, shared by every widget type" },
        text:  { type: "text_area" }, // was missing from the old flat map entirely
        font:  { type: "dropdown", options: NOTES_FONTS },
    },

    timer: {
        title:       { type: "input_field", group: "General" },
        style:       { type: "dropdown", options: WIDGET_STYLES, group: "General",
                       desc: "Card appearance, shared by every widget type" },
        view:        { type: "dropdown", options: TIMER_VIEWS, group: "Timer" },
        duration:    { type: "input_field", group: "Timer",
                       desc: "Seconds the Reset button returns to" }, // seconds, used by Reset
        sound:       { type: "boolean", group: "Timer" },
        autorestart: { type: "boolean", group: "Timer" },
        // duration/started widget state (config top level) is not user-facing -
        // intentionally left out of this schema
    },

    quote: {
        title:       { type: "input_field", group: "General" },
        style:       { type: "dropdown", options: WIDGET_STYLES, group: "General",
                       desc: "Card appearance, shared by every widget type" },
        category:    { type: "dropdown", options: QUOTE_CATEGORIES, group: "Quote" },
        font:        { type: "dropdown", options: QUOTE_FONTS, group: "Quote" },
        show_source: { type: "boolean", group: "Quote" },
    },

    welcome: {
        title:     { type: "input_field" },
        style:     { type: "dropdown", options: WIDGET_STYLES },
        show_date: { type: "boolean" },
        show_time: { type: "boolean" },
    },

    task: {
        title:         { type: "input_field", group: "General" },
        style:         { type: "dropdown", options: WIDGET_STYLES, group: "General",
                         desc: "Card appearance, shared by every widget type" },
        show_progress: { type: "boolean", group: "List" },
        allow_add:     { type: "boolean", group: "List" },
        show_done:     { type: "boolean", group: "List" },
        limit:         { type: "input_field", group: "List",
                         desc: "How many tasks to show at once" },
        sort:          { type: "dropdown", options: TASK_SORTS, group: "List",
                         desc: "\"Position\" keeps the manual order from the tasks site" },
        show_deadline: { type: "boolean", group: "List" },
    },

    calendar: {
        title:        { type: "input_field" },
        style:        { type: "dropdown", options: WIDGET_STYLES },
        start_sunday: { type: "boolean" },
    },

    event_manager: {
        title:         { type: "input_field" },
        style:         { type: "dropdown", options: WIDGET_STYLES },
        limit:         { type: "input_field" },
    },

    finance: {
        title:              { type: "input_field" },
        style:              { type: "dropdown", options: WIDGET_STYLES },
        currency:           { type: "input_field",
                              desc: "Three-letter code like CHF or USD" },
        show_transactions:  { type: "boolean" },
    },

    notifications: {
        title:           { type: "input_field" },
        style:           { type: "dropdown", options: WIDGET_STYLES },
        show_categories: { type: "boolean" },
    },

    link: {
        title: { type: "input_field" },
        style: { type: "dropdown", options: WIDGET_STYLES },
        url:   { type: "input_field" },
    },

    speedtest: {
        title:    { type: "input_field" },
        style:    { type: "dropdown", options: WIDGET_STYLES },
        auto_run: { type: "boolean" },
    },

    news: {
        title:  { type: "input_field", group: "General" },
        style:  { type: "dropdown", options: WIDGET_STYLES, group: "General",
                  desc: "Card appearance, shared by every widget type" },
        limit:  { type: "input_field", group: "Feed",
                  desc: "How many headlines to show" },
        source: { type: "dropdown", options: NEWS_SOURCES, group: "Feed",
                  desc: "Where headlines are fetched from" },
        preset: { type: "dropdown", options: NEWS_PRESETS, group: "Feed",
                  desc: "Bundled presentation for the feed" },
    },
};