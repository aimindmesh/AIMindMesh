
import { getRecentMemories, getMemoryCount } from '../memory/memoryDatabase';
import { getAllEvents, systemCalendarVisible } from '../calendar/calendarService';
import { getUpcomingTasks, getOverdueTasks } from '../calendar/taskDatabase';
import { Message, LLMConfig } from '../../types/index';
// @ts-ignore - Plugins might not be installed yet, handling gracefully
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { isMobile } from '../../utils/platform';
import { estimateContextUsage } from '../llm/contextMonitor';
import { getProviderContextWindow } from '../llm/context/unifiedContextManager';
import { readSetting } from '../security/secretStore';
import { logger } from '../logger';
import { CalendarEvent as BriefingEvent, toBriefingEvents } from './meetingBriefingService';
import { applyContextSummary } from '../llm/contextSummaryStore';
import { getActiveThreadId } from '../llm/threadManager';

/**
 * Context window of the configured model: the provider's window for remote providers
 * (nCtx/contextSize describe on-device models only), else the on-device setting.
 */
export function getContextWindow(llmConfig: Partial<LLMConfig> | null | undefined): number {
    if (!llmConfig) return 2048;
    return (llmConfig.provider && getProviderContextWindow(llmConfig.provider))
        || llmConfig.nCtx || llmConfig.contextSize || 2048;
}

export interface ProactiveContext {
    timestamp: number;
    location?: {
        lat: number;
        lng: number;
        label?: string;
    };
    device: {
        batteryLevel: number;
        isCharging: boolean;
        networkType: 'wifi' | 'cellular' | 'none' | 'unknown';
        isPowerSaveMode: boolean;
        platform: string;
    };
    user: {
        details?: any; // User profile if available
        activity: 'idle' | 'active' | 'focus';
        lastInteraction: number;
    };
    app: {
        currentScreen?: string;
        focusMode: boolean;
    };
    data: {
        recentMemories: any[];
        upcomingEvents: BriefingEvent[];
        overdueTasks: any[];
        upcomingTasks: any[];
        recentChatHistory: Message[];
        memoryCount: number;
    };
    chat: {
        messageCount: number;
        contextUsage: number; // 0.0 - 1.0
    };
}

class ContextAnalyzer {
    private currentScreen: string = 'home';
    private isFocusMode: boolean = false;

    async analyze(): Promise<ProactiveContext> {
        const timestamp = Date.now();
        const deviceContext = await this.getDeviceContext();
        const dataContext = await this.getDataContext();

        // User activity inference (simple heuristic for now)
        const lastInteraction = this.getLastInteractionTime(dataContext.recentChatHistory);
        const timeSinceInteraction = timestamp - lastInteraction;
        let activity: 'idle' | 'active' | 'focus' = 'active';

        if (this.isFocusMode) {
            activity = 'focus';
        } else if (timeSinceInteraction > 30 * 60 * 1000) { // 30 mins
            activity = 'idle';
        }

        // Chat context calculation
        const chatContextUsage = await this.getChatContextUsage();

        const context: ProactiveContext = {
            timestamp,
            device: deviceContext,
            user: {
                activity,
                lastInteraction,
            },
            app: {
                currentScreen: this.currentScreen,
                focusMode: this.isFocusMode,
            },
            data: dataContext,
            chat: chatContextUsage,
        };

        return context;
    }

    // --- State Setters ---

    setScreen(screenName: string) {
        this.currentScreen = screenName;
    }

    setFocusMode(enabled: boolean) {
        this.isFocusMode = enabled;
    }

    // --- Data Gathering ---

    private async getDeviceContext() {
        let batteryLevel = 1.0;
        let isCharging = true;
        let networkType: 'wifi' | 'cellular' | 'none' | 'unknown' = 'unknown';
        let isPowerSaveMode = false;
        let platform = 'web';

        try {
            // Platform check
            const info = await Device.getInfo();
            platform = info.platform;

            // Network check
            const status = await Network.getStatus();
            networkType = status.connectionType as any;

            // Battery check (only on mobile usually)
            if (isMobile()) {
                const bat = await Device.getBatteryInfo();
                batteryLevel = bat.batteryLevel || 1.0;
                isCharging = bat.isCharging || false;
            }
        } catch (e) {
            // Fallback or ignore if plugins not implemented
            // console.warn('Failed to get device info', e);
        }

        return {
            batteryLevel,
            isCharging,
            networkType,
            isPowerSaveMode,
            platform,
        };
    }

