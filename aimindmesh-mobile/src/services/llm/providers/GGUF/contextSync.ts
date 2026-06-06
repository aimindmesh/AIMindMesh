import { Capacitor } from '@capacitor/core';
import { logger } from '../../../logger';
import { Message, LLMConfig } from '../../../../types';
import { getNativeMessageCount, resetNativeContext } from '../../nativeLLM';

let lastSystemPrompt = '';

export async function syncGGUFContext(
    history: Message[],
    llmConfig: LLMConfig,
    systemPrompt: string,
    slot: 'chat' | 'tool' | 'memory' = 'chat'
): Promise<{
    messagesToFormat: Message[];
    systemPromptToUse: string;
    appendMode: boolean;
}> {
    let messagesToFormat: Message[] = history;
    let systemPromptToUse = systemPrompt;
    let appendMode = false;
    let shouldReset = false;

    const usePersistentContext = (llmConfig.storeChats ?? true) && Capacitor.isNativePlatform();
    const promptChanged = lastSystemPrompt !== systemPrompt;
    
    // Check if this is a background / proactive / summary request
    const isBackground = history.length === 1 && (history[0].id === 'summary-request' || history[0].id === 'proactive');

    if (usePersistentContext && !promptChanged) {
        try {
            const count = await getNativeMessageCount(slot);
            const expectedCount = Math.max(0, history.length - 1);

            if (history.length > 1 && count === expectedCount) {
                logger.log('info', `[GGUFContext] 🔗 Context sync match (Count: ${count}). Appending new message.`);
                messagesToFormat = [history[history.length - 1]];
                systemPromptToUse = '';
                appendMode = true;
            } else if (history.length === 1 && count === 0) {
                logger.log('info', '[GGUFContext] Starting new session (fresh state).');
            } else {
                logger.log('info', `[GGUFContext] ⚠️ Context mismatch (Native: ${count}, User: ${history.length}). Hard Resetting.`);
                shouldReset = true;
            }
        } catch (e) {
            logger.log('warn', '[GGUFContext] Failed to sync context state', e);
            shouldReset = true;
        }
    } else {
        if (promptChanged) {
            logger.log('info', '[GGUFContext] 🔄 System Prompt Changed. Forcing session reset.');
        }
        shouldReset = true;
    }

    if (shouldReset) {
        try {
            logger.log('info', `[GGUFContext] Performing Hard Session Reset for slot: ${slot}.`);
            await resetNativeContext(slot);
            messagesToFormat = history;
            systemPromptToUse = systemPrompt;
            appendMode = false;
            if (!isBackground) {
                lastSystemPrompt = systemPrompt; // Track the new prompt
            }
        } catch (e) {
            logger.log('warn', '[GGUFContext] Failed to reset context', e);
        }
    }

    return { messagesToFormat, systemPromptToUse, appendMode };
}
