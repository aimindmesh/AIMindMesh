import { Whisper } from 'whisper-capacitor';
import { VAD } from 'vad-capacitor';
import { SpeakerEmbedding } from 'speaker-embedding-capacitor';
import { Filesystem } from '@capacitor/filesystem';
import AudioConverter from '../../audio/audioConverter';
import { getVADService } from '../../stt/vadService';
import { listLocalWhisperModels } from '../../stt/whisperModelDownloader';
import { getWhisperSTTService } from '../../stt/whisperSTT';
import { pin } from '../../model/modelOrchestrator';
import { newSegmentId } from '../meetingIds';
import { waitForBundledModels } from '../../model/bundledModels';
import { logger } from '../../logger';
import { TranscriptSegment } from '../../../types/meeting';
import { planChunks, TimeRange } from './chunkPlanner';
import { cleanWhisperSegments, RawSegment } from './whisperOutput';
import { assignSpeakers } from './speakerAssignment';
import { speechWindows, speakersByOverlap } from './speechWindows';
import { buildSpeakerChunks, labelSpeech, SpeakerRange } from './speakerChunks';
import { MeetingVoices, voiceCentroids } from '../../speaker/voiceProfiles';

/**
 * Post-recording processing of a meeting's audio file, entirely on device:
 * decode to 16 kHz WAV → voice activity (Silero) → Whisper on the speech, chunk by chunk →
 * one voice embedding per sentence (ECAPA) → speakers by clustering.
 */

export type PostProcessStage = 'preparing' | 'detecting-speech' | 'transcribing' | 'speakers';

export interface PostProcessProgress {
    stage: PostProcessStage;
    /** 0..1 within the stage */
    fraction: number;
}

export interface TranscribeOptions {
    /** Whisper language code, or 'auto' */
    language: string;
    /** Beam search (more accurate, ~1.5x slower) instead of greedy decoding */
    accurate: boolean;
    /** Whisper model id, or 'auto' for the most accurate installed */
    model?: string;
    /** Also identify speakers; otherwise everything is speaker 0 */
    diarize: boolean;
    speakers: SpeakerOptions;
}

export interface SpeakerOptions {
    /** Average cosine distance above which two voices are different people */
    distanceThreshold: number;
    targetSpeakers?: number;
}

/** A transcript, and the average voice of each of its speakers (for known-voice recognition). */
export interface TranscriptionResult {
    transcript: TranscriptSegment[];
    voices: MeetingVoices;
}

export interface SpeakersResult {
    /** Segment id → speaker number. */
    speakers: Map<string, number>;
    voices: MeetingVoices;
}

/** Voices keyed by the final speaker numbers, from voices keyed by clustering labels. */
export function renumberVoices(voices: Map<number, number[]>, order: Map<number, number>): MeetingVoices {
    const result: MeetingVoices = {};
    voices.forEach((voice, label) => {
        const speaker = order.get(label);
        if (speaker !== undefined) result[speaker] = voice;
    });
    return result;
}

export class PostProcessCancelled extends Error {
    constructor() {
        super('Processing cancelled');
    }
}

/**
 * Order for 'auto'. Measured on a Galaxy Z Fold5 (Italian, word error rate / time for 50 s of
 * speech in 6 turns): base 28% / 8 s, small 16% / 9 s with a short encoder window,
 * large-v3-turbo 1.4% / 177 s. Small is the best trade-off; turbo and medium are only used
 * when chosen explicitly, they take longer than the meeting itself.
 */
const WHISPER_PREFERENCE = [
    'ggml-small-q8_0', 'ggml-small-q5_1', 'ggml-small', 'ggml-base-q8_0', 'ggml-base', 'ggml-tiny-q8_0', 'ggml-tiny',
];

