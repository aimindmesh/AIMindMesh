import { useCallback, useEffect, useRef } from 'react';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { TranscriptSegment } from '../../types/meeting';
import { RecognitionMode } from '../../types/meeting';
import { newSegmentId } from '../../services/meeting/meetingIds';

/** 10 s of 16 kHz audio per Whisper call */
const MAX_CHUNK_SAMPLES = 160000;
/** On stop at most this many chunks of tail are transcribed before saving */
const MAX_TAIL_CHUNKS = 6;

interface UseWhisperTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
    setIsWhisperTranscribing: (isTranscribing: boolean) => void;
    diarizationRef?: React.MutableRefObject<any>;
    recognitionModeRef?: React.MutableRefObject<RecognitionMode>;
}

export function useWhisperTranscription({
    settings,
    recording,
    setTranscript,
    setIsWhisperTranscribing,
    diarizationRef,
    recognitionModeRef
}: UseWhisperTranscriptionProps) {
    /** Absolute sample offset (from the recording start) already transcribed */
    const lastProcessedSampleOffsetRef = useRef(0);
    const inFlightRef = useRef<Promise<boolean> | null>(null);
    const segmentCounterRef = useRef(0);
    const previousTextRef = useRef('');
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    /** Transcribes the next chunk; false when there was no audio left. */
    const transcribeNext = useCallback(async (): Promise<boolean> => {
        const { base64, startOffset, newOffset } = recording.getAudioSince(lastProcessedSampleOffsetRef.current, MAX_CHUNK_SAMPLES);
        if (!base64 || base64.length === 0) return false;
        lastProcessedSampleOffsetRef.current = newOffset;

        const current = settingsRef.current;
        setIsWhisperTranscribing(true);
        let speakerId = 0;

        try {
            // Extract speaker embedding for diarization (precise mode only)
            if (diarizationRef && recognitionModeRef?.current === 'precise') {
                try {
                    const embedResult = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64 });
                    if (embedResult && embedResult.embedding && embedResult.embedding.length > 0) {
                        speakerId = diarizationRef.current.identifySpeaker(embedResult.embedding);
                        const segmentId = `whisper_embed_${Date.now()}_${segmentCounterRef.current}`;
                        diarizationRef.current.getEmbeddingService().storeEmbedding(
                            segmentId, embedResult.embedding, Date.now(), speakerId
                        );
                    }
                } catch (e) {
                    logger.log('warn', 'Whisper ONNX embedding extraction failed, using default speaker', e);
                }
            }

            const accurate = current.whisperProfile === 'accurate';
            const transcribeConfig: any = {
                language: current.transcriptionLanguage,
                temperature: 0.0,
                beamSize: accurate ? 5 : 1,
                vadFilter: current.whisperVadFilter || accurate,
                conditionOnPreviousText: current.whisperConditionOnPrevious || accurate,
                wordTimestamps: current.whisperWordTimestamps || accurate
            };
            if (transcribeConfig.conditionOnPreviousText && previousTextRef.current) {
                transcribeConfig.initialPrompt = previousTextRef.current;
            }

            const result = await getWhisperSTTService().transcribeAudio(base64, transcribeConfig, accurate ? 'accurate' : 'fast');
            if (!result.text || result.text.trim().length === 0) return true;

            logger.log('info', `[Whisper] Chunk result: "${result.text}" (speaker ${speakerId})`);
            previousTextRef.current = result.text.trim();

            // Position of this chunk in the recording
            const offsetMs = startOffset / 16;
            const rawWords: any[] | undefined = (result as any).words;
            const words = rawWords?.map((w: any) => ({
                word: w.word || w.text,
                start_ms: Math.floor(offsetMs + (w.startMs ?? w.start_ms ?? 0)),
                end_ms: Math.floor(offsetMs + (w.endMs ?? w.end_ms ?? 0)),
                confidence: w.confidence ?? w.probability ?? 0
            }));
            segmentCounterRef.current++;

            if (result.segments && result.segments.length > 0) {
                const newSegments: TranscriptSegment[] = result.segments
                    .filter(seg => seg.text.trim().length > 0)
                    .map(seg => {
                        const start = Math.floor(offsetMs + seg.startMs);
                        const end = Math.floor(offsetMs + seg.endMs);
                        return {
                            id: newSegmentId('whisper'),
                            speakerId,
                            text: seg.text.trim(),
                            timestamp: Date.now(),
                            start_ms: start,
                            end_ms: end,
                            stt_provider: 'whisper',
                            confidence: seg.confidence ?? 0,
                            words: words?.filter(w => w.start_ms >= start && w.end_ms <= end)
                        };
                    });
                setTranscript(prev => [...prev, ...newSegments]);
            } else {
                setTranscript(prev => [...prev, {
                    id: newSegmentId('whisper'),
                    speakerId,
                    text: result.text.trim(),
                    timestamp: Date.now(),
                    start_ms: Math.floor(offsetMs),
                    end_ms: Math.floor(offsetMs + (newOffset - startOffset) / 16),
                    stt_provider: 'whisper',
                    confidence: 0,
                    words: words?.length ? words : undefined
                }]);
            }
        } catch (error) {
            logger.log('error', 'Whisper chunk transcription failed', error);
        } finally {
            setIsWhisperTranscribing(false);
        }
        return true;
    }, [recording.getAudioSince, setTranscript, setIsWhisperTranscribing, diarizationRef, recognitionModeRef]);

    const runExclusive = useCallback((): Promise<boolean> => {
        if (inFlightRef.current) return inFlightRef.current;
        const run = transcribeNext().finally(() => { inFlightRef.current = null; });
        inFlightRef.current = run;
        return run;
    }, [transcribeNext]);

    // Offsets are absolute from the recording start: every recording starts at 0
    useEffect(() => {
        if (recording.isRecording) {
            lastProcessedSampleOffsetRef.current = 0;
            segmentCounterRef.current = 0;
            previousTextRef.current = '';
        }
    }, [recording.isRecording]);

    useEffect(() => {
        if (settings.transcriptionMode !== 'whisper' || !recording.isRecording || recording.isPaused) {
            return;
        }

        const safeChunkSize = Math.min(settings.whisperChunkSize, 10);
        const intervalMs = safeChunkSize * 1000;
        logger.log('info', `Starting Whisper loop with interval ${intervalMs}ms`);

        const intervalId = setInterval(() => {
            if (!recording.isRecordingRef.current || recording.isPausedRef.current) return;
            if (inFlightRef.current) {
                logger.log('warn', 'Skipping chunk: previous transcription still in progress');
                return;
            }
            void runExclusive();
        }, intervalMs);

        return () => clearInterval(intervalId);
    }, [settings.transcriptionMode, recording.isRecording, recording.isPaused, settings.whisperChunkSize, recording.isRecordingRef, recording.isPausedRef, runExclusive]);

    // On stop: finish the chunk in flight, then transcribe the tail so the last words are saved
    useEffect(() => recording.registerStopDrain(async () => {
        if (settingsRef.current.transcriptionMode !== 'whisper') return;
        if (inFlightRef.current) await inFlightRef.current;
        for (let i = 0; i < MAX_TAIL_CHUNKS; i++) {
            if (!(await runExclusive())) break;
        }
    }), [recording.registerStopDrain, runExclusive]);
}
