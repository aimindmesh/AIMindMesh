/**
 * useProactiveMessage.ts
 * Extracts the inline proactive message generation logic from App.tsx.
 * Handles RAG retrieval (memories + workspace docs), LLM call, UI state, and local notification.
 */

import { useCallback, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { LLMConfig, Personality, ProactiveSettings, Message } from '../types';
import { ProactiveAction } from '../types/proactive';
import { onProactiveAction } from '../services/proactive/ActionExecutor';
import { useNativeProactiveSync } from '../services/proactive/nativeProactiveSync';
import { getOrInitializeSemanticMemoryRetriever } from '../services/memory/semanticMemoryRetriever';
import { DocumentRetriever } from '../services/documents/DocumentRetriever';
import { buildProactiveMessagePrompt } from '../services/llm/promptBuilder';
import { generateProactiveMessage } from '../services/llm/llmService';
import { logger } from '../services/logger';

interface UseProactiveMessageOptions {
    chat: {
        messages: Message[];
        setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    };
    personality: Personality;
    llmConfig: LLMConfig;
    apiKey: string;
    isProactiveThinking: boolean;
    setIsProactiveThinking: (v: boolean) => void;
    incomingCall: boolean;
    isSettingsOpen: boolean;
    isVoiceMode: boolean;
    isAppActive: boolean;
    activeThreadId: string | null;
    proactiveSettings: ProactiveSettings;
}

export function useProactiveMessage({
    chat,
    personality,
    llmConfig,
    apiKey,
    isProactiveThinking,
    setIsProactiveThinking,
    incomingCall,
    isSettingsOpen,
    isVoiceMode,
    isAppActive,
    activeThreadId,
    proactiveSettings,
}: UseProactiveMessageOptions) {
    // App passes the proactive settings here: the native job and MainActivity need them too
    useNativeProactiveSync(proactiveSettings);

    // Meeting briefings (interactive proactive actions) become a chat message plus a notification
    const latest = useRef({ chat, personality, llmConfig, apiKey });
    latest.current = { chat, personality, llmConfig, apiKey };
    useEffect(() => onProactiveAction('chat', (action) => deliverChatAction(action, latest.current)), []);

    const handleProactiveMessage = useCallback(async () => {
        if (isProactiveThinking || incomingCall || isSettingsOpen || isVoiceMode) return;
        const lastMessage = chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
        if (lastMessage && (new Date().getTime() - new Date(lastMessage.timestamp).getTime()) < 30000) return;

        setIsProactiveThinking(true);
        try {
            // ─── RAG Retrieval ───────────────────────────────────────────────
            let memories: any[] = [];
            let workspaceDocs: any[] = [];
            const query = chat.messages.slice(-3).map(m => m.text).join(' ');

            if (llmConfig.enableSemanticMemory && query) {
                try {
                    const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                    if (retriever) {
                        memories = await retriever.retrieveRelevantMemories(query, activeThreadId || undefined, 3);
                        logger.log('info', `[Proactive] Retrieved ${memories.length} memories`);
                    }
                } catch (e) {
                    logger.log('warn', '[Proactive] Memory retrieval failed', e);
                }
            }

            if (query) {
                try {
                    const docRetriever = new DocumentRetriever();
                    workspaceDocs = await docRetriever.autoRetrieve(query);
                    logger.log('info', `[Proactive] Retrieved ${workspaceDocs.length} docs`);
                } catch (e) {
                    logger.log('warn', '[Proactive] Doc retrieval failed', e);
                }
            }

            // ─── Generate ────────────────────────────────────────────────────
            const prompt = buildProactiveMessagePrompt({
                personality,
                recentMessages: chat.messages.slice(-5),
                hoursSinceLastChat: lastMessage ? (new Date().getTime() - new Date(lastMessage.timestamp).getTime()) / (1000 * 60 * 60) : 24,
                currentTime: new Date(),
                memories,
                workspaceDocs
            });

            const response = await generateProactiveMessage(prompt, personality, llmConfig, apiKey);
            if (response) {
                const proactiveMsg: any = { id: Date.now().toString(), role: 'model', text: response, timestamp: new Date() };
                chat.setMessages((prev: Message[]) => [...prev, proactiveMsg]);

                // ─── Notify ──────────────────────────────────────────────────
                try {
                    await LocalNotifications.schedule({
                        notifications: [{
                            id: Math.floor(Date.now() % 2147483647),
                            title: personality.name,
                            body: response,
                            schedule: { at: new Date() },
                            sound: 'default',
                            smallIcon: 'ic_launcher',
                            channelId: 'proactive-messages'
                        }]
                    });
                } catch (e) {
                    logger.log('error', '[Proactive] Notification failed', e);
                }
            }
        } catch (error) {
            logger.log('error', '[Proactive] Message generation failed', error);
        } finally {
            setIsProactiveThinking(false);
        }
    }, [isProactiveThinking, chat.messages, personality, llmConfig, apiKey, incomingCall, isSettingsOpen, isVoiceMode, isAppActive, activeThreadId]);

    return { handleProactiveMessage };
}

/** On-device engines: a background generation would drop their chat KV cache */
const ON_DEVICE_PROVIDERS = ['litert', 'native-gguf'];

async function deliverChatAction(
    action: ProactiveAction,
    { chat, personality, llmConfig, apiKey }: { chat: UseProactiveMessageOptions['chat']; personality: Personality; llmConfig: LLMConfig; apiKey: string }
): Promise<void> {
    const prompt: string = action.data?.message || '';
    const start = action.data?.eventStart ? new Date(action.data.eventStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    // Plain reminder when no model can run now: the briefing still arrives
    let text = `📋 ${action.data?.eventTitle || action.data?.title || 'Upcoming event'}${start ? ` at ${start}` : ''}`;

    if (prompt && !ON_DEVICE_PROVIDERS.includes(llmConfig.provider)) {
        try {
            const generated = await generateProactiveMessage(prompt, personality, llmConfig, apiKey);
            if (generated?.trim()) text = generated;
        } catch (e) {
            logger.log('warn', '[Proactive] Briefing generation failed, sending the plain reminder', e);
        }
    }

    chat.setMessages(prev => [...prev, { id: `${action.id}-msg`, role: 'model', text, timestamp: new Date() } as Message]);
    try {
        await LocalNotifications.schedule({
            notifications: [{
                id: Math.floor(Date.now() % 2147483647),
                title: action.data?.title || personality.name,
                body: text.length > 300 ? `${text.slice(0, 297)}...` : text,
                schedule: { at: new Date() },
                smallIcon: 'ic_launcher',
                channelId: 'proactive-messages'
            }]
        });
    } catch (e) {
        logger.log('error', '[Proactive] Briefing notification failed', e);
    }
}
