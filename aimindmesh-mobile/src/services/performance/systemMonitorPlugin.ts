import { registerPlugin } from '@capacitor/core';

export interface SystemStats {
    ram: {
        total: number;
        available: number;
        used: number;
        threshold: number;
        lowMemory: boolean;
        appUsed: number;
    };
    cpu: number;
    gpu: number;
}

/** Battery power now: powerMw is missing while charging or when the device does not report the current */
export interface PowerSample {
    timestamp: number;
    charging: boolean;
    currentMa?: number;
    voltageMv?: number;
    powerMw?: number;
    levelPct?: number;
    temperatureC?: number;
}

export interface SystemMonitorPlugin {
    getStats(): Promise<SystemStats>;
    getPowerSample(): Promise<PowerSample>;
}

/** Native SystemMonitor (performance/SystemMonitorPlugin.java), registered once for the whole app */
export const SystemMonitor = registerPlugin<SystemMonitorPlugin>('SystemMonitor');
