import { downloadModel } from './model/modelDownloader';
import { downloadVoskModel, VOSK_MODELS } from './stt/voskModelDownloader';
import { downloadWhisperModel, WHISPER_MODELS } from './stt/whisperModelDownloader';
import { logger } from './logger';
import { FileSystemAdapter as Filesystem, Directory } from '../utils/fileSystemAdapter';
import { registerPlugin } from '@capacitor/core';

const Vosk = registerPlugin('Vosk') as any;

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

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this.updateProgress({ 
                    currentStepIndex: i, 
                    currentStepName: step.name,
                    percentage: (i / steps.length) * 100 
                });

                this.log(`Step ${i + 1}/${steps.length}: Downloading ${step.name}...`);
                
                const downloadUrl = `${serverUrl.replace(/\/$/, '')}/dl/${step.path}`;
                
                try {
                    await this.processStep(step, downloadUrl, apiKey);
                    this.log(`✓ ${step.name} installed successfully.`);
                } catch (err: any) {
                    this.log(`✗ Error installing ${step.name}: ${err.message}`);
                }
            }

            this.updateProgress({ 
                status: 'completed', 
                percentage: 100, 
                currentStepName: 'Setup Complete' 
            });
            this.log('🎉 One-Click Configuration complete!');
            
            // Auto-update settings
            this.applyDefaultSettings(steps);

        } catch (error: any) {
            this.updateProgress({ status: 'failed', error: error.message });
            this.log(`CRITICAL ERROR: ${error.message}`);
        }
    }

    private async processStep(step: SetupStep, url: string, apiKey: string) {
        switch (step.category) {
            case 'GGUF':
                await downloadModel(url, step.target, undefined, apiKey);
                break;
            
            case 'LiteRT':
                await downloadModel(url, step.target, undefined, apiKey);
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
                    await downloadVoskModel(voskModel as any);
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
                    await downloadWhisperModel(whisperModel as any);
                }
                break;

            case 'WakeWord':
                await Vosk.downloadModel({ 
                    url, 
                    path: 'wakeword.zip' 
                });
                break;

            case 'Piper':
                await this.downloadToSubdir(url, 'piper-models', step.target, apiKey);
                break;

            case 'SpeakerID':
                await this.downloadToSubdir(url, 'speaker-id', step.target, apiKey);
                break;

            case 'VAD':
                await downloadModel(url, step.target, undefined, apiKey);
                break;

            default:
                this.log(`Unknown category: ${step.category}. Skipping...`);
        }
    }

    private async downloadToSubdir(url: string, subdir: string, filename: string, apiKey: string) {
        await Filesystem.mkdir({ path: subdir, directory: Directory.Data, recursive: true });
        const targetPath = `${subdir}/${filename}`;
        const tempName = `temp_${filename}`;
        await downloadModel(url, tempName, undefined, apiKey);
        
        await Filesystem.copy({
            from: tempName,
            to: targetPath,
            directory: Directory.Data
        });
        await Filesystem.deleteFile({ path: tempName, directory: Directory.Data });
    }

    private applyDefaultSettings(steps: SetupStep[]) {
        this.log('Applying optimized settings for downloaded models...');

        try {
            // Since we use useLocalStorage in App.tsx, writing directly to localStorage
            // and dispatching a storage event will trigger updates in components.
            
            // 1. LLM Defaults
            if (steps.find(s => s.id === 'qwen3.5-2b')) {
                const currentLLM = JSON.parse(localStorage.getItem('llm-config') || '{}');
                const newLLM = {
                    ...currentLLM,
                    provider: 'GGUF',
                    modelPath: 'Qwen3.5-2B-Q4_K_M.gguf'
                };
                localStorage.setItem('llm-config', JSON.stringify(newLLM));
                window.dispatchEvent(new StorageEvent('storage', { key: 'llm-config', newValue: JSON.stringify(newLLM) }));
            }

            // 2. LiteRT Defaults
            if (steps.find(s => s.id === 'gemma-4-e2b')) {
                const currentLLM = JSON.parse(localStorage.getItem('llm-config') || '{}');
                const newLLM = {
                    ...currentLLM,
                    liteRTModelPath: 'gemma-4-E2B-it.litertlm'
                };
                localStorage.setItem('llm-config', JSON.stringify(newLLM));
                window.dispatchEvent(new StorageEvent('storage', { key: 'llm-config', newValue: JSON.stringify(newLLM) }));
            }

            // 3. STT Defaults
            if (steps.find(s => s.id === 'vosk-it')) {
                const currentSpeech = JSON.parse(localStorage.getItem('speech-config') || '{}');
                const newSpeech = {
                    ...currentSpeech,
                    sttProvider: 'Vosk',
                    voskModelId: 'vosk-model-it-0.22'
                };
                localStorage.setItem('speech-config', JSON.stringify(newSpeech));
                window.dispatchEvent(new StorageEvent('storage', { key: 'speech-config', newValue: JSON.stringify(newSpeech) }));
            }

            // 4. TTS Defaults
            if (steps.find(s => s.id === 'piper-paola')) {
                const currentSpeech = JSON.parse(localStorage.getItem('speech-config') || '{}');
                const newSpeech = {
                    ...currentSpeech,
                    ttsProvider: 'Piper',
                    piperVoiceId: 'it_IT-paola-medium'
                };
                localStorage.setItem('speech-config', JSON.stringify(newSpeech));
                window.dispatchEvent(new StorageEvent('storage', { key: 'speech-config', newValue: JSON.stringify(newSpeech) }));
            }

            this.log('✓ Settings updated and applied via storage events.');
        } catch (e: any) {
            this.log(`Error updating settings: ${e.message}`);
        }
    }
}

export const setupService = new SetupService();
