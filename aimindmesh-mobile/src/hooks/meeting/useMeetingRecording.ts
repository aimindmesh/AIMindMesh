import { useState, useRef, useCallback, useEffect } from 'react';
import { Vosk } from 'vosk-capacitor';
import { isVoskSpeakerModelInstalled } from '../../services/speaker/speakerModelDownloader';
import { logger } from '../../services/logger';
import { RecognitionMode, TranscriptionMode } from '../../types/meeting';
import { HighQualityAudioRecorder, RecordingResult, pcmToBase64 } from '../../services/audio/highQualityAudioRecorder';
import { floatToInt16, arrayBufferToBase64 } from '../../services/audio/audioUtils';
import AudioConverter from '../../services/audio/audioConverter';

const MAX_BUFFER_DURATION = 5; // Keep last 5 seconds approx for ONNX analysis
const MAX_WHISPER_BUFFER_DURATION = 60 * 5; // Keep last 5 minutes for Whisper lookback context during active meeting

export interface MeetingRecordingState {
    isRecording: boolean;
    isPaused: boolean;
    audioLevel: number;
    // Legacy refs exposed for external use (some still needed for ONNX analysis)
    mediaRecorderRef: React.MutableRefObject<null>; // Deprecated, kept for interface compatibility
    audioChunksRef: React.MutableRefObject<Blob[]>; // Deprecated
    audioContextRef: React.MutableRefObject<AudioContext | null>;
    audioBufferRef: React.MutableRefObject<Float32Array[]>; // For ONNX speaker analysis
    fullPcmBufferRef: React.MutableRefObject<Float32Array[]>; // For Whisper
    totalBufferedDurationRef: React.MutableRefObject<number>;
    recordingStartTimeRef: React.MutableRefObject<number>;
    animationFrameRef: React.MutableRefObject<number | null>; // Deprecated
    audioProcessorRef: React.MutableRefObject<AudioWorkletNode | null>;
    // Actions
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<void>;
    togglePause: () => void;
    setAudioLevel: (level: number) => void;
    getAudioSince: (sampleOffset: number, maxSamples?: number) => { base64: string, newOffset: number };
}

interface UseMeetingRecordingOptions {
    recognitionModeRef: React.MutableRefObject<RecognitionMode>;
    transcriptionModeRef: React.MutableRefObject<TranscriptionMode>;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onRecordingStopped?: (audioChunks: Blob[], mimeType: string, pcmBlob?: Blob | null, durationMs?: number, filePath?: string) => Promise<void>;
}

/**
 * Hook for managing meeting audio recording with Vosk integration
 * Uses Web Audio API + AudioWorklet for high-quality 16kHz PCM capture
 * 
 * Audio Flow: Microfono → Web Audio API @ 16kHz → AudioWorklet PCM16 → Whisper.cpp → Testo
 */
