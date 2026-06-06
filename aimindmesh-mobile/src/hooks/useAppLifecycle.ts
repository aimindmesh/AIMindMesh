import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';
import BackgroundService from 'background-service-capacitor';
import { logger } from '../services/logger';
import { stopSpeaking } from '../services/tts/speech';
import { reopenKnowledgeDatabase } from '../services/database/knowledgeDatabase';
import { reopenMemoryDatabase } from '../services/memory/memoryDatabase';
import { reopenCalendarDatabase } from '../services/calendar/calendarDatabase';

/**
 * Manages application lifecycle events, native initialization, and background services.
 */
export const useAppLifecycle = (keepAlive: boolean) => {
    const [isAppActive, setIsAppActive] = useState(true);

    // Handle Background Service Lifecycle
    useEffect(() => {
        if (Capacitor.getPlatform() !== 'android') return;

        const syncBackgroundService = async () => {
            try {
                const { running } = await BackgroundService.isRunning();
                if (keepAlive && !running) {
                    await BackgroundService.startService({
                        title: 'AI Mind Mesh',
                        body: 'Assistant is active in background'
                    });
                    logger.log('info', 'Background service started');
                } else if (!keepAlive && running) {
                    await BackgroundService.stopService();
                    logger.log('info', 'Background service stopped');
                }
            } catch (error) {
                logger.log('error', 'Failed to sync background service', error);
            }
        };

        syncBackgroundService();
    }, [keepAlive]);

    // Initialize Native App
    useEffect(() => {
        const initializeNativeApp = async () => {
            if (Capacitor.isNativePlatform()) {
                try {
                    // Prevent content from going under status bar
                    await StatusBar.setOverlaysWebView({ overlay: false });
                    await StatusBar.setStyle({ style: Style.Dark });
                    await StatusBar.setBackgroundColor({ color: '#1a1a2e' }); // Match gradient top

                    CapApp.addListener('appStateChange', async ({ isActive }: { isActive: boolean }) => {
                        setIsAppActive(isActive);
                        if (!isActive) {
                            stopSpeaking();
                        } else {
                            // App is coming back to foreground - reopen database connections
                            logger.log('info', '[AppLifecycle] App resumed, reopening databases');
                            try {
                                await Promise.all([
                                    reopenKnowledgeDatabase(),
                                    reopenMemoryDatabase(),
                                    reopenCalendarDatabase()
                                ]);
                                logger.log('info', '[AppLifecycle] All databases reopened successfully');
                            } catch (error) {
                                logger.log('error', '[AppLifecycle] Error reopening databases', error);
                            }
                        }
                    });

                    // Create notification channel for Android
                    await LocalNotifications.createChannel({
                        id: 'proactive-messages',
                        name: 'Proactive Messages',
                        description: 'Messages initiated by your AI companion',
                        importance: 4, // high
                        visibility: 1, // public
                        vibration: true,
                    });
                } catch (error) {
                    logger.log('error', 'Failed to initialize Capacitor plugins.', error);
                }
            }
        };
        initializeNativeApp();
    }, []);

    return { isAppActive };
};
