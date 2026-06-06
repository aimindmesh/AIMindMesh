/**
 * Memory Pressure Service
 * 
 * Listens for native trim events broadcast by MemoryPressureManager
 * and dispatches unload calls to the appropriate services.
 * 
 * Respects the `alwaysKeepLoaded` setting for GGUF models.
 */

import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';

type TrimHandler = (component: string) => Promise<void>;

class MemoryPressureService {
    private handlers: Map<string, TrimHandler> = new Map();

    /**
     * Register a component handler for trim events
     */
    registerHandler(component: string, handler: TrimHandler): void {
        this.handlers.set(component, handler);
        logger.log('info', `[MemoryPressure] Registered handler for: ${component}`);
    }

    /**
     * Initialize the service by listening for native broadcast events.
     * Components register their own unload handlers.
     */
    initialize(): void {
        if (!Capacitor.isNativePlatform()) return;

        // Listen for trim broadcasts from native layer
        // These arrive via window custom events dispatched by the BroadcastReceiver
        window.addEventListener('trimComponent', async (event: Event) => {
            const detail = (event as CustomEvent).detail;
            const component = detail?.component as string;

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
                logger.log('warn', `[MemoryPressure] No handler for: ${component}`);
            }
        });

        logger.log('info', '[MemoryPressure] Service initialized');
    }
}

export const memoryPressureService = new MemoryPressureService();
