import { Whisper } from 'whisper-capacitor';
import { VAD } from 'vad-capacitor';
import { getVADService } from '../../stt/vadService';
import { waitForBundledModels } from '../../model/bundledModels';
import { logger } from '../../logger';
import { TimeRange } from './chunkPlanner';
import { RawSegment } from './whisperOutput';
import { assignSpeakers } from './speakerAssignment';
import { speechWindows } from './speechWindows';
import { labelSpeech, SpeakerRange } from './speakerChunks';
import { appendSpeech, readyChunks, spansSpeakerChange, turnsWithin } from './incrementalPlan';
import {
    audioCtxFor,
    embeddingsFor,
    ensureSpeakerModel,
    ensureWhisperModel,
    MIN_SPEAKER_MS,
    PostProcessProgress,
    tail,
    throwIfCancelled,
    renumberVoices,
    toTranscript,
    transcribeSpeech,
    TranscribeOptions,
    TranscriptionResult
} from './pipeline';
import { voiceCentroids } from '../../speaker/voiceProfiles';
import { keepWhisperModel, whisperThreads } from './pipeline';
import { pin } from '../../model/modelOrchestrator';

/** Whisper threads while recording: one core stays free for the capture and live Vosk. */
const recordingThreads = () => Math.max(1, Math.min(3, whisperThreads() - 1));
/** Audio this recent is not scanned yet: the recorder may not have written it all. */
const WRITE_MARGIN_MS = 600;

interface Chunk extends TimeRange {
    segments: RawSegment[];
}

/**
 * Transcribes a meeting while it is recorded: finished stretches of speech are sent to Whisper
 * as soon as a pause ends them, reading the recording file as it is written, and voice
 * embeddings are taken along the way. When the recording stops, only the last part is left to
 * transcribe, then speakers are clustered and the few sentences Whisper wrote across a change
 * of speaker are transcribed again, one speaker at a time.
 *
 * Driven by the caller: tick() regularly while recording, then finish() once.
 */
export class LiveTranscriber {
    private wavPath: string;
    private speech: TimeRange[] = [];
    private scanFromMs = 0;
    /** Speech before this is planned into chunks. */
    private plannedUntilMs = 0;
    private chunks: Chunk[] = [];
    private windows: TimeRange[] = [];
    private embeddings: Array<number[] | null> = [];
    /** Speech regions whose windows are embedded. */
    private embeddedRegions = 0;
    private language: string;
    private previousText = '';
    private model: string | null = null;
    /** Keeps Whisper in RAM from the first chunk until the transcript is complete */
    private unpin: (() => void) | null = null;
    private running: Promise<void> | null = null;
    private failed = false;
    private stopped = false;

    constructor(
        wavPath: string,
        readonly meetingId: string,
        private readonly startedAt: number,
        private readonly options: TranscribeOptions
    ) {
        this.wavPath = wavPath;
        this.language = options.language;
    }

    /** Speech transcribed so far (ms of recording up to which everything is done). */
    get transcribedUntilMs(): number {
        return this.chunks.length ? this.chunks[this.chunks.length - 1].endMs : 0;
    }

    /** False after an error: the caller then transcribes the whole recording at the end instead. */
    get usable(): boolean {
        return !this.failed;
    }

    /** Processes what was recorded up to `recordedMs`; does nothing if the previous tick is still running. */
    tick(recordedMs: number): void {
        if (this.running || this.failed || this.stopped) return;
        this.running = this.advance(recordedMs - WRITE_MARGIN_MS, false)
            .catch(e => {
                this.failed = true;
                logger.log('warn', 'Transcription while recording stopped; the recording will be transcribed at the end', e);
            })
            .finally(() => { this.running = null; });
    }

    /** Stops ticking without finishing (the recording was discarded or the job cancelled). */
    cancel(): void {
        this.stopped = true;
        if (this.running) Whisper.abort().catch(() => { });
        this.release();
    }

    private release(): void {
        this.unpin?.();
        this.unpin = null;
    }

