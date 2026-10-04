import { LocalNotifications } from '@capacitor/local-notifications';
import { ProactiveSettings } from '../../types/proactive';
import { logger } from '../logger';

const CHANNEL_PREFIX = 'proactive-messages';

type Importance = 1 | 2 | 3 | 4 | 5;

function importanceOf(priority: ProactiveSettings['notifications']['priority']): Importance {
    switch (priority) {
        case 'min': return 1;
        case 'low': return 2;
        case 'high': return 4;
        default: return 3;
    }
}

function globalVibrationEnabled(): boolean {
    try {
        return localStorage.getItem('enable-notification-vibration') !== 'false';
    } catch {
        return true;
    }
}

/**
 * Channel id for these notification settings. Android never changes the sound, vibration or
 * importance of an existing channel, so each combination gets its own channel (the old one is
 * deleted): changing the settings then really changes the notifications.
 */
export function proactiveChannelId(settings: ProactiveSettings, vibration: boolean = globalVibrationEnabled()): string {
    const n = settings.notifications;
    return `${CHANNEL_PREFIX}-${importanceOf(n.priority)}${n.sound ? 's' : ''}${vibration && n.vibration ? 'v' : ''}${n.led ? 'l' : ''}`;
}

/**
 * Service for managing proactive notifications with user-configured settings
 */
class ProactiveNotificationService {
    private channelId = CHANNEL_PREFIX;
    private isInitialized = false;

    /** Channel every proactive notification of the app uses */
    getChannelId(): string {
        return this.channelId;
    }

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
        const { notifications } = settings;
        const vibration = globalVibrationEnabled();
        const id = proactiveChannelId(settings, vibration);
        try {
            await LocalNotifications.createChannel({
                id,
                name: 'Proactive Messages',
                description: 'Notifications from your AI companion\'s proactive assistant',
                importance: importanceOf(notifications.priority),
                visibility: 1,
                sound: notifications.sound ? 'default' : undefined,
                vibration: vibration && notifications.vibration,
                lights: notifications.led,
            });
            this.channelId = id;
            await this.deleteStaleChannels(id);

            logger.log('debug', '[ProactiveNotificationService] Channel ready', { id, priority: notifications.priority });
        } catch (error) {
            logger.log('error', '[ProactiveNotificationService] Failed to create channel', error);
        }
    }

    /** Channels of earlier settings (and the unversioned one of older versions) */
    private async deleteStaleChannels(current: string): Promise<void> {
        try {
            const { channels } = await LocalNotifications.listChannels();
            for (const channel of channels) {
                if (channel.id.startsWith(CHANNEL_PREFIX) && channel.id !== current) {
                    await LocalNotifications.deleteChannel({ id: channel.id });
                }
            }
        } catch (e) {
            logger.log('debug', '[ProactiveNotificationService] Stale channel cleanup failed', e);
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
                    channelId: this.channelId,
                }]
            });

            logger.log('info', '[ProactiveNotificationService] Notification sent', { title, body });
        } catch (error) {
            logger.log('error', '[ProactiveNotificationService] Failed to send notification', error);
        }
    }

    /** New notification settings: a channel matching them (only once the service is ready) */
    async updateSettings(settings: ProactiveSettings) {
        if (!this.isInitialized || proactiveChannelId(settings) === this.channelId) return;
        await this.createChannel(settings);
        logger.log('info', '[ProactiveNotificationService] Settings updated');
    }
}

export const proactiveNotificationService = new ProactiveNotificationService();
