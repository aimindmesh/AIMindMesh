import { describe, expect, it, vi } from 'vitest';

const recorderState = vi.hoisted(() => ({
    instances: [] as any[],
    initGate: null as null | Promise<void>,
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/audio/highQualityAudioRecorder', () => {
    class FakeRecorder {
        config: any;
        onData: ((chunk: Int16Array) => void) | null = null;
        started = false;
        cleaned = false;
        constructor(config: any) {
            this.config = config;
            recorderState.instances.push(this);
        }
        async init() {
            if (recorderState.initGate) await recorderState.initGate;
        }
        start(_level: unknown, _progress: unknown, onData: (chunk: Int16Array) => void) {
            this.started = true;
            this.onData = onData;
        }
        async stop() {
            // The worklet flushes its last partial chunk on stop
            this.onData?.(new Int16Array(1600).fill(2000));
            return {};
        }
        async cleanup() {
            this.cleaned = true;
        }
    }
    return { HighQualityAudioRecorder: FakeRecorder, pcmToBase64: () => 'BASE64' };
});

import {
    INITIAL_ACTIVITY,
    LIVE_CHUNK_SAMPLES,
    WhisperLiveStreamManager,
    computeRms,
    decideChunkAction,
    isNonSpeechMarker,
    updateActivity,
} from '../src/services/stt/whisperLiveStream';

const loud = () => new Int16Array(1600).fill(2000);
const quiet = () => new Int16Array(1600);

describe('whisper live stream chunk logic', () => {
    it('computes RMS of Int16 chunks', () => {
        expect(computeRms(new Int16Array([300, -300, 300, -300]))).toBe(300);
        expect(computeRms(new Int16Array(0))).toBe(0);
    });

    it('transcribes after a pause that follows speech', () => {
        let activity = INITIAL_ACTIVITY;
        let samples = 0;
        for (let i = 0; i < 10; i++) { activity = updateActivity(activity, 2000); samples += 1600; }
        for (let i = 0; i < 5; i++) { activity = updateActivity(activity, 0); samples += 1600; }
        expect(decideChunkAction(activity, samples)).toBe('wait');
        activity = updateActivity(activity, 0);
        samples += 1600;
        expect(decideChunkAction(activity, samples)).toBe('transcribe');
    });

    it('does not cut continuous speech at a few seconds', () => {
        const activity = { hasSpeechActivity: true, silenceChunks: 0 };
        expect(decideChunkAction(activity, 16000 * 5)).toBe('wait');
        expect(decideChunkAction(activity, 16000 * 10)).toBe('transcribe');
    });

    it('discards long pure silence instead of transcribing it', () => {
        expect(decideChunkAction(INITIAL_ACTIVITY, 16000 * 10)).toBe('discard');
    });

    it('recognizes Whisper non-speech markers', () => {
        expect(isNonSpeechMarker('[BLANK_AUDIO]')).toBe(true);
        expect(isNonSpeechMarker('(silenzio)')).toBe(true);
        expect(isNonSpeechMarker('Ciao (davvero)')).toBe(false);
    });
});

describe('WhisperLiveStreamManager', () => {
    it('uses short chunks and delivers the trailing utterance on stop', async () => {
        recorderState.instances.length = 0;
        recorderState.initGate = null;
        const transcribeAudio = vi.fn(async () => ({ text: 'ciao mondo', segments: [] }));
        const manager = new WhisperLiveStreamManager({ transcribeAudio } as any);
        const onUpdate = vi.fn();

        await manager.start(onUpdate);
        const recorder = recorderState.instances[0];
        expect(recorder.config.chunkIntervalSamples).toBe(LIVE_CHUNK_SAMPLES);

        for (let i = 0; i < 5; i++) recorder.onData(loud());
        await manager.stop();

        expect(transcribeAudio).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith('ciao mondo');
        expect(recorder.cleaned).toBe(true);
        expect(manager.isRunning()).toBe(false);
    });

    it('does not start recording when stopped while the microphone opens', async () => {
        recorderState.instances.length = 0;
        let release!: () => void;
        recorderState.initGate = new Promise<void>(r => { release = r; });
        const manager = new WhisperLiveStreamManager({ transcribeAudio: vi.fn() } as any);

        const starting = manager.start(vi.fn());
        await manager.stop();
        release();
        await starting;

        const recorder = recorderState.instances[0];
        expect(recorder.started).toBe(false);
        expect(recorder.cleaned).toBe(true);
        recorderState.initGate = null;
    });

    it('does not transcribe trailing silence on stop', async () => {
        recorderState.instances.length = 0;
        const transcribeAudio = vi.fn(async () => ({ text: 'x', segments: [] }));
        const manager = new WhisperLiveStreamManager({ transcribeAudio } as any);
        await manager.start(vi.fn());
        const recorder = recorderState.instances[0];
        recorder.stop = async () => ({}); // no final chunk
        for (let i = 0; i < 5; i++) recorder.onData(quiet());
        await manager.stop();
        expect(transcribeAudio).not.toHaveBeenCalled();
    });
});
