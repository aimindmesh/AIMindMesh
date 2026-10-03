import { downloadModel } from './model/modelDownloader';
import { readSetting, storeSetting } from './security/secretStore';
import { downloadVoskModel, VOSK_MODELS } from './stt/voskModelDownloader';
import { downloadWhisperModel, WHISPER_MODELS } from './stt/whisperModelDownloader';
import { logger } from './logger';
import { FileSystemAdapter as Filesystem, Directory } from '../utils/fileSystemAdapter';
import { registerPlugin } from '@capacitor/core';
import { LLMConfig, SpeechConfig } from '../types';

const Vosk = registerPlugin('Vosk') as any;

// Directories and ids the app's services load these models from
const PIPER_DIR = 'piper-voices';
const VAD_DIR = 'vad-models';
const VAD_MODEL_ID = 'silero-vad-v4';

export interface SetupStep {
    id: string;
    name: string;
    category: string;
    path: string;
    target: string;
    size: number;
    isZip?: boolean;
}

export interface SetupProgress {
    currentStepIndex: number;
    totalSteps: number;
    currentStepName: string;
    percentage: number;
    status: 'idle' | 'fetching' | 'downloading' | 'installing' | 'completed' | 'failed';
    error?: string;
    logs: string[];
}

class SetupService {
    private progress: SetupProgress = {
        currentStepIndex: 0,
        totalSteps: 0,
        currentStepName: '',
        percentage: 0,
        status: 'idle',
        logs: []
    };

    private onProgressChange?: (progress: SetupProgress) => void;

    setProgressListener(callback: (progress: SetupProgress) => void) {
        this.onProgressChange = callback;
    }

    /** Current state: a setup keeps running while the settings screen is closed */
    getProgress(): SetupProgress {
        return this.progress;
    }

    isRunning(): boolean {
        return this.progress.status === 'fetching' || this.progress.status === 'downloading' || this.progress.status === 'installing';
    }

    private updateProgress(patch: Partial<SetupProgress>) {
        this.progress = { ...this.progress, ...patch };
        if (this.onProgressChange) {
            this.onProgressChange(this.progress);
        }
    }

    private log(message: string) {
        const timestamp = new Date().toLocaleTimeString();
        const fullMessage = `[${timestamp}] ${message}`;
        this.updateProgress({ logs: [fullMessage, ...this.progress.logs].slice(0, 50) });
        logger.log('info', `[SetupService] ${message}`);
    }

