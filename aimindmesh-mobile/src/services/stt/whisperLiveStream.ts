import { HighQualityAudioRecorder, pcmToBase64 } from '../audio/highQualityAudioRecorder';
import { logger } from '../logger';
import type { WhisperSTTService, WhisperConfig } from './whisperSTT';

const SAMPLE_RATE = 16000;
/** 100 ms chunks: short enough to notice the pause that ends an utterance. */
export const LIVE_CHUNK_SAMPLES = 1600;
const ENERGY_THRESHOLD = 300;        // RMS speech activity threshold (Int16 scale)
const PAUSE_CHUNKS = 6;              // ~600 ms of silence after speech ends an utterance
const MIN_UTTERANCE_SECONDS = 0.8;
// Cap for uninterrupted speech. A short cap (it was 3 s) cut words in half and, in call mode,
// let the overlay's silence timer send half sentences.
const MAX_UNTRANSCRIBED_SECONDS = 10;
const MIN_TRANSCRIBE_SAMPLES = 8000; // 0.5 s

export interface SpeechActivity {
    hasSpeechActivity: boolean;
    silenceChunks: number;
}

export const INITIAL_ACTIVITY: SpeechActivity = { hasSpeechActivity: false, silenceChunks: 0 };

export function computeRms(chunk: Int16Array): number {
    if (chunk.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
        sum += chunk[i] * chunk[i];
    }
    return Math.sqrt(sum / chunk.length);
}

/** Tracks speech and the silence that follows it, one chunk at a time. */
export function updateActivity(state: SpeechActivity, rms: number): SpeechActivity {
    if (rms > ENERGY_THRESHOLD) return { hasSpeechActivity: true, silenceChunks: 0 };
    if (state.hasSpeechActivity) return { ...state, silenceChunks: state.silenceChunks + 1 };
    return state;
}

/**
 * What to do with the buffered audio: transcribe after a pause that follows speech (or when
 * speech runs past the cap), discard a full buffer of pure silence (Whisper hallucinates text
 * on silence), otherwise keep buffering.
 */
export function decideChunkAction(activity: SpeechActivity, untranscribedSamples: number): 'transcribe' | 'discard' | 'wait' {
    const seconds = untranscribedSamples / SAMPLE_RATE;
    if (activity.hasSpeechActivity && activity.silenceChunks >= PAUSE_CHUNKS && seconds >= MIN_UTTERANCE_SECONDS) {
        return 'transcribe';
    }
    if (seconds >= MAX_UNTRANSCRIBED_SECONDS) {
        return activity.hasSpeechActivity ? 'transcribe' : 'discard';
    }
    return 'wait';
}

/** Whisper marks non-speech as e.g. "[BLANK_AUDIO]" or "(silenzio)": not a transcript. */
export function isNonSpeechMarker(text: string): boolean {
    return /^(\[[^\]]*\]|\([^)]*\))$/.test(text.trim());
}

interface LiveSession {
    recorder: HighQualityAudioRecorder;
    onUpdate: (transcript: string) => void;
    config: WhisperConfig;
    chunks: Int16Array[];
    untranscribedSamples: number;
    activity: SpeechActivity;
    transcript: string;
    inFlight: Promise<void> | null;
    acceptingAudio: boolean;
}

/**
 * Each start() owns a session object, so a stop() that is still flushing (or a stop() that
 * arrives while the recorder initializes) cannot clobber the state of the next session.
 */
export class WhisperLiveStreamManager {
    private session: LiveSession | null = null;

    constructor(private whisperService: WhisperSTTService) {}

    public isRunning(): boolean {
        return this.session !== null;
    }

