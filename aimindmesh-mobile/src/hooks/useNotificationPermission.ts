import { useEffect, useState } from 'react';
import { Capacitor, PermissionState } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../services/logger';

export const useNotificationPermission = () => {
    const [permissionStatus, setPermissionStatus] = useState<PermissionState>('prompt');

    useEffect(() => {
        const requestPermission = async () => {
            if (Capacitor.isNativePlatform()) {
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
