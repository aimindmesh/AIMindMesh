import { useCallback, useEffect, useRef, useState } from 'react';
import { Filesystem } from '@capacitor/filesystem';
import { TranscriptSegment } from '../../types/meeting';
import { logger } from '../../services/logger';
import { BackgroundWork } from '../../services/meeting/backgroundWork';
import {
    transcribeRecording,
    diarizeTranscript,
    PostProcessCancelled,
    PostProcessProgress,
    SpeakerOptions,
    SpeakersResult,
    TranscribeOptions,
    TranscriptionResult
} from '../../services/meeting/postProcessing/pipeline';
import { LiveTranscriber } from '../../services/meeting/postProcessing/liveTranscriber';
import { MeetingRecorder, FinalizedRecording } from '../../services/audio/meetingRecorder';

export interface PostProcessTarget {
    meetingId: string;
    startedAt: number;
    audioPath: string;
}

/** Transcription running while a meeting is recorded. */
export interface LiveTranscription {
    meetingId: string;
    /** Recording time up to which the accurate transcript is done. */
    transcribedMs: number;
}

/** How often the transcription while recording looks for new finished speech. */
const LIVE_TICK_MS = 15_000;

export interface PostProcessJob {
    meetingId: string;
    kind: 'transcribe' | 'speakers';
    progress: PostProcessProgress;
}

interface Options {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    /**
     * Receives a finished transcript for `meetingId` (which may no longer be on screen);
     * may return a note for the completion message.
     */
    onTranscript: (meetingId: string, result: TranscriptionResult) => Promise<string | void> | string | void;
    /** Receives new speaker ids for the segments of `meetingId` (same note as onTranscript). */
    onSpeakers: (meetingId: string, result: SpeakersResult) => Promise<string | void> | string | void;
}

const STAGE_LABEL: Record<PostProcessProgress['stage'], string> = {
    'preparing': 'Preparing audio',
    'detecting-speech': 'Detecting speech',
    'transcribing': 'Transcribing',
    'speakers': 'Identifying speakers',
};

/** Status line for a running job, e.g. "Transcribing 42%". */
export function describeJob(job: PostProcessJob | null): string {
    if (!job) return '';
    const { stage, fraction } = job.progress;
    const percent = stage === 'transcribing' || stage === 'speakers' ? ` ${Math.round(fraction * 100)}%` : '';
    return `${STAGE_LABEL[stage]}${percent}`;
}

/**
 * Runs the on-device post-processing of a meeting recording (Whisper transcript, speakers),
 * one job at a time, with progress and cancellation. Results are handed back by meeting id,
 * so they land on the right meeting even if the user moved on to another one meanwhile.
 */
