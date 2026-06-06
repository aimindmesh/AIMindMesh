import { useEffect, useRef } from 'react';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { TranscriptSegment } from '../../types/meeting';

interface UseWhisperTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
    setIsWhisperTranscribing: (isTranscribing: boolean) => void;
}

export function useWhisperTranscription({
    settings,
    recording,
    setTranscript,
    setIsWhisperTranscribing
}: UseWhisperTranscriptionProps) {
    // Last processed sample offset for Whisper chunking
    const lastProcessedSampleOffsetRef = useRef(0);

    // Whisper Loop
    // Mutex to prevent concurrent transcriptions (native context is NOT thread-safe)
    const isTranscribingRef = useRef(false);

    useEffect(() => {
        if (settings.transcriptionMode !== 'whisper' || !recording.isRecording || recording.isPaused) {
            return;
        }

        // Clamp to 10s max to match native safety limit
        const safeChunkSize = Math.min(settings.whisperChunkSize, 10);
        const intervalMs = safeChunkSize * 1000;
        logger.log('info', `Starting Whisper loop with interval ${intervalMs}ms`);

        const intervalId = setInterval(async () => {
            if (!recording.isRecording || recording.isPaused) return;

            // Skip if a transcription is already in progress (native context is not thread-safe)
            if (isTranscribingRef.current) {
                logger.log('warn', 'Skipping chunk: previous transcription still in progress');
                return;
            }

            // Extract audio since last offset, limiting to 10 seconds (160000 samples) to prevent native crash
            const { base64, newOffset } = recording.getAudioSince(lastProcessedSampleOffsetRef.current, 160000);

            if (!base64 || base64.length === 0) return;

            // Update offset immediately to avoid reprocessing
            const startOffset = lastProcessedSampleOffsetRef.current;
            lastProcessedSampleOffsetRef.current = newOffset;

            // Set lock and UI state
            isTranscribingRef.current = true;
            setIsWhisperTranscribing(true);

            try {
                logger.log('info', `Sending chunk to Whisper: ${(newOffset - startOffset) / 16000}s`);
                const service = getWhisperSTTService();

                // Model should be pre-loaded by useMeetingInitialization
                const result = await service.transcribeAudio(base64, {
                    language: settings.transcriptionLanguage,
                    temperature: 0.0,
                    beamSize: 1 // Use fast settings for chunks
                }, 'fast');

                if (result.text && result.text.trim().length > 0) {
                    logger.log('info', `[Whisper] Chunk result: "${result.text}"`);

                    const speakerId = 0; // Default/Unknown
                    const offsetMs = startOffset / 16; // 16kHz audio

                    if (result.segments && result.segments.length > 0) {
                        setTranscript(prev => {
                            const newSegments = result.segments.map((seg, i) => ({
                                id: Date.now().toString() + '_' + i,
                                speakerId,
                                text: seg.text.trim(),
                                timestamp: Date.now(),
                                start_ms: Math.floor(offsetMs + seg.startMs),
                                end_ms: Math.floor(offsetMs + seg.endMs)
                            }));
                            return [...prev, ...newSegments];
                        });
                    } else {
                        setTranscript(prev => [...prev, {
                            id: Date.now().toString(),
                            speakerId,
                            text: result.text.trim(),
                            timestamp: Date.now(),
                            start_ms: Math.floor(offsetMs),
                            end_ms: Math.floor(offsetMs + (newOffset - startOffset) / 16)
                        }]);
                    }
                }
            } catch (error) {
                logger.log('error', 'Whisper chunk transcription failed', error);
            } finally {
                // Release lock and UI state
                isTranscribingRef.current = false;
                setIsWhisperTranscribing(false);
            }

        }, intervalMs);

        return () => {
            clearInterval(intervalId);
        };
    }, [settings.transcriptionMode, recording.isRecording, recording.isPaused, settings.whisperChunkSize, settings.transcriptionLanguage, recording.getAudioSince]);

    // Reset offset when recording starts
    useEffect(() => {
        if (recording.isRecording) {
            // If starting fresh
            if (recording.totalBufferedDurationRef.current === 0) {
                lastProcessedSampleOffsetRef.current = 0;
            }
        }
    }, [recording.isRecording]);
}
