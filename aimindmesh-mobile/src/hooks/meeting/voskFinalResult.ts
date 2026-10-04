import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { FinalResultEvent } from 'vosk-capacitor';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { TranscriptSegment } from '../../types/meeting';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { newSegmentId } from '../../services/meeting/meetingIds';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';

const MIN_EMBEDDING_SECONDS = 2.0; // ECAPA embeddings are unreliable below 2 s
/** Longest stretch of an utterance used for its embedding */
const MAX_EMBEDDING_MS = 10_000;
const MIN_RMS = 0.01;
const RECLUSTER_INTERVAL_MS = 30000;
const RECLUSTER_MIN_SEGMENTS = 10;

export interface VoskFinalResultDeps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    diarizationRef: MutableRefObject<SpeakerDiarization>;
    setCurrentText: (text: string) => void;
    setTranscript: Dispatch<SetStateAction<TranscriptSegment[]>>;
    /** Live Vosk text is used only in Vosk mode (speaker vectors alone in "fast" recognition) */
    voskTranscribesRef: MutableRefObject<boolean>;
    /** Final results still being processed (awaited before the audio is saved) */
    pendingRef: MutableRefObject<number>;
    lastReclusterTime: MutableRefObject<number>;
    lastReclusterSegCount: MutableRefObject<number>;
}

/**
 * Audio of the utterance for the speaker embedding, with its RMS (silence is skipped): Vosk
 * timestamps share the recording's clock, so it is the utterance itself (its last 10 s at most,
 * extended back to the minimum embedding length if shorter).
 */
async function utteranceAudio(deps: VoskFinalResultDeps, startMs: number, endMs: number): Promise<{ base64: string; rms: number } | null> {
    const targetMs = Math.max(MIN_EMBEDDING_SECONDS, deps.settings.embeddingDurationRef.current) * 1000;
    const utteranceStart = Math.max(startMs, endMs - MAX_EMBEDDING_MS);
    const segment = await deps.recording.getAudioRange(Math.max(0, Math.min(utteranceStart, endMs - targetMs)), endMs);
    if (!segment) return null;
    let sumSq = 0;
    for (let i = 0; i < segment.length; i++) sumSq += segment[i] * segment[i];
    return {
        base64: arrayBufferToBase64(floatToInt16(segment).buffer as ArrayBuffer),
        rms: Math.sqrt(sumSq / segment.length)
    };
}

/** Handles one live Vosk final result: speaker, transcript, periodic mini-clustering. */
export function createVoskFinalResultHandler(deps: VoskFinalResultDeps) {
    return async (data: FinalResultEvent) => {
        const text = data.text?.trim();
        if (!text) return;
        // Results of the voice assistant's session, or of a mode that does not use Vosk text
        if (data.source === 'mic' || !deps.voskTranscribesRef.current) return;
        if (!deps.recording.isRecordingRef.current && !deps.recording.isActiveRef.current) return;

        const timed = (data.endMs ?? 0) > (data.startMs ?? 0);
        const startMs = timed ? data.startMs : undefined;
        const endMs = timed ? data.endMs : undefined;

        deps.pendingRef.current++;
        try {
            let embedding = data.speakerVector;

            // ONNX embedding extraction for precise mode
            if (deps.settings.recognitionModeRef.current === 'precise' && startMs !== undefined && endMs !== undefined) {
                try {
                    const audio = await utteranceAudio(deps, startMs, endMs);
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
