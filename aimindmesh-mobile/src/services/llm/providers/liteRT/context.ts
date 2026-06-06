import { Capacitor } from '@capacitor/core';
import { logger } from '../../../logger';
import { Message, LLMConfig } from '../../../../types';
import { LiteRT, state, stopLiteRTGeneration, releaseLiteRTSession } from './plugin';
import { refineContext } from '../../context/unifiedContextManager';

// Safeguard limit for context window
export const SAFEGUARD_CONTEXT_SIZE = 2048;

/**
 * Synchronize native model state and session context
 */
export async function syncNativeContext(
    history: Message[],
    llmConfig: LLMConfig,
    absoluteModelPath: string,
    systemPrompt: string
): Promise<{
    messagesToFormat: Message[];
    systemPromptToUse: string;
    appendMode: boolean;
}> {
    if (Capacitor.isNativePlatform()) {
        try {
            const nativeState = await LiteRT.isModelLoaded();
            if (nativeState.isLoaded && nativeState.modelPath === absoluteModelPath) {
                logger.log('info', '[LiteRT] 🟢 Model already loaded in native layer. Hydrating state...');
                state.isInitialized = true;
            }
        } catch (e) {
            logger.log('warn', '[LiteRT] Failed to check native status:', e);
        }
    }

    let messagesToFormat: Message[] = history;
    let systemPromptToUse = systemPrompt;
    let appendMode = false;
    let shouldReset = false;

    const usePersistentContext = (llmConfig.storeChats ?? true) && Capacitor.isNativePlatform();
    const promptChanged = state.lastSystemPrompt !== systemPrompt;
    const isBackground = history.length === 1 && (history[0].id === 'summary-request' || history[0].id === 'proactive' || history[0].id === 'sys_memory_req');
    const sessionTypeChanged = state.lastRunWasBackground !== isBackground;

    if (usePersistentContext && state.isInitialized && !promptChanged && !sessionTypeChanged) {
        try {
            const { count } = await LiteRT.getMessageCount();
            const expectedCount = Math.max(0, history.length - 1);

            if (history.length > 1 && count > 0 && count <= expectedCount) {
                logger.log('info', `[LiteRT] 🔗 Context sync valid (Native: ${count}, Expected: ${expectedCount}). Appending new message.`);
                messagesToFormat = [history[history.length - 1]];
                systemPromptToUse = '';
                appendMode = true;
            } else if (history.length === 1 && count === 0) {
                logger.log('info', '[LiteRT] Starting new session (fresh state).');
            } else {
                logger.log('info', `[LiteRT] ⚠️ Context mismatch (Native: ${count}, Expected: ${expectedCount}). Hard Resetting.`);
                shouldReset = true;
            }
        } catch (e) {
            logger.log('warn', '[LiteRT] Failed to sync context state', e);
            shouldReset = true;
        }
    } else {
        if (promptChanged && state.isInitialized) {
            logger.log('info', '[LiteRT] 🔄 System Prompt Changed. Forcing session reset.');
        }
        shouldReset = true;
    }

    if (shouldReset) {
        try {
            if (!appendMode) {
                try { 
                    await stopLiteRTGeneration();
                    await releaseLiteRTSession();
                    logger.log('debug', '[LiteRT] Session reset for non-append mode (full history provided)');
                } catch (e) { 
                    logger.log('warn', '[LiteRT] Pre-generation reset failed', e);
                }
            }
            
            messagesToFormat = history;
            systemPromptToUse = systemPrompt;
            appendMode = false;
            
            if (!isBackground) {
                state.lastSystemPrompt = systemPrompt; // Track the new prompt
            }

        } catch (e) {
            logger.log('warn', '[LiteRT] Failed to reset context', e);
        }
    }

    // Truncation safeguard using UnifiedContextManager
    if (!appendMode) {
        const truncationResult = refineContext(
            messagesToFormat,
            systemPromptToUse,
            llmConfig,
            512 // Default maxResponseTokens
        );
        systemPromptToUse = truncationResult.systemPrompt;
        messagesToFormat = truncationResult.messages;
        if (!isBackground) {
            state.lastSystemPrompt = systemPromptToUse;
        }
    }

    state.lastRunWasBackground = isBackground;

    return { messagesToFormat, systemPromptToUse, appendMode };
}
