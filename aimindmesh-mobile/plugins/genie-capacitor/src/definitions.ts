/** auto = NPU, then GPU, then CPU (GGUF files only: QAIRT bundles always run on the NPU) */
export type GenieRuntime = 'auto' | 'npu' | 'gpu' | 'cpu';

export interface GenieLoadOptions {
  /** A QAIRT bundle (.zip, folder) or a .gguf file (absolute path or name in the app's files dir) */
  modelPath: string;
  modelType?: 'qwen' | 'gemma' | 'llama' | 'custom';
  runtime?: GenieRuntime;
  /** Context window of a GGUF (default 4096); QAIRT bundles use the one they were compiled with */
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
  /** Vision models: images of this prompt (data URLs), in the order of the prompt's image slots */
  images?: string[];
  /** GBNF the output must follow (GGUF on the llama_cpp runtime; QAIRT bundles ignore it) */
  grammar?: string;
}

/** GenieX timings of a generation, sent with the last chunk */
export interface GenieProfile {
  ttftMs: number;
  promptTokens: number;
  generatedTokens: number;
  promptTimeMs: number;
  decodeTimeMs: number;
  /** tokens/s */
  prefillSpeed: number;
  decodingSpeed: number;
  stopReason?: string;
  computeUnit?: string;
  /** Time spent encoding the images (vision models) */
  mediaMs?: number;
}

export interface GenieStreamResult {
  text?: string;
  done?: boolean;
  error?: string;
  profile?: GenieProfile;
}

export interface GenieChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  imageCount?: number;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
  toolName?: string;
}

export interface GenieCapabilities {
  hasNpu: boolean;
  npuArch?: string; // 'v73' (8 Gen 2), 'v75' (8 Gen 3), 'v79' (8 Elite), 'v81'
  supportedRuntimes: string[];
  socModel?: string;
  board?: string;
  /** GGUF files on the NPU (GenieX llama_cpp runtime, Hexagon v68+) */
  ggufNpuSupported?: boolean;
  /** Qualcomm AI Hub QAIRT bundles (GenieX 0.3.5: Hexagon v79/v81 only) */
  qairtSupported?: boolean;
}

export interface GenieModelInfo {
  model_id: string;
  model_name: string;
  path: string;
  precision?: string;
  /** 'qairt' (AI Hub bundle) or 'llama_cpp' (GGUF file) */
  runtime?: string;
  /** GGUF weights the Hexagon kernels run (Q4_0, Q4_1, IQ4_NL, MXFP4, Q8_0); others fall back to GPU/CPU */
  npuReady?: boolean;
  is_vision?: boolean;
  sizeBytes?: number;
}

export interface GenieLoadedModel {
  modelName?: string;
  isVision?: boolean;
  precision?: string;
  runtime?: string;
  /** The unit the model actually runs on (npu, gpu, cpu) */
  computeUnit?: string;
  contextLength?: number;
}

export interface GeniePlugin {
  getCapabilities(): Promise<GenieCapabilities>;
  loadModel(options: GenieLoadOptions): Promise<{ success: boolean; error?: string } & GenieLoadedModel>;
  unloadModel(): Promise<{ success: boolean }>;
  isLoaded(): Promise<{ loaded: boolean; modelPath?: string } & GenieLoadedModel>;
  listLocalModels(): Promise<{ models: GenieModelInfo[] }>;
  /**
   * Prompt from the loaded model's own chat template (GGUF metadata, bundle tokenizer config;
   * rejects when it has none). `imageCount` puts image slots before a message's text (vision models).
   */
  /**
   * Prompt from the model's own chat template. `tools`: a JSON array of OpenAI-style tool
   * declarations, rendered in the template's format; assistant turns may carry `toolCalls`
   * (arguments as JSON text) and `tool` turns the result for `toolCallId`.
   */
  formatChat(options: { messages: GenieChatMessage[]; enableThinking?: boolean; tools?: string }): Promise<{ prompt: string }>;
  generateStream(
    options: GenieGenerateOptions,
    callback: (result: GenieStreamResult | null, err?: any) => void
  ): Promise<string>;
  abortGeneration(): Promise<{ success: boolean }>;
}
