// widget_registry.js
import { TimeWidget } from './widgets/TimeWidget.js';
import { WeatherWidget } from './widgets/WeatherWidget.js';
import { TimerWidget } from './widgets/TimerWidget.js';
import { QuoteWidget } from './widgets/QuoteWidget.js';
// ... other imports

const WIDGET_REGISTRY = {
    time: TimeWidget,
    weather: WeatherWidget,
    timer: TimerWidget,
    quote: QuoteWidget,
    // ...
};

export function createWidget(config) {
    try {
        const WidgetClass = WIDGET_REGISTRY[config.type];

        if (!WidgetClass) {
            console.error(`Unknown widget type: ${config.type}, skipped it`);
            return;
        }

        const instance = new WidgetClass(config);
        instance.build();

        return instance;

    } catch (error) {
        console.error("Failed to create widget:", config, error);
        return null;
    }
}