    private async getDataContext() {
        const [
            recentMemories,
            upcomingEvents,
            overdueTasks,
            upcomingTasks,
            recentChatHistory,
            memoryCount
        ] = await Promise.all([
            this.getRecentMemoriesSafe(),
            this.getUpcomingEventsSafe(),
            getOverdueTasks().catch(() => []),
            getUpcomingTasks(3).catch(() => []),
            this.getRecentChatHistory(),
            getMemoryCount().catch(() => 0)
        ]);

        return {
            recentMemories,
            upcomingEvents,
            overdueTasks,
            upcomingTasks,
            recentChatHistory,
            memoryCount,
        };
    }

    private async getRecentMemoriesSafe() {
        try {
            return await getRecentMemories(5, undefined, 1); // Last 24h
        } catch (e) {
            console.error('Failed to get memories', e);
            return [];
        }
    }

    private async getUpcomingEventsSafe(): Promise<BriefingEvent[]> {
        try {
            const now = new Date();
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            // Near midnight, still reach the events of the next hours
            const end = new Date(Math.max(endOfDay.getTime(), now.getTime() + 2 * 60 * 60 * 1000));
            // Briefing shape: { start: ms } (the database returns startTime: Date)
            // Meetings usually live in the system calendar: included when the Agenda shows it
            return toBriefingEvents(await getAllEvents(now, end, await systemCalendarVisible()));
        } catch (e) {
            console.error('Failed to get events', e);
            return [];
        }
    }

    private async getRecentChatHistory(): Promise<Message[]> {
        try {
            if (typeof window === 'undefined') return [];
            const item = window.localStorage.getItem('chat-history');
            if (!item) return [];

            const messages = JSON.parse(item, (_key, value) => {
                // ISO Date reviver
                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                    return new Date(value);
                }
                return value;
            });

            return Array.isArray(messages) ? messages.slice(-10) : [];
        } catch (e) {
            console.error('Failed to get chat history', e);
            return [];
        }
    }

    private async getChatContextUsage(): Promise<{ messageCount: number; contextUsage: number }> {
        try {
            if (typeof window === 'undefined') {
                return { messageCount: 0, contextUsage: 0 };
            }

            // Get full chat history
            const historyItem = window.localStorage.getItem('chat-history');
            if (!historyItem) {
                return { messageCount: 0, contextUsage: 0 };
            }

            const messages: Message[] = JSON.parse(historyItem, (_key, value) => {
                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                    return new Date(value);
                }
                return value;
            });

            if (!Array.isArray(messages) || messages.length === 0) {
                return { messageCount: 0, contextUsage: 0 };
            }

            // Context window of the model in use (App stores its config under 'llm-config')
            const contextSize = getContextWindow(readSetting<Partial<LLMConfig> | null>('llm-config', null));

            // Usage of what the model actually receives: the thread's summary replaces what it covers
            const modelHistory = applyContextSummary(messages, getActiveThreadId());
            const estimate = estimateContextUsage(modelHistory, '', contextSize);

            return {
                messageCount: modelHistory.length,
                contextUsage: estimate.usagePercent
            };

        } catch (e) {
            logger.log('error', '[ContextAnalyzer] Failed to get chat context usage', e);
            return { messageCount: 0, contextUsage: 0 };
        }
    }

    private getLastInteractionTime(messages: Message[]): number {
        if (messages.length === 0) return Date.now();
        const lastMsg = messages[messages.length - 1];
        return lastMsg.timestamp instanceof Date ? lastMsg.timestamp.getTime() : Date.now();
    }
}

export const contextAnalyzer = new ContextAnalyzer();
