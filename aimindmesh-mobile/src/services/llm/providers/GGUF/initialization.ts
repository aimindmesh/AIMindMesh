import { LLMConfig, Message } from '../../../../types';
import { logger } from '../../../logger';
import { modelExists } from '../../../model/modelDownloader';
import * as nativeLLM from '../../nativeLLM';

// Global context operation mutex to prevent race conditions during initialization
let contextOperationMutex: Promise<any> = Promise.resolve();
// Track pending models to implement "last-one-wins" pattern
let pendingModelPath: string | null = null;

export async function initializeNativeModel(llmConfig: LLMConfig): Promise<{ supportsVision: boolean }> {
    // Mark intent immediately for last-one-wins pattern
    pendingModelPath = llmConfig.nativeModelPath || null;

    const operationPromise = contextOperationMutex.then(async () => {
        // Final check if this request is still current (last-one-wins logic)
        if (pendingModelPath !== llmConfig.nativeModelPath) {
            logger.log('info', `[GGUF] Skipping outdated load for "${llmConfig.nativeModelPath}" - user now wants "${pendingModelPath}"`);
            return { supportsVision: false };
        }

        // Ensure chat model is initialized in 'chat' slot
        // We must do this BEFORE checking for multimodal support
        const chatModelInfo = nativeLLM.getSlotModelInfo('chat');

        let supportsVision = false; // Declare at top level for catch block access

    // Check path and projector mismatches
    // Normalize to undefined for comparison (as config might be null/empty string vs undefined)
    const currentProj = chatModelInfo.multimodalProj || undefined;

    // Only use projector if vision is explicitly enabled
    let configProj = llmConfig.enableVision ? llmConfig.multimodalProj : undefined;

    // Fix: Decode URL-encoded paths if present (e.g. primary%3ADownload...)
    // This happens if the file path was stored directly from a content URI without being cleaned
    if (configProj && (configProj.includes('%3A') || configProj.includes('%2F'))) {
        try {
            configProj = decodeURIComponent(configProj);
            // Also handle specific Android prefixes if they persist after decoding
            // But usually decodeURIComponent is enough if the file matches the decoded name
            // If the actual file on disk is URL-encoded, this might break it, but that's rare.
            // Given the error log, the native layer expects a "real" path.
            logger.log('info', `Decoded multimodal projector path: ${configProj}`);
        } catch (e) {
            logger.log('warn', 'GGUF: Failed to decode multimodal projector path', e);
        }
    }

    // Check if we need to initialize or re-initialize
    let needsInit = !chatModelInfo.isLoaded ||
        chatModelInfo.modelPath !== llmConfig.nativeModelPath ||
        currentProj !== configProj;

    // Additional Check: If we expect vision (configProj exists) but the model is loaded,
    // verify if vision is actually enabled in the native layer. 
    // It might have failed to load the projector silently in a previous session.
    if (!needsInit && configProj && chatModelInfo.isLoaded) {
        try {
            const { registerPlugin } = await import('@capacitor/core');
            const LlamaCpp = registerPlugin('LlamaCpp') as any;
            const support = await LlamaCpp.getMultimodalSupport({ contextId: 0 }).catch(() => ({ vision: false }));
            if (!support.vision) {
                logger.log('warn', 'GGUF: Projector configured but vision not supported by native layer. Forcing re-initialization.');
                needsInit = true;
            }
        } catch (e) {
            logger.log('warn', 'GGUF: Failed to verify vision support', e);
        }
    }

    if (needsInit) {
        try {
            await nativeLLM.initNativeModel({
                modelPath: llmConfig.nativeModelPath!,
                nThreads: llmConfig.nThreads,
                nThreadsBatch: llmConfig.nThreadsBatch,
                nCtx: llmConfig.nCtx,
                nBatch: llmConfig.nBatch,
                nUBatch: llmConfig.nUBatch,
                flashAttn: llmConfig.flashAttn,
                cacheTypeK: llmConfig.cacheTypeK,
                cacheTypeV: llmConfig.cacheTypeV,
                nGpuLayers: llmConfig.nGpuLayers,
                useMmap: llmConfig.useMmap,
                minP: llmConfig.minP,
                useMlock: llmConfig.useMlock,
                customChatTemplate: llmConfig.customChatTemplate,
                multimodalProj: configProj,
                useOpenCL: llmConfig.useOpenCL,
                useVulkan: llmConfig.useVulkan,
                useHexagon: llmConfig.useHexagon,
            }, 'chat');
        } catch (initError: any) {
            logger.log('error', 'GGUF: Failed to initialize with projector', initError);

            // Check if it was a projector issue
            if (configProj) {
                const projFilename = configProj.split('/').pop() || configProj;
                const exists = await modelExists(projFilename);

                if (!exists) {
                    logger.log('error', `GGUF: Projector file not found: ${projFilename}`);
                } else {
                    logger.log('error', `GGUF: Projector file exists but init failed. File might be corrupt.`);
                }

                // Fallback: Try initializing WITHOUT projector
                logger.log('info', 'GGUF: Falling back to text-only mode...');
                await nativeLLM.initNativeModel({
                    modelPath: llmConfig.nativeModelPath!,
                    nThreads: llmConfig.nThreads,
                    nThreadsBatch: llmConfig.nThreadsBatch,
                    nCtx: llmConfig.nCtx,
                    nBatch: llmConfig.nBatch,
                    nUBatch: llmConfig.nUBatch,
                    flashAttn: llmConfig.flashAttn,
                    cacheTypeK: llmConfig.cacheTypeK,
                    cacheTypeV: llmConfig.cacheTypeV,
                    nGpuLayers: llmConfig.nGpuLayers,
                    useMmap: llmConfig.useMmap,
                    minP: llmConfig.minP,
                    useMlock: llmConfig.useMlock,
                    customChatTemplate: llmConfig.customChatTemplate,
                    multimodalProj: "", // Disable vision
                    useOpenCL: llmConfig.useOpenCL,
                    useVulkan: llmConfig.useVulkan,
                    useHexagon: llmConfig.useHexagon,
                }, 'chat');

                // Reset support flag since we disabled it
                supportsVision = false;
            } else {
                // If no projector was involved, rethrow
                throw initError;
            }
        }
    } // Closes if (needsInit)

    return { supportsVision };
    });

    // Keep mutex chain intact by swallowing errors
    contextOperationMutex = operationPromise.then(() => {}).catch(() => {});

    return await operationPromise;
}

export async function checkMultimodalCapabilities(history: Message[]): Promise<boolean> {
    // Check if model supports multimodal vision (for image attachments)
    const hasImages = history.some(m => m.images && m.images.length > 0);
    let supportsVision = false;

    if (hasImages) {
        try {
            const { registerPlugin } = await import('@capacitor/core');
            const LlamaCpp = registerPlugin('LlamaCpp') as any;
            const multimodalSupport = await LlamaCpp.getMultimodalSupport({ contextId: 0 }).catch(() => ({ vision: false, audio: false }));
            supportsVision = !!multimodalSupport.vision;

            if (supportsVision) {
                logger.log('info', 'GGUF model supports vision, embedding images in prompt');
            } else {
                logger.log('info', 'GGUF model does not support vision, images will be ignored');
            }
        } catch (error) {
            logger.log('warn', 'Failed to check multimodal support', error);
        }
    }
    return supportsVision;
}
