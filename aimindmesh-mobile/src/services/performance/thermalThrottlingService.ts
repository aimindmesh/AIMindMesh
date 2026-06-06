/**
 * Thermal Throttling Service
 * 
 * Polls the native PerformancePlugin every 30 seconds to read CPU temperature.
 * Applies graduated throttling strategy based on 5 thermal tiers:
 *   NORMAL → WARM(38°C) → HOT(42°C) → VERY_HOT(47°C) → CRITICAL(52°C)
 * 
 * Includes 3°C hysteresis to prevent rapid tier oscillation.
 */

import { Capacitor } from '@capacitor/core';
import PerformancePlugin, { ThermalTier } from '../performancePlugin';
import { logger } from '../logger';

// Hysteresis: require 3°C drop below tier boundary before downgrading
const HYSTERESIS_DEGREES = 3;

class ThermalThrottlingService {
    private currentTier: ThermalTier = 'NORMAL';
    private monitorInterval: ReturnType<typeof setInterval> | null = null;
    private lastTemp = 0;
    private onTierChange: ((tier: ThermalTier, temp: number) => void) | null = null;

    /**
     * Start thermal monitoring with configurable interval.
     * @param intervalMs Polling interval in milliseconds (default: 30s)
     */
    start(intervalMs = 30_000): void {
        if (!Capacitor.isNativePlatform()) return;
        if (this.monitorInterval) return;

        logger.log('info', `[Thermal] Starting monitoring (interval: ${intervalMs}ms)`);
        this.monitorInterval = setInterval(() => this.checkAndApply(), intervalMs);
        // Run immediately on start
        this.checkAndApply();
    }

    /**
     * Stop thermal monitoring.
     */
    stop(): void {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            logger.log('info', '[Thermal] Monitoring stopped');
        }
    }

    /**
     * Register a callback for tier changes.
     * The callback receives the new tier and current temperature.
     */
    setOnTierChange(callback: (tier: ThermalTier, temp: number) => void): void {
        this.onTierChange = callback;
    }

    /**
     * Get the current thermal tier.
     */
    getCurrentTier(): ThermalTier {
        return this.currentTier;
    }

    /**
     * Get the last measured temperature.
     */
    getLastTemperature(): number {
        return this.lastTemp;
    }

    private async checkAndApply(): Promise<void> {
        try {
            const status = await PerformancePlugin.getThermalStatus();
            const temp = status.cpuTempCelsius;
            this.lastTemp = temp;

            if (temp < 0) {
                // Temperature unavailable
                return;
            }

            // Classify with hysteresis: only downgrade if temp is 3°C below threshold
            const newTier = this.classifyWithHysteresis(temp);

            if (newTier === this.currentTier) return;

            const prevTier = this.currentTier;
            this.currentTier = newTier;

            logger.log('warn', `[Thermal] Tier changed: ${prevTier} → ${newTier} (${temp.toFixed(1)}°C)`);

            if (this.onTierChange) {
                this.onTierChange(newTier, temp);
            }
        } catch (err) {
            logger.log('error', '[Thermal] Failed to check thermal status', err);
        }
    }

    /**
     * Apply hysteresis to prevent rapid tier oscillation.
     * Upgrading (hotter) happens at the exact threshold.
     * Downgrading (cooler) requires crossing 3°C below the current tier's threshold.
     */
    private classifyWithHysteresis(temp: number): ThermalTier {
        const tierThresholds: Array<{ tier: ThermalTier; min: number }> = [
            { tier: 'CRITICAL', min: 52 },
            { tier: 'VERY_HOT', min: 47 },
            { tier: 'HOT', min: 42 },
            { tier: 'WARM', min: 38 },
            { tier: 'NORMAL', min: 0 },
        ];

        // Find the appropriate tier going top-down (hottest first)
        for (const { tier, min } of tierThresholds) {
            if (temp >= min) {
                // If upgrading to a hotter tier, accept immediately
                const currentIdx = tierThresholds.findIndex(t => t.tier === this.currentTier);
                const newIdx = tierThresholds.findIndex(t => t.tier === tier);

                if (newIdx <= currentIdx) {
                    // Upgrading or same — accept immediately
                    return tier;
                } else {
                    // Downgrading — require hysteresis clearance
                    const currentThreshold = tierThresholds[currentIdx]?.min ?? 0;
                    if (temp < currentThreshold - HYSTERESIS_DEGREES) {
                        return tier;
                    }
                    // Stay at current tier (hysteresis active)
                    return this.currentTier;
                }
            }
        }

        return 'NORMAL';
    }
}

export const thermalThrottlingService = new ThermalThrottlingService();
