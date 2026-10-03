import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Vosk } from 'vosk-capacitor';
import { isVoskSpeakerModelInstalled } from '../../services/speaker/speakerModelDownloader';
import { logger } from '../../services/logger';
import { RecognitionMode, TranscriptionMode, TranscriptSegment } from '../../types/meeting';
import { HighQualityAudioRecorder, pcmToBase64 } from '../../services/audio/highQualityAudioRecorder';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import AudioConverter from '../../services/audio/audioConverter';
import { meetingAudioConverter } from '../../services/meeting/recordingRecovery';
import { appendBounded, countSamples, createWavBlobFromFloat32, readRange, readSince } from '../../services/meeting/pcmBuffer';
import { MeetingTimeline } from '../../services/meeting/meetingTimeline';
import { startMeetingForegroundService, stopMeetingForegroundService } from '../../services/meeting/meetingForegroundService';
import { startVoxtralMeeting, stopVoxtralMeeting } from './voxtralMeetingSession';
import { pin } from '../../services/model/modelOrchestrator';

const SAMPLE_RATE = 16000;
const MAX_BUFFER_DURATION = 10; // ONNX embeddings need a 2.5 s window + Vosk finalResult latency
const MAX_WHISPER_BUFFER_DURATION = 60 * 5; // Last 5 minutes kept for Whisper during the meeting
/** Audio reaches JS once per worklet chunk: 1 s keeps speaker-embedding windows on the speech */
const CHUNK_INTERVAL_SAMPLES = SAMPLE_RATE;
/** Upper bound for the transcription tails (Whisper, Vosk) before the stop-save */
const STOP_DRAIN_TIMEOUT_MS = 20000;

export interface RecordingStopResult {
    /** Native recording file (absent when finalizing it failed) */
    filePath?: string;
    /** In-memory WAV of the last minutes, only when there is no file */
    pcmBlob: Blob | null;
    durationMs: number;
}

export interface MeetingRecordingState {
    isRecording: boolean;
    isPaused: boolean;
    /** Starting or finalizing: a new recording must not start meanwhile */
    isBusy: boolean;
    audioLevel: number;
    isRecordingRef: MutableRefObject<boolean>;
    isPausedRef: MutableRefObject<boolean>;
    isBusyRef: MutableRefObject<boolean>;
    audioBufferRef: MutableRefObject<Float32Array[]>; // Last seconds, for ONNX speaker analysis
    totalBufferedDurationRef: MutableRefObject<number>;
    fullPcmBufferRef: MutableRefObject<Float32Array[]>; // Last minutes, for Whisper
    recordingStartTimeRef: MutableRefObject<number>;
    timelineRef: MutableRefObject<MeetingTimeline>;
    startRecording: () => Promise<boolean>;
    stopRecording: () => Promise<void>;
    togglePause: () => void;
    setAudioLevel: (level: number) => void;
    /** Audio from an absolute sample offset (counted from the recording start) */
    getAudioSince: (sampleOffset: number, maxSamples?: number) => { base64: string; startOffset: number; newOffset: number };
    /** Absolute [start, end) samples still held in memory */
    getAudioRange: (startSample: number, endSample: number) => Float32Array;
    /** Absolute number of samples received so far */
    getReceivedSamples: () => number;
    /** Work that must finish before the stop-save (transcription tails); returns the unregister */
    registerStopDrain: (drain: () => Promise<void>) => () => void;
}

interface UseMeetingRecordingOptions {
    recognitionModeRef: MutableRefObject<RecognitionMode>;
    transcriptionModeRef: MutableRefObject<TranscriptionMode>;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onRecordingStopped?: (result: RecordingStopResult) => Promise<void>;
    /** Transcript setter for Voxtral real-time transcription */
    setTranscript?: Dispatch<SetStateAction<TranscriptSegment[]>>;
    diarizationRef?: MutableRefObject<any>;
    /** Meeting the recording belongs to: written into the native file name for crash recovery */
    getMeetingId?: () => string | null;
}

/**
 * Meeting audio recording: AudioWorklet @ 16 kHz streamed to a native file, with Vosk or Voxtral
 * transcribing alongside. Stopping (or leaving the screen) always finishes the file and hands it
 * to the saver.
 */
