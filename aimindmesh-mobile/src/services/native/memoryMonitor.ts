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

/** How long a pressure report counts: Android never reports that memory is fine again */
export const PRESSURE_TTL_MS = 2 * 60 * 1000;

/**
 * Pressure meant by an onTrimMemory level.
 * 5/10/15 (RUNNING_MODERATE/LOW/CRITICAL) are sent while the app runs. Levels from 20 up
 * (UI_HIDDEN, BACKGROUND, MODERATE, COMPLETE) describe the app going or being in background,
 * sent on every app switch: they leave the level unchanged (null).
 */
export function classifyTrimLevel(level: number): MemoryPressureLevel | null {
    if (level >= 20) return null;
    if (level >= 15) return MemoryPressureLevel.CRITICAL;
    if (level >= 5) return MemoryPressureLevel.MODERATE;
    return MemoryPressureLevel.NORMAL;
}

let reported = MemoryPressureLevel.NORMAL;
let reportedAt = 0;
let initialized = false;

export function reportMemoryPressure(level: MemoryPressureLevel, now = Date.now()): void {
    reported = level;
    reportedAt = now;
}

export const initMemoryMonitor = () => {
    if (initialized || !LlamaCpp || !LlamaCpp.addListener) return;
    initialized = true;

    LlamaCpp.addListener('onTrimMemory', (event: any) => {
        const level = classifyTrimLevel(event.level);
        if (level === null) return;
        reportMemoryPressure(level);
        if (level !== MemoryPressureLevel.NORMAL) {
            logger.log('warn', `[MemoryMonitor] Pressure level updated: ${level} (raw: ${event.level})`);
        }
    });

    LlamaCpp.addListener('onLowMemory', () => {
        reportMemoryPressure(MemoryPressureLevel.CRITICAL);
        logger.log('warn', '[MemoryMonitor] LOW MEMORY event received!');
    });
};

/** Current pressure: a report older than PRESSURE_TTL_MS no longer counts */
export const getMemoryPressure = (now = Date.now()) =>
    now - reportedAt > PRESSURE_TTL_MS ? MemoryPressureLevel.NORMAL : reported;
