/**
 * Pure arithmetic of the LLM benchmark: speed from the timings, energy from the battery samples.
 * Energy is the battery power above the idle baseline (screen on, model loaded, nothing running),
 * so it measures what the generation itself costs.
 */

export interface PowerReading {
    /** ms (Date.now()) */
    t: number;
    powerMw?: number;
    charging: boolean;
}

export interface EnergyEstimate {
    /** Mean battery power during the run, W (null: charging or no readings) */
    avgW: number | null;
    /** Energy of the run, J (trapezoids between readings) */
    joules: number | null;
    seconds: number;
    charging: boolean;
}

export function integrateEnergy(samples: PowerReading[]): EnergyEstimate {
    const charging = samples.some(s => s.charging);
    const valid = samples.filter((s): s is PowerReading & { powerMw: number } => s.powerMw !== undefined && !s.charging);
    if (charging || valid.length < 2) return { avgW: null, joules: null, seconds: 0, charging };
    let joules = 0;
    for (let i = 1; i < valid.length; i++) {
        const dt = (valid[i].t - valid[i - 1].t) / 1000;
        joules += ((valid[i].powerMw + valid[i - 1].powerMw) / 2 / 1000) * dt;
    }
    const seconds = (valid[valid.length - 1].t - valid[0].t) / 1000;
    return { avgW: seconds > 0 ? joules / seconds : null, joules, seconds, charging };
}

/** What a run measured: GenieX gives exact token counts and timings, llama.cpp only JS timings */
export interface RunTimings {
    loadMs: number;
    ttftMs: number;
    totalMs: number;
    promptTokens: number;
    generatedTokens: number;
    /** From the engine profile when available, otherwise derived from the timings */
    prefillTps?: number;
    decodeTps?: number;
    /** Prompt tokens estimated from the characters (llama.cpp engine) */
    estimatedTokens?: boolean;
    computeUnit?: string;
}

export interface RunMetrics {
    prefillTps: number;
    decodeTps: number;
    avgW: number | null;
    /** Energy above the idle baseline, J */
    netJoules: number | null;
    /** J per 1000 tokens processed (prompt + answer) */
    jPer1kTokens: number | null;
    charging: boolean;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export function computeMetrics(timings: RunTimings, samples: PowerReading[], baselineW: number | null): RunMetrics {
    const decodeMs = Math.max(1, timings.totalMs - timings.ttftMs);
    const prefillTps = timings.prefillTps ?? timings.promptTokens / Math.max(0.001, timings.ttftMs / 1000);
    const decodeTps = timings.decodeTps ?? Math.max(0, timings.generatedTokens - 1) / (decodeMs / 1000);
    const energy = integrateEnergy(samples);
    let netJoules: number | null = null;
    if (energy.avgW !== null && energy.seconds > 0) {
        netJoules = Math.max(0, energy.avgW - (baselineW ?? 0)) * energy.seconds;
    }
    const tokens = timings.promptTokens + timings.generatedTokens;
    return {
        prefillTps: round(prefillTps),
        decodeTps: round(decodeTps),
        avgW: energy.avgW === null ? null : round(energy.avgW, 2),
        netJoules: netJoules === null ? null : round(netJoules, 1),
        jPer1kTokens: netJoules === null || tokens === 0 ? null : round((netJoules / tokens) * 1000, 1),
        charging: energy.charging,
    };
}

/** Mean power of an idle sampling, W */
export function baselineWatts(samples: PowerReading[]): number | null {
    return integrateEnergy(samples).avgW;
}

/** Rough token count for engines that do not report it (Italian/English: ~3.6 characters per token) */
export const estimateTokens = (text: string): number => Math.round(text.length / 3.6);
