export const WIDGET_DEFAULTS = {
    time: {
        "type": "time",
        "id": "-",
        "settings": {
        "24_format": "true",
        "show_seconds": true,
        "show_date": true,
        "date_style": "dd.m.jjjj", 
        "style": "tech"
        }
    },

    weather: {
        "type": "weather",
        "id": "-",
        "settings": {
        "location": "default",
        "unit": "celsius",
        "style": "tech"
        }
    },

    notes: {
        "type": "notes",
        "id": "-",
        "text": "default",
        "settings": {
        "style": "tech"
        }
    },

    timer: {
        type: "timer",
        settings: {
            duration: 300,
            started: 0
        }
    }
};