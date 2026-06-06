
import { LocalNotifications } from '@capacitor/local-notifications';
import { ProactiveSettings } from '../../types/proactive';
import { logger } from '../logger';

/**
 * Service for managing proactive notifications with user-configured settings
 */
class ProactiveNotificationService {
    private CHANNEL_ID = 'proactive-messages';
    private isInitialized = false;

    async init(settings: ProactiveSettings) {
        if (this.isInitialized) return;

        try {
            // Request permission
            const permission = await LocalNotifications.requestPermissions();
            if (permission.display !== 'granted') {
                logger.log('warn', '[ProactiveNotificationService] Notification permission not granted');
                return;
            }

            // Create channel with user settings
            await this.createChannel(settings);
            this.isInitialized = true;
            logger.log('info', '[ProactiveNotificationService] Initialized successfully');
        } catch (error) {
            logger.log('error', '[ProactiveNotificationService] Failed to initialize', error);
        }
    }

    async createChannel(settings: ProactiveSettings) {
        try {
            const { notifications } = settings;

            // Map priority to Android importance level
            let importance: 1 | 2 | 3 | 4 | 5 = 3; // default
            switch (notifications.priority) {
                case 'min':
                    importance = 1;
                    break;
                case 'low':
                    importance = 2;
                    break;
                case 'high':
                    importance = 4;
                    break;
                default:
                    importance = 3;
            }

            const globalVibration = localStorage.getItem('enable-notification-vibration') !== 'false';

            await LocalNotifications.createChannel({
                id: this.CHANNEL_ID,
                name: 'Proactive Messages',
                description: 'Notifications from your AI companion\'s proactive assistant',
                importance,
                sound: notifications.sound ? 'default' : undefined,
                vibration: globalVibration && notifications.vibration,
                lights: notifications.led,
            });

            logger.log('debug', '[ProactiveNotificationService] Channel created with settings', {
                priority: notifications.priority,
                importance,
                sound: notifications.sound,
                vibration: notifications.vibration,
            });
        } catch (error) {
            logger.log('error', '[ProactiveNotificationService] Failed to create channel', error);
        }
    }

    async sendNotification(title: string, body: string, settings: ProactiveSettings) {
        try {
            await LocalNotifications.schedule({
                notifications: [{
                    id: Math.floor(Date.now() % 2147483647),
                    title,
                    body,
                    schedule: { at: new Date() },
                    sound: settings.notifications.sound ? 'default' : undefined,
                    smallIcon: 'ic_launcher',
                    channelId: this.CHANNEL_ID,
                }]
            });

            logger.log('info', '[ProactiveNotificationService] Notification sent', { title, body });
        } catch (error) {
            logger.log('error', '[ProactiveNotificationService] Failed to send notification', error);
        }
    }

    async updateSettings(settings: ProactiveSettings) {
        // Recreate channel with new settings
        await this.createChannel(settings);
        logger.log('info', '[ProactiveNotificationService] Settings updated');
    }
}

export const proactiveNotificationService = new ProactiveNotificationService();
