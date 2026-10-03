
import { ProactiveAction, ProactiveActionType } from '../../types/proactive';
import { readSetting } from '../security/secretStore';
import { getActiveThreadId } from '../llm/threadManager';
import { activityLogger } from './ActivityLogger';
import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../logger';
import { proactiveNotificationService } from './ProactiveNotificationService';

const CHAT_HISTORY_KEY = 'chat-history';
/** Providers that cannot generate without their key (same rule as the memory extraction) */
const KEYED_PROVIDERS = ['gemini', 'perplexity', 'claude'];

function getProviderApiKey(provider: string): string {
    const key = provider === 'perplexity' ? 'perplexity-api-key'
        : provider === 'claude' ? 'claude-api-key' : 'gemini-api-key';
    return readSetting<string>(key, '');
}

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
        if (this.isExecuting && action.category === 'autonomous') {
            logger.log('warn', `[ActionExecutor] Skipping autonomous action because another one is already running: ${action.type}`);
            return;
        }

        logger.log('info', `[ActionExecutor] Executing action: ${action.type} (${action.id})`);

        if (action.category === 'autonomous') {
            this.isExecuting = true;
        }

        // Update status to executing
        action.status = 'executing';
        await activityLogger.log(action);

        try {
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
            const settingsStr = localStorage.getItem('proactive-settings');
            if (settingsStr) {
                const settings = JSON.parse(settingsStr);
                await proactiveNotificationService.sendNotification(
                    action.data.title || 'AI Mind Mesh',
                    action.data.message || 'New suggestion available',
                    settings
                );
            } else {
                // Fallback to basic notification
                await LocalNotifications.schedule({
                    notifications: [{
                        title: action.data.title || 'AI Mind Mesh',
                        body: action.data.message || 'New suggestion available',
                        id: Math.floor(Math.random() * 100000),
                        schedule: { at: new Date(Date.now() + 1000) },
                        actionTypeId: '',
                        extra: { actionId: action.id }
                    }]
                });
            }
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
            // Perform memory deduplication and summarization
            const resultDetails: any = {};

            // Settings with their secrets (the raw key used to keep its JSON quotes)
            const llmConfig: any = readSetting<any>('llm-config', null);
            const apiKey = readSetting<string>('gemini-api-key', '');

            if (!llmConfig || !apiKey) {
                logger.log('warn', '[ActionExecutor] Cannot perform memory maintenance: LLM config or API key missing');
                action.result = { success: false, reason: 'no_llm_config' };
                return;
            }

            // Protect LiteRT Context
            if (llmConfig.provider === 'litert' || llmConfig.engine === 'litert') {
                logger.log('warn', '[ActionExecutor] Skipping memory maintenance to protect active LiteRT KV cache.');
                action.result = { success: false, reason: 'litert_active' };
                return;
            }

            const { MemorySummarizer } = await import('../memory/memorySummarizer');
            const summarizer = new MemorySummarizer(llmConfig, apiKey);
            const { deduplicateExistingMemories, getMemoryCount } = await import('../memory/memoryDatabase');

            logger.log('info', `[ActionExecutor] Starting memory maintenance (count: ${action.data.memoryCount})`);

            // Step 1: Semantic Consolidation (Merging similar groups)
            // Use configured threshold or default 0.80
            const threshold = llmConfig.memorySimilarityThreshold || 0.80;
            const consolidationResult = await summarizer.consolidateRedundantMemories(threshold);
            resultDetails.consolidated = consolidationResult.consolidatedCount;
            logger.log('info', `[ActionExecutor] Consolidation result: ${consolidationResult.message}`);

            // Step 2: Exact Deduplication (Cleanup remaining)
            const dedupedCtx = await deduplicateExistingMemories(0.95); // High threshold for near-duplicates
            resultDetails.deduped = dedupedCtx;
            logger.log('info', `[ActionExecutor] Deduplicated ${dedupedCtx} exact memories`);

            // Step 3: Summarize if count is still abnormally high (after dedup/consolidation)
            const newCount = await getMemoryCount();
            resultDetails.finalCount = newCount;

            if (newCount > 60) {
                const summarizationResult = await summarizer.summarizeMemories(20);
                logger.log('info', `[ActionExecutor] Summarization result: ${summarizationResult.message}`);
                resultDetails.summarized = summarizationResult.success;
            }

            action.result = resultDetails;
        } else if (action.type === ProactiveActionType.SUMMARIZE_CONTEXT) {
            // Perform context summarization
            logger.log('info', `[ActionExecutor] Starting context summarization (usage: ${Math.round(action.data.currentUsage * 100)}%, count: ${action.data.messageCount})`);

            const { summarizeForModel } = await import('../llm/contextSummarization');
            const { applyContextSummary, saveContextSummary } = await import('../llm/contextSummaryStore');

            // The summary belongs to the active thread and only shortens what the model receives:
            // the conversation itself (chat-history and the saved thread) is never rewritten
            const threadId = getActiveThreadId();
            const historyItem = localStorage.getItem(CHAT_HISTORY_KEY);
            if (!historyItem || !threadId) {
                logger.log('warn', '[ActionExecutor] No chat history found');
                action.result = { success: false, reason: 'no_history' };
                return;
            }

            const messages: any[] = JSON.parse(historyItem, (_key, value) => {
                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                    return new Date(value);
                }
                return value;
            });

            // Model config and its key, as App stores them ('llm-config', '<provider>-api-key')
            const llmConfig: any = readSetting<any>('llm-config', null);
            if (!llmConfig) {
                logger.log('warn', '[ActionExecutor] LLM config not found');
                action.result = { success: false, reason: 'no_llm_config' };
                return;
            }
            const apiKey = getProviderApiKey(llmConfig.provider);
            if (KEYED_PROVIDERS.includes(llmConfig.provider) && !apiKey) {
                logger.log('warn', '[ActionExecutor] API key not found');
                action.result = { success: false, reason: 'no_api_key' };
                return;
            }

            // Protect LiteRT Context
            if (llmConfig.provider === 'litert' || llmConfig.engine === 'litert') {
                logger.log('warn', '[ActionExecutor] Skipping context summarization to protect active LiteRT KV cache.');
                action.result = { success: false, reason: 'litert_active' };
                return;
            }

            const modelHistory = applyContextSummary(messages, threadId);
            const result = await summarizeForModel(modelHistory, llmConfig, action.data.threshold, apiKey || undefined);
            if (!result) {
                action.result = { success: false, reason: 'nothing_summarized' };
                return;
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
                action.result = { success: false, reason: 'history_changed' };
                return;
            }
            saveContextSummary({ threadId, summary: result.summary, coversUpToId: result.coversUpToId, createdAt: Date.now() });

            logger.log('info', `[ActionExecutor] Context summarization complete`, {
                modelHistory: modelHistory.length,
                summarized: result.summarizedCount
            });

            action.result = {
                success: true,
                originalCount: modelHistory.length,
                newCount: modelHistory.length - result.summarizedCount + 1,
                messagesSaved: result.summarizedCount - 1
            };
        }
    }

    private notifyHandlers(type: string, action: ProactiveAction) {
        const handlers = actionHandlers[type];
        if (handlers) {
            handlers.forEach(h => h(action).catch(e => console.error(e)));
        }
    }
}

export const actionExecutor = new ActionExecutor();
