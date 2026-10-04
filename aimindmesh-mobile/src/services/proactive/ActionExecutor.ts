
import { ProactiveAction, ProactiveActionType } from '../../types/proactive';
import { getActiveThreadId } from '../llm/threadManager';
import { activityLogger } from './ActivityLogger';
import { logger } from '../logger';
import { proactiveNotificationService } from './ProactiveNotificationService';
import { readProactiveSettings } from './proactiveSettings';

const CHAT_HISTORY_KEY = 'chat-history';
const CONTEXT_SUMMARY_SYSTEM = 'You summarize conversations faithfully and concisely, in the language of the conversation.';

// Event bus for UI interactions
type ActionHandler = (action: ProactiveAction) => Promise<void>;
const actionHandlers: Record<string, ActionHandler[]> = {};

export function onProactiveAction(type: 'suggestion' | 'chat', handler: ActionHandler) {
    if (!actionHandlers[type]) actionHandlers[type] = [];
    actionHandlers[type].push(handler);
    return () => {
        actionHandlers[type] = actionHandlers[type].filter(h => h !== handler);
    };
}

class ActionExecutor {
    private isExecuting = false;

    async execute(action: ProactiveAction): Promise<void> {
        const autonomous = action.category === 'autonomous';
        if (this.isExecuting && autonomous) {
            logger.log('warn', `[ActionExecutor] Skipping autonomous action because another one is already running: ${action.type}`);
            return;
        }

        logger.log('info', `[ActionExecutor] Executing action: ${action.type} (${action.id})`);

        // One heavy autonomous task at a time; released in finally, whatever happens
        if (autonomous) {
            this.isExecuting = true;
        }

        try {
            // Update status to executing
            action.status = 'executing';
            await activityLogger.log(action);

            switch (action.category) {
                case 'silent':
                    await this.executeSilent(action);
                    break;
                case 'informative':
                    await this.executeInformative(action);
                    break;
                case 'suggestive':
                    await this.executeSuggestive(action);
                    break;
                case 'interactive':
                    await this.executeInteractive(action);
                    break;
                case 'autonomous':
                    await this.executeAutonomous(action);
                    break;
                default:
                    throw new Error(`Unknown category: ${action.category}`);
            }

            action.status = 'completed';
            action.result = 'Success';
            await activityLogger.log(action);

        } catch (error: any) {
            logger.log('error', `[ActionExecutor] Action failed: ${action.id}`, error);
            action.status = 'failed';
            action.error = error.message;
            await activityLogger.log(action);
        } finally {
            if (autonomous) this.isExecuting = false;
        }
    }

    // --- Category Executors ---

    private async executeSilent(action: ProactiveAction) {
        // E.g. Preload model, clean cache
        if (action.type === ProactiveActionType.SILENT_PRELOAD_MODEL) {
            // Trigger model loading (mock for now, or import model loader)
            logger.log('info', '[ActionExecutor] Preloading model...');
        } else if (action.type === ProactiveActionType.SILENT_CACHE_CLEANUP) {
            // Cleanup logic
            logger.log('info', '[ActionExecutor] Cleaning cache...');
        }
    }

    private async executeInformative(action: ProactiveAction) {
        // Show notification using configured settings
        try {
            await proactiveNotificationService.sendNotification(
                action.data.title || 'AI Mind Mesh',
                action.data.message || 'New suggestion available',
                readProactiveSettings()
            );
        } catch (error) {
            logger.log('error', '[ActionExecutor] Failed to send notification', error);
        }
    }

    private async executeSuggestive(action: ProactiveAction) {
        // Dipatch to UI (Suggestion Cards)
        this.notifyHandlers('suggestion', action);
    }

    private async executeInteractive(action: ProactiveAction) {
        // Dispatch to Chat UI
        this.notifyHandlers('chat', action);
    }

