import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
    const pending: (() => void)[] = [];
    return {
        pending,
        speak: vi.fn(() => new Promise<void>(resolve => { pending.push(resolve); })),
        // The native stop resolves the interrupted speak call
        stop: vi.fn(async () => { pending.splice(0).forEach(r => r()); }),
    };
});

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('piper-capacitor', () => ({ Piper: { speak: native.speak, stop: native.stop } }));
vi.mock('../src/services/tts/piper-wasm-api', () => ({
    piperPhonemize: vi.fn(async () => ({ phonemeIds: [1, 2, 3] })),
}));
vi.mock('../src/utils/fileSystemAdapter', () => ({
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' },
    FileSystemAdapter: { readFile: vi.fn(async () => ({ data: '{}' })) },
}));
vi.mock('../src/services/tts/kokoroPlugin', () => ({ Kokoro: { speak: native.speak, stop: native.stop } }));

import { PiperTextToSpeechService } from '../src/services/tts/piperTTS';
import { KokoroTextToSpeechService } from '../src/services/tts/kokoroTTS';

const flush = () => new Promise(r => setTimeout(r, 0));

describe('TTS sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        native.pending.length = 0;
        (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:cfg');
        (globalThis as any).URL.revokeObjectURL = vi.fn();
        (window as any).location = { origin: 'http://localhost' };
    });

    it('a stopped Piper reply does not resume when the next one starts', async () => {
        const piper = new PiperTextToSpeechService();
        (piper as any).currentVoiceId = 'it_IT-paola-medium';
        const firstEnd = vi.fn();
        const first = piper.speakStreaming('Uno. Due. Tre.', undefined, firstEnd);
        await vi.waitFor(() => expect(native.speak).toHaveBeenCalledTimes(1));

        const secondEnd = vi.fn();
        const second = piper.speakStreaming('Altro.', undefined, secondEnd);
        await vi.waitFor(() => expect(native.speak).toHaveBeenCalledTimes(2));
        expect(piper.isBusy()).toBe(true);
        native.pending.splice(0).forEach(r => r());
        await Promise.all([first, second]);
        await flush();

        // The first reply spoke one sentence, then stopped: no "Due."/"Tre.", no onEnd
        expect(native.speak).toHaveBeenCalledTimes(2);
        expect(firstEnd).not.toHaveBeenCalled();
        expect(secondEnd).toHaveBeenCalledTimes(1);
        expect(piper.isSpeakingNow()).toBe(false);
        expect(piper.isBusy()).toBe(false);
    });

    it('a stopped Kokoro reply does not report onEnd for the newer one', async () => {
        const kokoro = new KokoroTextToSpeechService();
        (kokoro as any).currentVoiceId = 'if_sara';
        const firstEnd = vi.fn();
        const first = kokoro.speak('Uno.', firstEnd);
        await vi.waitFor(() => expect(native.speak).toHaveBeenCalledTimes(1));
        await kokoro.stop();
        await first;

        expect(firstEnd).not.toHaveBeenCalled();
        expect(kokoro.isSpeakingNow()).toBe(false);
    });
});
