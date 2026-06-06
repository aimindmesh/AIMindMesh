import { registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { logger } from '../../../logger';
import {
    LiteRTPlugin,
    LiteRTConfig,
    LiteRTInitOptions
} from './types';

// Register plugin
export const LiteRT = registerPlugin<LiteRTPlugin>('LiteRT');

export const state = {
    isInitialized: false,
    tokenListenerHandle: null as PluginListenerHandle | null,
    lastSystemPrompt: '',
    lastRunWasBackground: false
};

/**
 * Initialize the LiteRT LLM with a model file
 */
export async function initLiteRTModel(config: LiteRTConfig): Promise<boolean> {
    try {
        logger.log('debug', '[LiteRT] Initializing model:', config.modelPath);

        const options: LiteRTInitOptions = {
            modelPath: config.modelPath,
            maxTokens: config.maxTokens ?? 8192,
            temperature: config.temperature ?? 0.8,
            topK: config.topK ?? 40,
            topP: config.topP ?? 0.95,
            backend: config.backend ?? 'CPU',
            enableVision: config.enableVision ?? true,
            enableAudio: config.enableAudio ?? true,
            maxNumImages: 10,
            useVisionGpu: (config.backend === 'GPU' && (config.enableVision ?? true)),
            storeChats: config.storeChats ?? true,
            enableMtp: config.enableMtp ?? true
        };

        const result = await LiteRT.initModel(options);
        
        if (result.success) {
            state.isInitialized = true;
            logger.log('debug', '[LiteRT] Model loaded successfully', result.modelInfo);
            return true;
        } else {
            // Handle specific case: session already exists but is orphaned or conflicting
            if (result.error && result.error.includes('A session already exists')) {
                logger.log('warn', '[LiteRT] Session already exists, attempting force release and retry...');
                await releaseLiteRTModel();
                const retryResult = await LiteRT.initModel(options);
                if (retryResult.success) {
                    state.isInitialized = true;
                    logger.log('info', '[LiteRT] Model loaded successfully after force release');
                    return true;
                }
            }
            logger.log('error', '[LiteRT] Failed to load model:', result.error);
            return false;
        }
    } catch (error: any) {
        logger.log('error', '[LiteRT] Init error:', error);
        return false;
    }
}

/**
 * Generate a complete response (non-streaming)
 */
export async function generateLiteRTResponse(
    prompt: string,
    images?: string[],
    audio?: string[]
): Promise<string> {
    if (!state.isInitialized) {
        throw new Error('LiteRT not initialized. Call initLiteRTModel first.');
    }

    try {
        const result = await LiteRT.generateResponse({
            prompt,
            images,
            audio,
        });

        return result.text;
    } catch (error) {
        logger.log('error', '[LiteRT] Generation error:', error);
        throw error;
    }
}

/**
 * Stop current generation
 */
export async function stopLiteRTGeneration(): Promise<void> {
    try {
        await LiteRT.stopGeneration();
        if (state.tokenListenerHandle) {
            state.tokenListenerHandle.remove();
            state.tokenListenerHandle = null;
        }
    } catch (error) {
        logger.log('error', '[LiteRT] Stop error:', error);
    }
}

/**
 * Release LiteRT resources
 */
export async function releaseLiteRTModel(): Promise<void> {
    try {
        if (state.tokenListenerHandle) {
            state.tokenListenerHandle.remove();
            state.tokenListenerHandle = null;
        }

        await LiteRT.releaseSession();
        await LiteRT.releaseModel();
        state.isInitialized = false;
        logger.log('debug', '[LiteRT] Model and session released');
    } catch (error) {
        logger.log('error', '[LiteRT] Release error:', error);
    }
}

/**
 * Release LiteRT conversation session (resets history)
 */
export async function releaseLiteRTSession(): Promise<void> {
    try {
        await LiteRT.releaseSession();
        logger.log('info', '[LiteRT] Native session released');
    } catch (error) {
        logger.log('error', '[LiteRT] Session release error:', error);
    }
}

/**
 * Check if LiteRT model is loaded
 */
export async function isLiteRTLoaded(): Promise<boolean> {
    try {
        const result = await LiteRT.isModelLoaded();
        return result.isLoaded;
    } catch {
        return false;
    }
}

/**
 * Get current message count in LiteRT history
 */
export async function getLiteRTMessageCount(): Promise<number> {
    try {
        const result = await LiteRT.getMessageCount();
        return result.count;
    } catch {
        return 0;
    }
}

/**
 * Save current LiteRT conversation history to disk
 */
export async function saveLiteRTKvCache(conversationId: string): Promise<boolean> {
    try {
        const result = await LiteRT.saveKvCache({ conversationId });
        return result.success;
    } catch (error) {
        logger.log('error', '[LiteRT] Failed to save KV Cache:', error);
        return false;
    }
}

/**
 * Restore LiteRT conversation history from disk and rebuild KV cache
 */
export async function restoreLiteRTKvCache(conversationId: string): Promise<boolean> {
    try {
        const result = await LiteRT.restoreKvCache({ conversationId });
        if (result.success) {
            state.isInitialized = true;
            logger.log('info', `[LiteRT] KV Cache restored (${result.messageCount} messages)`);
            return true;
        }
        return false;
    } catch (error) {
        logger.log('error', '[LiteRT] Failed to restore KV Cache:', error);
        return false;
    }
}

/**
 * Invalidate/Delete LiteRT conversation history from disk
 */
export async function invalidateLiteRTKvCache(conversationId: string): Promise<boolean> {
    try {
        const result = await LiteRT.invalidateKvCache({ conversationId });
        return result.success;
    } catch (error) {
        logger.log('error', '[LiteRT] Failed to invalidate KV Cache:', error);
        return false;
    }
}
