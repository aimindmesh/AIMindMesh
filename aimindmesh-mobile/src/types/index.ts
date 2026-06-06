import { ProactiveSettings } from './proactive';

export interface SupportServerSettings {
  enabled: boolean;
  url: string;
  delegateWebSearch: boolean;
  delegateWebScraping: boolean;
  delegateWebAnalysis: boolean;
}

export const DEFAULT_SUPPORT_SERVER_SETTINGS: SupportServerSettings = {
  enabled: false,
  url: 'http://localhost:3000',
  delegateWebSearch: false,
  delegateWebScraping: false,
  delegateWebAnalysis: false
};

// ---- AIMindMesh Server Integration (v4.0.0) ----
export type FallbackProvider = 'native-gguf' | 'litert' | 'gemini' | 'perplexity' | 'none';

export interface AIMindMeshServerSettings {
  /** Master switch for all server features */
  enabled: boolean;
  /** VPN IP and port, e.g. http://10.2.0.1:3030 */
  serverUrl: string;
  /** Node API key for this device */
  apiKey: string;
  /** Set as primary LLM provider */
  useAsDefaultProvider: boolean;
  /** Provider to use when server unreachable */
  fallbackProvider: FallbackProvider;
  /** Last fetched server version string */
  serverVersion?: string;
  /** Human-readable name for this device */
  deviceName?: string;
  /** Toggle for server-side reasoning (OpenClaw) */
  serverSideAgenticEnabled?: boolean;
  /** Server-side agent provider ('openclaw' | 'hermes') */
  serverSideAgentProvider?: 'openclaw' | 'hermes';
  /** Automatically refresh server resources (CPU/RAM) */
  autoRefreshResources?: boolean;
  /** Refresh interval in seconds (default 30) */
  resourceRefreshInterval?: number;
  /** Delivery mode: PUSH (real-time) vs CONTEXTUAL (pull-based) */
  deliveryMode?: 'PUSH' | 'CONTEXTUAL';
  /** AI Task execution polling interval in seconds (default 15) */
  aiTaskPollingInterval?: number;
  /** Number of AI task artifacts to keep before auto-deleting oldest */
  taskRetentionLimit?: number;
  /** Explicit routing target (e.g. "ZFOLD5", "LAPTOP", "AUTO") */
  preferredNode?: string;
  /** Participate in the distributed mesh as a worker node */
  participateAsWorker?: boolean;
  /** Delegate web search to the server (uses SearXNG) */
  delegateWebSearch?: boolean;
  /** Delegate web page scraping/reading to the server */
  delegateWebScraping?: boolean;
  /** Delegate web analysis (search + LLM synthesis) to the server */
  delegateWebAnalysis?: boolean;
}

export const DEFAULT_AIMINDMESH_SERVER_SETTINGS: AIMindMeshServerSettings = {
  enabled: false,
  serverUrl: 'http://10.2.0.1:3030',
  apiKey: '',
  useAsDefaultProvider: false,
  fallbackProvider: 'native-gguf',
  deviceName: 'Mobile Device',
  serverSideAgenticEnabled: false,
  serverSideAgentProvider: 'openclaw',
  autoRefreshResources: false,
  resourceRefreshInterval: 30,
  deliveryMode: 'PUSH',
  aiTaskPollingInterval: 15,
  taskRetentionLimit: 50,
  participateAsWorker: true,
};


export interface ImageAttachment {
  base64?: string;    // Base64 encoded image data (optional, if path is available)
  path?: string;      // Native file path (preferred for large files)
  webPath?: string;   // Web-accessible path (for UI rendering)
  mimeType: string;   // e.g., 'image/jpeg', 'image/png'
  name?: string;      // Original file name
}

export interface AudioAttachment {
  path: string;       // Absolute path to audio file
  name: string;       // File name
  mimeType: string;   // e.g. 'audio/wav', 'audio/mpeg'
  duration?: number;
  transcription?: string; // Cached transcription
}

export interface FileAttachment {
  name: string;
  content: string; // Text content
  mimeType: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
  hidden?: boolean; // If true, message acts as system prompt/trigger and is not shown in UI
  images?: ImageAttachment[];  // Optional array of attached images
  audio?: AudioAttachment[];   // Optional array of attached audio
  files?: FileAttachment[];    // Optional array of attached text files
  thinking?: string;           // Model's thought summary (for thinking mode)
  sources?: { title: string; uri: string }[];  // Search grounding sources
  toolResults?: { name: string; success: boolean; result: string }[]; // Tool execution results
  isSummary?: boolean;         // Flag to identify summary messages (for context compression)
}

