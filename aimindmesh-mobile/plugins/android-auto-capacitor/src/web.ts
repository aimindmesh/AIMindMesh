import { WebPlugin } from '@capacitor/core';
import type { AndroidAutoPlugin } from './definitions';

export class AndroidAutoWeb extends WebPlugin implements AndroidAutoPlugin {
    async initialize(): Promise<void> {
        console.log('Android Auto is not available on web');
    }

    async startSession(): Promise<void> {
        console.log('Android Auto session cannot be started on web');
    }

    async updateScreen(options: { type: string, payload: string }): Promise<void> {
        console.log('Android Auto screen update not supported on web', options);
    }

    async updateSettings(settings: {
        enabled: boolean;
        showCallMode: boolean;
        showCalendar: boolean;
        showToDo: boolean;
        showKanban: boolean;
    }): Promise<void> {
        console.log('Android Auto settings update not supported on web', settings);
    }
}
