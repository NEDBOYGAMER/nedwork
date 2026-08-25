// widget_registry.js
import { TimeWidget } from './widgets/TimeWidget.js';
import { WeatherWidget } from './widgets/WeatherWidget.js';
import { CalendarWidget } from './widgets/CalendarWidget.js';
import { TimerWidget } from './widgets/TimerWidget.js';
import { QuoteWidget } from './widgets/QuoteWidget.js';
import { NotesWidget } from './widgets/NotesWidget.js';
import { WelcomeWidget } from './widgets/WelcomeWidget.js';
import { TaskWidget } from './widgets/TaskWidget.js';
import { EventManagerWidget } from './widgets/EventManagerWidget.js';
import { FinanceWidget } from './widgets/FinanceWidget.js';
import { NotificationsWidget } from './widgets/NotificationsWidget.js';
import { LinkWidget } from './widgets/LinkWidget.js';
import { SpeedtestWidget } from './widgets/SpeedtestWidget.js';
import { NewsWidget } from './widgets/NewsWidget.js';
import { AppWidget } from './widgets/AppWidget.js';

const WIDGET_REGISTRY = {
    time: TimeWidget,
    weather: WeatherWidget,
    calendar: CalendarWidget,
    timer: TimerWidget,
    quote: QuoteWidget,
    notes: NotesWidget,
    welcome: WelcomeWidget,
    task: TaskWidget,
    event_manager: EventManagerWidget,
    finance: FinanceWidget,
    notifications: NotificationsWidget,
    link: LinkWidget,
    speedtest: SpeedtestWidget,
    news: NewsWidget,
    app: AppWidget,
};

export function createWidget(config, ctx) {
    try {
        const WidgetClass = WIDGET_REGISTRY[config.type];

        if (!WidgetClass) {
            console.error(`Unknown widget type: ${config.type}, skipped it`);
            return null;
        }

        const instance = new WidgetClass(config, ctx);
        instance.build();
        return instance;

    } catch (error) {
        console.error("Failed to create widget:", config, error);
        return null;
    }
}