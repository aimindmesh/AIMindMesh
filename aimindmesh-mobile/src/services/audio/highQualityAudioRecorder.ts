/**
 * High Quality Audio Recorder using Web Audio API + AudioWorklet
 * Optimized for Whisper transcription (16kHz, PCM16, mono)
 * 
 * Flow: Microfono → Web Audio API @ 16kHz → AudioWorklet PCM16 → Whisper.cpp → Testo
 */

import { logger } from '../logger';

/**
 * Configuration options for the audio recorder
 */
export interface AudioRecorderConfig {
    /** Sample rate in Hz (default: 16000 for Whisper) */
    sampleRate?: number;
    /** Number of audio channels (default: 1 for mono) */
    channels?: number;
    /** Enable echo cancellation (default: false for raw quality) */
    echoCancellation?: boolean;
    /** Enable noise suppression (default: false for raw quality) */
    noiseSuppression?: boolean;
    /** Enable auto gain control (default: false for raw quality) */
    autoGainControl?: boolean;
    /** Disable internal memory accumulation (default: false) - use for streaming/long recordings */
    disableInternalStorage?: boolean;
}

/**
 * Recording result containing the audio blob and metadata
 */
export interface RecordingResult {
    /** WAV audio blob */
    blob: Blob;
    /** Duration in milliseconds */
    durationMs: number;
    /** Sample rate in Hz */
    sampleRate: number;
    /** Number of samples */
    sampleCount: number;
    /** Raw PCM16 data as Int16Array */
    pcmData: Int16Array;
}

/**
 * Progress callback data
 */
export interface RecordingProgress {
    /** Current recording duration in seconds */
    durationSeconds: number;
    /** Whether recording is still in progress */
    isRecording: boolean;
}

/**
 * High Quality Audio Recorder
 * Uses AudioWorklet for real-time PCM16 capture at 16kHz
 */
export class HighQualityAudioRecorder {
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private analyserNode: AnalyserNode | null = null;
    private mediaStream: MediaStream | null = null;
    private isRecording = false;
    private isInitialized = false;
    private recordingStartTime = 0;

    // Audio data accumulator
    private recordedAudio: number[] = [];
    private resolveRecording: ((result: RecordingResult) => void) | null = null;

    // Configuration
    private config: Required<AudioRecorderConfig>;

    // Audio level monitoring
    private animationFrameId: number | null = null;
    private audioLevelCallback: ((level: number) => void) | null = null;

    // Progress callback
    private progressCallback: ((progress: RecordingProgress) => void) | null = null;

    // Real-time audio data callback
    private audioDataCallback: ((data: Int16Array) => void) | null = null;

    constructor(config: AudioRecorderConfig = {}) {
        this.config = {
            sampleRate: config.sampleRate ?? 16000, // Whisper optimal
            channels: config.channels ?? 1, // Mono for Whisper
            echoCancellation: config.echoCancellation ?? false,
            noiseSuppression: config.noiseSuppression ?? false,
            autoGainControl: config.autoGainControl ?? false,
            disableInternalStorage: config.disableInternalStorage ?? false
        };

        logger.log('info', 'HighQualityAudioRecorder created', this.config);
    }

