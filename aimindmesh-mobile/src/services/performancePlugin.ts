import { registerPlugin } from '@capacitor/core';

export type ThermalTier = 'UNKNOWN' | 'NORMAL' | 'WARM' | 'HOT' | 'VERY_HOT' | 'CRITICAL';

export interface ThermalStatus {
    cpuTempCelsius: number;
    thermalTier: ThermalTier;
    headroom?: number;
}

export interface PerformancePlugin {
    requestIgnoreBatteryOptimizations(): Promise<void>;
    isIgnoringBatteryOptimizations(): Promise<{ isIgnoring: boolean }>;
    startKeepAlive(): Promise<void>;
    stopKeepAlive(): Promise<void>;
    getThermalStatus(): Promise<ThermalStatus>;
}

const Performance = registerPlugin<PerformancePlugin>('Performance');

export default Performance;
