import type { PluginListenerHandle } from '@capacitor/core';

export interface SDLoadOptions {
  modelPath: string; // Directory containing unet.bin, vae.bin, text_encoder.bin or zip file
  backend?: 'npu' | 'gpu' | 'cpu';
}

export type SDSampler = 'euler' | 'dpmpp_2m';

export interface SDGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  sourceImage?: string;  // Data URL, base64, file path or content:// URI of the image to edit (img2img)
  strength?: number;     // Share of the steps re-run on the source (0.1 subtle - 0.95 drastic, default: 0.65)
  steps?: number;        // Default: 25
  cfgScale?: number;     // Default: 7.5
  seed?: number;         // Default: -1 (random; the seed used is returned)
  width?: number;        // Ignored: the NPU graphs are fixed at 512x512
  height?: number;       // Ignored: the NPU graphs are fixed at 512x512
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'; // Default: '1:1' (crop of the square; img2img keeps the source's shape)
  upscale?: 1 | 2 | 4;   // Default: 1 (Standard 512, 2 = 1024 HD, 4 = 2048 Ultra HD)
  sampler?: SDSampler;   // Default: 'euler'
}

export interface SDProgressEvent {
  step: number;
  totalSteps: number;
  timePerStep: number;
}

export interface SDGenerateResult {
  base64Image: string;   // data:image/png (up to 1024 px) or data:image/jpeg (larger)
  generationTimeMs: number;
  width: number;
  height: number;
  aspectRatio?: string;
  upscale?: number;
  seed?: number;         // Seed actually used: pass it back to reproduce the image
  steps?: number;
  sampler?: SDSampler;
  predictionType?: 'epsilon' | 'v_prediction';
  promptTruncated?: boolean; // The prompt exceeded 75 CLIP tokens: its end was ignored
}

/** What the loaded package can do */
export interface SDModelInfo {
  predictionType?: 'epsilon' | 'v_prediction';
  hasVaeEncoder?: boolean;      // Image editing (img2img) available
  hasSuperResolution?: boolean; // Real-ESRGAN upscaling (otherwise bilinear)
  textEmbeddingDim?: number;    // 768 = SD 1.x, 1024 = SD 2.x
  unetQuantized?: boolean;
}

export interface SDCapabilities {
  hasNpu: boolean;
  npuArch?: string;
  supportedBackends: string[];
  socModel?: string;
}

export interface SDPlugin {
  getCapabilities(): Promise<SDCapabilities>;
  loadModel(options: SDLoadOptions): Promise<{ success: boolean; error?: string } & SDModelInfo>;
  unloadModel(): Promise<{ success: boolean }>;
  isLoaded(): Promise<{ loaded: boolean; modelPath?: string } & SDModelInfo>;
  copyFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;
  generateImage(options: SDGenerateOptions): Promise<SDGenerateResult>;
  addListener(
    eventName: 'sdProgress',
    listenerFunc: (event: SDProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
