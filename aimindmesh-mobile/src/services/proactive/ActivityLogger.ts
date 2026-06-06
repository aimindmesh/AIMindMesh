
import { ProactiveAction } from '../../types/proactive';


export interface ActivityLogEntry {
    actionId: string;
    actionType: string;
    timestamp: number;
    status: string;
    dismissed: boolean;
    interacted: boolean;
    interactionType?: 'clicked' | 'dismissed' | 'snoozed' | 'completed';
}

class ActivityLogger {
    private LOG_KEY = 'proactive_activity_log';
    private maxEntries = 1000;

    async log(action: ProactiveAction): Promise<void> {
        const entry: ActivityLogEntry = {
            actionId: action.id,
            actionType: action.type,
            timestamp: action.triggeredAt,
            status: action.status,
            dismissed: false,
            interacted: false,
        };

        const log = await this.getLog();
        log.push(entry);

        // Keep only last N entries
        if (log.length > this.maxEntries) {
            log.splice(0, log.length - this.maxEntries);
        }

        await this.saveLog(log);
    }

    async logInteraction(
        actionId: string,
        type: 'clicked' | 'dismissed' | 'snoozed' | 'completed'
    ): Promise<void> {
        const log = await this.getLog();
        const entry = log.find(e => e.actionId === actionId);

        if (entry) {
            entry.interacted = true;
            entry.interactionType = type;

            if (type === 'dismissed') {
                entry.dismissed = true;
            }

            await this.saveLog(log);
        }
    }

    async getStats(days: number = 7): Promise<any> {
        const log = await this.getLog();
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

        const recent = log.filter(e => e.timestamp > cutoff);

        const stats = {
            total: recent.length,
            byType: {} as Record<string, number>,
            dismissRate: 0,
            interactionRate: 0,
        };

        recent.forEach(entry => {
            stats.byType[entry.actionType] = (stats.byType[entry.actionType] || 0) + 1;
        });

        const dismissed = recent.filter(e => e.dismissed).length;
        const interacted = recent.filter(e => e.interacted).length;

        stats.dismissRate = recent.length > 0 ? dismissed / recent.length : 0;
        stats.interactionRate = recent.length > 0 ? interacted / recent.length : 0;

        return stats;
    }

    async getLog(): Promise<ActivityLogEntry[]> {
        try {
            const value = localStorage.getItem(this.LOG_KEY);
            return value ? JSON.parse(value) : [];
        } catch (error) {
            console.error('Failed to load activity log:', error);
            return [];
        }
    }

    async getLastActionTime(actionType: string): Promise<number | null> {
        const log = await this.getLog();
        const matching = log.filter(e => e.actionType === actionType);
        if (matching.length === 0) return null;

        // Return most recent timestamp
        return Math.max(...matching.map(e => e.timestamp));
    }

    private async saveLog(log: ActivityLogEntry[]): Promise<void> {
        localStorage.setItem(this.LOG_KEY, JSON.stringify(log));
    }
}

export const activityLogger = new ActivityLogger();
