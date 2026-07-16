export const WIDGET_DEFAULTS = {
    time: {
        "type": "time",
        "id": "-",
        "settings": {
            title: "Time",
            show_time: true,
            show_weekday: true,
            show_date: true,
            primary: "time",
            format24: true,
            show_seconds: true,
            date_style: "dd.mm.yyyy",
            timezone: "Europe/Zurich",
        },
        style:"tech"
    },

    weather: {
        "type": "weather",
        "id": "-",
        "settings": {
            title: "Weather",
            "location": "Zurich, Switzerland",
            "unit": "celsius",
            "show_humidity": true,
            "show_wind": false,
        },
        style:"tech"
    },

    notes: {
        "type": "notes",
        "id": "-",
        "text": "default",
        "settings": {
            title: "Notes",
            "font": "Obitron",
        },
        style:"tech"
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
        style:"tech",
        duration: 300,
        started: 0,
    },

    quote: {
        "type": "quote",
        "id": "-",
        "settings": {
            title: "Quote",
            "category": "mixed",
            "font": "serif",
            "show_source": true,
        },
        style:"tech"
    }
};

export const WIDGET_SETTINGS_TYPE = {
    "type": "na",
    "id": "na",
    "title": "input_field",
    "style": "dropdown",
    "font": "dropdown",
    "color": "color",
    "location": "location",
    "unit": "3optionsslider",
    "offline": "yes/no",
    "show_time": "yes/no",
    "show_weekday": "yes/no",
    "show_date": "yes/no",
    "primary": "dropdown",
    "format24": "yes/no",
    "show_seconds": "yes/no",
    "date_style": "dropdown",
    "show_humidity": "yes/no",
    "show_wind": "yes/no",
    "sound": "yes/no",
    "autorestart": "yes/no",
    "category": "dropdown",
    "show_source": "yes/no",
}