
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
import { getLastChatActivityAt } from '../llm/background/chatActivity';
import { onDeviceContextSize } from '../llm/context/contextSize';

/**
 * Context window of the configured model: the provider's window for remote providers
 * (nCtx/contextSize describe on-device models only), else the on-device setting.
 */
export function getContextWindow(llmConfig: Partial<LLMConfig> | null | undefined): number {
    if (!llmConfig) return 2048;
    return (llmConfig.provider && getProviderContextWindow(llmConfig.provider))
        || onDeviceContextSize(llmConfig);
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

/** Device state measured by the native worker for this check */
export interface DeviceSignals {
    screenOn?: boolean;
    /** System Do Not Disturb: treated as focus mode */
    dnd?: boolean;
}

const IDLE_AFTER_MS = 30 * 60 * 1000;
/** With the screen off the user is not using the phone: idle much sooner */
const IDLE_SCREEN_OFF_AFTER_MS = 3 * 60 * 1000;

/** User activity from the last interaction and the screen state */
export function inferActivity(now: number, lastInteraction: number, focus: boolean, screenOn?: boolean): 'idle' | 'active' | 'focus' {
    if (focus) return 'focus';
    const since = now - lastInteraction;
    if (since > IDLE_AFTER_MS || (screenOn === false && since > IDLE_SCREEN_OFF_AFTER_MS)) return 'idle';
    return 'active';
}

class ContextAnalyzer {
    private currentScreen: string = 'home';
    private isFocusMode: boolean = false;

    async analyze(signals: DeviceSignals = {}): Promise<ProactiveContext> {
        const timestamp = Date.now();
        const deviceContext = await this.getDeviceContext();
        const dataContext = await this.getDataContext();
        const focusMode = this.isFocusMode || signals.dnd === true;

        // Last interaction: chat activity of this app run, else the last message of the chat
        const lastInteraction = Math.max(getLastChatActivityAt(), this.getLastInteractionTime(dataContext.recentChatHistory));
        const activity = inferActivity(timestamp, lastInteraction, focusMode, signals.screenOn);

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
                focusMode,
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

    /** Time of the last chat message (0: no chat yet) */
    private getLastInteractionTime(messages: Message[]): number {
        if (messages.length === 0) return 0;
        const lastMsg = messages[messages.length - 1];
        const time = lastMsg.timestamp instanceof Date ? lastMsg.timestamp.getTime() : new Date(lastMsg.timestamp as any).getTime();
        return Number.isFinite(time) ? time : 0;
    }
}

export const contextAnalyzer = new ContextAnalyzer();
