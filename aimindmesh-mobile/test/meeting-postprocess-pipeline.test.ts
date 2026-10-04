import { describe, expect, it, vi } from 'vitest';

// The pipeline module imports native plugins; only the pure policy is under test here.
const transcribeRange = vi.fn();
vi.mock('whisper-capacitor', () => ({ Whisper: { transcribeRange: (r: any) => transcribeRange(r) } }));
vi.mock('vad-capacitor', () => ({ VAD: {} }));
vi.mock('speaker-embedding-capacitor', () => ({ SpeakerEmbedding: {} }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {} }));
vi.mock('../src/services/audio/audioConverter', () => ({ default: {} }));
vi.mock('../src/services/stt/vadService', () => ({ getVADService: () => ({}) }));
vi.mock('../src/services/stt/whisperModelDownloader', () => ({ listLocalWhisperModels: async () => [] }));
vi.mock('../src/services/models/bundledModels', () => ({ waitForBundledModels: async () => { } }));

const { audioCtxFor, transcribeSpeech } = await import('../src/services/meeting/postProcessing/pipeline');

describe('audioCtxFor', () => {
    it('shortens the encoder window for small on short chunks, with a margin', () => {
        expect(audioCtxFor('ggml-small-q8_0', 6000)).toBe(300 + 256);
    });

    it('keeps the full window for long chunks', () => {
        expect(audioCtxFor('ggml-small-q8_0', 25_000)).toBe(0);
    });

    it('never shortens it for models that degrade with it', () => {
        expect(audioCtxFor('ggml-base-q8_0', 6000)).toBe(0);
        expect(audioCtxFor('ggml-large-v3-turbo-q8_0', 6000)).toBe(0);
    });
});

describe('transcribeSpeech', () => {
    const request = { audioPath: 'a.wav', startMs: 60_000, endMs: 66_000, language: 'it', initialPrompt: 'garbled text' };
    const said = { text: 'Bene, allora', segments: [{ text: 'Bene, allora', startMs: 60_000, endMs: 62_000 }] };
    const nothing = { text: '', segments: [] };

    it('retries without the prompt when a garbled one made Whisper return nothing', async () => {
        transcribeRange.mockReset().mockResolvedValueOnce(nothing).mockResolvedValueOnce(said);
        expect(await transcribeSpeech(request)).toBe(said);
        expect(transcribeRange.mock.calls[1][0].initialPrompt).toBe('');
    });

    it('keeps an empty result for silence-like ranges or without a prompt', async () => {
        transcribeRange.mockReset().mockResolvedValue(nothing);
        await transcribeSpeech({ ...request, endMs: 60_500 });
        await transcribeSpeech({ ...request, initialPrompt: '' });
        expect(transcribeRange).toHaveBeenCalledTimes(2);
    });
});
