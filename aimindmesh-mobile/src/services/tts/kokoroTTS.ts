import { logger } from '../logger';
import { Kokoro } from './kokoroPlugin';

/**
 * Kokoro Text-to-Speech Service
 * Uses the custom Kokoro Capacitor plugin for offline text-to-speech.
 */
export class KokoroTextToSpeechService {
    private idleTimer: NodeJS.Timeout | null = null;
    private readonly IDLE_TIMEOUT_MS = 300000; // Unload after 5 minutes of silence

    private currentVoiceId: string | null = null;
    private isSpeaking: boolean = false;

    constructor() {
        logger.log('info', 'Kokoro TTS Service initialized');
    }

    public isSupported(): boolean {
        return true; 
    }

    public async loadVoice(voiceId: string): Promise<void> {
        console.log('[Kokoro-DEBUG] === loadVoice called', voiceId);

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        try {
            const [nativeLoaded, nativeInfo] = await Promise.all([
                Kokoro.isVoiceLoaded(),
                Kokoro.getVoiceInfo()
            ]);

            if (nativeLoaded.loaded && nativeInfo.voiceId === voiceId) {
                logger.log('info', `[Kokoro] 🟢 Voice already loaded in native layer. Hydrating state...`);
                this.currentVoiceId = voiceId;
                return;
            }
        } catch (e) {
            logger.log('debug', '[Kokoro] Native state check failed, proceeding with init');
        }

        if (this.currentVoiceId === voiceId) {
            return;
        }

        logger.log('info', `Loading Kokoro voice: ${voiceId}`);

        try {
            if (this.currentVoiceId) {
                await this.unloadVoice();
            }

            await Kokoro.loadVoice({ voiceId });

            this.currentVoiceId = voiceId;
            logger.log('info', `Kokoro voice loaded: ${voiceId}`);
        } catch (error) {
            logger.log('error', 'Failed to load Kokoro voice', error);
            throw error;
        }
    }

    public async unloadVoice(): Promise<void> {
        if (!this.currentVoiceId) return;

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        logger.log('info', 'Unloading Kokoro voice (Memory Optimization)');

        try {
            if (this.isSpeaking) {
                await this.stop();
            }

            await Kokoro.unloadVoice();
            this.currentVoiceId = null;
            logger.log('info', 'Kokoro voice unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload Kokoro voice', error);
        }
    }

    public isVoiceLoaded(): boolean {
        return this.currentVoiceId !== null;
    }

    public getCurrentVoiceId(): string | null {
        return this.currentVoiceId;
    }

    private resetIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (!this.isSpeaking) {
                logger.log('info', 'Kokoro TTS idle timeout reached, unloading model');
                this.unloadVoice();
            }
        }, this.IDLE_TIMEOUT_MS);
    }

    public async speak(text: string, onEnd?: () => void): Promise<void> {
        if (!this.currentVoiceId) {
            throw new Error('No Kokoro voice loaded. Call loadVoice() first.');
        }

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        if (this.isSpeaking) {
            await this.stop();
        }

        logger.log('info', 'Starting Kokoro TTS', { text: text.substring(0, 50) });
        this.isSpeaking = true;

        try {
            await Kokoro.speak({ text });

            this.isSpeaking = false;
            logger.log('info', 'Kokoro TTS finished');

            this.resetIdleTimer(); 

            if (onEnd) onEnd();
        } catch (error) {
            this.isSpeaking = false;
            this.resetIdleTimer();
            logger.log('error', 'Failed to synthesize speech', error);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        if (!this.isSpeaking) return;

        logger.log('info', 'Stopping Kokoro TTS');
        this.resetIdleTimer();

        try {
            await Kokoro.stop();
            this.isSpeaking = false;
            logger.log('info', 'Kokoro TTS stopped');
        } catch (error) {
            logger.log('error', 'Failed to stop Kokoro TTS', error);
        }
    }

    public async setAudioOutput(output: 'speaker' | 'earpiece' | 'bluetooth' | 'wired'): Promise<void> {
        logger.log('info', `Setting Kokoro audio output to: ${output}`);
        try {
            await Kokoro.setAudioOutput({ output });
        } catch (error) {
            logger.log('error', 'Failed to set audio output', error);
            throw error;
        }
    }

    public async getAvailableOutputs(): Promise<string[]> {
        try {
            const result = await Kokoro.getAvailableAudioOutputs();
            return result.outputs;
        } catch (error) {
            logger.log('error', 'Failed to get available audio outputs', error);
            return ['speaker'];
        }
    }

    public isSpeakingNow(): boolean {
        return this.isSpeaking;
    }
}

let _kokoroService: KokoroTextToSpeechService | null = null;

export const getKokoroTtsService = (): KokoroTextToSpeechService => {
    if (!_kokoroService) {
        _kokoroService = new KokoroTextToSpeechService();
    }
    return _kokoroService;
};