    private async executeAutonomous(action: ProactiveAction) {
        // Direct modification (be very careful)
        if (action.type === ProactiveActionType.AUTO_CREATE_TASK) {
            // await createTask(action.data);
        } else if (action.type === ProactiveActionType.AUTO_RESCHEDULE_EVENT) {
            // await updateEvent(...)
        } else if (action.type === ProactiveActionType.PERFORM_MEMORY_MAINTENANCE) {
            // Episodic memory only: near-identical rows of the same role, then old chat turns
            // summarized per conversation and day. Facts are never merged or deleted.
            const { runEpisodicMaintenance } = await import('../memory/episodicMaintenance');
            logger.log('info', `[ActionExecutor] Starting memory maintenance (count: ${action.data.memoryCount})`);
            action.result = await runEpisodicMaintenance();
            logger.log('info', '[ActionExecutor] Memory maintenance done', action.result);
        } else if (action.type === ProactiveActionType.SUMMARIZE_CONTEXT) {
            action.result = await this.summarizeContext(action);
        }
    }

    /**
     * Summarizes the older part of the active thread for the model. The summary only shortens
     * what the model receives: the conversation (chat-history and the saved thread) is never rewritten.
     */
    private async summarizeContext(action: ProactiveAction): Promise<Record<string, unknown>> {
        logger.log('info', `[ActionExecutor] Starting context summarization (usage: ${Math.round(action.data.currentUsage * 100)}%, count: ${action.data.messageCount})`);

        const { summarizeForModel } = await import('../llm/contextSummarization');
        const { applyContextSummary, saveContextSummary } = await import('../llm/contextSummaryStore');
        const { runBackgroundTask } = await import('../llm/background/backgroundLlm');

        const threadId = getActiveThreadId();
        const historyItem = localStorage.getItem(CHAT_HISTORY_KEY);
        if (!historyItem || !threadId) {
            logger.log('warn', '[ActionExecutor] No chat history found');
            return { success: false, reason: 'no_history' };
        }

        const messages: any[] = JSON.parse(historyItem, (_key, value) => {
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                return new Date(value);
            }
            return value;
        });

        // Any provider, with its own key; an on-device model only when loaded and the chat is quiet
        let skipped: string | undefined;
        const generate = async (prompt: string) => {
            const outcome = await runBackgroundTask({ label: 'context-summary', prompt, systemPrompt: CONTEXT_SUMMARY_SYSTEM });
            skipped = outcome.skipped;
            return outcome.text;
        };

        const modelHistory = applyContextSummary(messages, threadId);
        const result = await summarizeForModel(modelHistory, action.data.threshold, generate);
        if (!result) {
            return { success: false, reason: skipped ?? 'nothing_summarized' };
        }

        // The covered messages must still be in the conversation (it may have been cleared meanwhile)
        const stillCovered = (): boolean => {
            try {
                const current: { id?: string }[] = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
                return Array.isArray(current) && current.some(m => m?.id === result.coversUpToId);
            } catch {
                return false;
            }
        };
        if (getActiveThreadId() !== threadId || !stillCovered()) {
            logger.log('info', '[ActionExecutor] Chat changed during summarization, result discarded');
            return { success: false, reason: 'history_changed' };
        }
        saveContextSummary({ threadId, summary: result.summary, coversUpToId: result.coversUpToId, createdAt: Date.now() });

        logger.log('info', `[ActionExecutor] Context summarization complete`, {
            modelHistory: modelHistory.length,
            summarized: result.summarizedCount
        });

        return {
            success: true,
            originalCount: modelHistory.length,
            newCount: modelHistory.length - result.summarizedCount + 1,
            messagesSaved: result.summarizedCount - 1
        };
    }

    private notifyHandlers(type: string, action: ProactiveAction) {
        const handlers = actionHandlers[type];
        if (handlers) {
            handlers.forEach(h => h(action).catch(e => console.error(e)));
        }
    }
}

export const actionExecutor = new ActionExecutor();
