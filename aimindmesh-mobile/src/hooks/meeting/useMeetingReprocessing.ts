import { useState, useRef, useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Vosk } from 'vosk-capacitor';
import { TranscriptSegment } from '../../types/meeting';
import { SpeechConfig } from '../../types';
import { logger } from '../../services/logger';
import { SpeakerClustering } from '../../services/speaker/speakerClustering';
import { alignClusterLabels } from '../../services/speaker/labelAlignment';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { newSegmentId } from '../../services/meeting/meetingIds';
import { planChunks, whisperResultToSegments } from '../../services/meeting/reprocessHelpers';
import { openMeetingPcm, PcmSource } from './meetingPcmSource';
import { runFullAudioDiarization } from './fullAudioDiarization';

const SAMPLE_RATE = 16000;
/** Whisper gets 30 s per call: a whole meeting in one base64 string ran out of memory */
const WHISPER_CHUNK_SAMPLES = 30 * SAMPLE_RATE;
const VOSK_CHUNK_SAMPLES = SAMPLE_RATE;

interface UseMeetingReprocessingProps {
    playback: any;
    speechConfig?: SpeechConfig;
    /** Latest transcript (a closure value would be the one from when the action started) */
    getTranscript: () => TranscriptSegment[];
    setTranscript: Dispatch<SetStateAction<TranscriptSegment[]>>;
    getMeetingTimestamp: () => number;
    diarizationRef: MutableRefObject<any>;
    settings: any;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    saveMeeting: () => Promise<void>;
    suspendAutosave: () => () => void;
    pcmAudioBlobRef: MutableRefObject<Blob | null>;
    audioFilePathRef: MutableRefObject<string | null>;
}

export interface MeetingReprocessingState {
    isReclustering: boolean;
    processingStatus: string;
    reprocessMeeting: () => Promise<void>;
    fullAudioDiarization: () => Promise<void>;
    reclusterSpeakers: () => Promise<void>;
    handleCancelProcessing: () => void;
    reprocessingStateRef: MutableRefObject<{
        audioData: Float32Array | null;
        currentOffset: number;
        isReprocessing: boolean;
    }>;
}

/** PCM of a WAV blob (header skipped) as Float32. */
async function wavBlobToFloat(blob: Blob): Promise<Float32Array> {
    const int16 = new Int16Array((await blob.arrayBuffer()).slice(44));
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768.0;
    return out;
}

