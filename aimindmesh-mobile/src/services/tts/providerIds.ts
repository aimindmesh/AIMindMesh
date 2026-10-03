import type { SttProvider, TtsProvider } from '../../types';

/**
 * Provider ids are compared lowercase everywhere, but older settings (and the one-click
 * setup) stored 'Vosk'/'Piper' or the legacy 'gemini'/'system' ids. Normalizing at the
 * point of use keeps those configurations working instead of silently matching nothing.
 */
const LEGACY_ALIASES: Record<string, string> = {
    gemini: 'online',
    system: 'offline',
};

function normalize(id: unknown): string {
    const lower = typeof id === 'string' ? id.trim().toLowerCase() : '';
    return LEGACY_ALIASES[lower] ?? lower;
}

const TTS_PROVIDERS: TtsProvider[] = ['offline', 'online', 'piper', 'kokoro'];
const STT_PROVIDERS: SttProvider[] = ['offline', 'online', 'vosk', 'whisper', 'voxtral'];

/** Returns the canonical TTS id, or the lowercased input when it is not a known provider. */
export function normalizeTtsProvider(id: unknown): TtsProvider {
    return normalize(id) as TtsProvider;
}

/** Returns the canonical STT id, or the lowercased input when it is not a known provider. */
export function normalizeSttProvider(id: unknown): SttProvider {
    return normalize(id) as SttProvider;
}

export function isKnownTtsProvider(id: unknown): id is TtsProvider {
    return TTS_PROVIDERS.includes(id as TtsProvider);
}

export function isKnownSttProvider(id: unknown): id is SttProvider {
    return STT_PROVIDERS.includes(id as SttProvider);
}

/**
 * Whether a voice call runs on the app's own STT/TTS pipeline ("standard") instead of
 * Gemini Live. Every configured provider (local or online) stays standard: Gemini Live
 * needs an API key and network and would ignore the configured Whisper/Kokoro/Piper models,
 * so it is only the fallback when neither id is recognized.
 */
export function shouldUseStandardVoiceChat(stt: unknown, tts: unknown): boolean {
    return isKnownSttProvider(normalizeSttProvider(stt)) || isKnownTtsProvider(normalizeTtsProvider(tts));
}
