import { HighQualityAudioRecorder, pcmToBase64 } from '../audio/highQualityAudioRecorder';
import { logger } from '../logger';
import type { WhisperSTTService, WhisperConfig } from './whisperSTT';

export class WhisperLiveStreamManager {
    private recorder: HighQualityAudioRecorder | null = null;
    private isRecording = false;
    private audioBuffer: Int16Array[] = [];
    private accumulatedTranscript = '';
    private onUpdateCallback: ((transcript: string) => void) | null = null;
    private isTranscribingChunk = false;
    private silenceFrames = 0;
    private hasSpeechActivity = false;
    private totalRecordedSamples = 0;
    private lastTranscribedSampleCount = 0;

    constructor(private whisperService: WhisperSTTService) {}

    public isRunning(): boolean {
        return this.isRecording;
    }

    public async start(
        onUpdate: (transcript: string) => void,
        onAudioLevel?: (level: number) => void,
        config: WhisperConfig = {}
    ): Promise<void> {
        if (this.isRecording) {
            logger.log('warn', '[WhisperLiveStream] Already running');
            return;
        }

        this.onUpdateCallback = onUpdate;
        this.accumulatedTranscript = '';
        this.audioBuffer = [];
        this.totalRecordedSamples = 0;
        this.lastTranscribedSampleCount = 0;
        this.hasSpeechActivity = false;
        this.silenceFrames = 0;

        try {
            this.recorder = new HighQualityAudioRecorder({
                sampleRate: 16000,
                channels: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                disableInternalStorage: true
            });

            await this.recorder.init();

            this.isRecording = true;

            this.recorder.start(
                (level) => {
                    onAudioLevel?.(level);
                },
                undefined,
                (int16Chunk: Int16Array) => {
                    if (!this.isRecording) return;
                    this.handleAudioChunk(int16Chunk, config);
                }
            );

            logger.log('info', '[WhisperLiveStream] Live Whisper speech recognition started');
        } catch (error) {
            this.isRecording = false;
            logger.log('error', '[WhisperLiveStream] Failed to start live Whisper recognition', error);
            throw error;
        }
    }

    private async handleAudioChunk(chunk: Int16Array, config: WhisperConfig): Promise<void> {
        this.audioBuffer.push(chunk);
        this.totalRecordedSamples += chunk.length;

        // Calculate RMS energy of this chunk
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) {
            sum += chunk[i] * chunk[i];
        }
        const rms = Math.sqrt(sum / chunk.length);
        const energyThreshold = 300; // RMS speech activity threshold

        if (rms > energyThreshold) {
            this.hasSpeechActivity = true;
            this.silenceFrames = 0;
        } else if (this.hasSpeechActivity) {
            this.silenceFrames++;
        }

        const unTranscribedSamples = this.totalRecordedSamples - this.lastTranscribedSampleCount;
        const unTranscribedSeconds = unTranscribedSamples / 16000;

        // Trigger transcription:
        // 1. After speech pause (silence for ~6-8 chunks / ~600-800ms) and buffer >= 0.8s
        // 2. OR when continuous speech exceeds 3.0s for low latency streaming
        const shouldTranscribe = 
            (this.hasSpeechActivity && this.silenceFrames >= 6 && unTranscribedSeconds >= 0.8) ||
            (unTranscribedSeconds >= 3.0);

        if (shouldTranscribe && !this.isTranscribingChunk) {
            await this.transcribeCurrentBuffer(config);
        }
    }

    private async transcribeCurrentBuffer(config: WhisperConfig): Promise<void> {
        if (this.audioBuffer.length === 0 || this.isTranscribingChunk) return;

        this.isTranscribingChunk = true;
        try {
            const totalLen = this.audioBuffer.reduce((acc, c) => acc + c.length, 0);
            if (totalLen < 8000) { // Min 0.5s
                this.isTranscribingChunk = false;
                return;
            }

            const merged = new Int16Array(totalLen);
            let offset = 0;
            for (const c of this.audioBuffer) {
                merged.set(c, offset);
                offset += c.length;
            }

            const base64Audio = pcmToBase64(merged);
            this.lastTranscribedSampleCount = this.totalRecordedSamples;
            this.audioBuffer = []; // Reset chunk buffer
            this.hasSpeechActivity = false;
            this.silenceFrames = 0;

            const result = await this.whisperService.transcribeAudio(
                base64Audio,
                {
                    ...config,
                    temperature: 0.0,
                    beamSize: 1, // Fast greedy decoding
                    bestOf: 1
                },
                'fast'
            );

            if (result.text && result.text.trim()) {
                const text = result.text.trim();
                logger.log('info', `[WhisperLiveStream] Recognized: "${text}"`);
                this.accumulatedTranscript = (this.accumulatedTranscript ? `${this.accumulatedTranscript} ` : '') + text;
                this.onUpdateCallback?.(this.accumulatedTranscript);
            }
        } catch (error) {
            logger.log('error', '[WhisperLiveStream] Chunk transcription error', error);
        } finally {
            this.isTranscribingChunk = false;
        }
    }

    public async stop(): Promise<void> {
        if (!this.isRecording) return;
        this.isRecording = false;

        try {
            if (this.recorder) {
                await this.recorder.stop();
                await this.recorder.cleanup();
                this.recorder = null;
            }

            // Transcribe any remaining samples in buffer
            if (this.audioBuffer.length > 0) {
                await this.transcribeCurrentBuffer({});
            }
            logger.log('info', '[WhisperLiveStream] Live Whisper speech recognition stopped');
        } catch (error) {
            logger.log('warn', '[WhisperLiveStream] Error stopping recorder', error);
        } finally {
            this.audioBuffer = [];
            this.onUpdateCallback = null;
        }
    }
}
