import { WebPlugin } from '@capacitor/core';
import type { SDPlugin, SDCapabilities, SDLoadOptions, SDGenerateOptions, SDGenerateResult } from './definitions';

export class SDWeb extends WebPlugin implements SDPlugin {
  async getCapabilities(): Promise<SDCapabilities> {
    return {
      hasNpu: false,
      supportedBackends: ['cpu'],
      socModel: 'Web/Browser'
    };
  }

  async loadModel(_options: SDLoadOptions): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Stable Diffusion Qualcomm NPU acceleration is only available on native Android Snapdragon devices' };
  }

  async unloadModel(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async isLoaded(): Promise<{ loaded: boolean; modelPath?: string }> {
    return { loaded: false };
  }

  async copyFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }> {
    return { path: options.sourcePath };
  }

  async generateImage(_options: SDGenerateOptions): Promise<SDGenerateResult> {
    throw new Error('Image generation on NPU is not supported on web platform');
  }
}