/**
 * Encoder frames for a chunk (whisper.cpp audio_ctx, 50 per second, 0 = full 30 s window).
 * Whisper always pays for 30 s of audio; sized to the chunk plus a margin, small transcribes
 * short turns ~4x faster at the same accuracy. Base and large-v3-turbo degrade badly with a
 * shortened window (repetitions, 60-90% errors), so they keep the full one.
 */
export function audioCtxFor(model: string, chunkMs: number): number {
    if (!model.startsWith('ggml-small') || chunkMs >= 20_000) return 0;
    return Math.min(1500, Math.ceil(chunkMs / 20) + 256);
}

type RangeRequest = Parameters<typeof Whisper.transcribeRange>[0];

/**
 * Whisper on a range of speech. The prompt (text said just before) keeps names and style
 * consistent, but a garbled one can make Whisper return nothing: then the range is
 * transcribed again without it.
 */
export async function transcribeSpeech(request: RangeRequest) {
    const result = await Whisper.transcribeRange(request);
    const empty = !result.segments.some(s => s.text.trim());
    if (empty && request.initialPrompt && request.endMs - request.startMs >= 1000) {
        logger.log('info', `Whisper: nothing in ${Math.round(request.startMs / 1000)} s with the prompt, retrying without`);
        return Whisper.transcribeRange({ ...request, initialPrompt: '' });
    }
    return result;
}

/**
 * Loads `preferred` if installed, else the first installed model of WHISPER_PREFERENCE.
 * A model that fails to load (e.g. a corrupt file) is skipped in favour of the next one.
 * Loading goes through the app's Whisper service, so the model orchestrator knows Whisper is in
 * RAM and voice chat sees which model is loaded.
 */
export async function ensureWhisperModel(preferred?: string): Promise<string> {
    const installed = await listLocalWhisperModels();
    const ranked = [
        ...WHISPER_PREFERENCE.filter(m => installed.includes(m)),
        ...installed.filter(m => !WHISPER_PREFERENCE.includes(m)), // e.g. turbo, if it's all there is
    ];
    const candidates = preferred && preferred !== 'auto' && installed.includes(preferred)
        ? [preferred, ...ranked.filter(m => m !== preferred)]
        : ranked;
    if (candidates.length === 0) throw new Error('No Whisper model installed');

    const service = getWhisperSTTService();
    if (service.isModelLoaded() && service.getCurrentModelId() === candidates[0]) return candidates[0];
    for (const model of candidates) {
        try {
            logger.log('info', `Loading Whisper model ${model}`);
            await service.loadModel(model);
            return model;
        } catch (e) {
            logger.log('error', `Whisper model ${model} could not be loaded, trying the next one`, e);
        }
    }
    throw new Error('No installed Whisper model could be loaded');
}

/**
 * Before each chunk: voice chat (allowed during a post-processing) may have loaded another
 * Whisper model meanwhile.
 */
export async function keepWhisperModel(model: string): Promise<void> {
    const service = getWhisperSTTService();
    if (!service.isModelLoaded() || service.getCurrentModelId() !== model) {
        logger.log('info', `Whisper model changed meanwhile: reloading ${model}`);
        await service.loadModel(model);
    }
}

/** Threads for whisper.cpp on this device (detected when the model is loaded). */
export const whisperThreads = () => getWhisperSTTService().getRecommendedThreads();

export async function ensureSpeakerModel(): Promise<void> {
    const { loaded } = await SpeakerEmbedding.isModelLoaded();
    if (!loaded) await SpeakerEmbedding.loadModel({ modelPath: 'models/ecapa_tdnn.onnx' });
}

export function throwIfCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw new PostProcessCancelled();
}

/** Decodes the meeting audio to a temporary 16 kHz WAV, runs `fn` on it, then deletes it. */
async function withDecodedWav<T>(audioPath: string, fn: (wavPath: string, durationMs: number) => Promise<T>): Promise<T> {
    const { filePath } = await AudioConverter.decodeM4AToWav({ filePath: audioPath });
    try {
        const { size } = await Filesystem.stat({ path: `file://${filePath}` });
        return await fn(filePath, Math.floor((size - 44) / 32));
    } finally {
        await Filesystem.deleteFile({ path: `file://${filePath}` })
            .catch(e => logger.log('warn', 'Could not delete the decoded WAV', e));
    }
}

