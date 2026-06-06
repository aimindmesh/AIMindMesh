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
