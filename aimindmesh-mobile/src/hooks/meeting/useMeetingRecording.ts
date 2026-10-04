import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { PluginListenerHandle } from '@capacitor/core';
import { Vosk } from 'vosk-capacitor';
import { isVoskSpeakerModelInstalled } from '../../services/speaker/speakerModelDownloader';
import { logger } from '../../services/logger';
import { RecognitionMode, TranscriptionMode, TranscriptSegment } from '../../types/meeting';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import { MeetingRecorder, FinalizedRecording, RecorderSession, RECORDER_SAMPLE_RATE } from '../../services/audio/meetingRecorder';
import { PcmRingBuffer } from '../../services/audio/pcmRingBuffer';
import { setMeetingCaptureActive } from '../../services/meeting/meetingCapture';
import { pin } from '../../services/model/modelOrchestrator';
import { startVoxtralMeeting, stopVoxtralMeeting } from './voxtralMeetingSession';

/** Recent audio kept in memory for live speaker embeddings. */
const PCM_BUFFER_SECONDS = 60 * 5;
const SAMPLES_PER_MS = RECORDER_SAMPLE_RATE / 1000;
/** Upper bound for live results still being processed (embeddings) before the audio is saved */
const STOP_DRAIN_TIMEOUT_MS = 10000;

export interface MeetingRecordingState {
    isRecording: boolean;
    isPaused: boolean;
    /** True while the audio of a just-stopped recording is being saved. */
    isFinalizing: boolean;
    /** Recording or finalizing, readable synchronously (guards against starting twice) */
    isActiveRef: MutableRefObject<boolean>;
    isRecordingRef: MutableRefObject<boolean>;
    isPausedRef: MutableRefObject<boolean>;
    /**
     * Calls `listener` with the microphone level (0-1) about 10 times a second while recording.
     * A subscription rather than state, so the level doesn't re-render the whole meeting.
     */
    subscribeLevel: (listener: (level: number) => void) => () => void;
    /** Changes at every new (or re-attached) recording, so consumers can reset their state. */
    sessionEpoch: number;
    /** Starts recording into `meetingId`. Resolves null if recording could not start. */
    startRecording: (meetingId: string) => Promise<RecorderSession | null>;
    stopRecording: () => Promise<void>;
    togglePause: () => Promise<void>;
    /** Marks the current moment of the recording; resolves its position (ms), or null. */
    addBookmark: () => Promise<number | null>;
    /** Base64 PCM16 of the recorded audio held in memory from `sampleOffset` (absolute). */
    getAudioSince: (sampleOffset: number, maxSamples?: number) => { base64: string; startOffset: number; newOffset: number };
    /** Recorded audio between two recording timestamps, waiting briefly for it to arrive. */
    getAudioRange: (startMs: number, endMs: number) => Promise<Float32Array | null>;
    /** Work that must finish before the audio is saved (live results in flight); returns the unregister */
    registerStopDrain: (drain: () => Promise<void>) => () => void;
}

interface UseMeetingRecordingOptions {
    recognitionModeRef: MutableRefObject<RecognitionMode>;
    transcriptionModeRef: MutableRefObject<TranscriptionMode>;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    /** Called once the audio of a finished recording is saved as the meeting's audio file. */
    onRecordingStopped?: (recording: FinalizedRecording) => Promise<void> | void;
    /** Called when the app reopens while the native recorder is still recording. */
    onSessionReattached?: (session: { meetingId: string; startedAt: number; bookmarks: number[] }) => void;
    /** A moment was marked (from the app or the recording notification), `ms` into the recording. */
    onBookmark?: (ms: number) => void;
    /** At stop: keep the recording's WAV for a transcription that is reading it. */
    shouldKeepWav?: () => boolean;
    /** Transcript setter for Voxtral live transcription */
    setTranscript?: Dispatch<SetStateAction<TranscriptSegment[]>>;
    diarizationRef?: MutableRefObject<any>;
}

