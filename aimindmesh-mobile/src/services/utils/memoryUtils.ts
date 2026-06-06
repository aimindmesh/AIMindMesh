import { logger } from '../logger';

/**
 * Aggressively releases all AI model memory to prevent OOM during heavy operations
 * like file importing or model switching.
 */
export async function releaseAllResources() {
    logger.log('info', '[MemoryUtils] Starting aggressive memory cleanup...');

    // 1. Unload WebLLM
    try {
        const { unload } = await import('../llm/webLLM');
        await unload();
        logger.log('debug', '[MemoryUtils] WebLLM unloaded');
    } catch (e) {
        // Ignore if module not loaded or fails
    }

    // 2. Unload Native GGUF Models (Force Clean)
    try {
        const nativeLLM = await import('../llm/nativeLLM');
        // Force clean all potential slots 0-4
        if (nativeLLM.forceReleaseAllContexts) {
            await nativeLLM.forceReleaseAllContexts();
        } else {
            // Fallback
            await nativeLLM.unloadNativeModelSlot('chat');
            await nativeLLM.unloadNativeModelSlot('tool');
        }
        logger.log('debug', '[MemoryUtils] Native GGUF models force cleaned');
    } catch (e) {
        logger.log('debug', '[MemoryUtils] Native LLM cleanup skipped/failed', e);
    }

    // 3. Unload LiteRT
    try {
        const { releaseLiteRTModel, isLiteRTLoaded } = await import('../llm/providers/liteRTProvider');
        if (await isLiteRTLoaded()) {
            await releaseLiteRTModel();
            logger.log('debug', '[MemoryUtils] LiteRT model released');
        }
    } catch (e) {
        logger.log('debug', '[MemoryUtils] LiteRT cleanup skipped/failed', e);
    }

    // 4. Force Garbage Collection Delay
    if ((window as any).performance && (window as any).performance.memory) {
        logger.log('debug', `[MemoryUtils] JS Heap before/during GC wait: ${(window as any).performance.memory.usedJSHeapSize / 1048576} MB`);
    }

    logger.log('info', '[MemoryUtils] Waiting for GC (1500ms)...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    logger.log('info', '[MemoryUtils] Memory cleanup complete');
}
