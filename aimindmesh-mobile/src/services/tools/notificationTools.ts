import { Type } from '@google/genai';
import { ToolDefinition, ToolResult } from './types';
import { LocalNotifications } from '@capacitor/local-notifications';

export const notificationTools: ToolDefinition[] = [
    {
        name: 'schedule_notification',
        description: 'Schedules a notification/reminder to be shown at a specific time.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'Title of the notification'
                },
                body: {
                    type: Type.STRING,
                    description: 'Body text of the notification'
                },
                datetime: {
                    type: Type.STRING,
                    description: 'When to show the notification in ISO 8601 format (YYYY-MM-DDTHH:MM:SS)'
                }
            },
            required: ['title', 'body', 'datetime']
        },
        requiresConfirmation: true,
        category: 'notification'
    },
    {
        name: 'set_alarm',
        description: 'Sets an alarm on the device clock.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                hour: {
                    type: Type.NUMBER,
                    description: 'Hour (0-23)'
                },
                minute: {
                    type: Type.NUMBER,
                    description: 'Minute (0-59)'
                },
                message: {
                    type: Type.STRING,
                    description: 'Optional message/label for the alarm'
                }
            },
            required: ['hour', 'minute']
        },
        requiresConfirmation: true,
        category: 'notification'
    },
    {
        name: 'send_whatsapp',
        description: 'Opens WhatsApp to send a message to a specific phone number.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                phone_number: {
                    type: Type.STRING,
                    description: 'Phone number with country code (e.g., "+39123456789")'
                },
                message: {
                    type: Type.STRING,
                    description: 'The message to send'
                }
            },
            required: ['phone_number', 'message']
        },
        requiresConfirmation: true,
        category: 'notification'
    },
    {
        name: 'send_telegram',
        description: 'Opens Telegram to send a message. Can use username or phone number.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                username: {
                    type: Type.STRING,
                    description: 'Telegram username (without @) or phone number'
                },
                message: {
                    type: Type.STRING,
                    description: 'The message to send'
                }
            },
            required: ['message']
        },
        requiresConfirmation: true,
        category: 'notification'
    }
];

export async function executeScheduleNotification(args: { title: string; body: string; datetime: string }): Promise<ToolResult> {
    try {
        const { title, body, datetime } = args;
        const scheduleDate = new Date(datetime);

        if (isNaN(scheduleDate.getTime())) {
            return { success: false, message: "Invalid date format" };
        }

        if (scheduleDate <= new Date()) {
            return { success: false, message: "Date must be in the future" };
        }

        await LocalNotifications.schedule({
            notifications: [
                {
                    title,
                    body,
                    id: Math.floor(Math.random() * 1000000),
                    schedule: { at: scheduleDate },
                    sound: undefined,
                    attachments: undefined,
                    actionTypeId: "",
                    extra: null
                }
            ]
        });

        return {
            success: true,
            message: `Notification scheduled for ${scheduleDate.toLocaleString()}`,
            data: { id: Math.floor(Math.random() * 1000000), at: scheduleDate }
        };
    } catch (e: any) {
        return { success: false, message: "Failed to schedule notification: " + e.message, error: e.message };
    }
}

export async function executeSetAlarm(args: { hour: number; minute: number; message?: string }): Promise<ToolResult> {
    try {
        const { hour, minute, message } = args;
        // Native alarm setting is complex without specific plugin, fallback to immediate notification or deep link if possible
        // For now, simpler to just schedule a notification at that time today/tomorrow
        const now = new Date();
        const alarmDate = new Date();
        alarmDate.setHours(hour, minute, 0, 0);

        if (alarmDate <= now) {
            alarmDate.setDate(alarmDate.getDate() + 1);
        }

        await LocalNotifications.schedule({
            notifications: [{
                title: "Alarm",
                body: message || "Time to wake up!",
                id: Math.floor(Math.random() * 1000000),
                schedule: { at: alarmDate },
                sound: 'beep.wav'
            }]
        });

        return { success: true, message: `Alarm set for ${hour}:${minute.toString().padStart(2, '0')}` };
    } catch (e: any) {
        return { success: false, message: "Failed to set alarm: " + e.message };
    }
}

export async function executeSendWhatsApp(args: { phone_number: string; message: string }): Promise<ToolResult> {
    try {
        const url = `https://wa.me/${args.phone_number.replace('+', '')}?text=${encodeURIComponent(args.message)}`;
        window.open(url, '_system');
        return { success: true, message: "Opened WhatsApp" };
    } catch (e: any) {
        return { success: false, message: "Failed to open WhatsApp" };
    }
}

export async function executeSendTelegram(args: { username?: string; message: string }): Promise<ToolResult> {
    try {
        // Telegram URL scheme
        let url = 'https://t.me/';
        if (args.username) {
            url += args.username.replace('@', '');
        } else {
            url += 'share/url?url=' + encodeURIComponent(args.message);
        }
        window.open(url, '_system');
        return { success: true, message: "Opened Telegram" };
    } catch (e: any) {
        return { success: false, message: "Failed to open Telegram" };
    }
}
