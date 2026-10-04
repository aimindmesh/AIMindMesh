/**
 * Last GenieX timings (TTFT, prefill and decode speed, compute unit): shown in the Genie settings
 * and logged, so the user sees whether the model really runs on the NPU and how fast.
 */
import type { GenieProfile } from 'genie-capacitor';
import { logger } from '../logger';

export interface GenieProfileRecord extends GenieProfile {
    model: string;
    at: number;
}

let last: GenieProfileRecord | null = null;
const listeners = new Set<(record: GenieProfileRecord) => void>();

export function recordGenieProfile(profile: GenieProfile, model: string): void {
    last = { ...profile, model, at: Date.now() };
    logger.log('info', `[GenieProfile] ${model}: ${formatGenieProfile(last)}`);
    listeners.forEach(listener => listener(last!));
}

export const getLastGenieProfile = (): GenieProfileRecord | null => last;

export function onGenieProfile(listener: (record: GenieProfileRecord) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** "NPU · first token 420 ms · prompt 812 tok at 350 tok/s · answer 96 tok at 18.2 tok/s" */
export function formatGenieProfile(p: GenieProfile): string {
    const parts = [
        p.computeUnit ? p.computeUnit.toUpperCase() : null,
        `first token ${Math.round(p.ttftMs)} ms`,
        `prompt ${p.promptTokens} tok at ${Math.round(p.prefillSpeed)} tok/s`,
        `answer ${p.generatedTokens} tok at ${p.decodingSpeed.toFixed(1)} tok/s`,
    ];
    return parts.filter(Boolean).join(' · ');
}

export function resetGenieStatsForTests(): void {
    last = null;
    listeners.clear();
}