export * from './proactive';

export interface Personality {
  name: string;
  description: string;
  systemPrompt: string;
  traits: string[];
  // Optional LLM parameters for fine-tuning behavior
  llmParams?: {
    temperature?: number;      // 0.0-2.0, controls randomness (lower = more deterministic)
    topP?: number;             // 0.0-1.0, nucleus sampling (lower = more focused)
    maxTokens?: number;        // Maximum response length
    presencePenalty?: number;  // -2.0 to 2.0, penalizes new topics (higher = more diverse)
    frequencyPenalty?: number; // -2.0 to 2.0, penalizes repetition (higher = less repetitive)
  };
}

export type LLMProvider = 'gemini' | 'perplexity' | 'claude' | 'openrouter' | 'local' | 'in-browser-downloaded' | 'native-gguf' | 'local-model' | 'litert' | 'aimindmesh-server';

export interface CustomGGUFModel {
  id: string;
  name: string;
  sizeBytes: number;
  uploadedAt: Date;
  isPreset?: boolean; // True for preset models, false for custom
}

export interface LLMConfig {
  provider: LLMProvider;
  localEndpoint: string;
  localModel: string;
  geminiModel?: string;     // e.g. 'gemini-2.5-flash', 'gemini-2.5-pro'
  perplexityModel?: string; // e.g. 'sonar-pro'
  claudeModel?: string;     // e.g. 'claude-3-5-sonnet-latest'
  openrouterModel?: string; // e.g. 'google/gemini-2.0-flash-lite:free'
  openrouterApiKey?: string;
  selectedGGUF?: string;
  contextSize?: number; // Configurable context size (default: 2048 or model specific)
  customModels?: CustomGGUFModel[];
  // LLM Engine selection (hybrid approach)
  engine?: 'gguf' | 'litert';  // 'gguf' = llama.cpp, 'litert' = Google AI Edge
  // LiteRT configuration
  liteRTModelPath?: string;    // Path to .litertlm model file
  liteRTModelId?: string;      // ID of downloaded LiteRT model
  liteRTBackend?: 'CPU' | 'GPU'; // Accelerator backend (default: CPU)
  // Native GGUF configuration
  nativeModelPath?: string;  // Path to local GGUF file
  nativeTokenizerPath?: string; // Path to tokenizer.json file for Candle
  toolUseModelPath?: string; // Path to dedicated tool-use GGUF model (e.g., FunctionGemma)
  nThreads?: number;          // CPU threads for inference (default: 6 for Z Fold)
  nThreadsBatch?: number;     // CPU threads for batch processing (default: 4)
  autoThreads?: boolean;       // Auto-detect optimal thread count (default: false)
  nCtx?: number;              // Context size (default: 2048)
  nBatch?: number;            // Batch size for prompt processing (default: 512)
  nUBatch?: number;           // Micro-batch size (default: 512)
  multimodalProj?: string;    // Path to multimodal projector file (.mmproj)
  flashAttn?: boolean;        // Enable Flash Attention (default: false)
  cacheTypeK?: string;        // KV cache quantization for keys: 'f16'|'q8_0'|'q4_0' (default: 'f16')
  cacheTypeV?: string;        // KV cache quantization for values (default: 'f16')
  nGpuLayers?: number;        // Number of layers to offload to GPU (default: 0, 99 = all)
  useMmap?: boolean;          // Memory mapping (default: true)
  useVulkan?: boolean;        // GPU backend via Vulkan - requires device support (default: false)
  useOpenCL?: boolean;        // OpenCL backend, optimized for Qualcomm Adreno GPU (default: false)
  useHexagon?: boolean;       // Hexagon NPU backend, optimized for Qualcomm DSP (default: false)
  liteRTUseNPU?: boolean;  // Hexagon QNN NPU delegate for LiteRT, requires Qualcomm SoC (default: false)
  liteRTEnableMtp?: boolean; // Multi-Token Prediction (Speculative Decoding) for LiteRT
  minP?: number;              // Minimum probability for sampling (default: 0.05)
  useMlock?: boolean;         // Lock model in memory (default: false)
  customChatTemplate?: string;// Custom Jinja2 chat template
  // Tool calling configuration
  enableToolCalling?: boolean;                    // Enable AI to execute actions
  useDedicatedToolModel?: boolean;                // Use separate GGUF model for tool calling
  toolConfirmationMode?: 'always' | 'dangerous' | 'never'; // When to ask for confirmation
  toolRules?: Record<string, 'allow' | 'confirm' | 'deny'>; // Fine-grained tool permissions
  maxAgentIterations?: number;                             // Max tool execution loops (default: 5)
  keepAlive?: boolean;                                     // Keep app active in background
  alwaysKeepLoaded?: boolean;                              // Always keep model loaded in RAM
  keepScreenOn?: boolean;                                  // Prevent screen from dimming during inference
  serverSideAgenticEnabled?: boolean;                      // Route reasoning to OpenClaw server
  serverSideAgentProvider?: 'openclaw' | 'hermes';         // Server-side agent provider ('openclaw' | 'hermes')