export function useMeetingRecording({
    recognitionModeRef,
    transcriptionModeRef,
    showToast,
    onRecordingStopped,
    setTranscript,
    diarizationRef,
    getMeetingId
}: UseMeetingRecordingOptions): MeetingRecordingState {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    const isRecordingRef = useRef(false);
    const isPausedRef = useRef(false);
    const isBusyRef = useRef(false);
    const unmountedRef = useRef(false);
    const voskStartedRef = useRef(false);
    const voxtralStartedRef = useRef(false);

    const recorderRef = useRef<HighQualityAudioRecorder | null>(null);
    const audioBufferRef = useRef<Float32Array[]>([]);
    const fullPcmBufferRef = useRef<Float32Array[]>([]);
    const droppedSamplesRef = useRef(0);
    const totalBufferedDurationRef = useRef(0);
    const recordingStartTimeRef = useRef(0);
    const timelineRef = useRef(new MeetingTimeline());
    const drainsRef = useRef(new Set<() => Promise<void>>());

    // Callbacks read through refs: the unmount path runs after the last render
    const onStoppedRef = useRef(onRecordingStopped);
    onStoppedRef.current = onRecordingStopped;
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;
    const getMeetingIdRef = useRef(getMeetingId);
    getMeetingIdRef.current = getMeetingId;

    const setBusy = useCallback((busy: boolean) => {
        isBusyRef.current = busy;
        setIsBusy(busy);
    }, []);

    const stopEngines = useCallback(async () => {
        if (voxtralStartedRef.current) {
            voxtralStartedRef.current = false;
            await stopVoxtralMeeting();
        }
        if (voskStartedRef.current) {
            voskStartedRef.current = false;
            // Vosk emits the utterance still in progress before this resolves
            await Vosk.stopRecognition().catch((e: any) => logger.log('warn', 'Error stopping Vosk', e));
        }
    }, []);

    const handleChunk = useCallback((int16Data: Int16Array) => {
        // Paused audio must reach neither the file nor the transcription buffers
        const ranges = timelineRef.current.keptSampleRanges(Date.now(), int16Data.length, SAMPLE_RATE);
        if (ranges.length === 0) return;
        let kept = int16Data;
        if (ranges.length !== 1 || ranges[0][0] !== 0 || ranges[0][1] !== int16Data.length) {
            kept = new Int16Array(ranges.reduce((acc, [a, b]) => acc + b - a, 0));
            let offset = 0;
            for (const [a, b] of ranges) {
                kept.set(int16Data.subarray(a, b), offset);
                offset += b - a;
            }
        }

        // Stream to file (no await: the bridge keeps the call order)
        AudioConverter.writeChunk({ data: pcmToBase64(kept) }).catch(e => {
            logger.log('error', 'Failed to write audio chunk', e);
        });

        const float32Data = new Float32Array(kept.length);
        for (let i = 0; i < kept.length; i++) float32Data[i] = kept[i] / 32768.0;

        droppedSamplesRef.current += appendBounded(fullPcmBufferRef.current, float32Data, MAX_WHISPER_BUFFER_DURATION * SAMPLE_RATE);

        // Ring buffer for ONNX speaker recognition
        if (recognitionModeRef.current !== 'off') {
            audioBufferRef.current.push(float32Data);
            totalBufferedDurationRef.current += float32Data.length / SAMPLE_RATE;
            while (totalBufferedDurationRef.current > MAX_BUFFER_DURATION && audioBufferRef.current.length > 1) {
                const removed = audioBufferRef.current.shift()!;
                totalBufferedDurationRef.current -= removed.length / SAMPLE_RATE;
            }
        }
    }, [recognitionModeRef]);

    const startVosk = useCallback(async (recognitionMode: RecognitionMode): Promise<boolean> => {
        try {
            const status = await (Vosk as any).checkPermissions();
            if (status.microphone !== 'granted') {
                const request = await (Vosk as any).requestPermissions();
                if (request.microphone !== 'granted') {
                    showToastRef.current('Permesso microfono negato', 'error');
                    return false;
                }
            }
        } catch (e) {
            logger.log('warn', 'Vosk permission check failed, proceeding anyway', e);
        }

        try {
            if (recognitionMode === 'fast') {
                if (await isVoskSpeakerModelInstalled()) {
                    logger.log('info', 'Loading Vosk speaker model for fast diarization');
                    await (Vosk as any).loadSpeakerModel({ modelPath: 'vosk-models/vosk-model-spk-0.4' });
                } else {
                    logger.log('warn', 'Vosk speaker model not installed, falling back to RMS diarization');
                }
            } else {
                // Speaker vectors only belong to 'fast' mode
                const speakerStatus = await (Vosk as any).isSpeakerModelLoaded().catch(() => ({ loaded: false }));
                if (speakerStatus.loaded) await (Vosk as any).unloadSpeakerModel();
            }
        } catch (e) {
            logger.log('warn', 'Failed to configure speaker model', e);
        }

        logger.log('info', 'Starting Vosk...');
        await Vosk.startRecognition();
        voskStartedRef.current = true;
        // Vosk word times count from here
        timelineRef.current.setVoskStart(Date.now());
        return true;
    }, []);

    const startAudioCapture = useCallback(async (): Promise<boolean> => {
        const recorder = new HighQualityAudioRecorder({
            sampleRate: SAMPLE_RATE,
            channels: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            disableInternalStorage: true,
            chunkIntervalSamples: CHUNK_INTERVAL_SAMPLES
        });
        try {
            // Microphone first: if it fails no native file is left open
            await recorder.init();
            await meetingAudioConverter.startWriting({
                sampleRate: SAMPLE_RATE,
                channels: 1,
                meetingId: getMeetingIdRef.current?.() ?? undefined,
                startedAt: Date.now()
            });
        } catch (audioError) {
            logger.log('error', 'AudioWorklet recording failed', audioError);
            await recorder.cleanup().catch(() => { });
            showToastRef.current('Error starting audio recording', 'error');
            return false;
        }

        recorderRef.current = recorder;
        audioBufferRef.current = [];
        fullPcmBufferRef.current = [];
        droppedSamplesRef.current = 0;
        totalBufferedDurationRef.current = 0;

        recorder.start(
            (level) => {
                if (isPausedRef.current) return;
                setAudioLevel(level);
                // Without Vosk this is the only level source for the RMS speaker fallback
                if (!voskStartedRef.current) diarizationRef?.current?.recordRmsValue(level);
            },
            undefined,
            handleChunk
        );
        recordingStartTimeRef.current = Date.now();
        timelineRef.current.setFileStart(recordingStartTimeRef.current);
        return true;
    }, [diarizationRef, handleChunk]);

    const sttPinRef = useRef<(() => void) | null>(null);

    const startRecording = useCallback(async (): Promise<boolean> => {
        // A second tap while models load used to start a second recorder and leak the mic
        if (isRecordingRef.current || isBusyRef.current) return false;
        setBusy(true);
        const recognitionMode = recognitionModeRef.current;
        const transcriptionMode = transcriptionModeRef.current;
        const needsVosk = transcriptionMode === 'vosk' || transcriptionMode === 'hybrid' || recognitionMode === 'fast';
        timelineRef.current = new MeetingTimeline();

        try {
            if (transcriptionMode === 'voxtral') {
                try {
                    logger.log('info', 'Initializing Voxtral STT for real-time transcription');
                    await startVoxtralMeeting({
                        setTranscript,
                        diarizationRef,
                        recognitionModeRef,
                        audioBufferRef,
                        isPausedRef,
                        timelineRef
                    });
                    voxtralStartedRef.current = true;
                } catch (voxtralError) {
                    logger.log('error', 'Failed to initialize Voxtral, recording audio only', voxtralError);
                    showToastRef.current('Voxtral initialization failed', 'error');
                }
            } else if (needsVosk) {
                if (!(await startVosk(recognitionMode))) return false;
            }

            const captured = !unmountedRef.current && await startAudioCapture();
            if (!captured || unmountedRef.current) {
                if (captured) {
                    await recorderRef.current?.cleanup();
                    recorderRef.current = null;
                    await AudioConverter.finishWriting().catch(() => { });
                }
                await stopEngines();
                return false;
            }

            isRecordingRef.current = true;
            isPausedRef.current = false;
            setIsRecording(true);
            setIsPaused(false);
            void startMeetingForegroundService();
            // The speech model stays in RAM until the recording is saved (an LLM request waits)
            sttPinRef.current?.();
            sttPinRef.current = transcriptionMode === 'voxtral' ? pin('voxtral')
                : (transcriptionMode === 'whisper' || transcriptionMode === 'hybrid') ? pin('whisper') : null;
            logger.log('info', recognitionMode === 'off'
                ? 'Meeting recording started (AudioWorklet @ 16kHz - battery saving mode)'
                : 'Meeting recording started (AudioWorklet @ 16kHz)');
            return true;
        } catch (error) {
            logger.log('error', 'Failed to start recording', error);
            showToastRef.current('Error starting recording', 'error');
            await stopEngines();
            return false;
        } finally {
            setBusy(false);
        }
    }, [recognitionModeRef, transcriptionModeRef, setTranscript, diarizationRef, setBusy, startVosk, startAudioCapture, stopEngines]);

    const runDrains = useCallback(async () => {
        const drains = [...drainsRef.current].map(drain => drain().catch(e => logger.log('warn', 'Stop drain failed', e)));
        if (drains.length === 0) return;
        await Promise.race([
            Promise.all(drains),
            new Promise(resolve => setTimeout(resolve, STOP_DRAIN_TIMEOUT_MS))
        ]);
    }, []);

    /** Stops everything, finalizes the file, waits for the transcription tails, then saves. */
    const finishRecording = useCallback(async () => {
        isRecordingRef.current = false;
        if (isPausedRef.current) timelineRef.current.resume(Date.now());
        isPausedRef.current = false;
        setIsRecording(false);
        setIsPaused(false);
        setAudioLevel(0);

        await stopEngines();

        const recorder = recorderRef.current;
        recorderRef.current = null;
        let durationMs = timelineRef.current.wallToFileMs(Date.now());
        let filePath: string | undefined;
        let pcmBlob: Blob | null = null;

        if (recorder) {
            try {
                // Delivers the last chunk to handleChunk before resolving
                await recorder.stop();
            } catch (stopError) {
                logger.log('error', 'Error stopping recording', stopError);
            }
            try {
                const fileResult = await AudioConverter.finishWriting();
                filePath = fileResult.filePath;
                if (fileResult.durationMs > 0) durationMs = fileResult.durationMs;
                logger.log('info', `Audio saved to file: ${filePath}, duration: ${durationMs}ms`);
            } catch (e) {
                logger.log('error', 'Failed to finish writing audio file', e);
                // Last resort: only the last minutes are still in memory
                if (countSamples(fullPcmBufferRef.current) > 0) {
                    pcmBlob = createWavBlobFromFloat32(fullPcmBufferRef.current, SAMPLE_RATE);
                }
            }
            await recorder.cleanup().catch(() => { });
        }

        void stopMeetingForegroundService();
        await runDrains();

        try {
            await onStoppedRef.current?.({ filePath, pcmBlob, durationMs });
            if (filePath || pcmBlob) showToastRef.current('Recording completed', 'success');
        } catch (error) {
            logger.log('error', 'Failed to handle the stopped recording', error);
        }
        sttPinRef.current?.();
        sttPinRef.current = null;
        logger.log('info', 'Meeting recording stopped');
    }, [stopEngines, runDrains]);

    const finishRecordingRef = useRef(finishRecording);
    finishRecordingRef.current = finishRecording;

    const stopRecording = useCallback(async () => {
        if (!isRecordingRef.current) return;
        setBusy(true);
        try {
            await finishRecording();
        } finally {
            setBusy(false);
        }
    }, [finishRecording, setBusy]);

    // Unmount: leaving the screen must not discard the meeting being recorded
    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            if (isRecordingRef.current) {
                isBusyRef.current = true;
                void finishRecordingRef.current().finally(() => { isBusyRef.current = false; });
                return;
            }
            if (recorderRef.current) recorderRef.current.cleanup().catch(() => { });
            if (voskStartedRef.current) Vosk.stopRecognition().catch(() => { });
        };
    }, []);

    const togglePause = useCallback(() => {
        if (!isRecordingRef.current) return;
        const now = Date.now();
        const pausing = !isPausedRef.current;
        if (pausing) timelineRef.current.pause(now);
        else timelineRef.current.resume(now);
        isPausedRef.current = pausing;
        setIsPaused(pausing);
        if (pausing) setAudioLevel(0);
    }, []);

    const getAudioSince = useCallback((sampleOffset: number, maxSamples?: number) => {
        const read = readSince(fullPcmBufferRef.current, droppedSamplesRef.current, sampleOffset, maxSamples);
        const base64 = read.samples.length > 0
            ? arrayBufferToBase64(floatToInt16(read.samples).buffer as ArrayBuffer)
            : '';
        return { base64, startOffset: read.startOffset, newOffset: read.newOffset };
    }, []);

    const getAudioRange = useCallback((startSample: number, endSample: number) =>
        readRange(fullPcmBufferRef.current, droppedSamplesRef.current, startSample, endSample), []);

    const getReceivedSamples = useCallback(
        () => droppedSamplesRef.current + countSamples(fullPcmBufferRef.current), []);

    const registerStopDrain = useCallback((drain: () => Promise<void>) => {
        drainsRef.current.add(drain);
        return () => { drainsRef.current.delete(drain); };
    }, []);

    return {
        isRecording,
        isPaused,
        isBusy,
        audioLevel,
        isRecordingRef,
        isPausedRef,
        isBusyRef,
        audioBufferRef,
        totalBufferedDurationRef,
        fullPcmBufferRef,
        recordingStartTimeRef,
        timelineRef,
        startRecording,
        stopRecording,
        togglePause,
        setAudioLevel,
        getAudioSince,
        getAudioRange,
        getReceivedSamples,
        registerStopDrain
    };
}
