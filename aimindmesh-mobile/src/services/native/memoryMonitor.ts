import { registerPlugin, Capacitor } from '@capacitor/core';
import { logger } from '../logger';

// Try to grab LlamaCpp to listen for memory events
let LlamaCpp: any = null;
if (Capacitor.isNativePlatform()) {
    try {
        LlamaCpp = registerPlugin('LlamaCpp');
    } catch (e) {
        // Ignored
    }
}

export enum MemoryPressureLevel {
    NORMAL = 0,
    MODERATE = 1,
    CRITICAL = 2
}

let currentMemoryPressure = MemoryPressureLevel.NORMAL;

export const initMemoryMonitor = () => {
    if (!LlamaCpp || !LlamaCpp.addListener) return;

    LlamaCpp.addListener('onTrimMemory', (event: any) => {
        const level = event.level;
        // TRIM_MEMORY_RUNNING_MODERATE (5), TRIM_MEMORY_RUNNING_LOW (10), TRIM_MEMORY_RUNNING_CRITICAL (15)
        if (level >= 15) {
            currentMemoryPressure = MemoryPressureLevel.CRITICAL;
        } else if (level >= 5) {
            currentMemoryPressure = MemoryPressureLevel.MODERATE;
        } else {
            currentMemoryPressure = MemoryPressureLevel.NORMAL;
        }
        
        if (currentMemoryPressure !== MemoryPressureLevel.NORMAL) {
            logger.log('warn', `[MemoryMonitor] Pressure level updated: ${currentMemoryPressure} (raw: ${level})`);
        }
    });

    LlamaCpp.addListener('onLowMemory', () => {
        currentMemoryPressure = MemoryPressureLevel.CRITICAL;
        logger.log('warn', '[MemoryMonitor] LOW MEMORY event received!');
    });
};

// Expose getter
export const getMemoryPressure = () => currentMemoryPressure;