/** Speech regions, or null when VAD is unavailable (the caller then transcribes everything). */
async function detectSpeech(wavPath: string): Promise<TimeRange[] | null> {
    try {
        const vad = getVADService();
        if (!(await vad.checkModelLoaded())) await vad.loadModel('silero-vad-v4');
        const { segments } = await VAD.processFile({ audioPath: wavPath });
        return segments.map(s => ({ startMs: s.startMs, endMs: s.endMs }));
    } catch (e) {
        logger.log('warn', 'Voice activity detection failed: transcribing the whole recording', e);
        return null;
    }
}

export const tail = (text: string, max: number) => (text.length <= max ? text : text.slice(text.length - max)).trim();

/** Less total speech than this is treated as a noisy embedding, not a participant. */
export const MIN_SPEAKER_MS = 4000;

/** Longest stretch of a range used for its voice embedding: enough to tell voices apart. */
const MAX_EMBEDDING_MS = 15_000;

/** One voice embedding per range, extracted natively from the WAV in batches (progress, cancel). */
export async function embeddingsFor(
    wavPath: string,
    ranges: TimeRange[],
    onProgress: (fraction: number) => void,
    signal?: AbortSignal
): Promise<Array<number[] | null>> {
    const capped = ranges.map(r => {
        if (r.endMs - r.startMs <= MAX_EMBEDDING_MS) return r;
        const mid = (r.startMs + r.endMs) / 2;
        return { startMs: Math.round(mid - MAX_EMBEDDING_MS / 2), endMs: Math.round(mid + MAX_EMBEDDING_MS / 2) };
    });
    const embeddings: Array<number[] | null> = [];
    const BATCH = 20;
    for (let i = 0; i < capped.length; i += BATCH) {
        throwIfCancelled(signal);
        const batch = await SpeakerEmbedding.extractEmbeddingsFromFile({
            audioPath: wavPath,
            ranges: capped.slice(i, i + BATCH),
            minDurationMs: 1000
        });
        embeddings.push(...batch.embeddings);
        onProgress(Math.min(1, (i + BATCH) / capped.length));
    }
    return embeddings;
}

/** Speaker numbers 0, 1, 2... in order of first appearance in the transcript. */
export function renumberByAppearance(segments: Array<{ id: string }>, speakers: Map<string, number>): Map<string, number> {
    const order = new Map<number, number>();
    const result = new Map<string, number>();
    for (const s of segments) {
        const raw = speakers.get(s.id) ?? 0;
        if (!order.has(raw)) order.set(raw, order.size);
        result.set(s.id, order.get(raw)!);
    }
    return result;
}

/**
 * Who speaks in each segment. With voice activity, voices are compared on ~3 s windows of
 * actual speech (which stop at pauses, where turns change) and each segment gets the voice that
 * talks most during it: Whisper's segment boundaries often straddle two turns. Without voice
 * activity, each segment's own audio is used.
 */
async function speakersFor(
    wavPath: string,
    segments: Array<{ id: string } & TimeRange>,
    speech: TimeRange[] | null,
    options: SpeakerOptions,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal
): Promise<SpeakersResult> {
    await ensureSpeakerModel();

    const windows = speech ? speechWindows(speech) : [];
    const items = windows.length > 0 ? windows : segments;
    const embeddings = await embeddingsFor(wavPath, items, onProgress, signal);
    const labels = assignSpeakers(
        items.map((w, i) => ({ id: `w${i}`, ...w, embedding: embeddings[i] })),
        windows.length > 0 ? { ...options, minSpeakerMs: MIN_SPEAKER_MS } : options
    );
    const raw = windows.length > 0
        ? speakersByOverlap(segments, windows.map((w, i) => ({ ...w, speaker: labels.get(`w${i}`) ?? 0 })))
        : new Map(segments.map((s, i) => [s.id, labels.get(`w${i}`) ?? 0]));
    const speakers = renumberByAppearance(segments, raw);
    const order = new Map<number, number>();
    segments.forEach(s => { if (!order.has(raw.get(s.id)!)) order.set(raw.get(s.id)!, speakers.get(s.id)!); });
    const centroids = voiceCentroids(items, embeddings, i => labels.get(`w${i}`));
    return { speakers, voices: renumberVoices(centroids, order) };
}