export function useMeetingPostProcessing({ showToast, onTranscript, onSpeakers }: Options) {
    const [job, setJob] = useState<PostProcessJob | null>(null);
    const [live, setLive] = useState<LiveTranscription | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const liveRef = useRef<{ transcriber: LiveTranscriber; timer: ReturnType<typeof setInterval> } | null>(null);
    const callbacksRef = useRef({ showToast, onTranscript, onSpeakers });
    callbacksRef.current = { showToast, onTranscript, onSpeakers };

    const run = useCallback(async <T,>(
        target: PostProcessTarget,
        kind: PostProcessJob['kind'],
        work: (onProgress: (p: PostProcessProgress) => void, signal: AbortSignal) => Promise<T>,
        deliver: (result: T) => Promise<void> | void
    ): Promise<boolean> => {
        if (controllerRef.current) {
            callbacksRef.current.showToast('Another meeting is being processed: wait or cancel it', 'info');
            return false;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        setJob({ meetingId: target.meetingId, kind, progress: { stage: 'preparing', fraction: 0 } });
        BackgroundWork.start({ kind }).catch(() => { });
        let shownPercent = -1;
        try {
            const result = await work(
                progress => {
                    setJob({ meetingId: target.meetingId, kind, progress });
                    // One overall percentage for the notification: speakers then words
                    const overall = kind === 'speakers' ? progress.fraction
                        : progress.stage === 'speakers' ? progress.fraction * 0.3
                            : progress.stage === 'transcribing' ? 0.3 + progress.fraction * 0.7 : 0;
                    const percent = Math.floor(overall * 100);
                    if (percent !== shownPercent) {
                        shownPercent = percent;
                        BackgroundWork.progress({ kind, percent }).catch(() => { });
                    }
                },
                controller.signal
            );
            await deliver(result);
            return true;
        } catch (e: any) {
            if (e instanceof PostProcessCancelled) {
                callbacksRef.current.showToast('Processing cancelled', 'info');
            } else {
                logger.log('error', `Post-processing (${kind}) failed`, e);
                callbacksRef.current.showToast(`Processing failed: ${e?.message || e}`, 'error');
            }
            return false;
        } finally {
            controllerRef.current = null;
            setJob(null);
            BackgroundWork.stop().catch(() => { });
        }
    }, []);

    /** Whisper transcript of the whole recording (replaces the live one), plus speakers if asked. */
    const transcribe = useCallback((target: PostProcessTarget, options: TranscribeOptions) =>
        run(target, 'transcribe',
            (onProgress, signal) => transcribeRecording(target.audioPath, target.startedAt, options, onProgress, signal),
            async result => {
                if (result.transcript.length === 0) {
                    // Never replace a live transcript with nothing
                    callbacksRef.current.showToast('No speech found in the recording: transcript left unchanged', 'info');
                    return;
                }
                const note = await callbacksRef.current.onTranscript(target.meetingId, result);
                callbacksRef.current.showToast(note ? `Accurate transcript ready: ${note}` : 'Accurate transcript ready', 'success');
            }), [run]);

    /** New speaker assignment for the existing transcript. */
    const identifySpeakers = useCallback((target: PostProcessTarget, transcript: TranscriptSegment[], options: SpeakerOptions) =>
        run(target, 'speakers',
            (onProgress, signal) => diarizeTranscript(target.audioPath, transcript, options, onProgress, signal),
            async result => {
                const note = await callbacksRef.current.onSpeakers(target.meetingId, result);
                callbacksRef.current.showToast(`Speakers identified: ${new Set(result.speakers.values()).size}` + (note ? `, ${note}` : ''), 'success');
            }), [run]);

    const stopLive = useCallback(() => {
        const current = liveRef.current;
        if (!current) return null;
        clearInterval(current.timer);
        liveRef.current = null;
        setLive(null);
        return current.transcriber;
    }, []);

    /** Starts transcribing a recording while it is made, from its growing WAV file. */
    const startLive = useCallback((target: PostProcessTarget & { wavPath: string }, options: TranscribeOptions) => {
        stopLive()?.cancel();
        const transcriber = new LiveTranscriber(target.wavPath, target.meetingId, target.startedAt, options);
        const timer = setInterval(async () => {
            // Another meeting's processing uses the same native models: wait for it
            if (controllerRef.current || !transcriber.usable) return;
            try {
                const status = await MeetingRecorder.getStatus();
                if (status.meetingId !== target.meetingId || status.durationMs === undefined) return;
                transcriber.tick(status.durationMs);
                setLive({ meetingId: target.meetingId, transcribedMs: transcriber.transcribedUntilMs });
            } catch (e) {
                logger.log('warn', 'Could not read the recording status', e);
            }
        }, LIVE_TICK_MS);
        liveRef.current = { transcriber, timer };
        setLive({ meetingId: target.meetingId, transcribedMs: 0 });
    }, [stopLive]);

    /** True when the recording of `meetingId` is being transcribed live (keep its WAV at stop). */
    const isLive = useCallback((meetingId: string) => liveRef.current?.transcriber.meetingId === meetingId
        && liveRef.current.transcriber.usable, []);

    /**
     * Completes the transcript of a finished recording: from what was transcribed while
     * recording when possible, else from the whole recording.
     */
    const transcribeFinished = useCallback(async (target: PostProcessTarget, recording: FinalizedRecording, options: TranscribeOptions) => {
        const transcriber = liveRef.current?.transcriber.meetingId === target.meetingId ? stopLive() : null;
        const deleteWav = () => {
            if (recording.wavPath && recording.wavIsTemporary) {
                Filesystem.deleteFile({ path: `file://${recording.wavPath}` })
                    .catch(e => logger.log('warn', 'Could not delete the transcription WAV', e));
            }
        };
        if (!transcriber?.usable || !recording.wavPath) {
            transcriber?.cancel();
            deleteWav();
            return transcribe(target, options);
        }
        try {
            return await run(target, 'transcribe',
                (onProgress, signal) => {
                    const abortNative = () => transcriber.cancel();
                    signal.addEventListener('abort', abortNative);
                    return transcriber.finish(recording.wavPath!, recording.durationMs, onProgress, signal)
                        .finally(() => signal.removeEventListener('abort', abortNative));
                },
                async result => {
                    if (result.transcript.length === 0) {
                        callbacksRef.current.showToast('No speech found in the recording: transcript left unchanged', 'info');
                        return;
                    }
                    const note = await callbacksRef.current.onTranscript(target.meetingId, result);
                    callbacksRef.current.showToast(note ? `Accurate transcript ready: ${note}` : 'Accurate transcript ready', 'success');
                });
        } finally {
            deleteWav();
        }
    }, [run, stopLive, transcribe]);

    // A transcription started for a recording dies with the screen that started it
    useEffect(() => () => { stopLive()?.cancel(); }, [stopLive]);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    return { job, live, transcribe, transcribeFinished, startLive, isLive, identifySpeakers, cancel };
}
