export const WIDGET_DEFAULTS = {
    time: {
        "type": "time",
        "id": "-",
        "settings": {
            title: true,
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
            title: true,
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
            title: true,
            "style": "tech"
        }
    },

    timer: {
        type: "timer",
        "id": "-",
        settings: {
            title: true,
            duration: 300,
            started: 0,
            style : "tech"
        }
    }
};