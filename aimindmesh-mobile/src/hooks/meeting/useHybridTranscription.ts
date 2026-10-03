import { useCallback, useEffect, useRef } from 'react';
import { logger } from '../../services/logger';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingSettingsState } from './useMeetingSettings';
import { TranscriptSegment } from '../../types/meeting';
import { mergeWhisperRefinement } from '../../services/meeting/hybridRefinement';

const REFINE_INTERVAL_MS = 30000;
/** 30 s of 16 kHz audio per refinement */
const MAX_REFINE_SAMPLES = 480000;

interface UseHybridTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    transcript: TranscriptSegment[];
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

/**
 * Hybrid mode: Vosk runs continuously for real-time transcription + speaker ID.
 * Whisper runs every 30 s to refine the segments of the audio it re-transcribes;
 * refined segments keep Vosk's speaker and timing.
 */
export function useHybridTranscription({
    settings,
    recording,
    transcript,
    setTranscript
}: UseHybridTranscriptionProps) {
    /** Absolute sample offset (from the recording start) already refined */
    const lastHybridOffsetRef = useRef(0);
    const inFlightRef = useRef<Promise<void> | null>(null);
    const refineCounterRef = useRef(0);
    // Read through a ref: as an effect dependency every new segment restarted the 30 s timer
    const transcriptLengthRef = useRef(transcript.length);
    transcriptLengthRef.current = transcript.length;
    const languageRef = useRef(settings.transcriptionLanguage);
    languageRef.current = settings.transcriptionLanguage;

    const refine = useCallback(async () => {
        const service = getWhisperSTTService();
        if (!(await service.checkModelLoaded())) {
            logger.log('warn', 'Whisper model not loaded for hybrid refinement, skipping');
            return;
        }

        const { base64, startOffset, newOffset } = recording.getAudioSince(lastHybridOffsetRef.current, MAX_REFINE_SAMPLES);
        if (!base64 || base64.length === 0) return;
        lastHybridOffsetRef.current = newOffset;

        const result = await service.transcribeAudio(base64, {
            language: languageRef.current,
            temperature: 0.0,
            beamSize: 5,
            vadFilter: true,
            conditionOnPreviousText: false
        }, 'accurate');
        if (!result.text?.trim() || !result.segments?.length) return;

        const offsetMs = startOffset / 16;
        const refined = result.segments.map(ws => ({
            text: ws.text,
            startMs: Math.floor(offsetMs + ws.startMs),
            endMs: Math.floor(offsetMs + ws.endMs),
            confidence: ws.confidence
        }));
        setTranscript(prev => mergeWhisperRefinement(prev, refined));
        refineCounterRef.current++;
        logger.log('info', `Hybrid: Whisper refined ${refined.length} segments (pass ${refineCounterRef.current})`);
    }, [recording.getAudioSince, setTranscript]);

    // Offsets are absolute from the recording start: every recording starts at 0
    useEffect(() => {
        if (recording.isRecording) lastHybridOffsetRef.current = 0;
    }, [recording.isRecording]);

    useEffect(() => {
        if (settings.transcriptionMode !== 'hybrid' || !recording.isRecording || recording.isPaused) {
            return;
        }

        const intervalId = setInterval(() => {
            if (!recording.isRecordingRef.current || recording.isPausedRef.current) return;
            if (inFlightRef.current || transcriptLengthRef.current === 0) return;
            inFlightRef.current = refine()
                .catch(e => logger.log('warn', 'Hybrid Whisper refinement failed', e))
                .finally(() => { inFlightRef.current = null; });
        }, REFINE_INTERVAL_MS);

        return () => clearInterval(intervalId);
    }, [settings.transcriptionMode, recording.isRecording, recording.isPaused, recording.isRecordingRef, recording.isPausedRef, refine]);

    // The refinement in flight must land before the stop-save
    useEffect(() => recording.registerStopDrain(async () => {
        if (inFlightRef.current) await inFlightRef.current;
    }), [recording.registerStopDrain]);
}
