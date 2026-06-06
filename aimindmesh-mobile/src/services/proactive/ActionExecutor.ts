
import { ProactiveAction, ProactiveActionType } from '../../types/proactive';
import { activityLogger } from './ActivityLogger';
import { LocalNotifications } from '@capacitor/local-notifications';
import { logger } from '../logger';
import { proactiveNotificationService } from './ProactiveNotificationService';

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

            // Get LLM config from localStorage
            const llmConfigStr = localStorage.getItem('llm-config');
            const apiKey = localStorage.getItem('gemini-api-key') || '';
            let llmConfig: any = null;

            if (llmConfigStr) {
                llmConfig = JSON.parse(llmConfigStr);
            }

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

            const { summarizeConversation } = await import('../llm/contextSummarization');

            // Get chat history from localStorage
            const historyItem = localStorage.getItem('chat-history');
            if (!historyItem) {
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

            // Get LLM config and API key
            const settingsItem = localStorage.getItem('settings');
            if (!settingsItem) {
                logger.log('warn', '[ActionExecutor] Settings not found');
                action.result = { success: false, reason: 'no_settings' };
                return;
            }

            const settings = JSON.parse(settingsItem);
            const llmConfig: any = settings.llmConfig;
            const apiKey = settings.apiKey;

            if (!apiKey) {
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

            // Perform summarization
            const summarized = await summarizeConversation(
                messages,
                llmConfig,
                action.data.threshold,
                apiKey
            );

            // Save back to localStorage
            localStorage.setItem('chat-history', JSON.stringify(summarized));

            logger.log('info', `[ActionExecutor] Context summarization complete`, {
                originalCount: messages.length,
                newCount: summarized.length,
                saved: messages.length - summarized.length
            });

            action.result = {
                success: true,
                originalCount: messages.length,
                newCount: summarized.length,
                messagesSaved: messages.length - summarized.length
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
