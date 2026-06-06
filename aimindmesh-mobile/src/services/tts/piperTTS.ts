import { logger } from '../logger';
import { Piper } from 'piper-capacitor';
import { piperPhonemize } from '../tts/piper-wasm-api';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';

/**
 * Piper Text-to-Speech Service
 * Uses the piper-capacitor plugin for offline text-to-speech.
 */
export class PiperTextToSpeechService {
    private idleTimer: NodeJS.Timeout | null = null;
    private readonly IDLE_TIMEOUT_MS = 300000; // Unload after 5 minutes of silence

    private currentVoiceId: string | null = null;
    private isSpeaking: boolean = false;

    // WASM paths (absolute URL for Android WebView)
    // On Android, assets are served from the app's origin
    private get WASM_BASE() { return `${window.location.origin}/assets/piper-wasm/`; }
    private get PHONEMIZE_JS() { return this.WASM_BASE + 'piper_phonemize.js'; }
    private get PHONEMIZE_WASM() { return this.WASM_BASE + 'piper_phonemize.wasm'; }
    private get PHONEMIZE_DATA() { return this.WASM_BASE + 'piper_phonemize.data'; }
    private get WORKER_JS() { return this.WASM_BASE + 'piper_worker.js'; }

    constructor() {
        logger.log('info', 'Piper TTS Service initialized');
    }

    /**
     * Check if Piper is supported (always true on Android with plugin installed)
     */
    public isSupported(): boolean {
        return true; // Plugin is installed
    }

    /**
     * Load a Piper voice model by ID
     * @param voiceId The ID of the voice to load (e.g., 'it_IT-paola-medium')
     */
    public async loadVoice(voiceId: string): Promise<void> {
        console.log('[Piper-DEBUG] === loadVoice called');
        console.log('[Piper-DEBUG] currentVoiceId (local):', this.currentVoiceId);
        console.log('[Piper-DEBUG] requested voiceId:', voiceId);

        // Clear existing timer if any - we are active
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        // [CRITICAL FIX] Always check native state FIRST on native platforms
        // The local currentVoiceId can become stale after webview reload
        try {
            const [nativeLoaded, nativeInfo] = await Promise.all([
                Piper.isVoiceLoaded(),
                Piper.getVoiceInfo()
            ]);
            console.log('[Piper-DEBUG] Native state:', JSON.stringify({ loaded: nativeLoaded, info: nativeInfo }));

            if (nativeLoaded.loaded && nativeInfo.voiceId === voiceId) {
                console.log('[Piper-DEBUG] ✅ Native voice matches! Hydrating state...');
                logger.log('info', `[Piper] 🟢 Voice already loaded in native layer. Hydrating state...`);
                this.currentVoiceId = voiceId;
                return;
            } else {
                console.log('[Piper-DEBUG] Native voice mismatch or not loaded');
            }
        } catch (e) {
            console.log('[Piper-DEBUG] ⚠️ Native state check failed:', e);
            logger.log('debug', '[Piper] Native state check failed, proceeding with init');
        }

        // If already loaded locally (no hydration needed), just return
        if (this.currentVoiceId === voiceId) {
            return;
        }

        logger.log('info', `Loading Piper voice: ${voiceId}`);

        try {
            // Unload current voice if any
            if (this.currentVoiceId) {
                await this.unloadVoice();
            }

            // Load voice - paths are relative to app data directory
            // We assume the model file is .onnx and config is .onnx.json
            const modelPath = `piper-voices/${voiceId}.onnx`;
            const configPath = `piper-voices/${voiceId}.onnx.json`;

            await Piper.loadVoice({ modelPath, configPath });

            this.currentVoiceId = voiceId;
            logger.log('info', `Piper voice loaded: ${voiceId}`);
        } catch (error) {
            logger.log('error', 'Failed to load Piper voice', error);
            throw error;
        }
    }

