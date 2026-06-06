/**
 * Task Notifications Service
 * Handles scheduling and managing local notifications for tasks
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../logger';
import { CalendarTask } from '../../types/calendar';

const NOTIFICATION_CHANNEL = 'task-reminders';

/**
 * Initialize the notification service
 */
export async function initTaskNotifications(): Promise<boolean> {
    try {
        // Request permission
        const result = await LocalNotifications.requestPermissions();
        if (result.display !== 'granted') {
            logger.log('warn', '[TaskNotifications] Permission denied');
            return false;
        }

        // Create notification channel (Android)
        const globalVibration = localStorage.getItem('enable-notification-vibration') !== 'false';

        await LocalNotifications.createChannel({
            id: NOTIFICATION_CHANNEL,
            name: 'Task Reminders',
            description: 'Notifications for upcoming and overdue tasks',
            importance: 3, // Default importance
            sound: 'default',
            vibration: globalVibration
        });

        logger.log('info', '[TaskNotifications] Initialized successfully');
        return true;
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to initialize', error);
        return false;
    }
}

/**
 * Convert task ID to a numeric notification ID
 */
function getNotificationId(taskId: string): number {
    let hash = 0;
    for (let i = 0; i < taskId.length; i++) {
        hash = ((hash << 5) - hash) + taskId.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Schedule a notification for a task
 * Schedules notification 1 hour before due date
 */
export async function scheduleTaskNotification(task: CalendarTask): Promise<void> {
    try {
        // Cancel existing notification for this task first
        await cancelTaskNotification(task.id);

        const dueDate = new Date(task.dueDate);
        const now = new Date();

        if (dueDate <= now) {
            logger.log('info', '[TaskNotifications] Task already due, skipping notification');
            return;
        }

        // Schedule reminder 1 hour before due date
        const reminderTime = new Date(dueDate.getTime() - (60 * 60 * 1000));

        if (reminderTime <= now) {
            logger.log('info', '[TaskNotifications] Reminder time in past, skipping');
            return;
        }

        await LocalNotifications.schedule({
            notifications: [{
                id: getNotificationId(task.id),
                title: '📋 Task Reminder',
                body: `"${task.title}" is due in 1 hour`,
                schedule: {
                    at: reminderTime
                },
                channelId: NOTIFICATION_CHANNEL,
                extra: {
                    taskId: task.id,
                    type: 'task-reminder'
                }
            }]
        });

        logger.log('info', `[TaskNotifications] Scheduled reminder for task: ${task.id}`);
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to schedule notification', error);
    }
}

/**
 * Cancel a scheduled notification for a task
 */
export async function cancelTaskNotification(taskId: string): Promise<void> {
    try {
        const notificationId = getNotificationId(taskId);
        await LocalNotifications.cancel({
            notifications: [{ id: notificationId }]
        });
        logger.log('info', `[TaskNotifications] Cancelled notification for: ${taskId}`);
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to cancel notification', error);
    }
}

/**
 * Notify user about overdue tasks
 */
export async function notifyOverdueTasks(tasks: CalendarTask[]): Promise<void> {
    if (tasks.length === 0) return;

    try {
        await LocalNotifications.schedule({
            notifications: [{
                id: 999999, // Special ID for overdue summary
                title: `⚠️ ${tasks.length} Overdue Task${tasks.length > 1 ? 's' : ''}`,
                body: tasks.slice(0, 3).map(t => `• ${t.title}`).join('\n'),
                schedule: {
                    at: new Date(Date.now() + 1000) // 1 second from now
                },
                channelId: NOTIFICATION_CHANNEL,
                extra: {
                    type: 'overdue-summary',
                    taskCount: tasks.length
                }
            }]
        });

        logger.log('info', `[TaskNotifications] Sent overdue notification for ${tasks.length} tasks`);
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to send overdue notification', error);
    }
}

/**
 * Schedule notifications for all upcoming tasks
 */
export async function scheduleAllTaskNotifications(tasks: CalendarTask[]): Promise<void> {
    for (const task of tasks) {
        if (task.status !== 'done' && task.dueDate > Date.now()) {
            await scheduleTaskNotification(task);
        }
    }
}

/**
 * Get pending notifications count
 */
export async function getPendingNotificationsCount(): Promise<number> {
    try {
        const pending = await LocalNotifications.getPending();
        return pending.notifications.length;
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to get pending count', error);
        return 0;
    }
}
