import { useEffect, useRef, useState } from 'react';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { LocalNotifications } from '@capacitor/local-notifications';
import BackgroundService from 'background-service-capacitor';
import { logger } from '../services/logger';
import { stopSpeaking } from '../services/tts/speech';
import { reopenKnowledgeDatabase } from '../services/database/knowledgeDatabase';
import { reopenMemoryDatabase } from '../services/memory/memoryDatabase';
import { reopenCalendarDatabase } from '../services/calendar/calendarDatabase';
import Performance from '../services/performancePlugin';
import { thermalThrottlingService } from '../services/performance/thermalThrottlingService';
import { memoryPressureService } from '../services/performance/memoryPressureService';
import { isMeetingRecording } from '../services/meeting/meetingForegroundService';

/**
 * Manages application lifecycle events, native initialization, and background services.
 * @param keepAlive the shared keep-alive flag (services/performance/keepAliveSetting)
 */
export const useAppLifecycle = (keepAlive: boolean, isVoiceMode = false) => {
    const [isAppActive, setIsAppActive] = useState(true);
    // Read by the appStateChange listener (registered once): a voice call keeps talking with the screen off
    const voiceModeRef = useRef(isVoiceMode);
    voiceModeRef.current = isVoiceMode;

    // Handle Background Service Lifecycle: both native services follow the one keep-alive flag
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
                } else if (!keepAlive && running && !isMeetingRecording()) {
                    // A meeting in progress owns the service (microphone in background): it stops it itself
                    await BackgroundService.stopService();
                    logger.log('info', 'Background service stopped');
                }
            } catch (error) {
                logger.log('error', 'Failed to sync background service', error);
            }
        };

        // KeepAliveService (wake lock) also persists its own flag, read by MainActivity at launch:
        // stopping it here clears a flag left on by an older version
        (keepAlive ? Performance.startKeepAlive() : Performance.stopKeepAlive())
            .catch(error => logger.log('error', 'Failed to sync KeepAlive service', error));

        syncBackgroundService();
    }, [keepAlive]);

    // Thermal monitoring only while the app is in foreground (it polls every 30 s)
    useEffect(() => {
        if (isAppActive) thermalThrottlingService.start();
        else thermalThrottlingService.stop();
    }, [isAppActive]);

    // Initialize Native App
    useEffect(() => {
        let stateListener: Promise<PluginListenerHandle> | null = null;
        let disposed = false;

        const initializeNativeApp = async () => {
            if (Capacitor.isNativePlatform()) {
                memoryPressureService.initialize();
                try {
                    // Prevent content from going under status bar
                    await StatusBar.setOverlaysWebView({ overlay: false });
                    await StatusBar.setStyle({ style: Style.Dark });
                    await StatusBar.setBackgroundColor({ color: '#1a1a2e' }); // Match gradient top

                    if (disposed) return;
                    stateListener = CapApp.addListener('appStateChange', async ({ isActive }: { isActive: boolean }) => {
                        setIsAppActive(isActive);
                        if (!isActive) {
                            if (!voiceModeRef.current) stopSpeaking();
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

        return () => {
            disposed = true;
            stateListener?.then(handle => handle.remove());
            thermalThrottlingService.stop();
        };
    }, []);

    return { isAppActive };
};