    /**
     * Unload the current voice
     */
    public async unloadVoice(): Promise<void> {
        if (!this.currentVoiceId) {
            return;
        }

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        logger.log('info', 'Unloading Piper voice (Memory Optimization)');

        try {
            if (this.isSpeaking) {
                await this.stop();
            }

            await Piper.unloadVoice();
            this.currentVoiceId = null;
            logger.log('info', 'Piper voice unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload Piper voice', error);
        }
    }

    /**
     * Check if a voice is currently loaded
     */
    public isVoiceLoaded(): boolean {
        return this.currentVoiceId !== null;
    }

    /**
     * Get the currently loaded voice ID
     */
    public getCurrentVoiceId(): string | null {
        return this.currentVoiceId;
    }

    private resetIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (!this.isSpeaking) {
                logger.log('info', 'Piper TTS idle timeout reached, unloading model');
                this.unloadVoice();
            }
        }, this.IDLE_TIMEOUT_MS);
    }

    /**
     * Speak text using the loaded voice
     * @param text The text to speak
     * @param onEnd Optional callback when speech ends
     */
    public async speak(text: string, onEnd?: () => void): Promise<void> {
        // Ensure model is loaded (lazily re-load if needed)
        // But caller usually calls loadVoice first. 
        // If unloaded due to idle, we must fail or reload?
        // Let's assume we expect caller to handle loading, BUT if we auto-unloaded, currentVoiceId is null.
        // We can't reload without knowing the ID. 
        // Ideally we keep 'lastLoadedVoiceId' state to auto-reload?
        if (!this.currentVoiceId) {
            throw new Error('No Piper voice loaded. Call loadVoice() first.');
        }

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        if (this.isSpeaking) {
            await this.stop();
        }

        logger.log('info', 'Starting Piper TTS', { text: text.substring(0, 50) });
        this.isSpeaking = true;

        try {
            // 1. Phonemize using WASM
            logger.log('info', 'Phonemizing text...');

            // Workaround: Read the config file from filesystem and create a Blob URL
            const configPath = `piper-voices/${this.currentVoiceId}.onnx.json`;
            const configContent = await Filesystem.readFile({
                path: configPath,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            const configBlob = new Blob([configContent.data as string], { type: 'application/json' });
            const configUrl = URL.createObjectURL(configBlob);

            const { phonemeIds } = await piperPhonemize(
                this.PHONEMIZE_JS,
                this.PHONEMIZE_WASM,
                this.PHONEMIZE_DATA,
                this.WORKER_JS,
                configUrl,
                text,
                (_progress: number) => { /* ignore progress */ }
            );

            logger.log('info', `Phonemization complete. Generated ${phonemeIds.length} phonemes.`);

            // 2. Synthesize using Native Plugin
            await Piper.speak({ phonemeIds });

            this.isSpeaking = false;
            logger.log('info', 'Piper TTS finished');

            this.resetIdleTimer(); // Start idle timer

            if (onEnd) {
                onEnd();
            }
        } catch (error) {
            this.isSpeaking = false;
            this.resetIdleTimer(); // Reset even on error to cleanup
            logger.log('error', 'Failed to synthesize speech', error);
            throw error;
        }
    }

    /**
     * Speak text with sentence streaming for lower latency
     * Breaks text into sentences and synthesizes them in sequence
     * @param text The full text to speak
     * @param onSentenceStart Callback when a sentence starts
     * @param onEnd Optional callback when all speech ends
     */
    public async speakStreaming(
        text: string,
        onSentenceStart?: (sentenceIndex: number, sentence: string) => void,
        onEnd?: () => void
    ): Promise<void> {
        if (!this.currentVoiceId) {
            throw new Error('No Piper voice loaded. Call loadVoice() first.');
        }

        if (this.isSpeaking) {
            await this.stop();
        }

        logger.log('info', 'Starting streaming Piper TTS', { text: text.substring(0, 50) });

        // Split text into sentences
        const sentences = this.splitIntoSentences(text);

        if (sentences.length === 0) {
            if (onEnd) onEnd();
            return;
        }

        this.isSpeaking = true;

        try {
            // Read config once for phonemization
            const configPath = `piper-voices/${this.currentVoiceId}.onnx.json`;
            const configContent = await Filesystem.readFile({
                path: configPath,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            const configBlob = new Blob([configContent.data as string], { type: 'application/json' });
            const configUrl = URL.createObjectURL(configBlob);

            // Process sentences sequentially
            for (let i = 0; i < sentences.length && this.isSpeaking; i++) {
                const sentence = sentences[i].trim();
                if (!sentence) continue;

                if (onSentenceStart) {
                    onSentenceStart(i, sentence);
                }

                logger.log('debug', `Streaming TTS sentence ${i + 1}/${sentences.length}`);

                // Phonemize sentence
                const { phonemeIds } = await piperPhonemize(
                    this.PHONEMIZE_JS,
                    this.PHONEMIZE_WASM,
                    this.PHONEMIZE_DATA,
                    this.WORKER_JS,
                    configUrl,
                    sentence,
                    () => { }
                );

                // Synthesize and play
                await Piper.speak({ phonemeIds });
            }

            URL.revokeObjectURL(configUrl);
            this.isSpeaking = false;
            logger.log('info', 'Streaming Piper TTS finished');

            this.resetIdleTimer();

            if (onEnd) {
                onEnd();
            }
        } catch (error) {
            this.isSpeaking = false;
            this.resetIdleTimer();
            logger.log('error', 'Streaming TTS failed', error);
            throw error;
        }
    }

    /**
     * Split text into sentences for streaming
     */
    private splitIntoSentences(text: string): string[] {
        // Match sentence-ending punctuation followed by space or end
        return text
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    /**
     * Stop current speech
     */
    public async stop(): Promise<void> {
        if (!this.isSpeaking) {
            return;
        }

        logger.log('info', 'Stopping Piper TTS');
        this.resetIdleTimer(); // Ensure we eventually unload even if stopped manually

        try {
            await Piper.stop();
            this.isSpeaking = false;
            logger.log('info', 'Piper TTS stopped');
        } catch (error) {
            logger.log('error', 'Failed to stop Piper TTS', error);
        }
    }

    /**
     * Set audio output device
     * @param output The output device type
     */
    public async setAudioOutput(output: 'speaker' | 'earpiece' | 'bluetooth' | 'wired'): Promise<void> {
        logger.log('info', `Setting Piper audio output to: ${output}`);
        try {
            await Piper.setAudioOutput({ output });
        } catch (error) {
            logger.log('error', 'Failed to set audio output', error);
            throw error;
        }
    }

    /**
     * Get available audio output devices
     */
    public async getAvailableOutputs(): Promise<string[]> {
        try {
            const result = await Piper.getAvailableAudioOutputs();
            return result.outputs;
        } catch (error) {
            logger.log('error', 'Failed to get available audio outputs', error);
            return ['speaker']; // Default fallback
        }
    }

    /**
     * Check if currently speaking
     */
    public isSpeakingNow(): boolean {
        return this.isSpeaking;
    }

    /**
     * Set speech rate (speed)
     * @param rate Speed multiplier (0.5 = half speed, 2.0 = double speed)
     */
    public async setRate(_rate: number): Promise<void> {
        // Not yet implemented in plugin
        logger.log('warn', 'setRate not yet implemented in Piper plugin');
    }
}

// Singleton instance
let _piperService: PiperTextToSpeechService | null = null;

/**
 * Get the singleton Piper TTS service instance
 */
export const getPiperTtsService = (): PiperTextToSpeechService => {
    if (!_piperService) {
        _piperService = new PiperTextToSpeechService();
    }
    return _piperService;
};