/**
 * Speaker-labelled ranges covering all detected speech, one speaker each (see
 * buildSpeakerChunks), or null when no speech region is long enough to embed a voice.
 */
async function speakerTurns(
    wavPath: string,
    speech: TimeRange[],
    durationMs: number,
    options: SpeakerOptions,
    onProgress: (fraction: number) => void,
    signal?: AbortSignal
): Promise<{ turns: SpeakerRange[]; voices: Map<number, number[]> } | null> {
    const windows = speechWindows(speech);
    if (windows.length === 0) return null;
    await ensureSpeakerModel();
    const embeddings = await embeddingsFor(wavPath, windows, onProgress, signal);
    const labels = assignSpeakers(
        windows.map((w, i) => ({ id: `w${i}`, ...w, embedding: embeddings[i] })),
        { ...options, minSpeakerMs: MIN_SPEAKER_MS }
    );
    const labelled = windows.map((w, i) => ({ ...w, speaker: labels.get(`w${i}`) ?? 0 }));
    const shortRegions = speech.filter(r => r.endMs - r.startMs < 1000);
    return {
        turns: buildSpeakerChunks(labelSpeech(labelled, shortRegions), durationMs),
        voices: voiceCentroids(windows, embeddings, i => labels.get(`w${i}`))
    };
}

/**
 * Whisper's segments as the meeting transcript: cleaned, with ids, speakers numbered by
 * appearance. `order` maps the speaker labels of `raw` to those numbers.
 */
export function toTranscript(raw: RawSegment[], language: string, startedAt: number): { transcript: TranscriptSegment[]; order: Map<number, number> } {
    const clean = cleanWhisperSegments([...raw].sort((a, b) => a.startMs - b.startMs), language === 'auto' ? undefined : language);
    const transcript: TranscriptSegment[] = clean.map(s => ({
        id: newSegmentId('whisper'),
        speakerId: s.speaker ?? 0,
        text: s.text,
        timestamp: startedAt + s.startMs,
        start_ms: s.startMs,
        end_ms: s.endMs,
        stt_provider: 'whisper'
    }));
    const order = new Map<number, number>();
    for (const t of transcript) {
        if (!order.has(t.speakerId)) order.set(t.speakerId, order.size);
        t.speakerId = order.get(t.speakerId)!;
    }
    return { transcript, order };
}

/**
 * Transcribes a meeting recording with Whisper (and identifies speakers if asked).
 * Segment times are on the recording's timeline; `startedAt` gives them wall-clock timestamps.
 */
