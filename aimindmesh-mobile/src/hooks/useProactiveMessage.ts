/**
 * useProactiveMessage.ts
 * Messages the assistant starts by itself: the spontaneous ones of the personality timer and
 * the meeting briefings of the proactive engine. Both go through the proactive permissions
 * (master switch, interactive permission, quiet hours, hourly/daily limits) and run as
 * background generations: they never interrupt the chat, and use an on-device model only
 * when it is loaded and the chat is quiet.
 */

import { useCallback, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { LLMConfig, Personality, ProactiveSettings, Message } from '../types';
import { ProactiveAction, ProactiveActionType } from '../types/proactive';
import { onProactiveAction } from '../services/proactive/ActionExecutor';
import { useNativeProactiveSync } from '../services/proactive/nativeProactiveSync';
import { getOrInitializeSemanticMemoryRetriever } from '../services/memory/semanticMemoryRetriever';
import { DocumentRetriever } from '../services/documents/DocumentRetriever';
import { buildProactiveMessagePrompt } from '../services/llm/promptBuilder';
import { runBackgroundTask } from '../services/llm/background/backgroundLlm';
import { isChatIdleFor } from '../services/llm/background/chatActivity';
import { readProactiveSettings } from '../services/proactive/proactiveSettings';
import { permissionManager } from '../services/proactive/PermissionManager';
import { contextAnalyzer } from '../services/proactive/ContextAnalyzer';
import { activityLogger } from '../services/proactive/ActivityLogger';
import { proactiveNotificationService } from '../services/proactive/ProactiveNotificationService';
import { logger } from '../services/logger';

/** A spontaneous message never interrupts: the chat must have been quiet this long */
export const ENGAGE_IDLE_MS = 10 * 60 * 1000;
const PROACTIVE_REQUEST = 'Based on the following context, generate a short, helpful proactive message to the user:\n\n';

interface UseProactiveMessageOptions {
    chat: {
        messages: Message[];
        setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    };
    personality: Personality;
    llmConfig: LLMConfig;
    isProactiveThinking: boolean;
    setIsProactiveThinking: (v: boolean) => void;
    incomingCall: boolean;
    isSettingsOpen: boolean;
    isVoiceMode: boolean;
    activeThreadId: string | null;
    proactiveSettings: ProactiveSettings;
}

function messageTime(message: Message | undefined): number {
    if (!message) return 0;
    const time = new Date(message.timestamp).getTime();
    return Number.isFinite(time) ? time : 0;
}

/** The engagement is logged like any proactive chat message (hourly and daily limits) */
function logEngagement(id: string): Promise<void> {
    const now = Date.now();
    const action: ProactiveAction = {
        id, type: ProactiveActionType.CHAT_CURIOSITY, category: 'interactive', triggeredBy: 'personality_timer',
        triggeredAt: now, data: {}, status: 'completed', requiresConfirmation: false, dismissible: true,
        priority: 4, logLevel: 'info',
    };
    return activityLogger.log(action);
}

async function notify(title: string, body: string): Promise<void> {
    try {
        await LocalNotifications.schedule({
            notifications: [{
                id: Math.floor(Date.now() % 2147483647),
                title,
                body: body.length > 300 ? `${body.slice(0, 297)}...` : body,
                schedule: { at: new Date() },
                smallIcon: 'ic_launcher',
                channelId: proactiveNotificationService.getChannelId(),
            }]
        });
    } catch (e) {
        logger.log('error', '[Proactive] Notification failed', e);
    }
}

export function useProactiveMessage({
    chat,
    personality,
    llmConfig,
    isProactiveThinking,
    setIsProactiveThinking,
    incomingCall,
    isSettingsOpen,
    isVoiceMode,
    activeThreadId,
    proactiveSettings,
}: UseProactiveMessageOptions) {
    // App passes the proactive settings here: the native job and MainActivity need them too
    useNativeProactiveSync(proactiveSettings);

    // Meeting briefings (interactive proactive actions) become a chat message plus a notification
    const latest = useRef({ chat, personality, llmConfig });
    latest.current = { chat, personality, llmConfig };
    useEffect(() => onProactiveAction('chat', (action) => deliverChatAction(action, latest.current)), []);

    /** Whether the assistant may start a conversation now (also gates its autonomous calls). */
    const canEngage = useCallback(async (): Promise<boolean> => {
        if (isProactiveThinking || incomingCall || isSettingsOpen || isVoiceMode) return false;
        if (!readProactiveSettings().enabled) return false;
        const lastMessage = chat.messages[chat.messages.length - 1];
        const now = Date.now();
        if (!isChatIdleFor(ENGAGE_IDLE_MS, now) || now - messageTime(lastMessage) < ENGAGE_IDLE_MS) return false;
        const permission = await permissionManager.checkPermission(
            ProactiveActionType.CHAT_CURIOSITY, await contextAnalyzer.analyze(), 4);
        if (!permission.allowed) logger.log('info', `[Proactive] Engagement held back: ${permission.reason}`);
        return permission.allowed;
    }, [isProactiveThinking, incomingCall, isSettingsOpen, isVoiceMode, chat.messages]);

    const handleProactiveMessage = useCallback(async () => {
        if (!(await canEngage())) return;
        const lastMessage = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;

        setIsProactiveThinking(true);
        try {
            // ─── RAG Retrieval ───────────────────────────────────────────────
            let retrieved: any[] = [];
            let workspaceDocs: any[] = [];
            const query = chat.messages.slice(-3).map(m => m.text).join(' ');

            if (llmConfig.enableSemanticMemory && query) {
                try {
                    const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                    if (retriever) {
                        retrieved = await retriever.retrieveRelevantMemories(query, activeThreadId || undefined, 3);
                        logger.log('info', `[Proactive] Retrieved ${retrieved.length} memories`);
                    }
                } catch (e) {
                    logger.log('warn', '[Proactive] Memory retrieval failed', e);
                }
            }

            if (query) {
                try {
                    workspaceDocs = await new DocumentRetriever().autoRetrieve(query);
                    logger.log('info', `[Proactive] Retrieved ${workspaceDocs.length} docs`);
                } catch (e) {
                    logger.log('warn', '[Proactive] Doc retrieval failed', e);
                }
            }

            // ─── Generate ────────────────────────────────────────────────────
            const prompt = buildProactiveMessagePrompt({
                personality,
                recentMessages: chat.messages.slice(-5),
                hoursSinceLastChat: lastMessage ? (Date.now() - messageTime(lastMessage)) / (1000 * 60 * 60) : 24,
                currentTime: new Date(),
                memories: retrieved,
                workspaceDocs
            });

            const outcome = await runBackgroundTask({
                label: 'proactive-message', prompt: PROACTIVE_REQUEST + prompt,
                persona: personality, llmConfig, requireIdleMs: ENGAGE_IDLE_MS,
            });
            if (!outcome.text) return;

            const id = Date.now().toString();
            chat.setMessages((prev: Message[]) => [...prev, { id, role: 'model', text: outcome.text!, timestamp: new Date() } as Message]);
            await logEngagement(`engage-${id}`);
            await notify(personality.name, outcome.text);
        } catch (error) {
            logger.log('error', '[Proactive] Message generation failed', error);
        } finally {
            setIsProactiveThinking(false);
        }
    }, [canEngage, chat, personality, llmConfig, activeThreadId, setIsProactiveThinking]);

    return { handleProactiveMessage, canEngage };
}

async function deliverChatAction(
    action: ProactiveAction,
    { chat, personality, llmConfig }: { chat: UseProactiveMessageOptions['chat']; personality: Personality; llmConfig: LLMConfig }
): Promise<void> {
    const prompt: string = action.data?.message || '';
    const start = action.data?.eventStart ? new Date(action.data.eventStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    // Plain reminder when no model can run now: the briefing still arrives
    let text = `📋 ${action.data?.eventTitle || action.data?.title || 'Upcoming event'}${start ? ` at ${start}` : ''}`;

    if (prompt) {
        const outcome = await runBackgroundTask({ label: 'meeting-briefing', prompt: PROACTIVE_REQUEST + prompt, persona: personality, llmConfig });
        if (outcome.text) text = outcome.text;
        else logger.log('info', `[Proactive] Briefing without model text (${outcome.skipped}): plain reminder`);
    }

    chat.setMessages(prev => [...prev, { id: `${action.id}-msg`, role: 'model', text, timestamp: new Date() } as Message]);
    await notify(action.data?.title || personality.name, text);
}
