import { describe, expect, it } from 'vitest';
import {
    normalizeSttProvider,
    normalizeTtsProvider,
    shouldUseStandardVoiceChat,
} from '../src/services/tts/providerIds';

describe('voice provider ids', () => {
    it('normalizes capitalized and legacy ids', () => {
        expect(normalizeSttProvider('Vosk')).toBe('vosk');
        expect(normalizeTtsProvider('Piper')).toBe('piper');
        expect(normalizeTtsProvider('gemini')).toBe('online');
        expect(normalizeSttProvider('system')).toBe('offline');
        expect(normalizeSttProvider(' Whisper ')).toBe('whisper');
        expect(normalizeTtsProvider(undefined)).toBe('');
    });

    it('keeps every configured provider on the standard voice pipeline', () => {
        expect(shouldUseStandardVoiceChat('whisper', 'kokoro')).toBe(true);
        expect(shouldUseStandardVoiceChat('Vosk', 'Piper')).toBe(true);
        expect(shouldUseStandardVoiceChat('online', 'online')).toBe(true);
        expect(shouldUseStandardVoiceChat('voxtral', undefined)).toBe(true);
    });

    it('falls back to Gemini Live only for unrecognized ids', () => {
        expect(shouldUseStandardVoiceChat(undefined, undefined)).toBe(false);
        expect(shouldUseStandardVoiceChat('live', 'live')).toBe(false);
    });
});