export async function transcribeRecording(
    audioPath: string,
    startedAt: number,
    options: TranscribeOptions,
    onProgress: (p: PostProcessProgress) => void,
    signal?: AbortSignal
): Promise<TranscriptionResult> {
    onProgress({ stage: 'preparing', fraction: 0 });
    await waitForBundledModels();
    // Whisper stays in RAM for the whole job (an LLM request waits instead of unloading it)
    const unpin = pin('whisper');
    const abortNative = () => { Whisper.abort().catch(() => { }); };
    signal?.addEventListener('abort', abortNative);
    try {
        const model = await ensureWhisperModel(options.model);
        throwIfCancelled(signal);
        return await withDecodedWav(audioPath, async (wavPath, durationMs) => {
            onProgress({ stage: 'detecting-speech', fraction: 0 });
            const speech = await detectSpeech(wavPath);
            throwIfCancelled(signal);

            // Speakers first: chunks then never cross a change of speaker, so every Whisper
            // segment belongs to its chunk's speaker however Whisper cuts its sentences.
            let chunks: Array<TimeRange & { speaker?: number }> = planChunks(speech, durationMs);
            let voices = new Map<number, number[]>();
            if (options.diarize && speech && speech.length > 0) {
                const turns = await speakerTurns(wavPath, speech, durationMs, options.speakers,
                    fraction => onProgress({ stage: 'speakers', fraction }), signal);
                if (turns) {
                    chunks = turns.turns;
                    voices = turns.voices;
                }
            }
            const totalMs = chunks.reduce((sum, c) => sum + c.endMs - c.startMs, 0);
            logger.log('info', `Transcribing ${chunks.length} chunks (${Math.round(totalMs / 1000)} s of speech in ${Math.round(durationMs / 1000)} s) with ${model}`);

            const raw: RawSegment[] = [];
            let doneMs = 0;
            let previousText = '';
            // With 'auto', the language detected on the first real speech is kept for the
            // whole meeting: re-detecting per chunk can flip to another language and translate.
            let language = options.language;
            const t0 = Date.now();
            for (const chunk of chunks) {
                throwIfCancelled(signal);
                await keepWhisperModel(model);
                const result = await transcribeSpeech({
                    audioPath: wavPath,
                    startMs: chunk.startMs,
                    endMs: chunk.endMs,
                    language,
                    beamSize: options.accurate ? 5 : 1,
                    threads: whisperThreads(),
                    initialPrompt: tail(previousText, 150),
                    audioCtx: audioCtxFor(model, chunk.endMs - chunk.startMs)
                });
                throwIfCancelled(signal);
                for (const s of result.segments) {
                    raw.push({ text: s.text, startMs: s.startMs, endMs: Math.min(s.endMs, chunk.endMs), speaker: chunk.speaker });
                }
                previousText = result.text;
                if (language === 'auto' && result.language && result.text.trim().length >= 20) {
                    language = result.language;
                    logger.log('info', `Whisper: meeting language detected as ${language}`);
                }
                doneMs += chunk.endMs - chunk.startMs;
                onProgress({ stage: 'transcribing', fraction: totalMs > 0 ? doneMs / totalMs : 1 });
            }
            logger.log('info', `Whisper: ${Math.round(totalMs / 1000)} s of speech in ${Math.round((Date.now() - t0) / 1000)} s`);

            const { transcript, order } = toTranscript(raw, language, startedAt);
            return { transcript, voices: renumberVoices(voices, order) };
        });
    } finally {
        signal?.removeEventListener('abort', abortNative);
        unpin();
    }
}

/**
 * Re-identifies the speakers of an existing transcript from the recording.
 * Segments without timestamps (very old meetings) keep their speaker.
 */
export async function diarizeTranscript(
    audioPath: string,
    transcript: TranscriptSegment[],
    options: SpeakerOptions,
    onProgress: (p: PostProcessProgress) => void,
    signal?: AbortSignal
): Promise<SpeakersResult> {
    onProgress({ stage: 'preparing', fraction: 0 });
    await waitForBundledModels();
    const timed = transcript.filter(t => t.start_ms !== undefined && t.end_ms !== undefined && t.end_ms > t.start_ms);
    if (timed.length === 0) throw new Error('This transcript has no timestamps: reprocess the audio first');

    return withDecodedWav(audioPath, async wavPath => {
        onProgress({ stage: 'detecting-speech', fraction: 0 });
        const speech = await detectSpeech(wavPath);
        return speakersFor(
            wavPath,
            timed.map(t => ({ id: t.id, startMs: t.start_ms!, endMs: t.end_ms! })),
            speech,
            options,
            fraction => onProgress({ stage: 'speakers', fraction }),
            signal
        );
    });
}
