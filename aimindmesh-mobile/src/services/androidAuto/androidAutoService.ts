import { registerPlugin } from '@capacitor/core';

export interface AndroidAutoPlugin {
    initialize(): Promise<void>;
    startSession(): Promise<void>;
    sendMessage(options: { message: string }): Promise<void>;
    updateScreen(options: { type: string, payload: string }): Promise<void>;
    updateSettings(settings: {
        enabled: boolean;
        showCallMode: boolean;
        showCalendar: boolean;
        showToDo: boolean;
        showKanban: boolean;
    }): Promise<void>;
}

const AndroidAuto = registerPlugin<AndroidAutoPlugin>('AndroidAuto');

import { Capacitor } from '@capacitor/core';

export interface AutoCalendarEvent {
    title: string;
    startTime: Date;
    endTime: Date;
    isAllDay?: boolean;
    location?: string;
    notes?: string;
}

const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Calendar payload for CalendarScreen: the list spans a week, so events not of today carry
 * their date, and all-day events show no clock time.
 */
export function buildAutoCalendarPayload(events: AutoCalendarEvent[], now: Date = new Date()): string {
    const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

    return JSON.stringify(events.map(e => {
        const datePrefix = sameDay(e.startTime, now) ? '' : `${day(e.startTime)} `;
        return {
            title: e.title,
            startTime: e.isAllDay ? `${datePrefix}All day`.trim() : `${datePrefix}${time(e.startTime)}`,
            endTime: e.isAllDay ? '' : time(e.endTime),
            description: e.location || e.notes || '',
            // The car may show this list long after the sync: past events are dropped there
            endMs: e.endTime.getTime()
        };
    }));
}

export class AndroidAutoService {
    async initialize(): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await AndroidAuto.initialize();
            console.log('Android Auto initialized');
        } catch (e) {
            console.error('Failed to initialize Android Auto', e);
        }
    }

    async startCarSession(): Promise<void> {
        if (!Capacitor.isNativePlatform()) return;
        try {
            await AndroidAuto.startSession();
        } catch (e) {
            console.error('Failed to start Android Auto session', e);
        }
    }

    async sendMessage(text: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            console.log('Android Auto: Mock sending message', text);
            return;
        }
        try {
            await AndroidAuto.sendMessage({ message: text });
        } catch (e) {
            console.error('Failed to send message to Android Auto', e);
        }
    }

    async updateScreen(type: string, payload: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            console.log(`Android Auto: Mock updateScreen [${type}]`, payload.substring(0, 50) + '...');
            return;
        }
        try {
            await AndroidAuto.updateScreen({ type, payload });
        } catch (e) {
            console.error(`Failed to update Android Auto screen [${type}]`, e);
        }
    }

    async updateSettings(settings: {
        enabled: boolean;
        showCallMode: boolean;
        showCalendar: boolean;
        showToDo: boolean;
        showKanban: boolean;
    }): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            console.log('Android Auto: Mock updateSettings', settings);
            return;
        }
        try {
            await AndroidAuto.updateSettings(settings);
        } catch (e) {
            console.error('Failed to update Android Auto settings', e);
        }
    }
}

export const androidAutoService = new AndroidAutoService();