    async runOneClickSetup(serverUrl: string, apiKey: string): Promise<void> {
        if (this.isRunning()) return; // a second run would download every model twice
        try {
            this.updateProgress({ 
                status: 'fetching', 
                percentage: 0, 
                currentStepName: 'Fetching Manifest',
                logs: [] 
            });
            this.log('Fetching setup manifest from server...');

            const manifestUrl = `${serverUrl.replace(/\/$/, '')}/dl/setup_manifest.json`;
            const response = await fetch(manifestUrl, {
                headers: { 'x-api-key': apiKey }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch manifest: ${response.statusText}`);
            }

            const manifest = await response.json();
            const steps: SetupStep[] = manifest.models;

            this.updateProgress({ 
                totalSteps: steps.length, 
                status: 'downloading' 
            });
            this.log(`Found ${steps.length} models to configure.`);

            const installed: SetupStep[] = [];
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this.updateProgress({ 
                    currentStepIndex: i, 
                    currentStepName: step.name,
                    percentage: (i / steps.length) * 100 
                });

                this.log(`Step ${i + 1}/${steps.length}: Downloading ${step.name}...`);
                
                const downloadUrl = `${serverUrl.replace(/\/$/, '')}/dl/${step.path}`;
                // Progress inside the step moves the overall bar between this step and the next
                const onStepProgress = (fraction: number) => this.updateProgress({
                    percentage: ((i + Math.min(Math.max(fraction, 0), 1)) / steps.length) * 100
                });
                
                try {
                    await this.processStep(step, downloadUrl, apiKey, onStepProgress);
                    installed.push(step);
                    this.log(`✓ ${step.name} installed successfully.`);
                } catch (err: any) {
                    this.log(`✗ Error installing ${step.name}: ${err.message}`);
                }
            }

            const failed = steps.length - installed.length;
            this.updateProgress({ 
                status: 'completed', 
                percentage: 100, 
                currentStepName: failed > 0 ? `Setup Complete (${failed} failed)` : 'Setup Complete'
            });
            this.log(failed > 0
                ? `Configuration finished: ${installed.length} installed, ${failed} failed (see above).`
                : '🎉 One-Click Configuration complete!');
            
            // Only models that are really on the device are selected
            this.applyDefaultSettings(installed);

        } catch (error: any) {
            this.updateProgress({ status: 'failed', error: error.message });
            this.log(`CRITICAL ERROR: ${error.message}`);
        }
    }

    /** Downloads one file through the native downloader and waits until it is complete and verified */
    private async downloadFile(url: string, target: string, apiKey: string, onProgress?: (fraction: number) => void) {
        await downloadModel(url, target, p => onProgress?.(p.percentage / 100), apiKey);
    }

    /** Same, into a sub-directory of the app data directory (created if missing) */
    private async downloadToSubdir(url: string, subdir: string, filename: string, apiKey: string, onProgress?: (fraction: number) => void) {
        await Filesystem.mkdir({ path: subdir, directory: Directory.Data, recursive: true }).catch(() => { /* already there */ });
        await this.downloadFile(url, `${subdir}/${filename}`, apiKey, onProgress);
    }

    private async processStep(step: SetupStep, url: string, apiKey: string, onProgress: (fraction: number) => void) {
        switch (step.category) {
            case 'GGUF':
            case 'LiteRT':
                await this.downloadFile(url, step.target, apiKey, onProgress);
                break;

            case 'Embedding':
                await Vosk.downloadModel({ 
                    url, 
                    path: 'embedding_models/memories.zip' 
                });
                break;

            case 'Vosk':
                if (step.id === 'vosk-spk') {
                    await Vosk.downloadModel({ url, path: 'vosk-models/vosk-model-spk-0.4.zip' });
                } else {
                    const voskModel = VOSK_MODELS.find(m => m.id === step.id) || {
                        id: step.id,
                        url: url,
                        size: step.size
                    };
                    await downloadVoskModel(voskModel as any, p => onProgress(p.percentage / 100));
                }
                break;

            case 'Whisper':
                {
                    const whisperModel = WHISPER_MODELS.find(m => m.id === step.id) || {
                        id: step.id,
                        url: url,
                        sizeBytes: step.size,
                        name: step.name
                    };
                    await downloadWhisperModel(whisperModel as any, p => onProgress(p.percentage / 100));
                }
                break;

            case 'WakeWord':
                await Vosk.downloadModel({ 
                    url, 
                    path: 'wakeword.zip' 
                });
                break;

            case 'Piper':
                // Where piperTTS loads voices from: the model plus its .onnx.json config
                await this.downloadToSubdir(url, PIPER_DIR, step.target, apiKey, onProgress);
                try {
                    await this.downloadToSubdir(`${url}.json`, PIPER_DIR, `${step.target}.json`, apiKey);
                } catch (e: any) {
                    throw new Error(`voice config (${step.target}.json) unavailable on the server: ${e.message}`);
                }
                break;

            case 'SpeakerID':
                // The speaker embedding plugin reads models/<file> from the app data directory
                await this.downloadToSubdir(url, 'models', step.target, apiKey, onProgress);
                break;

            case 'VAD':
                // vadService loads vad-models/<model id>.onnx
                await this.downloadToSubdir(url, VAD_DIR, `${VAD_MODEL_ID}.onnx`, apiKey, onProgress);
                break;

            default:
                this.log(`Unknown category: ${step.category}. Skipping...`);
        }
    }

    /** Settings writes go through the secret store and reach App's state via a storage event */
    private applySetting<T extends object>(key: string, patch: Partial<T>) {
        const next = { ...readSetting<T>(key, {} as T), ...patch };
        storeSetting(key, next);
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(next) }));
    }

    private applyDefaultSettings(installed: SetupStep[]) {
        this.log('Applying optimized settings for downloaded models...');
        const step = (id: string) => installed.find(s => s.id === id);

        try {
            // 1. LLM Defaults (ids the app knows: provider 'native-gguf' + nativeModelPath)
            const chatModel = step('qwen3.5-2b');
            if (chatModel) {
                this.applySetting<LLMConfig>('llm-config', { provider: 'native-gguf', engine: 'gguf', nativeModelPath: chatModel.target });
            }

            // 2. LiteRT Defaults
            const liteRTModel = step('gemma-4-e2b');
            if (liteRTModel) {
                this.applySetting<LLMConfig>('llm-config', { liteRTModelPath: liteRTModel.target });
            }

            // 3. STT Defaults
            if (step('vosk-it')) {
                this.applySetting<SpeechConfig>('speech-config', { sttProvider: 'vosk', voskModelId: 'vosk-model-it-0.22' });
            }

            // 4. TTS Defaults
            const voice = step('piper-paola');
            if (voice) {
                this.applySetting<SpeechConfig>('speech-config', { ttsProvider: 'piper', piperVoiceId: voice.target.replace(/\.onnx$/, '') });
            }

            this.log('✓ Settings updated and applied via storage events.');
        } catch (e: any) {
            this.log(`Error updating settings: ${e.message}`);
        }
    }
}

export const setupService = new SetupService();
