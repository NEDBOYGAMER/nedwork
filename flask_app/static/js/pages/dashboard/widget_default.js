export const WIDGET_DEFAULTS = {
    time: {
        "type": "time",
        "id": "-",
        "settings": {
            title: "Time",
            format24: true,
            show_seconds: true,
            show_date: true,
            show_time: true,
            show_weekday: true,
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
            "location": "default",
            "unit": "celsius",
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
        },
        style:"tech",
        duration: 300,
        started: 0,
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
    "24_format": "yes/no",
    "show_seconds": "yes/no",
    "show_date": "yes/no",
    "date_style": "dropdown",
}

