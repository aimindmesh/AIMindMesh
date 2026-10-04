import { useEffect, useRef } from 'react';
import { Vosk } from 'vosk-capacitor';
import type { FinalResultEvent } from 'vosk-capacitor';
import { PluginListenerHandle } from '@capacitor/core';
import { logger } from '../../services/logger';
import { MeetingRecordingState } from './useMeetingRecording';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { TranscriptSegment } from '../../types/meeting';
import { MeetingSettingsState } from './useMeetingSettings';
import { createVoskFinalResultHandler } from './voskFinalResult';

/** Longest wait for final results still computing their embedding before the stop-save */
const PENDING_DRAIN_MS = 5000;

interface UseVoskTranscriptionProps {
    settings: MeetingSettingsState;
    recording: MeetingRecordingState;
    diarizationRef: React.MutableRefObject<SpeakerDiarization>;
    setCurrentText: (text: string) => void;
    setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
}

export function useVoskTranscription({
    settings,
    recording,
    diarizationRef,
    setCurrentText,
    setTranscript
}: UseVoskTranscriptionProps) {
    // Periodic mini-clustering tracking refs
    const lastReclusterTime = useRef<number>(0);
    const lastReclusterSegCount = useRef<number>(0);
    const pendingRef = useRef(0);
    const voskTranscribesRef = useRef(false);
    voskTranscribesRef.current = settings.transcriptionMode === 'vosk';

    // Rebuilt every render, called through a ref: listeners registered once never see stale state
    const finalHandlerRef = useRef<(data: FinalResultEvent) => Promise<void>>();
    finalHandlerRef.current = createVoskFinalResultHandler({
        settings,
        recording,
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
        lastReclusterTime.current = 0;
        lastReclusterSegCount.current = 0;
    }, [recording.sessionEpoch]);

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
            // Audio levels come from the MeetingRecorder (see useMeetingRecording).
            // Refs, not the values of the first render: those stayed "not recording" forever
            keep(await Vosk.addListener('partialResult', (data: any) => {
                if (!data.text || data.source === 'mic') return;
                if (voskTranscribesRef.current && recording.isRecordingRef.current && !recording.isPausedRef.current) {
                    setCurrentText(data.text);
                }
            }));

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
