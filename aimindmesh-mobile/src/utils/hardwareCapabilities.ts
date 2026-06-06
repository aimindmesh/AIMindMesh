import { Device } from '@capacitor/device';
import { logger } from '../services/logger';

// Default safe values
const MIN_RAM_FOR_HIGH_END = 6 * 1024 * 1024 * 1024; // 6GB

export interface HardwareInfo {
    nThreads: number;
    maxContextHeight: number; // Rough estimate based on RAM
    isHighEnd: boolean;
}

/**
 * Gets the number of logical processors.
 * On Web/WebView, we can use navigator.hardwareConcurrency.
 */
export const getCpuCoreCount = (): number => {
    try {
        return navigator.hardwareConcurrency || 4;
    } catch (e) {
        logger.log('warn', 'Failed to get CPU core count', e);
        return 4;
    }
};

/**
 * Calculates the recommended number of threads for LLM inference.
 * Usually physical cores (or logical / 2) is a good starting point,
 * or simply `hardwareConcurrency` minus some overhead for the OS.
 * PocketPal uses: cores <= 4 ? cores : Math.floor(cores * 0.8)
 */
export const getRecommendedThreadCount = (): number => {
    const cores = getCpuCoreCount();
    if (cores <= 4) return cores;
    // Leave some room for the OS and UI thread
    return Math.floor(cores * 0.8);
};

/**
 * Estimates if the device is "High End" based on RAM and CPU.
 * Note: Browser/Capacitor API for RAM is limited.
 * We use Device.getInfo() for some hints, but it might not return total RAM on all platforms.
 */
export const getHardwareInfo = async (): Promise<HardwareInfo> => {
    let totalRam = 4 * 1024 * 1024 * 1024; // Assume 4GB as baseline if unknown
    try {
        const info = await Device.getInfo();
        // @ts-ignore - memUsed/realDiskTotal are standard but realTotalRAM is not always available in basic plugin
        // Some robust plugins might provide it. For now, we fallback or use heuristic if available.
        // If we can't get RAM, we assume standard/mid-range.
        if ((info as any).memTotal) {
            totalRam = (info as any).memTotal;
        }
    } catch (e) {
        logger.log('warn', 'Failed to get device info', e);
    }

    const cores = getCpuCoreCount();
    const isHighEnd = totalRam >= MIN_RAM_FOR_HIGH_END && cores >= 6;

    // Context size estimation
    // 4GB RAM -> conservative 2k/4k
    // 8GB+ RAM -> can handle 8k/16k+
    let maxContextHeight = 2048;
    if (totalRam >= 12 * 1024 * 1024 * 1024) { // 12GB+
        maxContextHeight = 16384;
    } else if (totalRam >= 8 * 1024 * 1024 * 1024) { // 8GB+
        maxContextHeight = 8192;
    } else if (totalRam >= 6 * 1024 * 1024 * 1024) { // 6GB+
        maxContextHeight = 4096;
    }

    return {
        nThreads: getRecommendedThreadCount(),
        maxContextHeight,
        isHighEnd
    };
};
