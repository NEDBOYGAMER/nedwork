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

export const WIDGET_STYLES = ["tech"]
// TODO: only "tech" appears anywhere in the codebase right now - add more
// here as they're built, the dropdown will pick them up automatically.

export const TIME_FIELDS = ["time", "weekday", "date"]
export const DATE_STYLES = ["dd.mm.yyyy", "mm/dd/yyyy", "yyyy-mm-dd"]
export const WEATHER_UNITS = ["celsius", "fahrenheit"]
export const QUOTE_CATEGORIES = ["mixed", "bible", "science", "motivational", "haiku", "cinematic"]
export const QUOTE_FONTS = ["serif"]
// TODO: only the default is known - add the other style keywords you want offered
export const NOTES_FONTS = ["Obitron"]
// TODO: only the default is known - add the other font-family choices you want offered

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
        },
        style: WIDGET_STYLES[0]
    },

    notes: {
        "type": "notes",
        "id": "-",
        "text": "default",
        "settings": {
            title: "Notes",
            "font": NOTES_FONTS[0],
        },
        style: WIDGET_STYLES[0]
    },

    timer: {
        type: "timer",
        "id": "-",
        settings: {
            title: "Timer",
            offline: true,
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
    }
};


//
// Each entry is { type, options? }:
//   - type tells the settings UI which control to render
//   - options (when present) is the exhaustive list to populate it with,
//     pulled from the shared constants above - so editing a list up there
//     updates the dropdown down here automatically, no double-editing.
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
        title:        { type: "input_field" },
        style:        { type: "dropdown", options: WIDGET_STYLES },
        show_time:    { type: "boolean" },
        show_weekday: { type: "boolean" },
        show_date:    { type: "boolean" },
        primary:      { type: "dropdown", options: TIME_FIELDS },
        format24:     { type: "boolean" },
        show_seconds: { type: "boolean" },
        date_style:   { type: "dropdown", options: DATE_STYLES },
        timezone:     { type: "timezone" }, // was missing from the old flat map entirely
    },

    weather: {
        title:          { type: "input_field" },
        style:          { type: "dropdown", options: WIDGET_STYLES },
        location:       { type: "location" },
        unit:           { type: "dropdown", options: WEATHER_UNITS }, // old map called this "3optionsslider" - only 2 values ever appear in WeatherWidget.js
        show_humidity:  { type: "boolean" },
        show_wind:      { type: "boolean" },
    },

    notes: {
        title: { type: "input_field" },
        style: { type: "dropdown", options: WIDGET_STYLES },
        text:  { type: "text_area" }, // was missing from the old flat map entirely
        font:  { type: "dropdown", options: NOTES_FONTS },
    },

    timer: {
        title:       { type: "input_field" },
        style:       { type: "dropdown", options: WIDGET_STYLES },
        offline:     { type: "boolean" },
        sound:       { type: "boolean" },
        autorestart: { type: "boolean" },
        // duration/started are numeric widget state, not user-facing settings -
        // intentionally left out of this schema
    },

    quote: {
        title:       { type: "input_field" },
        style:       { type: "dropdown", options: WIDGET_STYLES },
        category:    { type: "dropdown", options: QUOTE_CATEGORIES },
        font:        { type: "dropdown", options: QUOTE_FONTS },
        show_source: { type: "boolean" },
    },
};