    /**
     * Completes the transcript once the recording is over. `wavPath` is the finished recording
     * (the same audio, possibly moved), `durationMs` its length.
     */
    async finish(
        wavPath: string,
        durationMs: number,
        onProgress: (p: PostProcessProgress) => void,
        signal?: AbortSignal
    ): Promise<TranscriptionResult> {
        this.stopped = true;
        await this.running;
        if (this.failed) {
            this.release();
            throw new Error('Transcription while recording failed');
        }
        this.wavPath = wavPath;
        this.stopped = false;
        try {
            return await this.complete(durationMs, onProgress, signal);
        } finally {
            this.release();
        }
    }

    private async complete(
        durationMs: number,
        onProgress: (p: PostProcessProgress) => void,
        signal?: AbortSignal
    ): Promise<TranscriptionResult> {
        const remainingFrom = this.transcribedUntilMs;
        const remaining = Math.max(1, durationMs - remainingFrom);
        await this.advance(durationMs, true, signal, doneUntil =>
            onProgress({ stage: 'transcribing', fraction: Math.min(1, (doneUntil - remainingFrom) / remaining) }));

        let raw = this.chunks.flatMap(c => c.segments);
        let voices = new Map<number, number[]>();
        if (this.options.diarize && this.windows.length > 0) {
            onProgress({ stage: 'speakers', fraction: 0 });
            ({ raw, voices } = await this.withSpeakers(fraction => onProgress({ stage: 'speakers', fraction }), signal));
        }
        logger.log('info', `Live transcription finished: ${this.chunks.length} chunks, ${raw.length} segments`);
        const { transcript, order } = toTranscript(raw, this.language, this.startedAt);
        return { transcript, voices: renumberVoices(voices, order) };
    }

    private async advance(
        untilMs: number,
        final: boolean,
        signal?: AbortSignal,
        onChunkDone?: (doneUntilMs: number) => void
    ): Promise<void> {
        if (untilMs <= this.scanFromMs) return;
        await waitForBundledModels();
        this.unpin ??= pin('whisper');
        this.model ??= await ensureWhisperModel(this.options.model);

        // Voice activity on the new audio
        const vad = getVADService();
        if (!(await vad.checkModelLoaded())) await vad.loadModel('silero-vad-v4');
        const scan = await VAD.processFile({ audioPath: this.wavPath, startMs: this.scanFromMs, endMs: untilMs });
        const open = scan.openStartMs;
        const closed = final || open === undefined ? scan.segments : scan.segments.filter(s => s.startMs !== open);
        const before = this.speech.length;
        this.speech = appendSpeech(this.speech, closed.map(s => ({ startMs: s.startMs, endMs: s.endMs })));
        const lastEnd = this.speech.length ? this.speech[this.speech.length - 1].endMs : 0;
        // Rescan speech still going on from its start; else a little before the end, for onsets
        this.scanFromMs = Math.max(lastEnd, open !== undefined && !final ? open - 300 : untilMs - 300);

        // Transcribe the speech that pauses have closed
        const settledUntil = final ? untilMs : (open ?? untilMs);
        const { chunks, nextFromMs } = readyChunks(this.speech, this.plannedUntilMs, settledUntil, final);
        this.plannedUntilMs = nextFromMs;
        logger.log('info', `Live transcription: audio to ${Math.round(untilMs / 1000)} s, ${this.speech.length} speech regions, `
            + `chunks ${chunks.map(c => `${(c.startMs / 1000).toFixed(1)}-${(c.endMs / 1000).toFixed(1)}`).join(' ') || 'none'}`);
        for (const chunk of chunks) {
            if (this.stopped && !final) break;
            throwIfCancelled(signal);
            const segments = await this.transcribe(chunk, final ? whisperThreads() : recordingThreads());
            this.chunks.push({ ...chunk, segments: segments.map(s => ({ ...s })) });
            onChunkDone?.(chunk.endMs);
        }
        if (this.stopped && !final) {
            // Chunks not transcribed yet are planned again at finish()
            this.plannedUntilMs = this.transcribedUntilMs;
        }

        // Voice embeddings of the regions closed meanwhile
        if (this.options.diarize && this.speech.length > before) {
            const regions = this.speech.slice(this.embeddedRegions);
            const windows = speechWindows(regions);
            if (windows.length) {
                await ensureSpeakerModel();
                this.embeddings.push(...await embeddingsFor(this.wavPath, windows, () => { }, signal));
                this.windows.push(...windows);
            }
            this.embeddedRegions = this.speech.length;
        }
    }