export function useMeetingRecording({
    recognitionModeRef,
    transcriptionModeRef,
    showToast,
    onRecordingStopped
}: UseMeetingRecordingOptions): MeetingRecordingState {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    // High-quality audio recorder instance
    const recorderRef = useRef<HighQualityAudioRecorder | null>(null);

    // Refs for audio processing and analysis
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBufferRef = useRef<Float32Array[]>([]); // Ring buffer for ONNX speaker analysis
    const fullPcmBufferRef = useRef<Float32Array[]>([]); // Full recording for Whisper
    const totalBufferedDurationRef = useRef<number>(0);
    const recordingStartTimeRef = useRef<number>(0);
    const audioProcessorRef = useRef<AudioWorkletNode | null>(null);

    // Legacy refs (kept for interface compatibility but deprecated)
    const mediaRecorderRef = useRef<null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const animationFrameRef = useRef<number | null>(null);



    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (recorderRef.current) {
                recorderRef.current.cleanup();
            }
            // Ensure Vosk stops when component unmounts
            Vosk.stopRecognition().catch(console.warn);
        };
    }, []);

    const startRecording = useCallback(async () => {
        const recognitionMode = recognitionModeRef.current;
        const transcriptionMode = transcriptionModeRef.current;

        // Determine if we need Vosk or Voxtral
        // We need Vosk if:
        // 1. Transcription is set to 'vosk'
        // 2. Speaker recognition is 'fast' (uses Vosk model)
        const isVoskNeeded = transcriptionMode === 'vosk' || recognitionMode === 'fast';
        const isVoxtralNeeded = transcriptionMode === 'voxtral';

        try {
            if (isVoxtralNeeded) {
                // Initialize Voxtral STT
                try {
                    logger.log('info', 'Initializing Voxtral STT for real-time transcription');
                    const { getVoxtralSttService } = await import('../../services/stt/voxtralSTT');
                    const voxtralService = getVoxtralSttService();

                    // Start Voxtral streaming with transcript callback
                    await voxtralService.start((transcript: string, tokens: any[]) => {
                        logger.log('debug', `Voxtral transcript: ${transcript.substring(0, 50)}... tokens: ${tokens?.length}`);
                    });
                    logger.log('info', 'Voxtral STT started successfully');
                } catch (voxtralError) {
                    logger.log('error', 'Failed to initialize Voxtral, fallback may not work', voxtralError);
                    showToast('Voxtral initialization failed', 'error');
                }
            } else if (isVoskNeeded) {
                // Re-check microphone permission
                try {
                    const status = await (Vosk as any).checkPermissions();
                    if (status.microphone !== 'granted') {
                        const request = await (Vosk as any).requestPermissions();
                        if (request.microphone !== 'granted') {
                            showToast('Permesso microfono negato', 'error');
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('Vosk permission check failed, proceeding anyway:', e);
                }

                try {
                    if (recognitionMode === 'fast') {
                        const isInstalled = await isVoskSpeakerModelInstalled();
                        if (isInstalled) {
                            logger.log('info', 'Loading Vosk speaker model for fast diarization');
                            await (Vosk as any).loadSpeakerModel({ modelPath: 'vosk-models/vosk-model-spk-0.4' });
                        } else {
                            logger.log('warn', 'Vosk speaker model not installed, falling back to RMS diarization');
                        }
                    } else {
                        // If precise, we might still be here if transcriptionMode is vosk
                        // Ensure speaker model is unloaded if we don't want 'fast' mode
                        try {
                            const speakerStatus = await (Vosk as any).isSpeakerModelLoaded();
                            if (speakerStatus.loaded) {
                                logger.log('info', 'Unloading Vosk speaker model');
                                await (Vosk as any).unloadSpeakerModel();
                            }
                        } catch (e) {
                            // Method might not exist or fail, ignore
                        }
                    }
                } catch (e) {
                    logger.log('warn', 'Failed to configure speaker model', e);
                }

                // Start Vosk transcription
                logger.log('info', 'Starting Vosk...');
                await Vosk.startRecognition();
            } else {
                logger.log('info', 'Vosk not needed (Whisper/Off mode + Precise/Off speakers), skipping Vosk start');
                // Note: We won't get 'audioLevel' events from Vosk, but HighQualityAudioRecorder provides them via callback
            }

            setIsRecording(true);
            setIsPaused(false);

            // Initialize high-quality audio recording with AudioWorklet
            try {
                // Start streaming to file
                await AudioConverter.startWriting({ sampleRate: 16000, channels: 1 });

                // Create recorder with Whisper-optimal settings
                const recorder = new HighQualityAudioRecorder({
                    sampleRate: 16000,  // Whisper optimal sample rate
                    channels: 1,        // Mono
                    echoCancellation: false,  // Raw audio for better quality
                    noiseSuppression: false,
                    autoGainControl: false,
                    disableInternalStorage: true
                });
                recorderRef.current = recorder;

                // Initialize the recorder (sets up AudioWorklet)
                await recorder.init();

                // Store audio context reference for external access
                audioContextRef.current = (recorder as any).audioContext;
                audioProcessorRef.current = (recorder as any).workletNode;

                // Initialize buffers
                audioBufferRef.current = [];
                fullPcmBufferRef.current = [];
                totalBufferedDurationRef.current = 0;

                // Start recording with audio level callback and data callback
                recorder.start(
                    (level) => setAudioLevel(level),
                    (progress) => {
                        logger.log('debug', `Recording progress: ${progress.durationSeconds.toFixed(1)}s`);
                    },
                    (int16Data: Int16Array) => {
                        // Received real-time audio chunk from recorder

                        // Stream to file (async, no await to avoid blocking audio thread too much)
                        const base64Data = pcmToBase64(int16Data);
                        AudioConverter.writeChunk({ data: base64Data }).catch(e => {
                            console.error('Failed to write audio chunk', e);
                        });

                        // Convert Int16 to Float32 for ONNX analysis and internal processing
                        const float32Data = new Float32Array(int16Data.length);
                        for (let i = 0; i < int16Data.length; i++) {
                            float32Data[i] = int16Data[i] / 32768.0;
                        }

                        // Store for Whisper, but bounded to prevent OOM
                        fullPcmBufferRef.current.push(float32Data);
                        let totalWhisperSamples = fullPcmBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
                        const maxWhisperSamples = MAX_WHISPER_BUFFER_DURATION * 16000;

                        while (totalWhisperSamples > maxWhisperSamples && fullPcmBufferRef.current.length > 0) {
                            const removed = fullPcmBufferRef.current.shift();
                            if (removed) {
                                totalWhisperSamples -= removed.length;
                            }
                        }

                        // Update ring buffer for ONNX speaker recognition
                        // Only needed if we are doing speaker recognition
                        if (recognitionModeRef.current !== 'off') {
                            audioBufferRef.current.push(float32Data);
                            totalBufferedDurationRef.current += float32Data.length / 16000;

                            // Trim ring buffer to max duration
                            while (totalBufferedDurationRef.current > MAX_BUFFER_DURATION && audioBufferRef.current.length > 0) {
                                const removed = audioBufferRef.current.shift();
                                if (removed) {
                                    totalBufferedDurationRef.current -= removed.length / 16000;
                                }
                            }
                        }
                    }
                );

                console.log('debug', 'HighQualityAudioRecorder started with data callback');
                recordingStartTimeRef.current = Date.now();

                logger.log('info', recognitionMode === 'off'
                    ? 'Meeting recording started (AudioWorklet @ 16kHz - battery saving mode)'
                    : 'Meeting recording started (Vosk + AudioWorklet @ 16kHz)');

            } catch (audioError) {
                logger.log('error', 'AudioWorklet recording failed', audioError);
                showToast('Error starting audio recording', 'error');

                // Cleanup on failure
                if (recorderRef.current) {
                    await recorderRef.current.cleanup();
                    recorderRef.current = null;
                }
            }


        } catch (error) {
            logger.log('error', 'Failed to start recording', error);
            showToast('Error starting recording', 'error');
        }
    }, [recognitionModeRef, transcriptionModeRef, showToast]);

    const stopRecording = useCallback(async () => {
        if (!isRecording) return;

        try {
            // Determine if Vosk was needed/started based on refs (state might have changed, but usually mode stays same during rec)
            // We should check if we actually started it. 
            // Ideally we'd track 'isVoskRunning' ref, but checking logic is safe enough:
            // If we were in vosk mode or fast mode, we probably started it.
            // Asking Vosk to stop if not started usually just warns or does nothing.
            // Let's just try stopping it if mode implies it.
            const currentRecMode = recognitionModeRef.current;
            const currentTransMode = transcriptionModeRef.current;

            // Stop Voxtral if it was running
            if (currentTransMode === 'voxtral') {
                try {
                    const { getVoxtralSttService } = await import('../../services/stt/voxtralSTT');
                    const voxtralService = getVoxtralSttService();
                    await voxtralService.stop();
                    logger.log('info', 'Voxtral STT stopped');
                } catch (e) {
                    console.warn('Error stopping Voxtral:', e);
                }
            }

            // Stop Vosk if it was running
            if (currentTransMode === 'vosk' || currentRecMode === 'fast') {
                await Vosk.stopRecognition().catch((e: any) => console.warn('Error stopping Vosk (might not be running):', e));
            }

            setIsRecording(false);
            setIsPaused(false);

            // Stop AudioWorklet recording and get result
            if (recorderRef.current && recorderRef.current.isCurrentlyRecording()) {
                try {
                    const result: RecordingResult = await recorderRef.current.stop();

                    // Finish writing file
                    let savedFilePath: string | undefined;
                    try {
                        const fileResult = await AudioConverter.finishWriting();
                        savedFilePath = fileResult.filePath;
                        logger.log('info', `Audio saved to file: ${savedFilePath}, duration: ${fileResult.durationMs}ms`);
                    } catch (e) {
                        logger.log('error', 'Failed to finish writing audio file', e);
                    }

                    logger.log('info', `Audio recording stopped: ${result.blob.size} bytes, ${result.durationMs}ms, ${result.sampleCount} samples`);

                    if (onRecordingStopped) {
                        // Call the callback with WAV blob and file path
                        await onRecordingStopped(
                            [], // audioChunks (deprecated, now empty)
                            'audio/wav', // mimeType
                            result.blob, // pcmBlob (WAV format at 16kHz)
                            result.durationMs,
                            savedFilePath // Pass file path
                        );
                    }

                    showToast('Recording completed', 'success');
                } catch (stopError) {
                    logger.log('error', 'Error stopping recording', stopError);

                    // Try to provide fallback data from fullPcmBufferRef
                    if (onRecordingStopped && fullPcmBufferRef.current.length > 0) {
                        const pcmBlob = createWavBlobFromFloat32(fullPcmBufferRef.current, 16000);
                        const durationMs = Date.now() - recordingStartTimeRef.current;
                        await onRecordingStopped([], 'audio/wav', pcmBlob, durationMs);
                    }
                }

                // Cleanup recorder
                await recorderRef.current.cleanup();
                recorderRef.current = null;
            }



            // Reset audio level
            setAudioLevel(0);
            audioContextRef.current = null;
            audioProcessorRef.current = null;

            logger.log('info', 'Meeting recording stopped');
        } catch (error) {
            logger.log('error', 'Failed to stop recording', error);
        }
    }, [isRecording, recognitionModeRef, transcriptionModeRef, showToast, onRecordingStopped]);

    const togglePause = useCallback(() => {
        if (isPaused) {
            setIsPaused(false);
        } else {
            setIsPaused(true);
        }
    }, [isPaused]);

    const getAudioSince = useCallback((sampleOffset: number, maxSamples?: number) => {
        const chunks = fullPcmBufferRef.current;
        let totalSamples = 0;
        chunks.forEach(c => totalSamples += c.length);

        if (sampleOffset >= totalSamples) {
            return { base64: '', newOffset: totalSamples };
        }

        // Limit data if maxSamples provided
        let samplesToTake = totalSamples - sampleOffset;
        if (maxSamples && samplesToTake > maxSamples) {
            samplesToTake = maxSamples;
        }

        // Flatten full buffer (optimization: could just slice relevant chunks but this is safer for boundary issues)
        // For performance in long meetings, we might want to optimize this to only process needed chunks
        // But since we need a single Float32Array to convert to Int16, we probably need to copy anyway.
        // Let's try to be smart finding start chunk.

        let currentCount = 0;
        let startIndex = 0;
        let startInChunkOffset = 0;

        for (let i = 0; i < chunks.length; i++) {
            if (currentCount + chunks[i].length > sampleOffset) {
                startIndex = i;
                startInChunkOffset = sampleOffset - currentCount;
                break;
            }
            currentCount += chunks[i].length;
        }

        // Collect needed data
        const result = new Float32Array(samplesToTake);
        let resultOffset = 0;
        let remainingToCopy = samplesToTake;
        let idx = startIndex;

        // First chunk (partial)
        if (idx < chunks.length) {
            const firstChunk = chunks[idx];
            const available = firstChunk.length - startInChunkOffset;
            const toCopy = Math.min(available, remainingToCopy);

            result.set(firstChunk.subarray(startInChunkOffset, startInChunkOffset + toCopy), resultOffset);
            resultOffset += toCopy;
            remainingToCopy -= toCopy;
            idx++;
        }

        // Rest of chunks
        while (remainingToCopy > 0 && idx < chunks.length) {
            const chunk = chunks[idx];
            const toCopy = Math.min(chunk.length, remainingToCopy);

            result.set(chunk.subarray(0, toCopy), resultOffset);
            resultOffset += toCopy;
            remainingToCopy -= toCopy;
            idx++;
        }

        // Convert to Int16 Base64
        const int16 = floatToInt16(result);
        const base64 = arrayBufferToBase64(int16.buffer as ArrayBuffer);

        return { base64, newOffset: sampleOffset + samplesToTake };

    }, []);

    return {
        isRecording,
        isPaused,
        audioLevel,
        mediaRecorderRef,
        audioChunksRef,
        audioContextRef,
        audioBufferRef,
        totalBufferedDurationRef,
        recordingStartTimeRef,
        animationFrameRef,
        audioProcessorRef,
        startRecording,
        stopRecording,
        togglePause,
        setAudioLevel,
        fullPcmBufferRef,
        getAudioSince
    };
}

/**
 * Helper to create WAV blob from Float32 audio chunks
 */
function createWavBlobFromFloat32(chunks: Float32Array[], sampleRate: number): Blob {
    // Merge all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert to Int16
    const int16 = new Int16Array(totalLength);
    for (let i = 0; i < totalLength; i++) {
        const s = Math.max(-1, Math.min(1, merged[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Create WAV header
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = totalLength * 2;

    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    return new Blob([wavHeader, int16], { type: 'audio/wav' });
}
