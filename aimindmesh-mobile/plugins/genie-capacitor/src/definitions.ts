export interface GenieLoadOptions {
  modelPath: string;
  modelType?: 'qwen' | 'gemma' | 'llama' | 'custom';
  runtime?: 'npu' | 'gpu' | 'cpu' | 'auto';
  contextLength?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface GenieGenerateOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface GenieStreamResult {
  text?: string;
  done?: boolean;
  error?: string;
  tokensPerSec?: number;
}

export interface GenieCapabilities {
  hasNpu: boolean;
  npuArch?: string; // e.g. 'v79', 'v75', 'v73'
  supportedRuntimes: string[];
  socModel?: string;
}

export interface GenieModelInfo {
  model_id: string;
  model_name: string;
  path: string;
  precision?: string;
  runtime?: string;
  is_vision?: boolean;
  sizeBytes?: number;
}

export interface GeniePlugin {
  getCapabilities(): Promise<GenieCapabilities>;
  loadModel(options: GenieLoadOptions): Promise<{ success: boolean; modelName?: string; isVision?: boolean; error?: string }>;
  unloadModel(): Promise<{ success: boolean }>;
  isLoaded(): Promise<{ loaded: boolean; modelPath?: string; modelName?: string; isVision?: boolean }>;
  listLocalModels(): Promise<{ models: GenieModelInfo[] }>;
  generateStream(
    options: GenieGenerateOptions,
    callback: (result: GenieStreamResult | null, err?: any) => void
  ): Promise<string>;
  abortGeneration(): Promise<{ success: boolean }>;
}