function decodePcm16(base64: string): Float32Array {
    const binary = atob(base64);
    const samples = new Float32Array(binary.length >> 1);
    for (let i = 0; i < samples.length; i++) {
        const lo = binary.charCodeAt(2 * i);
        const hi = binary.charCodeAt(2 * i + 1);
        samples[i] = (((hi << 8) | lo) << 16 >> 16) / 32768;
    }
    return samples;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Meeting recording through the native MeetingRecorder: one microphone capture written to disk
 * by a foreground service (it goes on with the screen off, the app in background or this screen
 * closed), fed natively to live Vosk or Voxtral, and streamed here only when live speaker
 * embeddings need the PCM.
 */
export function useMeetingRecording({
    recognitionModeRef,
    transcriptionModeRef,
    showToast,
    onRecordingStopped,
    onSessionReattached,
    onBookmark,
    shouldKeepWav,
    setTranscript,
    diarizationRef
}: UseMeetingRecordingOptions): MeetingRecordingState {
    const [isRecording, setIsRecordingState] = useState(false);
    const [isPaused, setIsPausedState] = useState(false);
    const [isFinalizing, setIsFinalizingState] = useState(false);
    const [sessionEpoch, setSessionEpoch] = useState(0);
    const levelListenersRef = useRef(new Set<(level: number) => void>());
    const emitLevel = useCallback((level: number) => {
        levelListenersRef.current.forEach(listener => listener(level));
    }, []);
    const subscribeLevel = useCallback((listener: (level: number) => void) => {
        levelListenersRef.current.add(listener);
        return () => { levelListenersRef.current.delete(listener); };
    }, []);

    const isActiveRef = useRef(false);
    const isRecordingRef = useRef(false);
    const isPausedRef = useRef(false);
    const sessionIdRef = useRef<string | null>(null);
    const isStoppingRef = useRef(false);
    const voskActiveRef = useRef(false);
    const voxtralActiveRef = useRef(false);
    const unpinRef = useRef<(() => void) | null>(null);
    const drainsRef = useRef(new Set<() => Promise<void>>());
    const pcmBufferRef = useRef(new PcmRingBuffer(PCM_BUFFER_SECONDS * RECORDER_SAMPLE_RATE));

    const setRecording = useCallback((value: boolean) => {
        isRecordingRef.current = value;
        setIsRecordingState(value);
    }, []);
    const setPaused = useCallback((value: boolean) => {
        isPausedRef.current = value;
        setIsPausedState(value);
    }, []);
    const setFinalizing = useCallback((value: boolean) => setIsFinalizingState(value), []);

    // Latest callbacks for the long-lived native listeners
    const callbacksRef = useRef({ showToast, onRecordingStopped, onSessionReattached, onBookmark, shouldKeepWav, setTranscript });
    callbacksRef.current = { showToast, onRecordingStopped, onSessionReattached, onBookmark, shouldKeepWav, setTranscript };

    const needsVosk = () => transcriptionModeRef.current === 'vosk' || recognitionModeRef.current === 'fast';
    // PCM is only needed for live "precise" speaker embeddings next to live text
    const needsPcm = () => transcriptionModeRef.current !== 'off' && recognitionModeRef.current === 'precise';

    const startLiveVosk = useCallback(async () => {
        try {
            if (recognitionModeRef.current === 'fast' && await isVoskSpeakerModelInstalled()) {
                await Vosk.loadSpeakerModel({ modelPath: 'vosk-models/vosk-model-spk-0.4' });
            } else if (recognitionModeRef.current !== 'fast') {
                const speakerStatus = await Vosk.isSpeakerModelLoaded().catch(() => ({ loaded: false }));
                if (speakerStatus.loaded) await Vosk.unloadSpeakerModel();
            }
        } catch (e) {
            logger.log('warn', 'Failed to configure the Vosk speaker model', e);
        }
        await Vosk.startRecognition({ externalAudio: true });
        voskActiveRef.current = true;
    }, [recognitionModeRef]);

    /** Live engines flush their last words, then live results in flight finish (bounded). */
    const stopLiveEngines = useCallback(async () => {
        if (voskActiveRef.current) {
            voskActiveRef.current = false;
            await Vosk.stopRecognition({ externalAudio: true }).catch(e => logger.log('warn', 'Error stopping Vosk', e));
        }
        if (voxtralActiveRef.current) {
            voxtralActiveRef.current = false;
            await stopVoxtralMeeting();
        }
        const drains = [...drainsRef.current].map(drain => drain().catch(e => logger.log('warn', 'Stop drain failed', e)));
        if (drains.length > 0) await Promise.race([Promise.all(drains), sleep(STOP_DRAIN_TIMEOUT_MS)]);
        unpinRef.current?.();
        unpinRef.current = null;
    }, []);

    /** Turns the stopped session into the meeting audio file and hands it over. */
    const finishSession = useCallback(async (sessionId: string) => {
        try {
            const keepWav = callbacksRef.current.shouldKeepWav?.() ?? false;
            const recording = await MeetingRecorder.finalizeRecording({ sessionId, keepWav });
            logger.log('info', `Recording saved: ${recording.audioPath} (${recording.durationMs} ms)`);
            await callbacksRef.current.onRecordingStopped?.(recording);
            callbacksRef.current.showToast('Recording saved', 'success');
        } catch (e) {
            logger.log('error', 'Failed to save the recording audio', e);
            callbacksRef.current.showToast('Could not save the audio now: it will be recovered at the next start', 'error');
        }
    }, []);

    const stopRecording = useCallback(async () => {
        const sessionId = sessionIdRef.current;
        if (!sessionId || isStoppingRef.current) return;
        isStoppingRef.current = true;
        // Show "saving" at once: stopping can take a few seconds while live text catches up.
        setRecording(false);
        setPaused(false);
        emitLevel(0);
        setFinalizing(true);
        try {
            try {
                await MeetingRecorder.stop();
            } catch (e) {
                logger.log('error', 'Failed to stop the recorder', e);
            }
            setMeetingCaptureActive(false);
            await stopLiveEngines();
            await finishSession(sessionId);
        } finally {
            sessionIdRef.current = null;
            isStoppingRef.current = false;
            isActiveRef.current = false;
            setFinalizing(false);
        }
    }, [finishSession, stopLiveEngines, emitLevel, setRecording, setPaused, setFinalizing]);

    const stopRecordingRef = useRef(stopRecording);
    stopRecordingRef.current = stopRecording;

    // Native events: registered once, they outlive individual recordings.
    useEffect(() => {
        const handles: Promise<PluginListenerHandle>[] = [
            MeetingRecorder.addListener('level', ({ level }) => {
                emitLevel(level);
                diarizationRef?.current?.recordRmsValue(level);
            }),
            MeetingRecorder.addListener('pcm', ({ data, offset }) => {
                pcmBufferRef.current.push(offset, decodePcm16(data));
            }),
            MeetingRecorder.addListener('state', ({ state, reason }) => {
                if (state === 'paused' || state === 'recording') {
                    setPaused(state === 'paused');
                } else if (state === 'idle' && reason !== 'user' && sessionIdRef.current) {
                    // Capture failed natively (storage full, microphone lost): save what we have.
                    logger.log('error', `Recording stopped unexpectedly: ${reason}`);
                    void stopRecordingRef.current();
                }
            }),
            MeetingRecorder.addListener('error', ({ message }) => {
                callbacksRef.current.showToast(message, 'error');
            }),
            MeetingRecorder.addListener('bookmark', ({ ms }) => {
                callbacksRef.current.onBookmark?.(ms);
            }),
        ];
        return () => {
            // The native recorder keeps going without us: only detach the listeners.
            handles.forEach(h => h.then(handle => handle.remove()).catch(() => { }));
        };
    }, [diarizationRef, emitLevel, setPaused]);

    // Re-attach to a recording that kept running while the app UI was recreated.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const status = await MeetingRecorder.getStatus();
                if (cancelled || status.state === 'idle' || !status.sessionId || !status.meetingId) return;

                logger.log('info', `Re-attaching to recording ${status.sessionId}`);
                sessionIdRef.current = status.sessionId;
                isActiveRef.current = true;
                setMeetingCaptureActive(true);
                pcmBufferRef.current.reset(0);
                setSessionEpoch(e => e + 1);
                setRecording(true);
                setPaused(status.state === 'paused');
                callbacksRef.current.onSessionReattached?.({
                    meetingId: status.meetingId,
                    startedAt: status.startedAt ?? Date.now(),
                    bookmarks: status.bookmarks ?? []
                });
                callbacksRef.current.showToast('Recording still in progress', 'info');

                // Voxtral is not restarted (its model went with the old UI): the audio is
                // recorded and transcribed after Stop
                if (transcriptionModeRef.current === 'vosk' || recognitionModeRef.current === 'fast') {
                    // The previous recognizer died with the old UI; wait for the model to reload.
                    for (let i = 0; i < 30 && !cancelled; i++) {
                        const { loaded } = await Vosk.isModelLoaded().catch(() => ({ loaded: false }));
                        if (loaded) {
                            await startLiveVosk();
                            break;
                        }
                        await sleep(500);
                    }
                }
            } catch (e) {
                logger.log('warn', 'Could not query the native recorder', e);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const startVoxtral = useCallback(async () => {
        try {
            await startVoxtralMeeting({
                setTranscript: callbacksRef.current.setTranscript,
                diarizationRef,
                recognitionModeRef,
                isPausedRef,
                getAudioRange: (startMs, endMs) => getAudioRangeRef.current(startMs, endMs),
                onLagging: message => callbacksRef.current.showToast(message, 'info')
            });
            voxtralActiveRef.current = true;
            unpinRef.current = pin('voxtral');
        } catch (e) {
            logger.log('error', 'Voxtral unavailable, recording audio only', e);
            callbacksRef.current.showToast('Voxtral live transcription unavailable: recording audio only. The transcript will be made after recording.', 'error');
        }
    }, [diarizationRef, recognitionModeRef]);

    const startRecording = useCallback(async (meetingId: string): Promise<RecorderSession | null> => {
        if (isActiveRef.current) return null;
        isActiveRef.current = true;

        // The recorder first: audio is captured from the tap. Live text joins a moment later;
        // its timestamps stay aligned because they count from the first sample it receives.
        pcmBufferRef.current.reset(0);
        setMeetingCaptureActive(true);
        let session: RecorderSession;
        try {
            session = await MeetingRecorder.start({ meetingId, streamPcm: needsPcm() });
            sessionIdRef.current = session.sessionId;
        } catch (e: any) {
            logger.log('error', 'Failed to start recording', e);
            setMeetingCaptureActive(false);
            isActiveRef.current = false;
            showToast(`Cannot start recording: ${e?.message || e}`, 'error');
            return null;
        }

        setSessionEpoch(e => e + 1);
        setRecording(true);
        setPaused(false);

        if (transcriptionModeRef.current === 'voxtral') {
            await startVoxtral();
        } else if (needsVosk()) {
            try {
                await startLiveVosk();
            } catch (e) {
                logger.log('error', 'Live Vosk unavailable', e);
                showToast('Live transcription unavailable: recording audio only. The transcript will be made after recording.', 'error');
            }
        }
        logger.log('info', `Meeting recording started (vosk: ${voskActiveRef.current}, voxtral: ${voxtralActiveRef.current}, pcm: ${needsPcm()})`);
        return session;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showToast, startLiveVosk, startVoxtral, setRecording, setPaused]);

    const togglePause = useCallback(async () => {
        if (!sessionIdRef.current) return;
        try {
            if (isPausedRef.current) {
                await MeetingRecorder.resume();
                setPaused(false);
            } else {
                await MeetingRecorder.pause();
                setPaused(true);
                emitLevel(0);
            }
        } catch (e) {
            logger.log('error', 'Failed to toggle pause', e);
        }
    }, [emitLevel, setPaused]);

    const addBookmark = useCallback(async () => {
        if (!sessionIdRef.current) return null;
        try {
            const { ms } = await MeetingRecorder.addBookmark();
            return ms;
        } catch (e) {
            logger.log('warn', 'Could not mark the moment', e);
            return null;
        }
    }, []);

    const getAudioSince = useCallback((sampleOffset: number, maxSamples?: number) => {
        const buffer = pcmBufferRef.current;
        const from = Math.max(sampleOffset, buffer.start);
        const to = maxSamples ? Math.min(buffer.end, from + maxSamples) : buffer.end;
        const { offset, samples } = buffer.read(from, to);
        if (samples.length === 0) {
            return { base64: '', startOffset: offset, newOffset: offset };
        }
        const base64 = arrayBufferToBase64(floatToInt16(samples).buffer as ArrayBuffer);
        return { base64, startOffset: offset, newOffset: offset + samples.length };
    }, []);

    const getAudioRange = useCallback(async (startMs: number, endMs: number) => {
        const from = Math.max(0, Math.floor(startMs * SAMPLES_PER_MS));
        const to = Math.ceil(endMs * SAMPLES_PER_MS);
        // PCM arrives in 250 ms events; a live result may get here slightly before its audio.
        for (let waited = 0; pcmBufferRef.current.end < to && waited < 1000; waited += 50) {
            await sleep(50);
        }
        const { samples } = pcmBufferRef.current.read(from, to);
        return samples.length > 0 ? samples : null;
    }, []);
    const getAudioRangeRef = useRef(getAudioRange);
    getAudioRangeRef.current = getAudioRange;

    const registerStopDrain = useCallback((drain: () => Promise<void>) => {
        drainsRef.current.add(drain);
        return () => { drainsRef.current.delete(drain); };
    }, []);

    return {
        isRecording,
        isPaused,
        isFinalizing,
        isActiveRef,
        isRecordingRef,
        isPausedRef,
        subscribeLevel,
        sessionEpoch,
        startRecording,
        stopRecording,
        togglePause,
        addBookmark,
        getAudioSince,
        getAudioRange,
        registerStopDrain
    };
}
