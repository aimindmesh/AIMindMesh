
import { ProactiveActionType, USER_FACING_CATEGORIES, SELF_GATED_ACTIONS, DATA_HEAVY_ACTIONS, categoryOf } from '../../types/proactive';
import { ProactiveContext } from './ContextAnalyzer';
import { readProactiveSettings } from './proactiveSettings';
import { activityLogger } from './ActivityLogger';

export interface PermissionResult {
    allowed: boolean;
    reason?: string;
    modifiedPriority?: number;
}

class PermissionManager {

    async checkPermission(
        actionType: ProactiveActionType,
        context: ProactiveContext,
        estimatedPriority: number
    ): Promise<PermissionResult> {
        const settings = readProactiveSettings();
        const category = categoryOf(actionType);
        const reachesUser = USER_FACING_CATEGORIES.includes(category);
        const critical = estimatedPriority >= 9;

        // 1. Master Switch
        if (!settings.enabled) {
            return { allowed: false, reason: 'Proactive assistant disabled' };
        }

        // 2. Action Specific Controls
        const actionControl = settings.actionControls?.[actionType];
        if (actionControl && !actionControl.enabled) {
            return { allowed: false, reason: 'Action type disabled by user' };
        }

        // 3. Category Permissions (some actions have their own toggle instead)
        if (!SELF_GATED_ACTIONS.includes(actionType) && !settings.permissions[category]) {
            return { allowed: false, reason: `Category '${category}' disabled` };
        }

        // 4. Quiet Hours: they keep the assistant from interrupting, background work may run
        if (reachesUser && settings.quietHours?.enabled && isQuietHour(new Date(context.timestamp), settings.quietHours)) {
            // Allow critical if priority is high enough (e.g. > 8)
            if (!(settings.quietHours.allowCritical && estimatedPriority > 8)) {
                return { allowed: false, reason: 'Quiet hours active' };
            }
        }

        // 5. Context Awareness: Focus Mode (system Do Not Disturb)
        if (settings.contextAwareness.respectFocusMode && context.app.focusMode && reachesUser && !critical) {
            return { allowed: false, reason: 'Focus mode active' };
        }

        // 6. Context Awareness: Battery
        if (settings.contextAwareness.respectBatteryLevel) {
            if (context.device.batteryLevel < 0.20 && !context.device.isCharging) {
                // Disable non-essential battery draining actions
                if (category === 'silent' || category === 'autonomous') {
                    return { allowed: false, reason: 'Low battery' };
                }
            }
        }

        // 7. Context Awareness: Data usage (non-urgent heavy work waits for Wi-Fi)
        if (settings.contextAwareness.respectDataUsage && context.device.networkType === 'cellular'
            && DATA_HEAVY_ACTIONS.includes(actionType)) {
            return { allowed: false, reason: 'Waiting for Wi-Fi (Respect Data Usage)' };
        }

        // 8. Rate Limiting: hourly for what reaches the user, daily for autonomous work and chat messages
        if (!critical) {
            if (reachesUser) {
                const deliveredLastHour = await activityLogger.countDelivered(1, USER_FACING_CATEGORIES);
                if (deliveredLastHour >= settings.limits.maxActionsPerHour) {
                    return { allowed: false, reason: 'Hourly rate limit reached' };
                }
            }
            const dailyLimit = category === 'autonomous' ? settings.limits.maxAutonomousPerDay
                : category === 'interactive' ? settings.limits.maxChatMessagesPerDay : undefined;
            if (dailyLimit !== undefined && await activityLogger.countToday(category) >= dailyLimit) {
                return { allowed: false, reason: `Daily limit of ${category} actions reached` };
            }
        }

        return { allowed: true };
    }
}

/** Whether `date` falls in the quiet window (start > end crosses midnight, e.g. 22 to 7). */
export function isQuietHour(date: Date, quietHours: { start: number; end: number }): boolean {
    const hour = date.getHours();
    const { start, end } = quietHours;
    return start > end
        ? (hour >= start || hour < end)
        : (hour >= start && hour < end);
}

export const permissionManager = new PermissionManager();
