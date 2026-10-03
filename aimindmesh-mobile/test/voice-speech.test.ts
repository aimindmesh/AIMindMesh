import { beforeEach, describe, expect, it, vi } from 'vitest';

const piper = vi.hoisted(() => ({
    stop: vi.fn(async () => {}),
    isVoiceLoaded: vi.fn(() => true),
    getCurrentVoiceId: vi.fn(() => 'it_IT-paola-medium'),
    isSupported: vi.fn(() => true),
    loadVoice: vi.fn(async () => {}),
    speakStreaming: vi.fn(async (_text: string, _onStart: unknown, onEnd?: () => void) => onEnd?.()),
}));
const kokoro = vi.hoisted(() => ({
    stop: vi.fn(async () => {}),
    isVoiceLoaded: vi.fn(() => false),
    getCurrentVoiceId: vi.fn(() => null),
    isSupported: vi.fn(() => true),
    loadVoice: vi.fn(async () => {}),
    speak: vi.fn(async () => {}),
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/tts/piperTTS', () => ({ getPiperTtsService: () => piper }));
vi.mock('../src/services/tts/kokoroTTS', () => ({ getKokoroTtsService: () => kokoro }));
vi.mock('../src/utils/permissions', () => ({ requestMicrophonePermission: vi.fn(async () => true) }));
vi.mock('../src/utils/audio', () => ({ createBlob: vi.fn(), decode: vi.fn(), decodeAudioData: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn(), Modality: { AUDIO: 'AUDIO' } }));

import { speak, stopSpeaking } from '../src/services/tts/speech';

const llmConfig = {} as any;

describe('speech TTS dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (window as any).speechSynthesis;
    });

    it('stopSpeaking stops Piper and Kokoro (no require() in the bundle)', () => {
        stopSpeaking();
        expect(piper.stop).toHaveBeenCalledTimes(1);
        expect(kokoro.stop).toHaveBeenCalledTimes(1);
    });

    it('routes capitalized provider ids from older settings', async () => {
        const onEnd = vi.fn();
        await speak('Ciao.', 'Piper' as any, llmConfig, undefined, undefined, onEnd);
        expect(piper.speakStreaming).toHaveBeenCalledTimes(1);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('still reports the end for an unknown provider', async () => {
        const onEnd = vi.fn();
        await speak('Ciao.', 'nonexistent' as any, llmConfig, undefined, undefined, onEnd);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('reports the end of a reply that an external stop interrupted', async () => {
        piper.speakStreaming.mockImplementationOnce(async () => { /* never reaches its end */ });
        const onEnd = vi.fn();
        await speak('Ciao.', 'piper', llmConfig, undefined, undefined, onEnd);
        expect(onEnd).not.toHaveBeenCalled();
        stopSpeaking();
        expect(onEnd).toHaveBeenCalledTimes(1);
        stopSpeaking();
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('keeps a replaced reply silent so it cannot reset the new one', async () => {
        let lateEnd: (() => void) | undefined;
        piper.speakStreaming.mockImplementationOnce(async (_t: string, _s: unknown, end?: () => void) => { lateEnd = end; });
        const firstEnd = vi.fn();
        await speak('Uno.', 'piper', llmConfig, undefined, undefined, firstEnd);
        const secondEnd = vi.fn();
        await speak('Due.', 'piper', llmConfig, undefined, undefined, secondEnd);
        lateEnd?.();
        expect(firstEnd).not.toHaveBeenCalled();
        expect(secondEnd).toHaveBeenCalledTimes(1);
    });

    it('reports the end when the WebView has no speechSynthesis', async () => {
        const onEnd = vi.fn();
        await speak('Ciao.', 'offline', llmConfig, undefined, undefined, onEnd);
        expect(onEnd).toHaveBeenCalledTimes(1);
    });
});
