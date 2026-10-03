import { useEffect, useState } from 'react';
import { Capacitor, PermissionState } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../services/logger';
import { ensureTaskNotificationChannel } from '../services/calendar/taskNotifications';

export const useNotificationPermission = () => {
    const [permissionStatus, setPermissionStatus] = useState<PermissionState>('prompt');

    useEffect(() => {
        const requestPermission = async () => {
            if (Capacitor.isNativePlatform()) {
                // Task reminders are posted to their own channel: without it Android drops them
                void ensureTaskNotificationChannel();
                try {
                    const status = await LocalNotifications.checkPermissions();

                    if (status.display === 'prompt') {
                        const result = await LocalNotifications.requestPermissions();
                        setPermissionStatus(result.display);
                        logger.log('info', `Notification permission requested. Result: ${result.display}`);
                    } else {
                        setPermissionStatus(status.display);
                        logger.log('info', `Notification permission status: ${status.display}`);
                    }
                } catch (error) {
                    logger.log('error', 'Error requesting notification permission', error);
                }
            }
        };

        requestPermission();
    }, []);

    return permissionStatus;
};