export const useMeetingReprocessing = ({
    playback,
    speechConfig,
    getTranscript,
    setTranscript,
    getMeetingTimestamp,
    diarizationRef,
    settings,
    showToast,
    saveMeeting,
    suspendAutosave,
    pcmAudioBlobRef,
    audioFilePathRef
}: UseMeetingReprocessingProps): MeetingReprocessingState => {
    const [isReclustering, setIsReclustering] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string>('');

    const abortProcessingRef = useRef<boolean>(false);
    const busyRef = useRef(false);
    /** Transcript before the run: restored when it fails or is cancelled */
    const snapshotRef = useRef<TranscriptSegment[] | null>(null);
    const reprocessingStateRef = useRef<{
        audioData: Float32Array | null;
        currentOffset: number;
        isReprocessing: boolean;
    }>({
        audioData: null,
        currentOffset: 0,
        isReprocessing: false
    });

    const restoreSnapshot = useCallback(() => {
        if (snapshotRef.current) setTranscript(snapshotRef.current);
    }, [setTranscript]);

    const handleCancelProcessing = useCallback(() => {
        abortProcessingRef.current = true;
        restoreSnapshot();
        setProcessingStatus('Cancelling...');
    }, [restoreSnapshot]);

    /**
     * One processing run at a time. Autosave is suspended while the transcript is rebuilt, the
     * result is saved only when the run completes, otherwise the previous transcript comes back.
     */
    const runProcessing = async (task: () => Promise<boolean>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        abortProcessingRef.current = false;
        snapshotRef.current = getTranscript();
        const resumeAutosave = suspendAutosave();
        setIsReclustering(true);
        try {
            const completed = await task();
            if (completed && !abortProcessingRef.current) await saveMeeting();
            else restoreSnapshot();
        } catch (error) {
            logger.log('error', 'Meeting processing failed', error);
            showToast('Processing error', 'error');
            restoreSnapshot();
        } finally {
            snapshotRef.current = null;
            reprocessingStateRef.current = { audioData: null, currentOffset: 0, isReprocessing: false };
            resumeAutosave();
            busyRef.current = false;
            setIsReclustering(false);
            setProcessingStatus('');
        }
    };

    const ensureWhisperModel = async (): Promise<boolean> => {
        const whisperService = getWhisperSTTService();
        if (!(await whisperService.ensureAvailable())) return false;
        if (!(await whisperService.checkModelLoaded())) {
            showToast('Loading Whisper model...', 'info');
            setProcessingStatus('Loading AI Model...');
            await whisperService.loadModel(speechConfig?.whisperModelId || 'ggml-base');
        }
        return true;
    };

    /** Whisper over the audio in 30 s chunks, segments placed on the recording timeline. */
    const transcribeWithWhisper = async (source: PcmSource): Promise<TranscriptSegment[] | null> => {
        const whisperService = getWhisperSTTService();
        const meetingTimestamp = getMeetingTimestamp();
        const config = {
            language: settings.transcriptionLanguage,
            temperature: speechConfig?.whisperTemperature ?? 0.0,
            beamSize: speechConfig?.whisperBeamSize ?? 5
        };

        if (source.wavPath) {
            setProcessingStatus('Transcribing file...');
            const result = await whisperService.transcribeFile(source.wavPath, config);
            return whisperResultToSegments(result, {
                offsetMs: 0, durationMs: source.totalSamples / 16, meetingTimestamp, makeId: () => newSegmentId('whisper')
            });
        }

        const segments: TranscriptSegment[] = [];
        const chunks = planChunks(source.totalSamples, WHISPER_CHUNK_SAMPLES);
        for (let i = 0; i < chunks.length; i++) {
            if (abortProcessingRef.current) return null;
            setProcessingStatus(`Transcribing: ${Math.round((i / chunks.length) * 100)}%`);
            const { start, end } = chunks[i];
            const samples = await source.read(start, end - start);
            const result = await whisperService.transcribeAudio(
                arrayBufferToBase64(floatToInt16(samples).buffer as ArrayBuffer), config as any, 'accurate'
            );
            segments.push(...whisperResultToSegments(result, {
                offsetMs: start / 16, durationMs: (end - start) / 16, meetingTimestamp, makeId: () => newSegmentId('whisper')
            }));
        }
        return segments;
    };

    /** Streams the audio to Vosk; segments arrive through the finalResult listener. */
    const transcribeWithVosk = async (source: PcmSource, keepInMemory: boolean): Promise<boolean> => {
        await (Vosk as any).startProcessing();
        // In-memory audio lets precise mode extract embeddings of each utterance
        const audioData = keepInMemory ? await source.read(0, source.totalSamples) : null;
        reprocessingStateRef.current = { audioData, currentOffset: 0, isReprocessing: true };
        setProcessingStatus('Streaming to Vosk...');

        const chunks = planChunks(source.totalSamples, VOSK_CHUNK_SAMPLES);
        for (let i = 0; i < chunks.length; i++) {
            if (abortProcessingRef.current) break;
            const { start, end } = chunks[i];
            const samples = audioData ? audioData.subarray(start, end) : await source.read(start, end - start);
            reprocessingStateRef.current.currentOffset = end;
            await (Vosk as any).submitAudio({ data: arrayBufferToBase64(floatToInt16(samples).buffer as ArrayBuffer) });
            if (i % 10 === 0) setProcessingStatus(`Processing: ${Math.round((i / chunks.length) * 100)}%`);
            await new Promise(r => setTimeout(r, 5));
        }

        // Emits the last utterance before resolving
        await (Vosk as any).stopProcessing();
        // Let final results awaiting their embedding land before the save
        await new Promise(r => setTimeout(r, 300));
        return !abortProcessingRef.current;
    };

    const doFullAudioDiarization = async (): Promise<boolean> => {
        const result = await runFullAudioDiarization({
            audioUrl: playback.recordedAudioUrl,
            audioFilePath: audioFilePathRef.current,
            transcript: getTranscript(),
            speechConfig,
            targetSpeakerCount: settings.targetSpeakerCount,
            similarityThreshold: diarizationRef.current.similarityThreshold,
            showToast,
            setStatus: setProcessingStatus,
            isCancelled: () => abortProcessingRef.current
        });
        if (!result) return false;
        setTranscript(result);
        showToast(`Diarization complete (2-Pass + smoothing): ${new Set(result.map(s => s.speakerId)).size} speakers`, 'success');
        return true;
    };

    const reprocessMeeting = async () => {
        if (!playback.recordedAudioUrl) {
            showToast('No recorded audio to reprocess', 'error');
            return;
        }
        const sttMode = speechConfig?.sttMode || 'vosk-only';
        const useWhisper = sttMode === 'whisper-only' || sttMode === 'whisper-post' || sttMode === 'hybrid';
        showToast(`Reprocessing in progress (${useWhisper ? 'Whisper' : 'Vosk'})...`, 'info');

        await runProcessing(async () => {
            setProcessingStatus('Preparing audio...');
            setTranscript([]);
            diarizationRef.current.clear();

            let source: PcmSource;
            if (!audioFilePathRef.current && pcmAudioBlobRef.current && pcmAudioBlobRef.current.size > 44) {
                const data = await wavBlobToFloat(pcmAudioBlobRef.current);
                source = { totalSamples: data.length, wavPath: null, read: async (s, c) => data.slice(s, s + c) };
            } else {
                setProcessingStatus('Decoding audio...');
                source = await openMeetingPcm(playback.recordedAudioUrl, audioFilePathRef.current);
            }
            if (abortProcessingRef.current) return false;

            if (useWhisper) {
                try {
                    if (await ensureWhisperModel()) {
                        const segments = await transcribeWithWhisper(source);
                        if (!segments) return false;
                        setTranscript(segments);
                        showToast('Whisper transcription completed', 'success');
                        if (speechConfig?.enableWhisperDiarization) {
                            setProcessingStatus('Speaker Diarization...');
                            // Reads the new transcript through getTranscript()
                            await doFullAudioDiarization();
                        }
                        return true;
                    }
                } catch (e) {
                    logger.log('error', 'Whisper failed, fallback to Vosk', e);
                    showToast('Whisper failed, using Vosk', 'info');
                    setTranscript([]);
                }
            }

            // Long meetings stay on disk; short ones are kept in memory for precise-mode embeddings
            const keepInMemory = source.totalSamples <= 10 * 60 * SAMPLE_RATE;
            const completed = await transcribeWithVosk(source, keepInMemory);
            if (completed) showToast('Reprocessing completed', 'success');
            return completed;
        });
    };

    const fullAudioDiarization = async () => {
        if (!playback.recordedAudioUrl) {
            showToast('No audio to analyze', 'error');
            return;
        }
        if (getTranscript().length === 0) {
            showToast('No transcript to reprocess', 'info');
            return;
        }
        showToast('Full audio speaker analysis...', 'info');
        await runProcessing(doFullAudioDiarization);
    };

    const reclusterSpeakers = async () => {
        const sessionEmbeddings = diarizationRef.current.getEmbeddingService().getSessionEmbeddings();
        if (sessionEmbeddings.length === 0) {
            showToast('No embeddings saved for clustering', 'info');
            return;
        }
        if (getTranscript().length === 0) {
            showToast('No transcript to reprocess', 'info');
            return;
        }
        showToast('Speaker reprocessing in progress...', 'info');

        await runProcessing(async () => {
            const transcript = getTranscript();
            const clustering = new SpeakerClustering((msg) => logger.log('debug', 'Clustering', msg));
            const byId = new Map<string, any>(sessionEmbeddings.map((e: any) => [e.id, e]));
            const storedEmbeddings = transcript
                .map(seg => {
                    const stored = byId.get(seg.id);
                    return stored && stored.embedding.length > 0 ? {
                        id: seg.id,
                        embedding: stored.embedding as number[],
                        timestamp: seg.timestamp,
                        originalSpeakerId: seg.speakerId
                    } : null;
                })
                .filter((s): s is NonNullable<typeof s> => s !== null);

            const clusterResult = clustering.clusterWithAlgorithm(storedEmbeddings, settings.clusteringAlgorithm, {
                targetSpeakers: settings.targetSpeakerCount,
                distanceThreshold: 1 - diarizationRef.current.similarityThreshold
            });

            // Cluster numbers are arbitrary: keep the current ids (and their names) where they match
            const maxSpeakerId = transcript.reduce((max, s) => Math.max(max, s.speakerId), 0);
            const labels = alignClusterLabels(
                storedEmbeddings
                    .filter(e => clusterResult.speakerAssignments.has(e.id))
                    .map(e => ({ previous: e.originalSpeakerId, cluster: clusterResult.speakerAssignments.get(e.id)! })),
                maxSpeakerId + 1
            );
            const updatedTranscript = transcript.map(seg => {
                const cluster = clusterResult.speakerAssignments.get(seg.id);
                const speakerId = cluster === undefined ? undefined : labels.get(cluster);
                return speakerId === undefined || speakerId === seg.speakerId ? seg : { ...seg, speakerId };
            });

            setTranscript(updatedTranscript);
            const uniqueSpeakers = new Set(updatedTranscript.map(s => s.speakerId)).size;
            showToast(`Reprocessing completed: ${uniqueSpeakers} speakers`, 'success');
            return true;
        });
    };

    return {
        isReclustering,
        processingStatus,
        reprocessMeeting,
        fullAudioDiarization,
        reclusterSpeakers,
        handleCancelProcessing,
        reprocessingStateRef
    };
};
