import type { PluginListenerHandle } from '@capacitor/core';

export interface SDLoadOptions {
  modelPath: string; // Directory containing unet.bin, vae.bin, text_encoder.bin or zip file
  backend?: 'npu' | 'gpu' | 'cpu';
}

export interface SDGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  sourceImage?: string;  // Base64 or local file path for image-to-image editing
  strength?: number;     // Denoising strength (0.1 - 0.9, default: 0.65)
  steps?: number;        // Default: 20
  cfgScale?: number;     // Default: 7.5
  seed?: number;         // Default: -1 (random)
  width?: number;        // Default: 512
  height?: number;       // Default: 512
}

export interface SDProgressEvent {
  step: number;
  totalSteps: number;
  timePerStep: number;
}

export interface SDGenerateResult {
  base64Image: string;
  generationTimeMs: number;
  width: number;
  height: number;
}

export interface SDCapabilities {
  hasNpu: boolean;
  npuArch?: string;
  supportedBackends: string[];
  socModel?: string;
}

export interface SDPlugin {
  getCapabilities(): Promise<SDCapabilities>;
  loadModel(options: SDLoadOptions): Promise<{ success: boolean; error?: string }>;
  unloadModel(): Promise<{ success: boolean }>;
  isLoaded(): Promise<{ loaded: boolean; modelPath?: string }>;
  copyFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;
  generateImage(options: SDGenerateOptions): Promise<SDGenerateResult>;
  addListener(
    eventName: 'sdProgress',
    listenerFunc: (event: SDProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