  // Thinking and Search features
  enableThinking?: boolean;   // Enable model thinking/reasoning display
  thinkingBudget?: number;    // Token budget for thinking (0-24576, 0=disable)
  enableSearch?: boolean;     // Enable Google Search grounding (Gemini/Perplexity)
  // Semantic Memory configuration
  enableSemanticMemory?: boolean;  // Enable semantic memory retrieval
  embeddingModelId?: string;       // ID of the embedding model to use
  semanticMemoryMaxResults?: number; // Max memories to retrieve (default: 3)
  semanticMemorySimilarityThreshold?: number; // Min similarity for retrieval (default: 0.75)
  memorySimilarityThreshold?: number; // Min similarity for deduplication (default: 0.80)
  enableMemorySummarization?: boolean; // Enable periodic memory summarization

  // Vision configuration
  enableVision?: boolean;          // Enable multimodal vision capabilities

  // RAG Configuration
  ragChunkSize?: number;           // Default: 2000
  ragChunkOverlap?: number;        // Default: 200
  ragChunkingStrategy?: 'recursive' | 'page-level'; // Default: 'recursive'

  // Persistent Context
  storeChats?: boolean;            // Persist context state in native layer
  restoreKvCache?: boolean;        // Restore session KV Cache from disk on LiteRT init
}

// Speech-to-Text providers
export type SttProvider = 'offline' | 'online' | 'vosk' | 'whisper' | 'voxtral';

// STT processing mode
export type SttMode = 'off' | 'vosk-only' | 'hybrid' | 'whisper-post';

// Clustering algorithm for speaker diarization
export type ClusteringAlgorithm = 'ahc' | 'spectral' | 'incremental';

// Text-to-Speech providers  
export type TtsProvider = 'offline' | 'online' | 'piper' | 'kokoro';

// Legacy type for backwards compatibility
export type SpeechProvider = 'offline' | 'online';

// Whisper transcription language
export type WhisperLanguage = 'auto' | 'en' | 'it';

export interface SpeechConfig {
  ttsProvider: TtsProvider; // Text-to-Speech
  sttProvider: SttProvider; // Speech-to-Text

  // Vosk configuration
  voskModelId?: string; // e.g., 'vosk-model-en-us-0.22-lgraph'

  // Piper configuration
  piperVoiceId?: string; // e.g., 'it_IT-paola-medium'

  // Kokoro configuration
  kokoroVoiceId?: string; // e.g., 'if_sara'

  // --- Whisper configuration ---
  whisperModelId?: string;       // e.g., 'ggml-base'
  sttMode?: SttMode;             // 'vosk-only' | 'hybrid' | 'whisper-post'
  whisperLanguage?: WhisperLanguage; // 'auto', 'en', 'it' - defaults to 'auto'
  // Advanced Whisper performance settings
  whisperThreads?: number;       // Number of CPU threads (default: 4)
  whisperBeamSize?: number;      // Beam size for search (default: 5 or 2 based on profile)
  whisperBestOf?: number;        // Best of candidates (default: 1)
  whisperTemperature?: number;   // Sampling temperature (default: 0.0)
  whisperChunkSize?: number;     // Chunk size for streaming (default: 20)
  enableWhisperDiarization?: boolean; // Run diarization after Whisper transcription

  // --- Voxtral configuration ---
  voxtralModel?: string;         // Path to .gguf model file
  voxtralLatency?: 240 | 480 | 960 | 2400; // Quality preset (default: 480)
  voxtralThreads?: number;       // CPU threads (default: 4)
  voxtralMaxLen?: number;        // Max context tokens (default: 45000)

