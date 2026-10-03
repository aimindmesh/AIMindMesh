/**
 * Task Notifications Service
 * Handles scheduling and managing local notifications for tasks
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../logger';
import { CalendarTask } from '../../types/calendar';

const NOTIFICATION_CHANNEL = 'task-reminders';
const REMINDER_LEAD_MS = 60 * 60 * 1000;

/**
 * Creates the reminder channel. Android 8+ silently drops notifications posted to a channel
 * that does not exist, so this runs at startup (no permission prompt here).
 */
export async function ensureTaskNotificationChannel(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const globalVibration = localStorage.getItem('enable-notification-vibration') !== 'false';

        await LocalNotifications.createChannel({
            id: NOTIFICATION_CHANNEL,
            name: 'Task Reminders',
            description: 'Notifications for upcoming and overdue tasks',
            importance: 3, // Default importance
            sound: 'default',
            vibration: globalVibration
        });
    } catch (error) {
        logger.log('error', '[TaskNotifications] Failed to create the reminder channel', error);
    }
}

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

        await ensureTaskNotificationChannel();
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
    return Math.abs(hash) % 2147483647; // Math.abs(-2^31) does not fit a Java int
}

/**
 * When the reminder of a task fires (1 hour before it is due), or null when it needs none:
 * done, AI-run and subtasks (they share the parent's due date) get no reminder.
 */
export function getReminderTime(task: CalendarTask, now: number = Date.now()): number | null {
    if (task.status === 'done' || task.assignee === 'ai' || task.parentTaskId) return null;
    const at = task.dueDate - REMINDER_LEAD_MS;
    return Number.isFinite(at) && at > now ? at : null;
}

/**
 * Brings the reminder of a task in line with its current state: replaced when the due date
 * changes, removed when the task is completed, handed to the AI or deleted.
 */
export async function scheduleTaskNotification(task: CalendarTask): Promise<void> {
    try {
        // Cancel existing notification for this task first
        await cancelTaskNotification(task.id);

        const reminderTime = getReminderTime(task);
        if (reminderTime === null) return;

        await LocalNotifications.schedule({
            notifications: [{
                id: getNotificationId(task.id),
                title: '📋 Task Reminder',
                body: `"${task.title}" is due in 1 hour`,
                schedule: {
                    at: new Date(reminderTime)
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
        await scheduleTaskNotification(task);
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