    /**
     * Initialize the audio recorder
     * Must be called before start()
     */
    async init(): Promise<void> {
        if (this.isInitialized) {
            logger.log('debug', 'AudioRecorder already initialized');
            return;
        }

        try {
            // Create AudioContext with optimal sample rate for Whisper
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass({
                sampleRate: this.config.sampleRate
            });

            // Ensure context is running
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            logger.log('info', `AudioContext created: state=${this.audioContext.state}, sampleRate=${this.audioContext.sampleRate}Hz`);

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: this.config.echoCancellation,
                    noiseSuppression: this.config.noiseSuppression,
                    autoGainControl: this.config.autoGainControl,
                    sampleRate: this.config.sampleRate,
                    channelCount: this.config.channels
                }
            });

            // Create media stream source
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Load the AudioWorklet processor
            // The worklet file must be served from the same origin
            await this.audioContext.audioWorklet.addModule('/audio-worklet.js');
            logger.log('info', 'AudioWorklet module loaded');

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(
                this.audioContext,
                'audio-recorder',
                {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    channelCount: this.config.channels,
                    channelCountMode: 'explicit'
                }
            );

            // Create analyser for audio level visualization
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 256;

            // Connect the audio graph:
            // Source -> Analyser -> Worklet -> Destination (muted)
            this.mediaStreamSource.connect(this.analyserNode);
            this.analyserNode.connect(this.workletNode);

            // Connect to destination with zero gain to keep the graph active
            // but not produce any audible output
            const zeroGain = this.audioContext.createGain();
            zeroGain.gain.value = 0;
            this.workletNode.connect(zeroGain);
            zeroGain.connect(this.audioContext.destination);

            // Handle messages from the worklet
            this.workletNode.port.onmessage = (event) => {
                if (event.data.audioChunk !== undefined) {
                    // Streaming chunk received (new protocol for long recordings)
                    const chunk = event.data.audioChunk;
                    const isFinal = event.data.isFinal === true;

                    logger.log('debug', `Received audio chunk: ${chunk.length} samples, isFinal: ${isFinal}`);

                    // Accumulate chunks
                    if (chunk.length > 0) {
                        if (chunk instanceof Int16Array) {
                            // Emit real-time chunk
                            if (this.audioDataCallback) {
                                this.audioDataCallback(chunk);
                            }
                            // Store for full recording (still suboptimal for large files but keeping behavior for now)
                            if (!this.config.disableInternalStorage) {
                                for (let i = 0; i < chunk.length; i++) {
                                    this.recordedAudio.push(chunk[i]);
                                }
                            }
                        } else if (Array.isArray(chunk)) {
                            // Convert to Int16 for consistency if array
                            const int16 = new Int16Array(chunk);
                            if (this.audioDataCallback) {
                                this.audioDataCallback(int16);
                            }
                            if (!this.config.disableInternalStorage) {
                                this.recordedAudio.push(...chunk);
                            }
                        }
                    }

                    // If this is the final chunk, complete the recording
                    if (isFinal) {
                        logger.log('info', `All audio received: ${this.recordedAudio.length} total samples`);
                        this.handleRecordingComplete(this.recordedAudio.length);
                    }
                } else if (event.data.audioData !== undefined) {
                    // Legacy single-shot protocol (backward compatibility)
                    const audioData = event.data.audioData;
                    logger.log('info', `Received audio data (legacy): ${audioData.length} samples`);

                    if (audioData instanceof Int16Array) {
                        this.recordedAudio = Array.from(audioData);
                    } else if (Array.isArray(audioData)) {
                        this.recordedAudio = audioData;
                    } else {
                        logger.log('warn', 'Unexpected audio data type:', typeof audioData);
                        this.recordedAudio = [];
                    }

                    this.handleRecordingComplete(event.data.sampleCount || this.recordedAudio.length);
                } else if (event.data.progress) {
                    // Progress update
                    if (this.progressCallback) {
                        this.progressCallback({
                            durationSeconds: event.data.durationSeconds,
                            isRecording: true
                        });
                    }
                } else if (event.data.status === 'recording') {
                    logger.log('debug', 'Worklet confirmed recording started');
                }
            };

            this.isInitialized = true;
            logger.log('info', `✅ HighQualityAudioRecorder initialized @ ${this.audioContext.sampleRate}Hz`);

        } catch (error) {
            logger.log('error', '❌ Failed to initialize HighQualityAudioRecorder', error);
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Start recording audio
     * @param onAudioLevel Optional callback for real-time audio level (0-1)
     * @param onProgress Optional callback for recording progress
     */
    start(
        onAudioLevel?: (level: number) => void,
        onProgress?: (progress: RecordingProgress) => void,
        onAudioData?: (data: Int16Array) => void
    ): void {
        if (!this.isInitialized) {
            throw new Error('AudioRecorder not initialized. Call init() first.');
        }

        if (this.isRecording) {
            logger.log('warn', 'Recording already in progress');
            return;
        }

        this.audioLevelCallback = onAudioLevel || null;
        this.progressCallback = onProgress || null;
        this.audioDataCallback = onAudioData || null;
        this.recordedAudio = [];
        this.recordingStartTime = Date.now();
        this.isRecording = true;

        // Start the worklet recording with 5s buffering (16000 * 5)
        this.workletNode?.port.postMessage({
            command: 'start',
            chunkInterval: 80000
        });

        // Start audio level monitoring
        if (this.audioLevelCallback && this.analyserNode) {
            this.startAudioLevelMonitoring();
        }

        logger.log('info', '🔴 Recording started');
    }

    /**
     * Stop recording and return the audio blob
     * @returns Promise resolving to RecordingResult
     */
    stop(): Promise<RecordingResult> {
        return new Promise((resolve, reject) => {
            if (!this.isRecording) {
                reject(new Error('No recording in progress'));
                return;
            }

            this.resolveRecording = resolve;

            // Stop audio level monitoring
            this.stopAudioLevelMonitoring();

            // Stop the worklet recording - this will trigger onmessage with audio data
            this.workletNode?.port.postMessage({ command: 'stop' });
            this.isRecording = false;

            // Timeout in case worklet doesn't respond
            setTimeout(() => {
                if (this.resolveRecording) {
                    logger.log('warn', 'Recording stop timeout - using accumulated data');
                    this.handleRecordingComplete(this.recordedAudio.length);
                }
            }, 1000);
        });
    }

    /**
     * Handle recording completion - encode WAV and resolve promise
     */
    private handleRecordingComplete(sampleCount: number): void {
        if (!this.resolveRecording) return;

        const durationMs = Date.now() - this.recordingStartTime;

        // Convert number array to Int16Array
        const pcmData = new Int16Array(this.recordedAudio);

        // Encode as WAV
        let wavBuffer: ArrayBuffer;
        if (this.config.disableInternalStorage) {
            wavBuffer = new ArrayBuffer(0);
        } else {
            wavBuffer = this.encodeWAV(pcmData, this.config.sampleRate, this.config.channels);
        }
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });

        const result: RecordingResult = {
            blob,
            durationMs,
            sampleRate: this.config.sampleRate,
            sampleCount,
            pcmData
        };

        logger.log('info', `⏹️ Recording stopped: ${blob.size} bytes, ${durationMs}ms, ${sampleCount} samples`);

        this.resolveRecording(result);
        this.resolveRecording = null;
        this.recordedAudio = [];
    }

    /**
     * Get current audio level for visualization (0-1)
     * Call this in an animation loop for real-time updates
     */
    getAudioLevel(): number {
        if (!this.analyserNode) return 0;

        const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Normalize to 0-1 range with some boost
        return Math.min(1, (average / 128) * 1.5);
    }

    /**
     * Start continuous audio level monitoring
     */
    private startAudioLevelMonitoring(): void {
        const updateLevel = () => {
            if (!this.isRecording) return;

            const level = this.getAudioLevel();
            this.audioLevelCallback?.(level);

            this.animationFrameId = requestAnimationFrame(updateLevel);
        };
        updateLevel();
    }

    /**
     * Stop audio level monitoring
     */
    private stopAudioLevelMonitoring(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.audioLevelCallback?.(0);
    }

    /**
     * Encode PCM samples as WAV format
     */
    private encodeWAV(samples: Int16Array, sampleRate: number, channels: number): ArrayBuffer {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        // RIFF chunk descriptor
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');

        // fmt sub-chunk
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
        view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
        view.setUint16(22, channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channels * 2, true); // ByteRate
        view.setUint16(32, channels * 2, true); // BlockAlign
        view.setUint16(34, 16, true); // BitsPerSample

        // data sub-chunk
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // Write PCM samples
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            view.setInt16(offset, samples[i], true);
            offset += 2;
        }

        return buffer;
    }

    /**
     * Check if recording is in progress
     */
    isCurrentlyRecording(): boolean {
        return this.isRecording;
    }

    /**
     * Get the sample rate being used
     */
    getSampleRate(): number {
        return this.audioContext?.sampleRate ?? this.config.sampleRate;
    }

    /**
     * Cleanup all resources
     */
    async cleanup(): Promise<void> {
        this.stopAudioLevelMonitoring();

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.analyserNode) {
            this.analyserNode.disconnect();
            this.analyserNode = null;
        }

        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        this.isInitialized = false;
        this.isRecording = false;
        this.recordedAudio = [];
        this.resolveRecording = null;
        this.audioDataCallback = null;

        logger.log('info', 'HighQualityAudioRecorder cleaned up');
    }
}

// Singleton instance for convenience
let _recorderInstance: HighQualityAudioRecorder | null = null;

/**
 * Get a shared HighQualityAudioRecorder instance
 * Note: For multiple simultaneous recordings, create separate instances
 */
export function getHighQualityAudioRecorder(config?: AudioRecorderConfig): HighQualityAudioRecorder {
    if (!_recorderInstance) {
        _recorderInstance = new HighQualityAudioRecorder(config);
    }
    return _recorderInstance;
}

/**
 * Convert Int16Array PCM to Base64 string
 * Useful for sending to native plugins or APIs
 */
export function pcmToBase64(pcmData: Int16Array): string {
    const bytes = new Uint8Array(pcmData.buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