  // --- VAD (Voice Activity Detection) configuration ---
  enableVAD?: boolean;           // Enable Silero VAD
  vadModelId?: string;           // e.g., 'silero-vad-v4'
  vadSensitivity?: number;       // 0.3-0.9, higher = more sensitive (default: 0.5)
  vadMinSpeechDuration?: number; // Minimum speech duration in ms (default: 250)

  // --- Meeting/Diarization settings ---
  diarizationMode?: 'fast' | 'precise' | 'hybrid';
  clusteringAlgorithm?: ClusteringAlgorithm; // For post-processing
  enableOverlapDetection?: boolean;

  // Advanced Diarization Thresholds
  embeddingThreshold?: number;           // Default 0.80
  embeddingRejectionThreshold?: number;  // Default 0.50
  embeddingAdaptationRate?: number;      // Default 0.03
  minEmbeddingMagnitude?: number;        // Default 0.50
  diarizationSmoothingAlgorithm?: 'median' | 'hmm'; // Temporal smoothing algorithm (default: median)

  // Voice Call Audio Output
  defaultAudioOutput?: 'speaker' | 'earpiece'; // Default audio output for calls

  // --- Gemini Online provider configuration ---
  geminiTtsModel?: string;    // TTS model (e.g. 'gemini-3.1-flash'). Falls back to llmConfig.geminiModel.
  geminiTtsVoice?: string;    // Prebuilt voice (e.g. 'Kore', 'Aoede', 'Puck'). Default: 'Kore'
  geminiSttModel?: string;    // STT live model. Default: 'gemini-2.5-flash-native-audio-preview-09-2025'
  geminiSttLanguage?: string; // BCP-47 language code: 'it-IT' or 'en-US'. Default: 'it-IT'
}

// Response style for intelligent length management
export type ResponseStyle = 'concise' | 'normal' | 'detailed';

export type ProactiveFrequency = 'off' | 'low' | 'medium' | 'high';

export interface Memory {
  id: string;
  timestamp: Date;
  content: string;
  category: string; // Category for organization, defaults to 'other'
}

export const DEFAULT_MEMORY_CATEGORIES = [
  'personal',
  'work',
  'preferences',
  'dates',
  'tasks',
  'other'
] as const;

export interface GeminiBlob {
  mimeType: string;
  data: string; // base64 encoded string
}

// Wake Word configuration
export interface WakeWordSettings {
  enabled: boolean;           // Enable/disable wake word detection
  modelName: string;          // Wake word model file (e.g., 'hey_jarvis_v0.1.tflite')
  threshold: number;          // Detection threshold (0.0 - 1.0), default 0.5
  cooldownMs: number;         // Cooldown between detections in ms, default 2000
  bufferSize: number;         // Audio buffer size in chunks, default 20
  consecutiveFrames?: number; // Required consecutive high-confidence frames (default 8)
}

export const DEFAULT_WAKE_WORD_SETTINGS: WakeWordSettings = {
  enabled: false,
  modelName: 'hey_jarvis_v0.1.tflite',
  threshold: 0.5,
  cooldownMs: 2000,
  bufferSize: 20,
  consecutiveFrames: 8,
};

