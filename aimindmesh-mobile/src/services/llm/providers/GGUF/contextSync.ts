import { Capacitor } from '@capacitor/core';
import { logger } from '../../../logger';
import { resetNativeContext } from '../../nativeLLM';

/**
 * Native context of a GGUF slot before a generation. The native layer keeps the KV cache and
 * reuses the longest common token prefix with the previous prompt (LLMInference.cpp): the full
 * conversation is always sent, and the turns already processed are not processed again.
 * Resetting the context here (as before) made every turn re-process the whole conversation.
 *
 * A hard reset is still needed for prompts with images: that path does not track the prefix.
 */
export async function syncGGUFContext(
    slot: 'chat' | 'tool' | 'memory' = 'chat',
    options: { hasImages?: boolean } = {}
): Promise<void> {
    if (!options.hasImages || !Capacitor.isNativePlatform()) return;
    try {
        logger.log('info', `[GGUFContext] Prompt with images: resetting slot ${slot}`);
        await resetNativeContext(slot);
    } catch (e) {
        logger.log('warn', '[GGUFContext] Failed to reset context', e);
    }
}
