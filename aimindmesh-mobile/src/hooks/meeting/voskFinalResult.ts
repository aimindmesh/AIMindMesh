import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { FinalResultEvent } from 'vosk-capacitor';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { TranscriptSegment } from '../../types/meeting';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { pickEmbeddingWindow } from '../../services/meeting/pcmBuffer';
import { newSegmentId } from '../../services/meeting/meetingIds';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { MeetingReprocessingState } from './useMeetingReprocessing';

const SAMPLES_PER_MS = 16;
const MIN_EMBEDDING_SECONDS = 2.0; // ECAPA embeddings are unreliable below 2 s
const MIN_RMS = 0.01;
/** Audio reaches JS once per chunk: wait this long at most for the utterance's audio */
const AUDIO_WAIT_MS = 1500;
const RECLUSTER_INTERVAL_MS = 30000;
const RECLUSTER_MIN_SEGMENTS = 10;

export interface VoskFinalResultDeps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    reprocessing: MeetingReprocessingState;
    diarizationRef: MutableRefObject<SpeakerDiarization>;
    setCurrentText: (text: string) => void;
    setTranscript: Dispatch<SetStateAction<TranscriptSegment[]>>;
    /** Live Vosk text is used only in Vosk/Hybrid modes */
    voskTranscribesRef: MutableRefObject<boolean>;
    /** Final results still being processed (awaited before saving) */
    pendingRef: MutableRefObject<number>;
    lastReclusterTime: MutableRefObject<number>;
    lastReclusterSegCount: MutableRefObject<number>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Audio of the utterance for the speaker embedding, with its RMS (silence is skipped). */
async function utteranceAudio(
    deps: VoskFinalResultDeps,
    reprocessingNow: boolean,
    startMs: number | undefined,
    endMs: number | undefined
): Promise<{ base64: string; rms: number } | null> {
    const target = Math.ceil(Math.max(MIN_EMBEDDING_SECONDS, deps.settings.embeddingDurationRef.current) * 16000);
    const min = Math.ceil(MIN_EMBEDDING_SECONDS * 16000);
    const utterance = startMs !== undefined && endMs !== undefined
        ? { start: Math.round(startMs * SAMPLES_PER_MS), end: Math.round(endMs * SAMPLES_PER_MS) }
        : null;

    let segment: Float32Array;
    const state = deps.reprocessing.reprocessingStateRef.current;
    if (reprocessingNow) {
        if (!state.audioData) return null;
        const window = pickEmbeddingWindow(state.currentOffset, utterance, target, min);
        segment = state.audioData.slice(window.start, window.end);
    } else {
        // The utterance's own audio (the old "last N seconds" could be the previous speaker)
        if (utterance) {
            const deadline = Date.now() + AUDIO_WAIT_MS;
            while (deps.recording.getReceivedSamples() < utterance.end && Date.now() < deadline) await sleep(100);
        }
        const window = pickEmbeddingWindow(deps.recording.getReceivedSamples(), utterance, target, min);
        segment = deps.recording.getAudioRange(window.start, window.end);
    }
    if (segment.length === 0) return null;

    let sumSq = 0;
    for (let i = 0; i < segment.length; i++) sumSq += segment[i] * segment[i];
    return {
        base64: arrayBufferToBase64(floatToInt16(segment).buffer as ArrayBuffer),
        rms: Math.sqrt(sumSq / segment.length)
    };
}

/** Handles one Vosk final result: timing on the file timeline, speaker, transcript, mini-clustering. */
export function createVoskFinalResultHandler(deps: VoskFinalResultDeps) {
    return async (data: FinalResultEvent) => {
        const text = data.text?.trim();
        if (!text) return;

        const { recording } = deps;
        const reprocessingNow = deps.reprocessing.reprocessingStateRef.current.isReprocessing;
        const live = !reprocessingNow && (recording.isRecordingRef.current || recording.isBusyRef.current);
        // Results of another feature's Vosk session, or of a mode that does not use Vosk text
        if (!reprocessingNow && (!live || !deps.voskTranscribesRef.current)) return;

        const timeline = recording.timelineRef.current;
        const timed = (data.endMs ?? 0) > (data.startMs ?? 0);
        if (live) {
            const spokenAt = timed ? timeline.voskToWall(data.startMs!) : Date.now();
            if (timeline.isWallPaused(spokenAt) || (!timed && recording.isPausedRef.current)) {
                deps.setCurrentText('');
                return;
            }
        }
        // Reprocessing streams the file itself: Vosk times are already file positions
        const startMs = timed ? (live ? timeline.voskToFileMs(data.startMs!) : data.startMs!) : undefined;
        const endMs = timed ? (live ? timeline.voskToFileMs(data.endMs!) : data.endMs!) : undefined;

        deps.pendingRef.current++;
        try {
            let embedding = data.speakerVector;

            // ONNX embedding extraction for precise mode
            if (deps.settings.recognitionModeRef.current === 'precise') {
                try {
                    const audio = await utteranceAudio(deps, reprocessingNow, startMs, endMs);
                    if (audio && audio.rms >= MIN_RMS) {
                        const result = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: audio.base64 });
                        if (result && result.embedding) {
                            embedding = result.embedding;
                            logger.log('info', `ONNX Embedding extracted (RMS: ${audio.rms.toFixed(4)})`);
                        }
                    } else if (audio) {
                        logger.log('warn', `Skipping ONNX extraction: RMS ${audio.rms.toFixed(4)} < ${MIN_RMS} (silence/noise)`);
                    }
                } catch (e) {
                    logger.log('warn', 'ONNX extraction failed', e);
                }
            }

            const diarization = deps.diarizationRef.current;
            const speakerId = diarization.identifySpeaker(embedding);
            const segmentId = newSegmentId('vosk');
            if (embedding && embedding.length > 0) {
                diarization.getEmbeddingService().storeEmbedding(segmentId, embedding, Date.now(), speakerId);
            }

            deps.setTranscript(prev => {
                const updated: TranscriptSegment[] = [...prev, {
                    id: segmentId,
                    speakerId,
                    text,
                    timestamp: Date.now(),
                    start_ms: startMs,
                    end_ms: endMs,
                    stt_provider: 'vosk',
                    confidence: embedding && embedding.length > 0 ? 0.85 : 0.6
                }];

                // Periodic mini-clustering: every 30 s and 10 segments, refine the centroids
                const now = Date.now();
                if (updated.length - deps.lastReclusterSegCount.current < RECLUSTER_MIN_SEGMENTS ||
                    now - deps.lastReclusterTime.current < RECLUSTER_INTERVAL_MS) {
                    return updated;
                }
                deps.lastReclusterTime.current = now;
                deps.lastReclusterSegCount.current = updated.length;
                try {
                    // Corrections come back aligned to the current speaker ids
                    const corrections = diarization.getEmbeddingService().periodicRecluster();
                    if (!corrections || corrections.size === 0) return updated;
                    let correctedCount = 0;
                    const corrected = updated.map(seg => {
                        const newId = corrections.get(seg.id);
                        if (newId === undefined || newId === seg.speakerId) return seg;
                        correctedCount++;
                        return { ...seg, speakerId: newId };
                    });
                    if (correctedCount > 0) logger.log('info', `Mini-clustering corrected ${correctedCount} segments`);
                    return corrected;
                } catch (e) {
                    logger.log('warn', 'Periodic recluster failed', e);
                    return updated;
                }
            });
            deps.setCurrentText('');
        } finally {
            deps.pendingRef.current--;
        }
    };
}
