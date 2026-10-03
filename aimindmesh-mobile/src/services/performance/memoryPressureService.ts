/**
 * Memory Pressure Service
 *
 * Listens for the trim requests MemoryPressureManager sends on onTrimMemory (forwarded by
 * the Performance plugin) and dispatches unload calls to the appropriate services.
 *
 * Only components that reload by themselves on next use get a handler: an unload must
 * never break a feature that is still running.
 */

import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import Performance from '../performancePlugin';
import { logger } from '../logger';

type TrimHandler = (component: string) => Promise<void>;

class MemoryPressureService {
    private handlers: Map<string, TrimHandler> = new Map();
    private listener: Promise<PluginListenerHandle> | null = null;

    /**
     * Register a component handler for trim events
     */
    registerHandler(component: string, handler: TrimHandler): void {
        this.handlers.set(component, handler);
        logger.log('info', `[MemoryPressure] Registered handler for: ${component}`);
    }

    /** Runs the handler of one trim request (exposed for tests) */
    async handleTrim(component: string | undefined): Promise<void> {
        if (!component) return;

        logger.log('warn', `[MemoryPressure] Trim request received: ${component}`);

        const handler = this.handlers.get(component);
        if (handler) {
            try {
                await handler(component);
                logger.log('info', `[MemoryPressure] Successfully unloaded: ${component}`);
            } catch (err) {
                logger.log('error', `[MemoryPressure] Failed to unload: ${component}`, err);
            }
        } else {
            logger.log('debug', `[MemoryPressure] No handler for: ${component}`);
        }
    }

    /**
     * Initialize the service by listening for native trim requests (once).
     * Components register their own unload handlers.
     */
    initialize(): void {
        if (!Capacitor.isNativePlatform() || this.listener) return;

        this.listener = Performance.addListener('trimComponent', event => {
            void this.handleTrim(event?.component);
        });
        this.listener.catch(err => {
            this.listener = null;
            logger.log('warn', '[MemoryPressure] Trim events unavailable', err);
        });

        // Heavy models (LLM, Stable Diffusion, large speech models) through the orchestrator:
        // they reload when their feature needs them, pinned ones (a recording) stay
        this.registerHandler('heavy_idle', async () => {
            const { releaseForMemoryPressure } = await import('../model/modelOrchestrator');
            await releaseForMemoryPressure('idle');
        });
        this.registerHandler('heavy_all', async () => {
            const { releaseForMemoryPressure } = await import('../model/modelOrchestrator');
            await releaseForMemoryPressure('all');
        });

        // Piper reloads its voice on the next speak (speech.ts)
        this.registerHandler('tts_piper', async () => {
            const { getPiperTtsService } = await import('../tts/piperTTS');
            const piper = getPiperTtsService();
            if (!piper.isBusy()) await piper.unloadVoice(); // never cut a reply mid-speech
        });

        logger.log('info', '[MemoryPressure] Service initialized');
    }
}

export const memoryPressureService = new MemoryPressureService();
