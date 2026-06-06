import { WebPlugin } from '@capacitor/core';

import type {
  OpenWakeWordPlugin,
  LoadModelOptions,
  LoadModelResult,
  WakeWordModelInfo,
} from './definitions';

/**
 * Web implementation of OpenWakeWord plugin.
 * Wake word detection is not supported on web platform.
 * This provides stub implementations for development/testing.
 */
export class OpenWakeWordWeb extends WebPlugin implements OpenWakeWordPlugin {

  async loadModel(_options: LoadModelOptions): Promise<LoadModelResult> {
    console.warn('OpenWakeWord: Web platform not supported. Wake word detection requires native Android.');
    return {
      loaded: false,
      modelName: _options.modelName,
    };
  }

  async unloadModel(): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async isModelLoaded(): Promise<{ loaded: boolean }> {
    return { loaded: false };
  }

  async startListening(): Promise<{ status: string }> {
    console.warn('OpenWakeWord: Web platform not supported.');
    return { status: 'unsupported' };
  }

  async stopListening(): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async isListening(): Promise<{ listening: boolean }> {
    return { listening: false };
  }

  async setThreshold(options: { threshold: number }): Promise<{ threshold: number }> {
    return { threshold: options.threshold };
  }

  async setCooldown(options: { cooldownMs: number }): Promise<{ cooldownMs: number }> {
    return { cooldownMs: options.cooldownMs };
  }

  async setBufferSize(options: { bufferSize: number }): Promise<{ bufferSize: number }> {
    return { bufferSize: options.bufferSize };
  }

  async getAvailableModels(): Promise<{ models: WakeWordModelInfo[] }> {
    // Return list of known models (none will be downloaded on web)
    return {
      models: [
        {
          name: 'hey_jarvis_v0.1.tflite',
          displayName: 'Hey Jarvis',
          description: 'General purpose wake word',
          isDownloaded: false,
        },
        {
          name: 'alexa_v0.1.tflite',
          displayName: 'Alexa',
          description: 'Amazon Alexa style wake word',
          isDownloaded: false,
        },
        {
          name: 'hey_mycroft_v0.1.tflite',
          displayName: 'Hey Mycroft',
          description: 'Mycroft assistant wake word',
          isDownloaded: false,
        },
      ],
    };
  }

  async copyModelFile(_options: { sourcePath: string; fileName: string }): Promise<{ path: string }> {
    console.warn('OpenWakeWord: Web platform not supported.');
    return { path: '' };
  }

  async checkBaseModels(): Promise<{
    hasMelSpectrogram: boolean;
    hasEmbedding: boolean;
  }> {
    return {
      hasMelSpectrogram: false,
      hasEmbedding: false,
    };
  }

  async startTraining(): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async stopTraining(): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async saveProfile(_options: { name: string }): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async deleteModel(_options: { modelName: string }): Promise<void> {
    console.warn('OpenWakeWord: Web platform not supported.');
  }

  async getDebugDiagnostics(): Promise<any> {
    return { available: false, error: 'Web platform not supported' };
  }
}