    /**
     * Whisper on one range. `context` is the text said just before it (the prompt that keeps
     * names and style consistent); by default the previous chunk's.
     */
    private async transcribe(range: TimeRange, threads: number, speaker?: number, context?: string): Promise<RawSegment[]> {
        await keepWhisperModel(this.model!);
        const result = await transcribeSpeech({
            audioPath: this.wavPath,
            startMs: range.startMs,
            endMs: range.endMs,
            language: this.language,
            beamSize: this.options.accurate ? 5 : 1,
            threads,
            initialPrompt: tail(context ?? this.previousText, 150),
            audioCtx: audioCtxFor(this.model!, range.endMs - range.startMs)
        });
        if (context === undefined) this.previousText = result.text;
        // With 'auto', the language of the first real speech is kept for the whole meeting
        if (this.language === 'auto' && result.language && result.text.trim().length >= 20) {
            this.language = result.language;
            logger.log('info', `Whisper: meeting language detected as ${this.language}`);
        }
        return result.segments.map(s => ({ text: s.text, startMs: s.startMs, endMs: Math.min(s.endMs, range.endMs), speaker }));
    }

    /** Speakers for every segment; chunks with a sentence across a change of speaker are redone by turns. */
    private async withSpeakers(
        onProgress: (fraction: number) => void,
        signal?: AbortSignal
    ): Promise<{ raw: RawSegment[]; voices: Map<number, number[]> }> {
        const labels = assignSpeakers(
            this.windows.map((w, i) => ({ id: `w${i}`, ...w, embedding: this.embeddings[i] })),
            { ...this.options.speakers, minSpeakerMs: MIN_SPEAKER_MS }
        );
        const labelledWindows = this.windows.map((w, i) => ({ ...w, speaker: labels.get(`w${i}`) ?? 0 }));
        const labelled: SpeakerRange[] = labelSpeech(labelledWindows, this.speech.filter(r => r.endMs - r.startMs < 1000));

        const mixed = this.chunks.map(chunk => chunk.segments.some(s => spansSpeakerChange(s, labelled)));
        mixed.forEach((m, i) => m && logger.log('info', `Live transcription: chunk ${(this.chunks[i].startMs / 1000).toFixed(1)}-${(this.chunks[i].endMs / 1000).toFixed(1)} s spans a change of speaker`));
        const toRedo = mixed.filter(Boolean).length;
        const result: RawSegment[] = [];
        let redone = 0;
        for (const [i, chunk] of this.chunks.entries()) {
            if (mixed[i]) {
                for (const turn of turnsWithin(chunk, labelled)) {
                    throwIfCancelled(signal);
                    // What was said just before, not the last chunk of the meeting
                    const context = result.slice(-3).map(r => r.text).join(' ');
                    result.push(...await this.transcribe(turn, whisperThreads(), turn.speaker, context));
                }
                onProgress(++redone / toRedo);
                continue;
            }
            for (const s of chunk.segments) {
                result.push({ ...s, speaker: dominantSpeaker(s, labelled) });
            }
        }
        logger.log('info', `Live transcription: ${this.chunks.length} chunks, ${toRedo} transcribed again by speaker turn`);
        return { raw: result, voices: voiceCentroids(this.windows, this.embeddings, i => labels.get(`w${i}`)) };
    }
}

/** The speaker who talks most during the range, else the nearest one. */
function dominantSpeaker(range: TimeRange, labelled: SpeakerRange[]): number {
    let best = -1;
    let bestTalk = 0;
    const talk = new Map<number, number>();
    for (const p of labelled) {
        const overlap = Math.min(range.endMs, p.endMs) - Math.max(range.startMs, p.startMs);
        if (overlap <= 0) continue;
        const total = (talk.get(p.speaker) ?? 0) + overlap;
        talk.set(p.speaker, total);
        if (total > bestTalk) { best = p.speaker; bestTalk = total; }
    }
    if (best >= 0 || labelled.length === 0) return Math.max(best, 0);
    const mid = (range.startMs + range.endMs) / 2;
    return labelled.reduce((a, b) =>
        Math.abs((b.startMs + b.endMs) / 2 - mid) < Math.abs((a.startMs + a.endMs) / 2 - mid) ? b : a).speaker;
}
