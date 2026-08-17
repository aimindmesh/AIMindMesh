import { useEffect, useRef } from 'react';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { TranscriptSegment } from '../../types/meeting';

interface UseHybridTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    transcript: TranscriptSegment[];
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

/**
 * Hybrid mode: Vosk runs continuously for real-time transcription + speaker ID.
 * Whisper runs every `intervalSeconds` to refine recent segments with higher accuracy.
 * Whisper-refined segments preserve the speakerId from Vosk's real-time diarization.
 */
export function useHybridTranscription({
    settings,
    recording,
    transcript,
    setTranscript
}: UseHybridTranscriptionProps) {
    const lastHybridOffsetRef = useRef(0);
    const isRefiningRef = useRef(false);
    const refineCounterRef = useRef(0);

    useEffect(() => {
        if (settings.transcriptionMode !== 'hybrid' || !recording.isRecording || recording.isPaused) {
            return;
        }

        const intervalSeconds = 30; // Whisper refinement every 30s
        const intervalMs = intervalSeconds * 1000;

        const intervalId = setInterval(async () => {
            if (!recording.isRecording || recording.isPaused) return;
            if (isRefiningRef.current) return;
            if (transcript.length === 0) return;

            const { base64, newOffset } = recording.getAudioSince(lastHybridOffsetRef.current, 480000); // 30s max
            if (!base64 || base64.length === 0) return;

            const startOffset = lastHybridOffsetRef.current;
            lastHybridOffsetRef.current = newOffset;
            isRefiningRef.current = true;

            try {
                const service = getWhisperSTTService();
                const modelLoaded = await service.checkModelLoaded();
                if (!modelLoaded) {
                    logger.log('warn', 'Whisper model not loaded for hybrid refinement, skipping');
                    return;
                }

                const result = await service.transcribeAudio(base64, {
                    language: settings.transcriptionLanguage,
                    temperature: 0.0,
                    beamSize: 5,
                    vadFilter: true,
                    conditionOnPreviousText: false
                }, 'accurate');

                if (!result.text?.trim()) return;

                const offsetMs = startOffset / 16;

                if (result.segments && result.segments.length > 0) {
                    setTranscript(prev => {
                        return prev.map(seg => {
                            const segStart = seg.start_ms || 0;
                            const segEnd = seg.end_ms || Infinity;

                            // Find matching Whisper segment that overlaps
                            const match = result.segments.find((ws: any) => {
                                const wsStart = Math.floor(offsetMs + ws.startMs);
                                const wsEnd = Math.floor(offsetMs + ws.endMs);
                                return wsStart <= segEnd && wsEnd >= segStart;
                            });

                            if (match && seg.stt_provider !== 'whisper') {
                                const wsStart = Math.floor(offsetMs + match.startMs);
                                const wsEnd = Math.floor(offsetMs + match.endMs);
                                return {
                                    ...seg,
                                    text: match.text.trim(),
                                    start_ms: wsStart,
                                    end_ms: wsEnd,
                                    stt_provider: 'whisper',
                                    confidence: match.confidence ?? 0.85
                                };
                            }
                            return seg;
                        });
                    });
                    refineCounterRef.current++;
                    logger.log('info', `Hybrid: Whisper refined ${result.segments.length} segments (pass ${refineCounterRef.current})`);
                }
            } catch (e) {
                logger.log('warn', 'Hybrid Whisper refinement failed', e);
            } finally {
                isRefiningRef.current = false;
            }
        }, intervalMs);

        return () => {
            clearInterval(intervalId);
            lastHybridOffsetRef.current = 0;
        };
    }, [settings.transcriptionMode, settings.transcriptionLanguage, recording.isRecording, recording.isPaused, transcript.length, recording.getAudioSince]);
}