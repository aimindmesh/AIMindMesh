
import { ProactiveActionType } from '../../types/proactive';
import { ProactiveContext } from './ContextAnalyzer';
import { ProactiveSettings, DEFAULT_PROACTIVE_SETTINGS } from '../../types';
import { activityLogger } from './ActivityLogger';

export interface PermissionResult {
    allowed: boolean;
    reason?: string;
    modifiedPriority?: number;
}

class PermissionManager {

    private getProactiveSettings(): ProactiveSettings {
        try {
            const settingsStr = localStorage.getItem('proactive-settings');
            if (settingsStr) {
                return JSON.parse(settingsStr);
            }
        } catch (e) {
            console.error('[PermissionManager] Failed to load settings', e);
        }
        return DEFAULT_PROACTIVE_SETTINGS;
    }

    async checkPermission(
        actionType: ProactiveActionType,
        context: ProactiveContext,
        estimatedPriority: number
    ): Promise<PermissionResult> {
        const settings = this.getProactiveSettings();

        // 1. Master Switch
        if (!settings.enabled) {
            return { allowed: false, reason: 'Proactive assistant disabled' };
        }

        // 2. Action Specific Controls
        const actionControl = settings.actionControls[actionType];
        if (actionControl && !actionControl.enabled) {
            return { allowed: false, reason: 'Action type disabled by user' };
        }

        // 3. Category Permissions
        const category = this.getCategory(actionType);
        if (!settings.permissions[category]) {
            return { allowed: false, reason: `Category '${category}' disabled` };
        }

        // 4. Quiet Hours
        if (settings.quietHours.enabled) {
            const hour = new Date(context.timestamp).getHours();
            const { start, end, allowCritical } = settings.quietHours;

            const isQuietTime = start > end
                ? (hour >= start || hour < end) // Cross midnight (e.g. 22 to 7)
                : (hour >= start && hour < end); // Same day (e.g. 9 to 17)

            if (isQuietTime) {
                // Allow critical if priority is high enough (e.g. > 8)
                if (allowCritical && estimatedPriority > 8) {
                    // Pass
                } else {
                    return { allowed: false, reason: 'Quiet hours active' };
                }
            }
        }

        // 5. Context Awareness: Focus Mode
        if (settings.contextAwareness.respectFocusMode && context.app.focusMode) {
            // Only allow silent or high priority actions
            if (category !== 'silent' && estimatedPriority < 9) {
                return { allowed: false, reason: 'Focus mode active' };
            }
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

        // 7. Rate Limiting (Hourly)
        const stats = await activityLogger.getStats(0.04); // Last 1 hour (1/24 days)
        if (stats.total >= settings.limits.maxActionsPerHour) {
            // Allow critical actions to bypass rate limit
            if (estimatedPriority < 9) {
                return { allowed: false, reason: 'Hourly rate limit reached' };
            }
        }

        return { allowed: true };
    }

    private getCategory(type: ProactiveActionType): 'silent' | 'informative' | 'suggestive' | 'interactive' | 'autonomous' {
        if (type.startsWith('silent_')) return 'silent';
        if (type.startsWith('info_')) return 'informative';
        if (type.startsWith('suggest_')) return 'suggestive';
        if (type.startsWith('chat_')) return 'interactive';
        if (type.startsWith('auto_')) return 'autonomous';
        return 'informative'; // Default
    }
}

export const permissionManager = new PermissionManager();
