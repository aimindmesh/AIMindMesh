import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({ entries: {} as Record<string, 'file' | 'directory'> }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' },
    FileSystemAdapter: {
        stat: vi.fn(async ({ path }: { path: string }) => {
            const type = fsState.entries[path];
            if (!type) throw new Error('not found');
            return { type, size: 1, uri: path };
        }),
    },
}));
vi.mock('../src/utils/permissions', () => ({ requestMicrophonePermission: vi.fn(async () => true) }));
vi.mock('../src/services/stt/voxtralPlugin', () => ({ default: {} }));
vi.mock('vad-capacitor', () => ({ VAD: {} }));

import { resolveWhisperModelRelativePath } from '../src/services/stt/whisperModelDownloader';
import { normalizeVoxtralTokens } from '../src/services/stt/voxtralSTT';
import { int16ToFloat32Base64 } from '../src/services/stt/vadService';

describe('whisper model path resolution', () => {
    beforeEach(() => { fsState.entries = {}; });

    it('prefers the standalone binary', async () => {
        fsState.entries['whisper-models/ggml-base.bin'] = 'file';
        expect(await resolveWhisperModelRelativePath('ggml-base')).toBe('whisper-models/ggml-base.bin');
    });

    it('loads an imported ZIP bundle from its directory', async () => {
        fsState.entries['whisper-models/my-bundle'] = 'directory';
        expect(await resolveWhisperModelRelativePath('my-bundle')).toBe('whisper-models/my-bundle');
    });

    it('returns null for a missing model', async () => {
        expect(await resolveWhisperModelRelativePath('nope')).toBeNull();
    });
});

describe('voxtral token normalization', () => {
    it('maps native snake_case timings to camelCase', () => {
        const [token] = normalizeVoxtralTokens([
            { text: 'ciao', timestampMs: 1_700_000_000_000, confidence: 1, start_ms: 1200, end_ms: 1700 },
        ]);
        expect(token.startMs).toBe(1200);
        expect(token.endMs).toBe(1700);
        expect(token.text).toBe('ciao');
    });

    it('keeps camelCase fields when present and tolerates bad payloads', () => {
        expect(normalizeVoxtralTokens([{ text: 'a', startMs: 5, start_ms: 9 }])[0].startMs).toBe(5);
        expect(normalizeVoxtralTokens(undefined)).toEqual([]);
    });
});

describe('VAD sample encoding', () => {
    it('sends little-endian Float32 samples', () => {
        const base64 = int16ToFloat32Base64(new Int16Array([0, 16384, -32768]));
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const floats = new Float32Array(bytes.buffer);
        expect(Array.from(floats)).toEqual([0, 0.5, -1]);
    });
});
