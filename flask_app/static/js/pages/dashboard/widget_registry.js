// widget_registry.js
import { TimeWidget } from './widgets/TimeWidget.js';
// ... other imports

const WIDGET_REGISTRY = {
    time: TimeWidget,
    // ...
};

export function createWidget(config) {
    const WidgetClass = WIDGET_REGISTRY[config.type];
    const instance = new WidgetClass(config);
    instance.build();
}