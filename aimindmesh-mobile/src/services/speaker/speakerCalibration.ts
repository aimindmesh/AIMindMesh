/**
 * Speaker-matching calibration for the ECAPA features computed as the model expects (Kaldi
 * fbank + mean normalization, WeSpeaker): the same voice scores ~0.6-0.95, different people
 * ~0-0.35. Earlier versions computed other features: their thresholds (0.80 / 0.50) split one
 * voice into several speakers, and voice embeddings stored with them can't be compared any more.
 */

import { readSetting, storeSetting } from '../security/secretStore';
import { OWNER_VOICE_STORAGE_KEY } from './voiceStorage';

export const LIVE_MATCH_THRESHOLD = 0.60;
export const LIVE_REJECTION_THRESHOLD = 0.35;

/** Set when the enrolled owner voice was dropped by the migration: Settings asks to record it again. */
export const REENROLL_KEY = 'voice-profile-reenroll';
const CALIBRATION_KEY = 'speaker-calibration';
const CALIBRATION = 'kaldi-cmn';

/**
 * Runs once after the update: thresholds still at the old defaults are dropped (values the
 * user changed are kept), and the owner's enrolled voice, recorded with the old features, is
 * invalidated.
 */
export function migrateSpeakerCalibration(): void {
    try {
        if (localStorage.getItem(CALIBRATION_KEY) === CALIBRATION) return;
        // Meeting settings
        if (localStorage.getItem('embedding-threshold') === '0.8') localStorage.removeItem('embedding-threshold');
        if (localStorage.getItem('embedding-rejection-threshold') === '0.5') localStorage.removeItem('embedding-rejection-threshold');
        // App speech settings (Settings → Speaker)
        const speech = readSetting<Record<string, unknown> | null>('speech-config', null);
        if (speech && (speech.embeddingThreshold === 0.8 || speech.embeddingThreshold === undefined)) {
            storeSetting('speech-config', { ...speech, embeddingThreshold: LIVE_MATCH_THRESHOLD });
        }
        if (localStorage.getItem(OWNER_VOICE_STORAGE_KEY)) {
            localStorage.removeItem(OWNER_VOICE_STORAGE_KEY);
            localStorage.setItem(REENROLL_KEY, 'true');
        }
        localStorage.setItem(CALIBRATION_KEY, CALIBRATION);
    } catch {
        // storage unavailable: the new defaults apply anyway
    }
}

/** True until the owner records their voice again after the calibration change. */
export function needsVoiceReenrollment(): boolean {
    try {
        return localStorage.getItem(REENROLL_KEY) === 'true';
    } catch {
        return false;
    }
}
