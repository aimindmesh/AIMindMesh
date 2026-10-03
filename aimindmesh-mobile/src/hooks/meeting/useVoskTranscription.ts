import { useEffect, useRef } from 'react';
import { Vosk } from 'vosk-capacitor';
import type { FinalResultEvent } from 'vosk-capacitor';
import { PluginListenerHandle } from '@capacitor/core';
import { logger } from '../../services/logger';
import { MeetingRecordingState } from './useMeetingRecording';
import { MeetingReprocessingState } from './useMeetingReprocessing';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { TranscriptSegment } from '../../types/meeting';
import { MeetingSettingsState } from './useMeetingSettings';
import { createVoskFinalResultHandler } from './voskFinalResult';

/** Longest wait for final results still computing their embedding before the stop-save */
const PENDING_DRAIN_MS = 5000;

interface UseVoskTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    reprocessing: MeetingReprocessingState;
    diarizationRef: React.MutableRefObject<SpeakerDiarization>;
    setCurrentText: (text: string) => void;
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

export function useVoskTranscription({
    settings,
    recording,
    reprocessing,
    diarizationRef,
    setCurrentText,
    setTranscript
}: UseVoskTranscriptionProps) {
    // Periodic mini-clustering tracking refs
    const lastReclusterTime = useRef<number>(0);
    const lastReclusterSegCount = useRef<number>(0);
    const pendingRef = useRef(0);
    const voskTranscribesRef = useRef(false);
    voskTranscribesRef.current = settings.transcriptionMode === 'vosk' || settings.transcriptionMode === 'hybrid';

    // Rebuilt every render, called through a ref: listeners registered once never see stale state
    const finalHandlerRef = useRef<(data: FinalResultEvent) => Promise<void>>();
    finalHandlerRef.current = createVoskFinalResultHandler({
        settings,
        recording,
        reprocessing,
        diarizationRef,
        setCurrentText,
        setTranscript,
        voskTranscribesRef,
        pendingRef,
        lastReclusterTime,
        lastReclusterSegCount
    });

    // New meeting: mini-clustering starts over
    useEffect(() => {
        if (recording.isRecording) {
            lastReclusterTime.current = 0;
            lastReclusterSegCount.current = 0;
        }
    }, [recording.isRecording]);

    // Final results flushed on stop, or still awaiting their embedding, must land before saving
    useEffect(() => recording.registerStopDrain(async () => {
        const deadline = Date.now() + PENDING_DRAIN_MS;
        while (pendingRef.current > 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }), [recording.registerStopDrain]);

    useEffect(() => {
        let cancelled = false;
        const handles: PluginListenerHandle[] = [];
        // A cleanup running before registration finishes removes the late handle (it used to leak)
        const keep = (handle: PluginListenerHandle) => {
            if (cancelled) void handle.remove();
            else handles.push(handle);
        };

        const initListeners = async () => {
            // Refs, not the values of the first render: those stayed "not recording" forever
            keep(await Vosk.addListener('audioLevel', (data: any) => {
                if (recording.isRecordingRef.current && !recording.isPausedRef.current) {
                    recording.setAudioLevel(data.level);
                    diarizationRef.current.recordRmsValue(data.level);
                }
            }));

            keep(await Vosk.addListener('partialResult', (data: any) => {
                if (!data.text) return;
                const reprocessingNow = reprocessing.reprocessingStateRef.current.isReprocessing;
                const liveText = voskTranscribesRef.current && recording.isRecordingRef.current && !recording.isPausedRef.current;
                if (reprocessingNow || liveText) setCurrentText(data.text);
            }));

            // Registered in every mode: reprocessing uses Vosk even when live transcription does not
            keep(await Vosk.addListener('finalResult', (data: FinalResultEvent) => {
                void finalHandlerRef.current?.(data);
            }));
        };

        initListeners().catch(e => logger.log('warn', 'Failed to register Vosk listeners', e));

        return () => {
            cancelled = true;
            handles.forEach(handle => void handle.remove());
        };
        // Recording/reprocessing state is read through refs
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
