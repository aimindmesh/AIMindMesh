import { WebPlugin } from '@capacitor/core';
import type { GeniePlugin, GenieCapabilities, GenieLoadOptions, GenieGenerateOptions, GenieStreamResult, GenieModelInfo } from './definitions';

export class GenieWeb extends WebPlugin implements GeniePlugin {
  async getCapabilities(): Promise<GenieCapabilities> {
    return {
      hasNpu: false,
      supportedRuntimes: ['cpu'],
      socModel: 'Web/Browser'
    };
  }

  async loadModel(_options: GenieLoadOptions): Promise<{ success: boolean; modelName?: string; isVision?: boolean; error?: string }> {
    return { success: false, error: 'Genie Qualcomm NPU engine is only supported natively on Android Snapdragon devices' };
  }

  async unloadModel(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async isLoaded(): Promise<{ loaded: boolean; modelPath?: string; modelName?: string; isVision?: boolean }> {
    return { loaded: false };
  }

  async listLocalModels(): Promise<{ models: GenieModelInfo[] }> {
    return { models: [] };
  }

  async generateStream(
    _options: GenieGenerateOptions,
    callback: (result: GenieStreamResult | null, err?: any) => void
  ): Promise<string> {
    callback({ done: true, error: 'Genie NPU not available on web' });
    return '';
  }

  async abortGeneration(): Promise<{ success: boolean }> {
    return { success: true };
  }
}
