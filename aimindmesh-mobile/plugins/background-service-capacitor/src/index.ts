import { registerPlugin } from '@capacitor/core';

export interface BackgroundServicePlugin {
    /**
     * Start the foreground service with a notification
     */
    startService(options: {
        title: string;
        body: string;
        icon?: string;
        notificationId?: number;
    }): Promise<void>;

    /**
     * Stop the foreground service
     */
    stopService(): Promise<void>;

    /**
     * Check if the service is currently running
     */
    isRunning(): Promise<{ running: boolean }>;
}

const BackgroundService = registerPlugin<BackgroundServicePlugin>('BackgroundService');

export default BackgroundService;
