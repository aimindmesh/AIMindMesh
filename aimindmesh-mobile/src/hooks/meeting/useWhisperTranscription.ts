import { useEffect, useRef } from 'react';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { SpeakerEmbedding as SpeakerEmbeddingPlugin } from 'speaker-embedding-capacitor';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { TranscriptSegment } from '../../types/meeting';
import { RecognitionMode } from '../../types/meeting';

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
    const lastProcessedSampleOffsetRef = useRef(0);
    const isTranscribingRef = useRef(false);
    const segmentCounterRef = useRef(0);
    const previousTextRef = useRef('');

    useEffect(() => {
        if (settings.transcriptionMode !== 'whisper' || !recording.isRecording || recording.isPaused) {
            return;
        }

        const safeChunkSize = Math.min(settings.whisperChunkSize, 10);
        const intervalMs = safeChunkSize * 1000;
        logger.log('info', `Starting Whisper loop with interval ${intervalMs}ms`);

        const intervalId = setInterval(async () => {
            if (!recording.isRecording || recording.isPaused) return;

            if (isTranscribingRef.current) {
                logger.log('warn', 'Skipping chunk: previous transcription still in progress');
                return;
            }

            const { base64, newOffset } = recording.getAudioSince(lastProcessedSampleOffsetRef.current, 160000);

            if (!base64 || base64.length === 0) return;

            const startOffset = lastProcessedSampleOffsetRef.current;
            lastProcessedSampleOffsetRef.current = newOffset;

            isTranscribingRef.current = true;
            setIsWhisperTranscribing(true);

            let speakerId = 0;

            try {
                // Extract speaker embedding for diarization (precise mode only)
                if (diarizationRef && recognitionModeRef?.current === 'precise') {
                    try {
                        const embedResult = await SpeakerEmbeddingPlugin.extractEmbedding({ audioData: base64 });
                        if (embedResult && embedResult.embedding && embedResult.embedding.length > 0) {
                            speakerId = diarizationRef.current.identifySpeaker(embedResult.embedding);

                            // Store embedding for session clustering
                            const segmentId = `whisper_embed_${Date.now()}_${segmentCounterRef.current}`;
                            diarizationRef.current.getEmbeddingService().storeEmbedding(
                                segmentId, embedResult.embedding, Date.now(), speakerId
                            );
                            logger.log('debug', `Whisper chunk speaker ID: ${speakerId}`);
                        }
                    } catch (e) {
                        logger.log('warn', 'Whisper ONNX embedding extraction failed, using default speaker', e);
                    }
                }

                const service = getWhisperSTTService();
                const transcribeConfig: any = {
                    language: settings.transcriptionLanguage,
                    temperature: settings.whisperProfile === 'accurate' ? 0.0 : 0.0,
                    beamSize: settings.whisperProfile === 'accurate' ? 5 : 1,
                    vadFilter: settings.whisperVadFilter || settings.whisperProfile === 'accurate',
                    conditionOnPreviousText: settings.whisperConditionOnPrevious || settings.whisperProfile === 'accurate',
                    wordTimestamps: settings.whisperWordTimestamps || settings.whisperProfile === 'accurate'
                };

                // Pass previous text for continuity if enabled
                if (transcribeConfig.conditionOnPreviousText && previousTextRef.current) {
                    transcribeConfig.initialPrompt = previousTextRef.current;
                }

                const result = await service.transcribeAudio(base64, transcribeConfig, settings.whisperProfile === 'accurate' ? 'accurate' : 'fast');

                if (result.text && result.text.trim().length > 0) {
                    logger.log('info', `[Whisper] Chunk result: "${result.text}" (speaker ${speakerId})`);
                    previousTextRef.current = result.text.trim();

                    const offsetMs = startOffset / 16;
                    const chunkId = `${Date.now().toString(36)}_${segmentCounterRef.current++}`;

                    // Build word timestamps if available
                    const rawWords: any[] | undefined = (result as any).words;
                    const words = rawWords?.map((w: any) => ({
                        word: w.word || w.text,
                        start_ms: Math.floor(offsetMs + (w.startMs ?? w.start_ms ?? 0)),
                        end_ms: Math.floor(offsetMs + (w.endMs ?? w.end_ms ?? 0)),
                        confidence: w.confidence ?? w.probability ?? 0
                    }));

                    if (result.segments && result.segments.length > 0) {
                        setTranscript(prev => {
                            const newSegments = result.segments.map((seg, i) => ({
                                id: `${chunkId}_${i}`,
                                speakerId,
                                text: seg.text.trim(),
                                timestamp: Date.now(),
                                start_ms: Math.floor(offsetMs + seg.startMs),
                                end_ms: Math.floor(offsetMs + seg.endMs),
                                stt_provider: 'whisper',
                                confidence: seg.confidence ?? 0,
                                words: words?.filter((w: any) =>
                                    w.start_ms >= Math.floor(offsetMs + seg.startMs) && w.end_ms <= Math.floor(offsetMs + seg.endMs)
                                ) ?? undefined
                            }));
                            return [...prev, ...newSegments];
                        });
                    } else {
                        setTranscript(prev => [...prev, {
                            id: chunkId,
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
                }
            } catch (error) {
                logger.log('error', 'Whisper chunk transcription failed', error);
            } finally {
                isTranscribingRef.current = false;
                setIsWhisperTranscribing(false);
            }

        }, intervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [settings.transcriptionMode, recording.isRecording, recording.isPaused, settings.whisperChunkSize, settings.transcriptionLanguage, recording.getAudioSince]);

    useEffect(() => {
        if (recording.isRecording) {
            if (recording.totalBufferedDurationRef.current === 0) {
                lastProcessedSampleOffsetRef.current = 0;
                segmentCounterRef.current = 0;
            }
        }
    }, [recording.isRecording]);
}