// Theme configuration
export interface ThemeColors {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  bubbleUser: string;
  bubbleModel: string;
  input: string;
  textPrimary: string;
  textSecondary: string;
  online: string;
  gradientGlow: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface ThemeConfig {
  presetId: string;  // 'default', 'midnight', 'ocean', etc., or 'custom'
  customColors?: Partial<ThemeColors>; // Only used when presetId is 'custom'
}

export const DEFAULT_THEME_COLORS: ThemeColors = {
  background: '#0d0d12',
  surface: '#1c1c24',
  primary: '#c026d3',
  secondary: '#7c3aed',
  bubbleUser: '#c026d3',
  bubbleModel: '#1c1c24',
  input: '#272730',
  textPrimary: '#f3f4f6',
  textSecondary: '#9ca3af',
  online: '#4ade80',
  gradientGlow: '#2e1065',
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'system',
    name: 'System Default',
    colors: {
      // Light mode defaults — dark mode handled by CSS media query
      background: '#ffffff',
      surface: '#f5f5f5',
      primary: '#7c3aed',
      secondary: '#6d28d9',
      bubbleUser: '#7c3aed',
      bubbleModel: '#f5f5f5',
      input: '#eeeeee',
      textPrimary: '#111111',
      textSecondary: '#555555',
      online: '#22c55e',
      gradientGlow: '#ede9fe',
    },
  },
  {
    id: 'default',
    name: 'Fuchsia Night',
    colors: DEFAULT_THEME_COLORS,
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    colors: {
      background: '#0a0a14',
      surface: '#12121e',
      primary: '#3b82f6',
      secondary: '#6366f1',
      bubbleUser: '#3b82f6',
      bubbleModel: '#12121e',
      input: '#1a1a2e',
      textPrimary: '#e2e8f0',
      textSecondary: '#94a3b8',
      online: '#22c55e',
      gradientGlow: '#1e3a5f',
    },
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    colors: {
      background: '#0c1929',
      surface: '#132a43',
      primary: '#06b6d4',
      secondary: '#0891b2',
      bubbleUser: '#06b6d4',
      bubbleModel: '#132a43',
      input: '#1a3a5c',
      textPrimary: '#e0f2fe',
      textSecondary: '#7dd3fc',
      online: '#34d399',
      gradientGlow: '#083344',
    },
  },
  {
    id: 'forest',
    name: 'Forest Green',
    colors: {
      background: '#0a120a',
      surface: '#132013',
      primary: '#22c55e',
      secondary: '#16a34a',
      bubbleUser: '#22c55e',
      bubbleModel: '#132013',
      input: '#1a2d1a',
      textPrimary: '#dcfce7',
      textSecondary: '#86efac',
      online: '#4ade80',
      gradientGlow: '#14532d',
    },
  },
  {
    id: 'sunset',
    name: 'Warm Sunset',
    colors: {
      background: '#18100c',
      surface: '#2a1a12',
      primary: '#f97316',
      secondary: '#ea580c',
      bubbleUser: '#f97316',
      bubbleModel: '#2a1a12',
      input: '#3d2516',
      textPrimary: '#fff7ed',
      textSecondary: '#fdba74',
      online: '#fbbf24',
      gradientGlow: '#7c2d12',
    },
  },
  {
    id: 'rose',
    name: 'Rose Gold',
    colors: {
      background: '#1a0a10',
      surface: '#2a1420',
      primary: '#f43f5e',
      secondary: '#e11d48',
      bubbleUser: '#f43f5e',
      bubbleModel: '#2a1420',
      input: '#3d1a28',
      textPrimary: '#fff1f2',
      textSecondary: '#fda4af',
      online: '#fb7185',
      gradientGlow: '#881337',
    },
  },
];

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  presetId: 'default',
};

export interface Settings {
  personality: Personality;
  llmConfig: LLMConfig;
  speechConfig: SpeechConfig;
  apiKey: string;
  perplexityApiKey?: string;
  claudeApiKey?: string;
  openrouterApiKey?: string;
  openRouterModels?: any[];
  hfToken?: string;
  autoPlayAudio: boolean;
  enableDnd: boolean;
  dndStart: string; // HH:mm
  dndEnd: string;   // HH:mm
  responseStyle: ResponseStyle;
  proactiveFrequency: ProactiveFrequency;
  enableAiMemoryCategorization?: boolean;
  wakeWord?: WakeWordSettings; // Wake word configuration
  theme?: ThemeConfig; // Theme configuration
  enableSystemMonitor?: boolean;
  systemMonitorFrequency?: number;
  showRam?: boolean;
  showAppRam?: boolean;
  showCpu?: boolean;
  showGpu?: boolean;
  // supportServer: removed in v4.0.0 — use aimindmeshServer for web delegation
  androidAuto?: {
    enabled: boolean;
    showCallMode: boolean;
    showCalendar: boolean;
    showToDo: boolean;
    showKanban: boolean;
  };
  disableKnowledgeDbPing?: boolean;
  proactive?: ProactiveSettings;
  enableNotificationVibration?: boolean;
  saveMeetingAudio?: boolean;
  // v4.0.0 AIMindMesh Server integration
  aimindmeshServer?: AIMindMeshServerSettings;
  /** Automatically sync new memories to server KG (fire-and-forget) */
  autoSyncNewMemories?: boolean;
  /** Automatically check for app updates via server */
  autoCheckUpdates?: boolean;
}