    public async start(
        onUpdate: (transcript: string) => void,
        onAudioLevel?: (level: number) => void,
        config: WhisperConfig = {}
    ): Promise<void> {
        if (this.session) {
            logger.log('warn', '[WhisperLiveStream] Already running');
            return;
        }

        const session: LiveSession = {
            recorder: new HighQualityAudioRecorder({
                sampleRate: SAMPLE_RATE,
                channels: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                disableInternalStorage: true,
                chunkIntervalSamples: LIVE_CHUNK_SAMPLES
            }),
            onUpdate,
            config,
            chunks: [],
            untranscribedSamples: 0,
            activity: INITIAL_ACTIVITY,
            transcript: '',
            inFlight: null,
            acceptingAudio: false
        };
        this.session = session;

        try {
            await session.recorder.init();
        } catch (error) {
            if (this.session !== session) return; // stopped meanwhile: nothing to report
            this.session = null;
            logger.log('error', '[WhisperLiveStream] Failed to start live Whisper recognition', error);
            throw error;
        }

        if (this.session !== session) {
            // stop() arrived while the microphone was opening: release it instead of recording
            await session.recorder.cleanup().catch(() => { /* already released */ });
            return;
        }

        session.acceptingAudio = true;
        session.recorder.start(
            (level) => onAudioLevel?.(level),
            undefined,
            (int16Chunk: Int16Array) => this.handleAudioChunk(session, int16Chunk)
        );
        logger.log('info', '[WhisperLiveStream] Live Whisper speech recognition started');
    }

    private handleAudioChunk(session: LiveSession, chunk: Int16Array): void {
        if (!session.acceptingAudio) return;

        session.chunks.push(chunk);
        session.untranscribedSamples += chunk.length;
        session.activity = updateActivity(session.activity, computeRms(chunk));

        // One transcription at a time; the next chunk re-evaluates when it is done
        if (session.inFlight) return;

        const action = decideChunkAction(session.activity, session.untranscribedSamples);
        if (action === 'discard') {
            session.chunks = [];
            session.untranscribedSamples = 0;
        } else if (action === 'transcribe') {
            session.inFlight = this.transcribeBuffered(session).finally(() => {
                session.inFlight = null;
            });
        }
    }

    private async transcribeBuffered(session: LiveSession): Promise<void> {
        const chunks = session.chunks;
        session.chunks = [];
        session.untranscribedSamples = 0;
        session.activity = INITIAL_ACTIVITY;

        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalLen < MIN_TRANSCRIBE_SAMPLES) return;

        const merged = new Int16Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.length;
        }

        try {
            const result = await this.whisperService.transcribeAudio(
                pcmToBase64(merged),
                {
                    ...session.config,
                    temperature: 0.0,
                    beamSize: 1, // Fast greedy decoding
                    bestOf: 1
                },
                'fast'
            );

            const text = result.text?.trim();
            if (text && !isNonSpeechMarker(text)) {
                logger.log('info', `[WhisperLiveStream] Recognized: "${text}"`);
                session.transcript = (session.transcript ? `${session.transcript} ` : '') + text;
                session.onUpdate(session.transcript);
            }
        } catch (error) {
            logger.log('error', '[WhisperLiveStream] Chunk transcription error', error);
        }
    }

    public async stop(): Promise<void> {
        const session = this.session;
        if (!session) return;
        // Detach first: a new start() may begin while this session flushes its last utterance
        this.session = null;
        if (!session.acceptingAudio) return; // still initializing: start() releases the mic

        try {
            try {
                // The worklet flushes its last partial chunk on stop: keep accepting until then
                await session.recorder.stop();
            } catch (error) {
                logger.log('warn', '[WhisperLiveStream] Recorder stop failed', error);
            }
            session.acceptingAudio = false;
            await session.recorder.cleanup();

            if (session.inFlight) await session.inFlight;
            // Trailing speech that never reached a pause (silence alone is not worth a hallucination)
            if (session.chunks.length > 0 && session.activity.hasSpeechActivity) {
                await this.transcribeBuffered(session);
            }
            logger.log('info', '[WhisperLiveStream] Live Whisper speech recognition stopped');
        } catch (error) {
            logger.log('warn', '[WhisperLiveStream] Error stopping recorder', error);
        } finally {
            session.chunks = [];
        }
    }
}
