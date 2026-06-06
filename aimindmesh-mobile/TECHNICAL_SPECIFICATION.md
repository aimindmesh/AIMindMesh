# AI Mind Mesh - Technical Specification
 
> **Version:** 0.1.0
> **Server Version:** 0.1.0
> **Repository:** https://github.com/aimindmesh/AIMindMesh
> **Last Updated:** May 17, 2026
> **Architecture:** Local-First Hybrid Agent + Distributed Ecosystem

## 1. Executive Summary & Philosophy

AI Mind Mesh is a privacy-focused, local-first personal assistant designed for Android. Unlike cloud-dependent assistants, it prioritizes **on-device execution**, **data sovereignty**, and **agentic capability**.

### Core Tenets
1.  **Local First**: Core intelligence (LLM, STT, TTS, Vector DB) runs on-device using optimized inference engines (llama.cpp, LiteRT, Vosk/Piper). Cloud fallback (Gemini/Perplexity) is optional.
2.  **Agentic Architecture**: The AI is not just a chatbot; it is an agent with a "body" (the device). It can execute shell commands, manage files, control hardware, and interact with other apps.
3.  **Hybrid Intelligence**: Seamlessly switches between lightweight local models for privacy/speed (Gemma 3, Llama 3) and powerful cloud models for complex reasoning (Gemini 3.1 Flash Lite, Sonar Pro).
4.  **Semantic Memory**: Features a vector-based long-term memory system that retrieves relevant context from past conversations based on meaning, not just keywords.
5.  **Context Saturation Protection**: Advanced multi-layered context management combining LLM-based summarization (cloud or local) with a robust "rolling context" fallback to ensure coherence in long conversations while protecting critical system anchors.

---

## 2. System Architecture

The application uses a **React Native-like** architecture but with a custom, highly optimized native layer.

### 2.1 Technology Stack
*   **Frontend**: React 18, TypeScript, Vite, TailwindCSS (Utility-first styling).
*   **Container**: Capacitor 5 (Native Bridge).
*   **Vector Database**: SQLite (via `sqlite-vec` compatible logic) + `all-MiniLM-L6-v2` embeddings (ONNX).
*   **Native Layer**: Android (Java/Kotlin/C++).
*   **Inference Engines**:
    *   **LLM**: `llama.cpp` (GGUF format) & `LiteRT` (Gemini Nano/Gemma format).
    *   **STT**: `Vosk` (Offline), `Voxtral Mini 4B Realtime` (Offline, High-quality), `OpenAI Whisper` (C++ port), `Silero VAD` (Voice Activity Detection).
    *   **TTS**: `Piper` (Neural speech synthesis).

### 2.2 Directory Structure
*   `src/`: Frontend React application.
    *   `services/`: Core business logic.
        *   `calendar/`: Modularized into `tasks/` and `agenda/` folders.
        *   `llm/providers/liteRT/`: Dedicated logic for LiteRT session management.
        *   `wakeword/wakeword/`: Specialized training and file management sub-modules.
    *   `hooks/`: Shared state logic (Significant migration of UI logic to hooks).
    *   `components/`: UI components (Heavily modularized to keep file sizes < 600 lines).
        *   `layout/`: Extracted layout components like `AppNavbar` to ensure maintainability.
        *   `onboarding/`: First-run onboarding wizard. Includes optional server configuration step.
    *   `types/`: Centralized TypeScript definitions.
*   `android/`: Native Android project.
    *   `plugins/`: 17 Custom Capacitor plugins.
    *   `utils/`: Native audio processing utilities (`AudioEncoder`, `AudioDecoder`, `WavHelper`).

### 2.3 Data Persistence & Resilience
*   **Database**: SQLite is the primary storage engine for all persistent data (Memories, Calendar, Settings).
    *   **Architecture**: Multi-database isolation (separate files for memories, meeting history, and global settings).
    *   **Concurrency**: **Write-Ahead Logging (WAL)** mode enabled across all databases to permit concurrent reads while a write operation is in progress (bypassing `SQLITE_BUSY` contention).
    *   **Performance Tuning**:
        *   `journal_mode = WAL`: Optimized for concurrent access.
        *   `synchronous = NORMAL`: Balanced safety/speed; protects database integrity while doubling write throughput vs `FULL`.
        *   `cache_size = -8000`: 8MB page cache per database connection.
        *   `wal_autocheckpoint = 1000`: Automated checkpointing every 1000 pages to keep `.wal` file sizes manageable.
        *   **Background Maintenance**: Periodic `PRAGMA wal_checkpoint(PASSIVE)` triggered via `DatabaseManager.walCheckpoint()` during app idle states.
*   **Connection Management**: Uses a custom **Robust Proxy Pattern** to automatically handle Android lifecycle events.
*   **Auto-Recovery**: Automatically detects and recovers from OS-initiated connection closures (e.g., when app is backgrounded/killed) without data loss or user interruption.

---

## 3. Native Plugin Catalog

The unique power of AI Mind Mesh comes from its extensive suite of custom native plugins that bridge the web view with the operating system.

| Plugin Name | ID | Description & Key Capabilities |
| :--- | :--- | :--- |
| **FCM** | `fcm-capacitor` | **Firebase Cloud Messaging**. Native Kotlin plugin for receiving push notifications from AIMindMesh Server. Manages token lifecycle (register, refresh), dispatches foreground messages as typed events to the TypeScript event bus (`onFCMFeedEvent`), and handles inline `MARK_READ_ACTION` from notification tray. Google Services JSON required. |
| **LlamaCpp** | `llama-cpp-capacitor` | **Core LLM Engine**. Upgraded to `llama.rn@0.11.3` (PocketPal). Native support for Qwen 3.5 (Hybrid Mamba), Gemma 3n, and modern GGUF architectures. Supports CPU, Vulkan, and OpenCL. |
| **MeetingExport** | `meeting-export-capacitor` | **Export & Share**. Renders HTML to PDF and handles Android Share Intents. |
| **LiteRT** | `litert-capacitor` | **Google Edge AI Engine**. Runs `.litertlm` models (Gemma 3, Gemma 4 E2B/E4B) via LiteRT 0.11.0 runtime. Optimized for mobile NPU/GPU delegates, Multi-Token Prediction (MTP/Speculative Decoding), and memory-mapped embeddings. |
| **Vosk** | `vosk-capacitor` | **Offline Speech-to-Text**. Continuous large-vocabulary speech recognition. Fast, lightweight. Used for Meeting Mode and Voice Mode. |
| **Voxtral** | `voxtral-capacitor` | **Real-time STT**. Mistral Voxtral Mini 4B Realtime via `mtmd` multimodal API (PCM→mel→CLIP→llama). Greedy token sampling (temperature=0). Auto-unloads main LLM for memory coordination. |
| **Whisper** | `whisper-capacitor` | **High-Fidelity STT**. Runs OpenAI Whisper models (cpp port). Supports multilingual transcription and diarization preprocessing. |
| **Piper** | `piper-capacitor` | **Neural TTS**. Synthesizes speech locally. Supports ONNX voice models with variable speech/pitch. |
| **Wakeword** | `wakeword-capacitor` | **Hotword Detection**. Runs `.tflite` models (e.g., "Hey Jarvis"). Monitoring usually 500ms intervals. |
| **VAD** | `vad-capacitor` | **Voice Activity Detection**. Silero VAD based. Detects when user starts/stops speaking to handle turn-taking. |
| **AudioOutput** | `audio-output-capacitor` | **Audio Routing**. Switches output between Earpiece (privacy) and Speakerphone. |
| **AudioPlayback** | `AudioPlaybackPlugin` | **Segment Playback**. Leverages AndroidX Media3 ExoPlayer for precise Tap-to-Play segment replay without degrading live mic recording quality (bypasses AEC ducking). |
| **AudioConverter** | `n/a` (Java Utility) | **Media Processing**. Uses specialized `AudioEncoder`, `AudioDecoder`, and `WavHelper` utilities to process PCM to AAC/M4A/WAV. |
| **Termux** | `termux-capacitor` | **Shell Execution**. Bridges app to Termux environment. Executes `bash` commands, installs packages (`pkg`), manages files. |
| **BackgroundService** | `background-service-capacitor` | **Process Management**. Manages service lifecycle. The Proactive service has been transitioned to a standard background service to eliminate persistent notifications while maintaining periodic execution. |
| **Proactive** | `ProactivePlugin` | **Proactive Engine**. Dynamically controls the `ProactiveBackgroundService` loop, ensuring reliable on-device monitoring for suggestions. |
| **KeepAlive** | `KeepAliveService` | **Persistence**. Special use foreground service to guarantee "Always Loaded" model availability. |
| **AndroidAuto** | `android-auto-capacitor` | **Car Integration**. Projects a simplified UI (GridTemplate) to car dashboard via IOT category. Screens: Main, Call Mode, Calendar, To-Do, Kanban. |
| **Performance** | `performance-capacitor` | **Battery Opt**. Requests "Ignore Battery Optimizations" to allow heavy compute. Checks thermal state. |
| **SystemMonitor** | `system-monitor-cap` | **Diagnostics**. Real-time CPU/RAM usage tracking with granular visibility controls (RAM, CPU, GPU, App Mem). Floating overlay capability. |
| **SpeakerEmbedding** | `speaker-embedding-capacitor` | **Biometrics**. Generates vector embeddings from voice audio for Speaker Diarization (Guest vs User 1 vs User 2). |
| **TextEmbedding** | `text-embedding-capacitor` | **RAG Core**. Runs `all-MiniLM-L6-v2` to vectorize text for Semantic Memory storage and retrieval. |

### 3.1 Vulkan Acceleration & Architecture Constraints
The `llama-cpp-capacitor` plugin utilizes Vulkan for hardware-accelerated LLM inference. Due to Android NDK constraints and upstream `llama.cpp` divergence, the integration adheres to strict architectural patches:

*   **Engine Alignment**: Synchronized with `llama.rn` to enable modern sampling (`common_sampler`), Jinja2 templates, and hybrid compute graphs (Mamba/SSM).
*   **Version Pinning**: The `ggml-vulkan` drivers are matched to the core `ggml.h` tensor operations definition. |
*   **AOT Shader Generation**: SPIR-V shaders (`.spv`) are compiled Ahead-Of-Time (AOT) using a custom Python script invoking the Android NDK `glslc` compiler. This generates `ggml-vulkan-shaders.cpp`.
*   **Precision Downgrades via Extensions**: Certain Android device GPUs lack support for advanced subgroup extensions like `GL_EXT_shader_explicit_arithmetic_types_float16`. To ensure universal compatibility, the AOT compiler deliberately maps the `FLOAT_TYPE` macro to standard `float` instead of `float16_t` for the `mul_mat_vec` quantized execution (e.g., `q4_K`).

### 3.2 OpenCL Acceleration (Qualcomm Adreno GPU — Preferred)
The `llama-cpp-capacitor` plugin exposes a second GPU backend using the OpenCL driver contributed by Qualcomm to upstream `llama.cpp`. Unlike Vulkan, this backend is specifically tuned for Adreno shader compiler optimizations and incurs lower driver overhead.

**Priority Order** (highest to lowest): OpenCL > Vulkan > CPU. Enabling OpenCL automatically disables Vulkan.

**Data Flow**:
```
LLMConfig.useOpenCL (TS)
  └─> nativeLLM.ts (passes use_opencl=true, use_vulkan=false)
        └─> LlamaCppPlugin.java (.withOpenCL())
              └─> smollm_jni.cpp (jboolean useOpenCL)
                    └─> LLMInference.cpp::loadModel()
                          ├─> setenv("GGML_OPENCL_PLATFORM", "0") → Adreno GPU
                          ├─> setenv("GGML_OPENCL_DEVICE", "0")
                          ├─> model_params.n_gpu_layers = 99
                          └─> lm_ggml_backend_load_all() (dynamically loads OpenCL backend)
```

**Architecture Requirements**: The `android/CMakeLists.txt` must be compiled with `-DGGML_OPENCL=ON` for this path to activate. Otherwise, `lm_ggml_backend_load_all()` simply skips the OpenCL backend registration silently.

### 3.3 LiteRT QNN NPU Delegate (Qualcomm Hexagon)
The `litert-capacitor` plugin supports optional routing of quantized tensor operations to the Qualcomm Hexagon NPU via the QNN (Qualcomm Neural Network) delegate.

**Mechanism**: `android.system.Os.setenv("LITERT_DELEGATE", "QNN")` before engine construction causes LiteRT to load `libQnnHtp.so` and route supported ops (matmul, conv) to the Hexagon DSP/NPU at load time.

**Data Flow**:
```
LLMConfig.liteRTUseNPU (TS)
  └─> liteRTProvider.ts (passes useNPU=true)
        └─> LiteRT/plugin.ts (forwards to initModel call)
              └─> LiteRTPlugin.kt::initModel()
                    ├─> Os.setenv("LITERT_DELEGATE", "QNN")
                    ├─> Os.setenv("QNN_BACKEND_LIB", "libQnnHtp.so")
                    └─> Engine(config) → LiteRT loads QNN HTP delegate
```

**Device Requirements**: Snapdragon 8 Gen 2 or later. Falls back gracefully to selected CPU/GPU backend if `libQnnHtp.so` is not present on the device.

---

## 4. Feature Modules

### 4.1 Agentic Chat
The primary interaction interface with full agentic capabilities.

#### 4.1.1 Input Modalities
*   **Text**: Direct typing via chat input
*   **Voice**: Speech-to-text via Vosk or Whisper
*   **Images**: Camera capture, gallery selection, or clipboard paste (requires vision-capable model)
*   **Files**: Direct upload for document analysis

#### 4.1.2 Tool Execution (ReAct Pattern)
The assistant can automatically execute tools based on user intent:

**Workflow**:
1.  **Intent Detection**: LLM identifies need for external action (e.g., "search the web for X")
2.  **Tool Selection**: Chooses appropriate tool from 42 available functions
3.  **Parameter Extraction**: Extracts required parameters from conversation context
4.  **Confirmation** (optional): Asks user for approval based on tool danger level
5.  **Execution**: Runs tool via native bridge (e.g., `run_termux_command`, `search_web`)
6.  **Observation**: Tool returns result formatted as "Observation: [result]".
7.  **Reasoning & Integration**: LLM performs a new thinking cycle to evaluate the observation and determine the next step (another tool or final answer).

**Example Flow**:
```
User: "What's the weather in Tokyo?"
LLM Thought: I need to search the web for current weather
[Tool: search_web("Tokyo weather")]
Observation: "Currently 18°C, partly cloudy..."
LLM Response: "The weather in Tokyo is currently 18°C and partly cloudy."
```

#### 4.1.3 Thinking Mode
When enabled, displays internal reasoning process before final answer:
*   **Visual Distinction**: Thinking block shown in muted color with "thought bubble" icon
*   **Token Budget**: Configurable limit (default: unlimited)
*   **Use Cases**: Complex reasoning, math problems, code debugging, multi-step planning
*   **Performance**: Adds latency but improves answer quality for complex queries

#### 4.1.4 Message Persistence & Context
*   **Auto-Save**: All messages persisted to SQLite immediately
*   **Context Window**: Configurable via `nCtx` (default: 2048 tokens). In Dual-Model Tool Calling (GGUF), `nCtx` is automatically synchronized across both Chat and Extraction models. **Update**: Introduced Intelligent Context Summarization for extraction. If the extraction prompt exceeds the tool model's limit (e.g., 2048 tokens), the main model automatically generates a concise summary of the relevant history to ensure accurate tool selection without context overflow.
*   **Native Statefulness**:
    *   **GGUF (PocketPal Engine)**: Uses native C++ Jinja2 templates (via `llama.rn` matching) instead of manual TypeScript formatters. Resolves formatting errors by passing OpenAI-compatible `messages` arrays directly to the C++ backend. Employs a Mutex locked `initContext` pattern with Memory-Pressure batch constraints to prevent initialisation race conditions. Uses KV Cache reuse (~95% hit rate via System Prompt Optimization) and token diffing to avoid re-processing the entire prompt history on every turn. Only new tokens are computed.
    *   **LiteRT**: Maintains `Conversation` state object in native memory, syncing message counts with frontend to ensure consistency. 
    *   **LiteRT KV Protection**: The streaming engine relies on the model cleanly outputting its `<end_of_turn>` EOS token. Tool calls (`</tool>`) do **not** forcibly stop the native engine—this prevents syntactical corruption of the Conversation buffer which would otherwise cause severe tool hallucinations (e.g. `<tool>Answer</tool>`).
    *   **LiteRT Template Wrapping**: Manual prompt tags (`<start_of_turn>`) are omitted when passing string buffers to Android because LiteRT's `Conversation` engine automatically wraps User/Model turns. Passing pre-formatted strings causes "Double-Wrapping", immediately breaking Gemma generation.
    *   **LiteRT-LM Architecture**: Upgraded engine to LiteRT-LM `0.11.0` (released May 2026). Supports **Multi-Token Prediction (MTP)** for speculative decoding on GPU backends, significantly improving generation speed on compatible hardware. GPU/NPU acceleration is handled via `Backend` sealed classes. **Gemma 4 Support**: Optimized for the latest `.litertlm` models. The implementation handles response extraction by filtering `Message.contents` for `Content.Text` instances, ensuring compatibility with the latest bytecode-verified API. Engine initialization uses `EngineConfig` with persistent `cacheDir` for accelerated cold starts.
    *   **Drift Detection**: Automatically resets native context if frontend history diverges from native state (e.g., deleted messages).
*   **Context Management**: Automatically truncates oldest messages when limit reached
*   **Memory Integration**: Semantic memories injected into context based on relevance

#### 4.1.6 Persistent KV Cache
To eliminate redundant "Prefill" times (the time taken to process the conversation history) during app restarts or context switching, the system implements a disk-based KV cache persistence layer for native providers:
*   **LiteRT-LM**:
    *   **Persistent History**: A dedicated `ConversationPersistenceManager` serializes the message history (including base64 media) to JSON in the app's `cache/litert_cache/` directory.
    *   **Auto-Restore**: Upon engine initialization, if the native context is empty, the system automatically re-loads and re-submits the persisted history. This efficiently rebuilds the LiteRT-LM KV cache state, ensuring the next generation starts from the previous state without reprocessing everything from scratch.
    *   **Invalidation**: The cache is automatically cleared when a "Hard Reset" or "New Chat" is initiated.
*   **LlamaCpp (GGUF)**:
    *   **Slot-Based Persistence**: Utilizes the `/slots/{id}?action=save/restore` REST API for persistent KV management. 
    *   **Server-Side State**: If running `llama-server`, binary KV state is flushed to disk (e.g., in the `--slot-save-path` directory) ensuring instant resumption after app backgrounding or server restart.
*   **Lifecycle Synchronization**: Integrated with the Android application lifecycle. The `NodeWorker` and native plugins automatically flush the active KV state to disk when the application transitions to the background (`appStateChange: inactive`).

### 4.1.5 Context Management & VRAM Optimization
To prevent OOM (Out Of Memory) kills on Android and Adreno GPU crashes, the system implements a multi-layered context protection strategy:
*   **Real Tokenization (BPE)**: Uses `js-tiktoken` (`cl100k_base`) for accurate token estimation. Replaces character-based heuristics to ensure the LLM never receives a prompt exceeding its hardware-allocated context window.
*   **Dynamic RAM-Pressure Scaling**: A native observer listens to Android `onTrimMemory` and `onLowMemory` signals. If the OS reports high memory pressure, the app dynamically reduces the `maxTokens` budget (by up to 60%), forcing earlier history summarization to free VRAM *before* a system kill occurs.
*   **Tool Output Pruning**: Large tool results (e.g., web searches > 800 tokens) are automatically summarized by a fast cloud or local model before being injected into the conversation, preserving reasoning space.
*   **GGUF Context Sync (Append Mode)**: Synchronizes the UI message count with the native `llama.cpp` KV cache. 
    *   **Append Mode**: If counts match, only the newest message is sent, enabling incremental KV cache reuse (~90% speedup).
    *   **Hard Reset**: If history diverges, the native context is explicitly reset to prevent "inconsistent sequence position" errors.
*   **Template De-Duplication**: Strips outer chat wrappers from formatted prompts when passing to native engines (GGUF/LiteRT) to prevent "Double-Wrapping" (e.g., nested `<|user|>` tags), which otherwise causes infinite loops or truncated responses.

### 4.2 Semantic Memory (Long-Term RAG)
Vector-based memory system that enables the AI to recall relevant context from past conversations.

#### 4.2.1 Ingestion Pipeline
*   **Auto-Capture**: Messages exceeding 20 characters automatically saved
*   **Embedding Model**: `all-MiniLM-L6-v2` (384-dimensional vectors via ONNX)
*   **Storage**: SQLite with `sqlite-vec` extension for efficient vector search
*   **Metadata**: Each memory stores timestamp, category, embedding, and original text

#### 4.2.2 Categorization System
**Auto-Categorization** (optional):
*   Uses LLM to classify memories into categories (Facts, Tasks, Preferences, Events, Knowledge)
*   Triggered on save or via batch processing
*   Improves retrieval precision by category filtering

**Manual Categories**:
*   User can create custom categories (e.g., "Work", "Family", "Hobbies")
*   Manually assign memories to categories via Memory Browser
*   Filter retrieval by category for context-specific queries

#### 4.2.3 Retrieval & Ranking
**Query-Time Process**:
1.  User query vectorized using same embedding model
2.  Cosine similarity computed against all stored memories
3.  Top N memories (default: 3) with similarity > 0.75 retrieved
4.  Results ranked by similarity score
5.  Injected into system prompt as context

**Deduplication**:
*   Periodic cleanup removes semantically identical memories (similarity > 0.90)
*   See Proactive Assistant → Memory Maintenance (4.6.4)

#### 4.2.4 Memory Management UI
**Memory Browser** (Settings → Memory):
*   View all stored memories with timestamps
*   Search by text or category
*   Manually add/edit/delete memories
*   Bulk export/import as JSON
*   View similarity scores for debugging

### 4.3 Meeting Mode & Diarization
*   **Real-time Transcription**: Uses Vosk for immediate text stream.
*   **Tap-to-Play & Interactive Transcripts**:
    *   **Timestamp Sync**: Native STT plugins (Vosk, Whisper, Voxtral) emit microsecond-accurate relative `start_ms` and `end_ms` boundaries for each word/segment.
    *   **Audio Storage Architecture**: Live PCM buffers are continuously encoded and appended to a native `.m4a` file in the device `Data` directory, eliminating `localStorage` RAM exhaustion and OOM crashes during long (>2hr) recordings.
    *   **Segment Replay**: Custom `AudioPlaybackPlugin` loops targeted sub-segments and respects the active microphone's AEC state to prevent echo or degradation of ongoing live recordings.
    *   **Transcript Editing & Metadata**: Long-pressing a paragraph enables inline text editing. Both the revised and original texts are persistently managed in the SQLite `meetingDatabase`.
    *   **Export**: Full transcripts can be exported to Markdown, PDF (via WebView Print Adapter), SRT, and VTT with accurate timestamping.
*   **Speaker Separation**:
    *   **Real-time**: ECAPA-TDNN embedding-based identification with **Periodic Mini-Clustering** — every 30s (or 10 segments), `IncrementalStrategy` re-clusters all session embeddings to refine speaker centroids and correct prior greedy assignments, bringing post-processing quality to live transcription.
    *   **Post-Process (Reprocessing)**: Robust **3-Pass Diarization**:
        1.  **Profiling**: Global clustering of sliding-window ECAPA-TDNN embeddings to create stable Speaker Profiles. Windows are filtered to exclude silence using **VAD-gated filtering** (Silero VAD when `enableVAD` is on and model is loaded) or **RMS energy gating** (fallback, threshold: 0.01).
        2.  **Classification**: Re-assigns transcript segments by averaging embeddings in each segment's time window and matching to the closest global centroid.
        3.  **Smoothing**: Configurable temporal smoothing:
            *   **HMM Viterbi Decoder** (Recommended): Eliminates rapid speaker changes using hidden Markov model transition probabilities.
            *   **Median Filter**: Simple 5-segment sliding window to eliminate spurious single-segment oscillations (e.g., `[0,1,0,0,0]` → `[0,0,0,0,0]`).
*   **ONNX Runtime Safety**: VAD and ECAPA plugins share a single process-global `OrtEnvironment` singleton. VAD's `release()` only closes its `OrtSession`, not the shared environment.
*   **Memory Optimization**: Dynamic resource management automatically unloads heavy LLM models (GGUF/LiteRT) when Voxtral is active to prevent Out-Of-Memory (OOM) errors, reloading them on demand. The Voxtral STT service calls `releaseAllSmolLM()` before model initialization.
*   **Post-Process**: Can use Whisper for high-quality final transcript cleanup.

### 4.4 Agenda & Kanban
Comprehensive productivity system combining calendar events, tasks, and notes.

#### 4.4.1 Calendar Events
*   **Creation**: Via AI tools (`create_calendar_event`), manual entry, or import from system calendar
*   **Fields**: Title, date, start time, end time, location, notes, recurrence
*   **Notifications**: Configurable reminders (15min, 1hr, 1day before)
*   **Color Coding**: Visual distinction by event type or category
*   **Integration**: Syncs to Android Auto for in-car display

#### 4.4.2 Task Management (Kanban)
**Statuses** (5 columns):
1.  **Backlog**: Future tasks, not yet prioritized
2.  **Todo**: Prioritized and ready to start
3.  **In Progress**: Currently being worked on
4.  **Review**: Completed but awaiting review/approval
5.  **Done**: Fully completed

**Task Properties**:
*   **Title**: Short description
*   **Due Date**: Optional deadline with overdue highlighting
*   **Priority**: Low, Medium, High, Critical (visual badges)
*   **Tags**: Custom labels for filtering
*   **Notes**: Detailed description or context
*   **AI-Generated**: Flag for tasks created by proactive assistant

**Drag & Drop**: Touch-based column transitions (swipe to move between statuses)

#### 4.4.3 Day View (Agenda)
*   **Timeline**: Hour-by-hour visualization (00:00 - 23:59)
*   **Event Blocks**: Visual representation of scheduled events with duration
*   **Task List**: Due tasks shown at top of day
*   **Notes Section**: Day-specific freeform notes via `add_agenda_note` tool
*   **Navigation**: Swipe left/right to change days, tap date to jump

#### 4.4.4 Integration with AI
*   **Natural Language Creation**: "Remind me to call John tomorrow at 3pm" → Auto-creates event
*   **Smart Rescheduling**: AI suggests optimal times for conflicting events
*   **Task Extraction**: Detects action items in conversation and offers to create tasks
*   **Voice Commands**: Full CRUD via voice in Call Mode

### 4.5 Document RAG & Workspaces
*   **Ingestion Pipeline**: Parses PDF/DOCX/TXT/MD -> Chunks (Configurable: Recursive/Page-level, Size: 2000, Overlap: 200) -> Embeds (all-MiniLM-L6-v2) -> Stores in `knowledge_db`.
*   **Distributed Ingestion & Sync**: The system supports two primary ingestion workflows based on server connectivity:
    *   **Standard Mode (Server-First)**: When `aimindmeshServer.enabled` is true, ingestion is delegated to the server API (`/api/documents/ingest/file`). To save local resources (RAM/VRAM), the local indexing is **skipped**. The file is processed and searchable via the server.
    *   **Distributed Ingestion & Sync**: The system features a robust bidirectional synchronization infrastructure between mobile nodes (ZFOLD5, ZFOLD7) and the VPS server:
        1.  **Manual Sync Trigger**: Users can initiate an atomic sync from Settings -> Server, forcing an immediate exchange of SQLite (mobile) and Neo4j (server) knowledge deltas.
        2.  **Bidirectional Knowledge Exchange**: Local memories, meeting transcripts, and calendar events are pushed to the server for global KG integration, while server-side insights and Neural Wiki updates are pulled to the device.
        3.  **FCM Sync Triggers**: The server can broadcast `SYNC_REQUEST` push notifications via Firebase to all registered mobile nodes, triggering background "Silent Syncs" to ensure ecosystem-wide eventual consistency.
        4.  **Local Fallback**: If the server is disabled or unreachable, the system automatically falls back to the strictly local pipeline.
*   **Workspaces**: Logical grouping of documents (e.g., "Personal", "Work", "Project X"). Search is scoped to the active workspace.
*   **Hybrid Search**: Combines FTS5 (Keyword) and Vector (Semantic) search using Reciprocal Rank Fusion (RRF).
*   **Context Injection**: Automatically retrieves relevant chunks from the active workspace and injects them into the prompt.
*   **UI Performance & Client-Side Pagination**: To prevent rendering lag when displaying large indexes (e.g., 24,000+ files synced from Gitea), the client-side Knowledge Base explorer utilizes strict page-based chunking (`pageSize` selector of 20, 50, 100, or 200 rows) using a reactive windowing slice (`paginatedDocs = filteredDocs.slice(...)`). This reduces the active DOM size from thousands of simultaneous table rows down to a negligible count, maintaining high UI responsiveness.

### 4.6 Android Auto Integration
*   **Grid UI**: Custom `GridTemplate` dashboard optimized for driver safety.
*   **Launcher Integration**: Dedicated launcher icons for core modules (Kanban, Assistant Call, Agenda) appearing directly in the Android Auto app drawer.
*   **Deep Linking**: Support for Android Shortcuts (`shortcuts.xml`) that allow direct navigation to specific screens from the car launcher.
*   **Data Sync**: Real-time synchronization of Calendar, To-Do, and Kanban data from app to car.
*   **Voice Interop**: Direct access to "Assistant Call" for hands-free voice interaction via Vosk/Piper.
*   **App Category**: Registered with `androidx.car.app.category.IOT` for template-based car UI. Requires "Allow unknown sources" in Android Auto developer settings for sideloaded builds.

### 4.7 Proactive Assistant
This module enables the AI to act autonomously based on context, without waiting for explicit user prompts.

#### 4.7.0 Server-Mode Integration
When `aimindmeshServer.enabled = true`, the `ProactiveService` enters **Server Mode**:
*   **Intelligence Source Selection**: Users can choose in Settings → Proactive between **"Hybrid/Server Data"** (Auto) and **"Strictly Local"** (Privacy-focused).
    *   **Auto**: Default. Uses server-side insights (FCM) when online, fallback to local when offline.
    *   **Strictly Local**: Explicitly disables server-side proactive push reception even if the server is online, ensuring the background engine only uses on-device context.
*   **Local Suspension**: If source is "Auto" and server is online, the native `BackgroundServicePlugin` check listener is detached.
*   **Server Delegation**: The AIMindMesh Server generates insights and sends `NEW_INSIGHT` push notifications.
*   **Automatic Fallback**: The `useServerMode` hook pings `/api/health` every 60 seconds. After 3 consecutive failures, `ProactiveService.disableServerMode()` is called, restoring local proactive behavior.
*   **State Events**: `onServerModeChange(cb)` notifies UI consumers of online/offline transitions for banner display.

#### 4.7.1 Action Categories & Types

The Proactive Assistant operates through **5 action categories**, each with specific behaviors and user interaction patterns:

##### Silent Actions (Background)
Execute without any user notification. Used for performance optimization and maintenance.
*   **Preload Model**: Loads LLM into memory before predicted usage (e.g., morning routine)
*   **Sync Data**: Background synchronization of calendar, tasks, and knowledge base
*   **Cache Cleanup**: Removes stale cache files to free storage
*   **Index Documents**: Processes newly added documents for RAG search

##### Informative Actions (Notifications)
Passive notifications to keep user informed without requiring interaction.
*   **Badge Update**: Updates app icon badge count (e.g., pending tasks)
*   **Toast Notification**: Brief in-app message (slides in/out)
*   **System Notification**: Android notification tray alert

##### Suggestive Actions (In-App Cards)
Non-intrusive suggestions displayed as cards within the app UI. User can dismiss or act on them.
*   **Task Priority**: Suggests reordering tasks based on deadlines and importance
*   **Schedule Change**: Recommends rescheduling events due to conflicts or travel time
*   **Break Reminder**: Suggests taking a break after extended focus periods
*   **Knowledge Review**: Prompts to review documents before meetings
*   **Optimization**: Battery/storage/performance improvement suggestions
*   **Task Review**: Prompts to review overdue or stale tasks

##### Interactive Actions (Chat Messages)
Proactive messages sent to the chat interface, initiating conversation.
*   **Morning Briefing**: Daily summary of calendar, tasks, and relevant context (e.g., 7:00 AM)
*   **Event Reminder**: Contextual reminder 15min before events with prep suggestions
*   **Meeting Briefing**: Contextual briefing injected before scheduled meetings, built via RAG and semantic memories. The lead time (in minutes) is globally configurable by the user in `ProactiveSettings`.
*   **End-of-Day Summary**: Recap of completed tasks and tomorrow's preview (e.g., 8:00 PM)
*   **Follow-up Question**: Asks clarifying questions about incomplete tasks or vague notes
*   **Curiosity**: Initiates conversation based on detected patterns (e.g., "You've been researching X, would you like me to summarize?")
*   **Daily Review**: Summarizes the day and asks questions to consolidate memory

##### Autonomous Actions (Direct Modifications)
⚠️ **Requires explicit permission**. Directly modifies user data without confirmation.
*   **Create Task**: Auto-generates tasks from detected intents (e.g., "remind me to call John" in notes)
*   **Reschedule Event**: Automatically moves conflicting events to available slots
*   **Categorize Note**: Tags/categorizes notes and memories for better organization
*   **Tag Memory**: Applies semantic tags to memories for improved retrieval
*   **Archive Old Data**: Moves items older than retention period to archive
*   **Memory Maintenance**: Deduplicates and summarizes memories (see 4.7.3)

#### 4.7.2 Context Engine

The system continuously evaluates **context** to determine when and what actions to trigger:

**Device Context:**
*   Battery level and charging state
*   Network connectivity (WiFi, cellular, offline)
*   Storage availability
*   CPU/thermal state

**App Context:**
*   Current screen (chat, calendar, settings, etc.)
*   Focus mode enabled/disabled
*   Time since last user interaction

**User Context:**
*   Activity state: Active, Idle (30+ min), Focus
*   Recent chat history (last 10 messages)
*   Upcoming events (today)
*   Overdue tasks
*   Memory count and recency

**Temporal Context:**
*   Time of day (morning, afternoon, evening, night)
*   Day of week (workday vs weekend)
*   Quiet hours window


#### 4.7.3 Architecture & Privacy
*   **Local Processing**: All context analysis happens strictly on-device. No sensor data is sent to the cloud.
*   **Action Engine**: Executes Silent, Informative, Suggestive, Interactive, and Autonomous actions based on a priority queue.
*   **Permission System**: Granular controls per action category and rate limiting ensure the assistant remains helpful, not intrusive.
*   **Background Service**: A lightweight background service (`ProactiveBackgroundService`) enables periodic checks (default: 15min). To ensure a premium user experience with zero UI clutter, it operates as a standard background service (non-foreground), relying on AlarmManager `setAndAllowWhileIdle` for persistence. Its lifecycle is strictly controlled via `ProactivePlugin`, ensuring perfect synchronization with user preferences (dynamically starts/stops when toggled).
*   **Persistence**: Automatically starts `KeepAliveService` on app mount and synchronizes settings with native layer to prevent OS from unloading the mission-critical LLM state.
*   **Activity Logging**: All actions logged locally for transparency and learning (dismiss rates, interaction patterns).

#### 4.7.4 Memory Maintenance (Autonomous)
*   **Purpose**: Automatically deduplicate and summarize long-term memories to prevent database bloat and maintain optimal retrieval performance.
*   **Trigger Conditions**:
    *   Memory count exceeds 50 entries
    *   Device is idle (30+ min since last interaction) OR charging
    *   Autonomous permissions enabled
    *   Minimum 24-hour cooldown since last maintenance
*   **Two-Phase Process**:
    1.  **Deduplication**: Removes semantically similar memories using vector cosine similarity (threshold: 0.90)
    2.  **Summarization**: If count still > 50 after dedup, uses LLM to consolidate oldest 20 memories into a single dense summary
*   **Requirements**: Valid LLM configuration and API key (for summarization phase)
*   **User Control**: Toggle "Autonomous Memory Maintenance" in Settings → Proactive → Context Awareness

#### 4.7.5 Automatic Context Summarization (Autonomous)
*   **Purpose**: Maintain optimal model performance by preventing context window overflow through automatic compression of older chat messages.
*   **Problem Addressed**: As conversations grow, they can exceed the LLM's context window, causing:
    *   Message truncation and loss of early conversation context
    *   Degraded model performance and coherence
    *   Inability to reference earlier discussion points
*   **Trigger Conditions**:
    *   Context usage reaches user-configured threshold (default: 50%)
    *   Minimum 10 messages in chat history
    *   Auto-Summarize Context setting enabled
    *   Triggers independently of autonomous permissions (background task)
*   **Process**:
    1.  **Monitor**: Background service continuously estimates context usage using token calculation (3.5 chars/token).
    2.  **Split**: When threshold reached, dynamically splits messages:
        *   Older messages (calculated based on threshold) → Summarized.
        *   Recent messages (60-80%) → Kept verbatim for continuity.
    3.  **Summarize**: Uses active provider (Cloud, GGUF, or LiteRT) to generate concise summary. Supports local models like Gemma-3n for offline summarization.
    4.  **Replace**: Creates special `[Context Summary]` system message containing summary.
    5.  **Save**: Updates chat history in localStorage: `[Summary Message] + Recent Messages`.
*   **Context Safety Fallback (Rolling Context)**: If summarization is disabled or reaches its limits, the system employs **Anchor Protection** during history pruning:
    *   **Always Protected**: System prompts, tool rules, and the most recent `[Context Summary]` message.
    *   **Rolling Window**: Oldest conversational turns are gradually discarded to stay within the model's `nCtx`, while keeping the "anchors" to preserve high-level coherence.
*   **Cross-Context Synchronization**: Active chat instances automatically detect background history updates (e.g., from `ActionExecutor`) via storage event listeners, ensuring the UI remains perfectly synced without manual refresh.
*   **Context Estimation**: Uses same logic as GGUF context manager:
    *   Counts system prompt tokens, message text, and attachment overhead
    *   Reserves space for response generation
    *   Compares against configured context size (nCtx or contextSize)
*   **User Configuration** (Settings → Proactive → Context Awareness):
    *   **Toggle**: "Auto-Summarize Context" (default: enabled)
    *   **Threshold Slider**: 30% - 90% in 5% increments (default: 50%)
    *   Lower threshold = More aggressive summarization, less token usage
    *   Higher threshold = More original context preserved, delayed summarization
*   **Benefits**:
    *   Prevents context overflow and message truncation
    *   Maintains conversation coherence across long sessions
    *   Preserves key information while reducing token consumption
    *   Fully autonomous and transparent (summary visible in chat)
*   **Action Type**: `SUMMARIZE_CONTEXT` autonomous action
*   **Logging**: Full audit trail in system logs (original count, new count, tokens saved)

#### 4.7.6 Background Robustness & ANR Prevention
*   **Purpose**: Ensures the proactive system remains stable even during heavy computations of memory maintenance or context summarization without causing Application Not Responding (ANR) errors or OS-initiated process kills.
*   **Implementation**:
    *   **WakeLock Management**: Android layer (`ProactiveBackgroundService`) utilizes a persistent `PARTIAL_WAKE_LOCK` for up to 60 seconds to guarantee background execution time for LLM-based autonomous tasks.
    *   **Main Thread Yielding**: Heavy $O(N^2)$ computations in the JS layer (e.g., vector similarity clustering) include intentional yield points to the event loop (`setTimeout(0)`) to remain responsive to system signals.
    *   **Concurrency Guards**: `ActionExecutor` implements an execution lock to prevent multiple autonomous heavy tasks from running simultaneously, avoiding CPU and RAM thrashing.
    *   **Resource Throttling**: Automatically skips non-critical maintenance if the user is currently "active" in the app, prioritizing foreground interface smoothness.

### 4.8 Voice & Call Modes

The application supports two distinct hands-free interaction modes optimized for different use cases.

#### 4.8.1 Voice Mode
**Purpose**: Continuous hands-free conversation without needing to manually trigger each interaction.

**Features**:
*   **Continuous Listening**: Uses Wake Word detection to activate without touching the device
*   **Turn-Taking**: VAD (Voice Activity Detection) automatically detects when user stops speaking
*   **Speaker Output**: Audio responses play through media speaker by default
*   **Visual Feedback**: Waveform visualization shows audio activity in real-time
*   **Interruption**: Tap-to-stop allows user to interrupt AI mid-response

**Workflow**:
1.  User says wake word (e.g., "Hey Jarvis")
2.  System activates STT (Vosk/Whisper) and visual indicator appears
3.  User speaks query naturally
4.  VAD detects speech endpoint (500ms silence threshold)
5.  LLM processes and responds via TTS (Piper/Gemini)
6.  System returns to listening state (Wake Word active)

#### 4.8.2 Call Mode
**Purpose**: Privacy-focused interaction mode that mimics a phone call for discreet use in public.

**Features**:
*   **Earpiece Routing**: Audio output routed to phone earpiece instead of speaker
*   **Compact UI**: Minimized interface similar to phone call screen
*   **One-Tap Activation**: Quick access button in chat interface
*   **Android Auto Integration**: Accessible from car dashboard via Android Auto plugin
*   **Background Operation**: Works with screen off (requires battery optimization exemption)

**Differences from Voice Mode**:
*   No wake word needed (always listening during call)
*   Earpiece audio for privacy
*   Optimized for Android Auto hands-free use
*   Persistent notification shows call-like interface

**Control Flow**:
*   **Start**: Tap "Call Mode" button → Audio routes to earpiece
*   **Interaction**: Speak naturally → VAD handles turn-taking
*   **End**: Tap "End Call" or navigate away from screen

### 4.9 Personality System

The AI's behavior, tone, and proactive frequency can be customized through a flexible personality system.

#### 4.9.1 Preset Personalities
The system includes several built-in personalities optimized for different use cases:

*   **Professional Assistant**: Formal, concise, business-oriented. Minimal proactive behavior.
*   **Friendly Companion**: Casual, warm, conversational. Moderate proactive engagement.
*   **Technical Expert**: Detailed, precise, uses technical terminology. Proactive with optimization suggestions.
*   **Creative Partner**: Encouraging, imaginative, asks thought-provoking questions. High proactive curiosity.
*   **Minimalist**: Extremely concise responses, zero proactive behavior. Maximum efficiency.
*   **Teacher**: Patient, explanatory, breaks down concepts. Proactive with knowledge checks.

#### 4.9.2 Custom Personalities
Users can create unlimited custom personalities with full control over:

**Core Attributes**:
*   **Name**: Display name (e.g., "Jarvis", "Friday", "Alex")
*   **Description**: Optional summary of personality traits
*   **System Prompt**: Complete control over AI behavior via custom instructions (500-2000 chars recommended)
*   **Proactive Frequency**: How often AI initiates conversation (Off / Low / Medium / High)

**System Prompt Guidelines**:
*   Define tone (formal, casual, humorous, empathetic)
*   Set knowledge domain expertise
*   Specify response length preference
*   Define proactive triggers (e.g., "Always ask follow-up questions about coding projects")

**Example Custom Personalities**:
*   **Fitness Coach**: "You are an energetic fitness trainer. Always encourage healthy habits and suggest workout routines."
*   **Debug Assistant**: "You are a senior software engineer specialized in debugging. Always ask clarifying questions before suggesting fixes."
*   **Language Tutor**: "You are a patient language teacher. Correct my grammar gently and ask me to practice new vocabulary."

#### 4.9.3 Personality Management
*   **Switch Anytime**: Active personality can be changed instantly from Settings
*   **Per-Conversation Persistence**: Personality selection persists across app restarts
*   **Import/Export**: Share custom personalities as JSON files
*   **Backup**: All custom personalities stored in app's private storage

### 4.10 Vision & Multimodal Capabilities

The system supports image understanding through vision-capable language models.

#### 4.10.1 Supported Input Formats
*   **Images**: JPEG, PNG, WebP, BMP
*   **Sources**: Camera capture, gallery selection, file picker, clipboard paste
*   **Resolution**: Automatically resized to model requirements (typically 224x224 or 336x336)
*   **Batch Processing**: Multiple images per conversation turn (model-dependent)

#### 4.10.2 Vision Models & Projectors
Vision capabilities require two components:

**1. Base Language Model**: Must support multimodal input
*   **LLaVA**: Llama-based vision models (e.g., `llava-v1.6-mistral-7b.gguf`)
*   **Gemma Vision**: Google's vision-enabled Gemma variants
*   **Gemini Cloud**: Native multimodal support (no projector needed)

**2. Vision Projector** (`.mmproj` file):
*   Bridges visual encoder and language model
*   **CRITICAL**: Must match the exact base model architecture
*   Typical size: 300MB - 2GB depending on model
*   Example: `llava-v1.6-mistral-7b.mmproj` for the corresponding GGUF model

#### 4.10.3 RAM Implications
⚠️ **Vision is RAM-intensive**:
*   **Projector Baseline**: +300MB - 2GB (projector file size)
*   **Image Processing**: +100-500MB per active image
*   **Total Overhead**: Typically +500MB - 2.5GB on top of base model

**When to Disable Vision**:
*   Device has < 6GB RAM
*   Experiencing thermal throttling
*   Not using image input features
*   Maximizing inference speed

**Best Practices**:
*   Keep "Enable Vision" toggle OFF by default
*   Enable only when actually using image features
*   Use cloud providers (Gemini) for vision if local RAM is limited
*   Clear image cache regularly (Settings → Clear Cache)

#### 4.10.4 Use Cases
*   **Document Analysis**: Extract text and tables from photos of documents
*   **Object Recognition**: Identify objects, brands, landmarks in images
*   **Visual QA**: Answer questions about image content ("What's in this photo?")
*   **Code Screenshots**: Debug code from screenshots
*   **Diagram Understanding**: Explain flowcharts, architecture diagrams, graphs

### 4.10.5 Architectural Constraints: Mutex & Context Protection
The AI Mind Mesh heavily utilizes the LiteRT engine for on-device inference. To prevent memory exhaustion and concurrency crashes during asynchronous tasks (e.g., proactive generation, background context summarization):
*   **Global Promise Mutex**: A strict queue `window.__MEDIAPIPE_MUTEX__` is enforced at the `liteRTProvider` level. If a background event triggers LLM interaction while the user is chatting, the UI gracefully enters a loading state and waits for the unlock.
*   **KV Cache Preservation**: Background tasks (like `PERFORM_MEMORY_MAINTENANCE` and `SUMMARIZE_CONTEXT`) explicitly abort if `litert` is the user's active foreground engine. This guarantees the user's active Conversation buffer is never destroyed or polluted by background extraction instructions, preventing "Context Thrashing".

### 4.11 AI Organization & Governance Layer

To manage scale-out operations, code generation, and team structure, the platform implements a centralized server-side Organization Layer with client-side controls.

#### 4.11.1 AI Council Orchestrator
The governance body uses a live sequential debate loop involving active agent personas.
*   **Sequential Multi-Agent Debate**: Uses the `InferenceRouter.complete` service to run reasoning cycles across active roles.
*   **Consensus Evaluation**: Roles analyze proposals and yield vote choices. The Council evaluates consensus and generates synthesis records.
*   **Decision Memory**: Synthetic debate logs and final decisions are persistently stored in the SQLite graph database.

#### 4.11.2 Gitea VCS & Repository Provisioning
The platform automates workspace setup when new ideas are approved.
*   **Automated Provisioning**: Programmatically creates repositories under specified Gitea organizations.
*   **CI/CD Bootstrapping**: Automatically generates and commits GitHub Actions / Gitea Actions YAML workflows based on templates.

#### 4.11.3 Kasm Sandbox Validation
Code checkouts are validated in dynamic virtual environments.
*   **Isolated Testing**: Connects to the Kasm Workspaces API to spawn headless developer workspaces.
*   **Validation Runner**: Clones repositories, runs smoke tests, and extracts validation outputs before destroying the workspace.

#### 4.11.4 HR Recruitment Service
Agent personnel needs are calculated semantically.
*   **Role Proposing**: Analyzes ecosystem and repository signals to identify operational gaps (e.g. missing DevRel, QA).
*   **Materialization**: Creates and registers new LLM system prompts and tool permissions as live executable Agent roles.

#### 4.11.5 Meeting-to-Organization Bridge
A client-side pipeline routes physical meeting discussions to organizational actions.
*   **Action Candidate Extraction**: Scans meeting transcripts for intent indicators (verbs, goals).
*   **Selective Submission**: Provides interactive UI selectors to submit approved candidates to the server as Directives or Ideas.

### Category: System & Device
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `run_termux_command` | `command` (str) | **[POWERFUL]** Execute arbitrary shell command in Termux. |
| `termux_install_pkg` | `package` (str) | Install Linux packages (e.g., `python`, `nodejs`, `git`). |
| `get_battery_status` | - | Get level and charging status. |
| `set_volume` | `level` (0-15), `stream` | Set device volume. |
| `set_brightness` | `level` (0-255) | Set screen brightness. |
| `toggle_wifi` | `enabled` (bool) | Enable/Disable Wi-Fi. |
| `get_clipboard` | - | Read system clipboard text. |
| `set_clipboard` | `text` (str) | Write text to clipboard. |
| `launch_app` | `app_name` (str) | Open another Android application. |

### Category: Productivity & Organization
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `create_calendar_event` | `title`, `date`, `time` | Schedule a calendar reminder. |
| `list_calendar_events` | `date` | List schedule for a day. |
| `create_task` | `title`, `due_date`, `priority` | Create a Kanban task with deadline. |
| `complete_task` | `task_id` | Mark a Kanban task as done. |
| `list_tasks` | `status`, `priority` | Filter and list tasks. |
| `add_agenda_note` | `content`, `date` | Add a day-specific note. |
| `add_shopping_item` | `item` | Add to simple checklist/shopping list. |
| `schedule_notification` | `message`, `seconds` | Set a system timer/notification. |
| `set_alarm` | `time`, `label` | Set an Android system alarm. |

### Category: Communication
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `send_whatsapp` | `number`, `message` | Send message via WhatsApp Intent. |
| `send_telegram` | `username`, `message` | Send message via Telegram Intent. |
| `get_contacts` | `query` | Search Android contacts. |

### Category: Media & Files
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `take_photo` | - | Capture image with camera. |
| `record_audio` | `duration_sec` | Record voice memo. |
| `search_files` | `query`, `path` | Find files on device storage. |
| `create_text_file` | `name`, `content` | Save a text file. |
| `download_file` | `url`, `filename` | Download file from internet. |

### Category: Memory
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `save_memory` | `content`, `category` | Explicitly save a fact to long-term memory. |

### Category: Knowledge & Workspaces
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `ingest_document` | `file_path` | Parse and index a document (PDF, DOCX, etc.). |
| `search_documents` | `query`, `limit` | Search for info in the active workspace. |
| `list_documents` | `workspace_id` | List files in current or specific workspace. |
| `create_workspace` | `name`, `description` | Create a new isolated document container. |
| `switch_workspace` | `workspace_id` | Change the active knowledge context. |
| `add_document_to_workspace` | `doc_id`, `ws_id` | Link a document to a workspace. |

---

## 6. Configuration Reference (Settings)

### 6.0 Settings Management Architecture
To ensure data integrity and prevent state desynchronization during multi-tab configuration, the application utilizes a **Transactional Save Pattern**:

1.  **Centralized Buffering**: All settings changes made within the `SettingsModal` are buffered in a local state managed by the `useSettingsState` hook. 
2.  **State Isolation**: Sub-components (e.g., `STTSettings`, `PersonalitySettings`) receive buffered props and callbacks. They do **not** write directly to `localStorage` or the global application state.
3.  **Atomic Commit**: Changes are only persisted to permanent storage (SQLite, `localStorage`) and the global state when the user explicitly clicks the **"Save Changes"** button.
4.  **Rollback Support**: Closing the modal or clicking "Cancel" (X) performs an implicit rollback by discarding the buffered local state without affecting the live configuration.
5.  **Multi-Entity Sync**: The architecture handles complex entities including:
    *   **Main Configuration Object** (LLM, Audio, App, etc.)
    *   **Custom Personalities** (CRUD operations are buffered)
    *   **External Models & Voices** (Imported file registers are buffered)
    *   **Android Auto & Agenda Settings** (Isolated objects synced on commit)

### 6.1 LLM Configuration (`LLMConfig`)
Located in **Settings -> Model**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Provider** | `Select` | **Gemini** (Cloud), **Perplexity** (Cloud), **Claude** (Cloud), **Native GGUF** (Local), **LiteRT** (Local), **Local API** (Network), **FreeLLMAPI** (Proxy Gateway). |
| **Gemini Model** | `Text` | Model ID (e.g., `gemini-3.1-flash-lite`). Requires API Key. |
| **Perplexity Model** | `Text` | Model ID (Default: `sonar-pro`). Specialized in search. |
| **Claude Model** | `Text` | Model ID (Default: `claude-3-5-sonnet-latest`). |
| **Native Model Path** | `File` | Path to selected `.gguf` file (e.g., `llama-3-8b.gguf`). |
| **Enable Vision** | `Toggle` | **CRITICAL**. Enables/Disables vision projector. Keep OFF to save ~300MB-2GB RAM. |
| **Vision Projector** | `File` | Path to `.mmproj` files. Only loaded if **Enable Vision** is ON. |
| **LiteRT Model** | `File` | Path to selected `.litertlm` file (e.g., `gemma-2b-it-cpu.litertlm`). |
| **Context Size** | `Slider` | Global context window (tokens). Default: `2048`. Adjustable via unified slider in Advanced Settings to synchronize `nCtx` across both GGUF and LiteRT engines. |
| **Engine** | `Toggle` | **GGUF** (via llama.cpp) vs **LiteRT** (via Google AI Edge). |
| **Always Keep Loaded** | `Toggle` | **CRITICAL**. If ON, model stays in RAM in background. Consumes battery but instant response. |
| **Use Mmap** | `Toggle` | Memory mapping. OFF = Faster load, ON = Lower RAM pressure. |
| **Use GPU (Vulkan)** | `Toggle` | Offloads inference to device GPU via Vulkan. Auto-disables if thermal throttling triggered. **On Qualcomm Adreno, prefer OpenCL below.** |
| **Use OpenCL (Adreno)** | `Toggle` | Preferred GPU backend for Qualcomm Snapdragon devices. Uses the Qualcomm-contributed OpenCL backend. Mutually exclusive with Vulkan. Requires `GGML_OPENCL=ON` build flag. **Dynamically clamps `nCtx` to 8192 max** to prevent `CL_DEVICE_MAX_MEM_ALLOC_SIZE` driver crashes on huge KV cache buffers. |
| **Flash Attention** | `Toggle` | Attention optimizations. Default: `true` (Recommended). |
| **N Threads** | `Number` | CPU threads for inference. Recommended: `4-6` for modern phones. |
| **Enable Thinking** | `Toggle` | Shows "Thought Process" block before answer. |
| **Thinking Budget** | `Number` | Token limit for thinking process (0 = unlimited). |
| **Enable Tool Use** | `Toggle` | Master switch for tool execution capability. |
| **Tool Toggles** | `List` | Individual toggles to enable/disable specific tools (e.g. disable `run_termux_command` for safety). |
| **Tool Confirmation** | `Select` | **Always**, **Dangerous Only** (e.g. delete file), **Never**. |

**LiteRT-specific settings** (visible when engine = LiteRT):

| Option | Type | Description |
|---|---|---|
| **Accelerator Backend** | `CPU / GPU` | LiteRT compute backend selection. GPU automatically attempts to load OpenCL sampler (`libLiteRtTopKOpenClSampler.so`) before falling back to CPU. |
| **NPU (Hexagon QNN)** | `Toggle` | Routes quantized ops to Qualcomm Hexagon NPU via the QNN delegate (`libQnnHtp.so`). Requires Snapdragon 8 Gen 2+. Auto-sets backend to CPU. |
| **MTP (Speculative)** | `Toggle` | Enables Multi-Token Prediction (Speculative Decoding) on GPU backends. significantly improves speed by predicting multiple tokens per forward pass. |

### 6.2 Speech-to-Text (`SpeechConfig`)
Located in **Settings -> Audio**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **STT Provider** | `Select` | **Vosk** (Offline, Fast), **Voxtral** (Offline, High-quality Real-time), **Whisper** (Offline, Best Accuracy), **Gemini** (Online). |
| **Vosk Model** | `Select` | `vosk-model-small-ex` (Light), `vosk-model-en-us` (Accurate). |
| **Voxtral Model** | `File` | Path to `.gguf` file (e.g., `Voxtral-Mini-4B-Realtime-Q4_K_M.gguf`). |
| **Voxtral Latency** | `Select` | **Fast** (240ms), **Balanced** (480ms, default), **Accurate** (960ms), **Best** (2400ms). |
| **Whisper Model** | `Select` | `tiny`, `base`, `small`. Larger = Slower/Better. |
| **Whisper Threads**| `Number` | Threads for encoder. Default: `4`. |
| **Enable VAD** | `Toggle` | Voice Activity Detection. Fixes cutting off sentences too early. |
| **VAD Sensitivity**| `0.0-1.0` | Higher = Triggers on quieter sounds. Default `0.5`. |

### 6.3 Text-to-Speech (`SpeechConfig`)
Located in **Settings -> Audio**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **TTS Provider** | `Select` | **Piper** (Offline quality), **System** (Android default), **Gemini** (Cloud). |
| **Piper Voice** | `Select` | Select specific `.onnx` voice model (e.g., `en_US-amy-medium`). |
| **Default Output** | `Select` | **Speaker** (Media) vs **Earpiece** (Phone Call style). |

### 6.4 Wake Word
Located in **Settings -> Wake Word**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable** | `Toggle` | Turns on continuous background microphone listening. |
| **Model** | `File` | `.tflite` model (default: `hey_jarvis_v0.1.tflite`). |
| **Threshold** | `0.0-1.0` | Detection confidence. Lower = More false positives. Default `0.5`. |
| **Cooldown** | `ms` | Time to wait after detection. Default `2000ms`. |
| **Buffer Size** | `int` | Audio chunk buffer. Default `20`. |

### 6.5 Theme & UI
Located in **Settings -> Appearance**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Preset** | `Select` | **Fuchsia Night**, **Midnight Blue**, **Deep Ocean**, **Forest**, **Sunset**, **Rose**. |
| **Response Style**| `Select` | **Concise** (Short), **Normal**, **Detailed** (Long). |
| **Proactive Freq**| `Select` | **Off**, **Low**, **Medium**, **High** (How often AI auto-initiates). |

---

### 6.6 RAG & Document Configuration
Located in **Settings -> Knowledge**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Workspace** | `Select` | Active document isolation container (default: `Default`). |
| **Document Mgmt** | `List` | View, add, remove files (PDF, DOCX, TXT, MD). |
| **Embedding Model** | `File` | Path to `.onnx` model (Standard: `all-MiniLM-L6-v2`). |
| **Chunking Strategy** | `Select` | **Recursive** (Default) or **Page-Level** (Best for PDFs). |
| **Chunk Size** | `Slider` | Characters per chunk. Default: `2000`. Range: `512` - `4096`. |
| **Chunk Overlap** | `Slider` | Overlap for context continuity. Default: `200`. Range: `0` - `500`. |
| **Hybrid Search** | `Info` | Active by default. Combines Vector (Semantic) + FTS5 (Keyword). |
| **Connectivity Check** | `Toggle` | **Disable Connectivity Check**. Disables frequent DB pings. Default: `Off` (Ping Disabled). |

### 4.11 Neural Wiki
The Neural Wiki is a structured, collaborative-style knowledge base automatically compiled from the Knowledge Graph on the AIMindMesh Server.
*   **Two Modes**:
    *   **List Mode**: Searchable and paginated catalog of all compiled wiki pages.
    *   **Detail Mode**: Full-screen Markdown viewer with [[Wikilink]] support for seamless navigation between related entities and concepts.
*   **Navigation**: Maintains a historical back-stack for deep-diving into complex knowledge clusters.
*   **Export to Markdown**: Individual pages can be exported as `.md` files. On Desktop, this invokes a native save dialog via `@tauri-apps/plugin-dialog`. On Mobile, it triggers the native share intent via `@capacitor/share` to allow saving to the filesystem or sharing with external productivity apps.
*   **Sync & Regeneration**: Support for manual triggering of synthesis cycles and per-page regeneration via the AIMindMesh Server API to ensure knowledge remains current.

### 4.13 Auto-Evolution Engine
The Auto-Evolution Engine is an autonomous software improvement pipeline that allows the AIMindMesh ecosystem to suggest, validate, and propose architectural changes to its own codebase.

*   **Improvement Detection**: Monitor the Knowledge Graph for high-severity `open_question` nodes and `developerConclusion` nodes from debates that suggest actionable code changes.
*   **Contextual Code Generation**: Resolves local file context and dependencies using `InferenceRouter` (routed to `COMPLEX` tier nodes) to generate targeted improvements.
*   **Multi-Layered Validation**:
    *   **Syntax Check**: Uses `tsc --noEmit` and `eslint` in a secure sandbox to ensure code quality.
    *   **Protected Paths**: Respects `.noautoedit` and a dynamic `protected_paths` registry to avoid critical system corruption.
*   **Human-in-the-loop (Gitea Integration)**:
    *   Automated creation of `feature/auto-*` branches and Pull Requests in the local Gitea instance.
    *   **AI Identity Isolation**: Uses a dedicated `AIMindMesh` Gitea user for PR comments to prevent feedback loops and distinguish AI actions from human reviews.
    *   Requires manual review and approval via the EvolutionRouter API or Admin Cockpit before merging.
*   **Developer Controls**: The Admin Panel (PC/Mobile) provides full visibility into proposals, allowing for approval, rejection, and manual triggering of evolution cycles.

AI Mind Mesh introduces optional integration with the **AIMindMesh Server** — a Cloud VPS accessible over a WireGuard VPN. The integration is strictly additive; no existing local features are altered.

#### 4.12.1 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  AntiGravity Ecosystem                  │
├───────────────────┬────────────────────┬────────────────┤
│  AIMindMesh App  │  AIMindMesh       │  AGServer      │
│  (Android)        │  Server (VPS)      │  (Auth/Router) │
│                   │                   │                │
│  ┌─────────────┐  │  ┌─────────────┐  │  ┌──────────┐  │
│  │  FeedView   │◄─┼──│ Feed API    │  │  │ Gateway  │  │
│  │  ThreadView │  │  │ /api/feed   │  │  │ JWT Auth │  │
│  │  ImportSheet│  │  │ /api/kg/*   │  │  └──────────┘  │
│  └─────────────┘  │  └─────────────┘  │                │
│  ┌─────────────┐  │  ┌─────────────┐  │                │
│  │ ServerLLM   │◄─┼──│ LLM Proxy   │  │                │
│  │ Provider    │  │  │ (Ollama)    │  │                │
│  └─────────────┘  │  └─────────────┘  │                │
│  ┌─────────────┐  │  ┌─────────────┐  │                │
│  │ FCMService  │◄─┼──│ Firebase    │  │                │
│  └─────────────┘  │  │ (Push)      │  │                │
│                   │  └─────────────┘  │                │
│  ProactiveService │  KnowledgeGraph   │                │
│  (Server Mode)    │  (Neo4j)          │                │
└───────────────────┴────────────────────┴────────────────┘
```

#### 4.12.2 Feed Screen
*   **Purpose**: Displays AI-generated insights, connection summaries, and document ingestion results from the server KG.
*   **Architecture**: Bottom-nav tab (💬 Chat | ✨ Feed). Uses `IntersectionObserver` for infinite scroll.
*   **Live Updates**: FCM `NEW_INSIGHT` messages dispatch to `onFCMFeedEvent` event bus → `FeedView` re-fetches top of list without full reload.
*   **Thread View**: Each insight opens a `FeedThreadView` with a chat-bubble reply interface, streaming server responses via WebSocket.
*   **Unread Badge**: Bottom nav badge count reflects unread insights; resets on feed tab open.
#### 4.12.7 Mobile Worker Node
*   **Purpose**: Allows the mobile device to act as an active inference worker for the entire mesh cluster.
*   **Mechanism**: The app establishes a dedicated bidirectional WebSocket neural link to `/ws/nodes` on the server.
*   **Configuration Injection**: Unlike standard chat sessions, the `NodeWorker` dynamically inherits the active `LLMConfig` (model paths, thread counts) and `Personality` (traits, instructions) from the app's local state. This ensures that tasks dispatched from the mesh are executed with the exact same persona and hardware optimizations configured by the user.
*   **Execution Flow**:
    1.  Server dispatches task via WebSocket.
    2.  `NodeWorker.ts` receives payload (prompt + task ID).
    3.  Worker retrieves active configuration and triggers `generateTextResponseStream`.
    4.  Response is streamed back to the server in real-time.
*   **Robust Error Reporting**: Any exception during local inference (e.g., model not found, OOM) is caught and reported back to the server as a `WORKER_EXECUTION_FAILED` result. This prevents tasks from hanging in `PROCESSING` state and allows for automatic server-side retries or routing fallback.
*   **Wakeup Layer**: If the WebSocket is closed, the server dispatches a `WAKE_FOR_INFERENCE` FCM message. The mobile app's background service intercepts this and automatically re-activates the `NodeWorker` connection to receive the task.
*   **Lifecycle & UI Sync**: The worker's status is synchronized with the "AIMindMesh Server" settings panel. A dedicated listener pattern ensures the "READY FOR TASKS" badge reflects the real-time connectivity of the WebSocket link.
*   **Controls**: Users can enable/disable this feature via "Participate as Worker Node" in AIMindMesh Server settings.

#### 4.12.3 AIMindMesh Server LLM Provider
*   **Provider ID**: `'aimindmesh-server'` in `LLMConfig.provider`.
*   **Primary Transport**: WebSocket streaming at `ws://<serverUrl>/api/llm/stream`.
*   **Fallback**: REST POST at `/api/llm/generate` when WebSocket unavailable.
*   **Health Tracking**: `serverProvider.ts` maintains a `consecutiveFailures` counter; fires `server:unreachable` custom event after 3 failures.
*   **Authentication**: All requests carry `x-api-key: <apiKey>` header.

#### 4.12.4 Knowledge Import Sheet
*   **Triggers**: FAB button on FeedView, or paperclip attachment in chat.
*   **Tabs**: Document (file picker: PDF/DOCX/TXT/MD), URL (HTTP), Clipboard (auto-detects URL).
*   **Server Pipeline**: `POST /api/documents/ingest/file` or `/url` → receives `{jobId}` → polls `GET /api/documents/jobs/<jobId>` every 5s for up to 2 minutes.
*   **Local Fallback**: When server not configured, files are queued to local `DocumentIngestionService`.

#### 4.12.5 Memory KG Sync
*   **Auto-Sync**: When `autoSyncNewMemories = true`, each `addMemory()` call fires a fire-and-forget `POST /api/kg/memories`.
*   **Bulk Sync**: `bulkSyncMemoriesToServer()` in `memorySyncService.ts` iterates all local memories with `setTimeout(0)` yield points between each POST (ANR prevention).
*   **Payload**: `{content, category, source: 'aimindmesh_android', createdAt}`.

#### 4.12.6 FCM Push Notification Architecture
*   **Plugin**: `fcm-capacitor` (Kotlin). Registers `FCMCapacitorPlugin` with Capacitor bridge.
*   **Services**: `FCMMessagingService` (extends `FirebaseMessagingService`), `FCMActionReceiver` (handles inline actions).
*   **Token Lifecycle**: On init → request permission → `getFCMToken()` → `POST /api/nodes/register`. On rotate → re-register via `tokenRefresh` listener.
*   **Message Types**: `NEW_INSIGHT`, `INGESTION_COMPLETE`, `NODE_STATUS`, `SYSTEM_ALERT`, `MARK_READ_ACTION`.
*   **Data Flow**:
```
Firebase Cloud Messaging
  └─> FCMMessagingService.onMessageReceived()
        └─> capacitorPlugin.notifyListeners("fcm:message", payload)
              └─> fcmService.ts dispatchMessage()
                    └─> emitFeedEvent() → onFCMFeedEvent listeners
                          └─> FeedView.tsx → prepend new insight card
```

### 4.13 Server-Side Knowledge Import
See §4.12.4 for the import sheet UI. The server-side pipeline:
1.  **File ingest**: Server extracts text (Apache Tika), chunks, embeds, and stores in Neo4j KG.
2.  **URL ingest**: Server fetches URL, runs Readability extraction, then processes identically to file.
3.  **Job Status**: Polling endpoint returns `{status: 'pending'|'processing'|'completed'|'failed', progress}`.
4.  **FCM Completion**: On completion, server dispatches `INGESTION_COMPLETE` FCM message; `ImportSheet` receives it via `onFCMFeedEvent` listener.

### 6.7 App & Utils Settings
Located in **Settings -> App & Utils**.

#### 6.7.1 App Settings

| Option | Type | Description |
| :--- | :--- | :--- |
| **Auto-play Audio** | `Toggle` | Automatically speak AI responses. |
| **Do Not Disturb** | `Toggle` | Silence proactive notifications during specific hours. |
| **Response Style** | `Select` | **Normal**, **Concise**, **Detailed**. |
| **Notification Vibration** | `Toggle` | Master switch for app-wide notification vibration. |
| **Clear Chat History** | `Button` | Deletes all messages in the active thread. |

#### 6.7.2 System Monitor

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable Monitor** | `Toggle` | Show floating overlay. |
| **Frequency** | `Slider` | Update interval (500ms - 5000ms). |
| **Show RAM** | `Toggle` | Display total/used device RAM. |
| **Show App Mem** | `Toggle` | Display memory used by this specific app. |
| **Show CPU** | `Toggle` | Display app-specific CPU usage. |
| **Show GPU** | `Toggle` | Display GPU utilization (if supported). |

### 6.8 Android Auto
Located in **Settings -> Android Auto**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable Integration** | `Toggle` | Master switch for Android Auto capability. |
| **Show "Call Mode"** | `Toggle` | Display Voice Assistant shortcut on car screen. |
| **Show Calendar** | `Toggle` | Display upcoming calendar events. |
| **Show To-Do** | `Toggle` | Display active tasks list. |
| **Show Kanban** | `Toggle` | Display Kanban board columns. |

### 6.9 Memory Settings
Located in **Settings → Memory**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable Auto-Categorization** | `Toggle` | Uses LLM to automatically categorize new memories into Facts, Tasks, Preferences, Events, Knowledge. |
| **Similarity Threshold** | `Slider` | Cosine similarity threshold for retrieval (0.0-1.0). Default: `0.75`. Higher = stricter matching. |
| **Max Memories Retrieved** | `Number` | Number of memories injected into context per query. Default: `3`. Range: `1-10`. |
| **Memory Browser** | `List` | View, search, edit, and delete stored memories. Shows timestamp and category. |
| **Add Memory** | `Button` | Manually create a new long-term memory entry. |
| **Manage Categories** | `List` | Create, rename, delete custom memory categories. |
| **Export Memories** | `Button` | Export all memories as JSON file for backup. |
| **Import Memories** | `File` | Restore memories from JSON backup file. |
| **Clear All Memories** | `Button` | ⚠️ **DANGEROUS**. Permanently deletes all stored memories. |

### 6.10 Personality Settings
Located in **Settings → Personality**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Active Personality** | `Select` | Choose from preset or custom personalities. Changes take effect immediately. |
| **Preset Personalities** | `List` | Built-in options: Professional Assistant, Friendly Companion, Technical Expert, Creative Partner, Minimalist, Teacher. |
| **Custom Personalities** | `List` | User-created personalities. Tap to edit or delete. |
| **Create New** | `Button` | Opens editor for new custom personality. |
| **Personality Name** | `Text` | Display name for custom personality (e.g., "Jarvis"). Max 30 chars. |
| **Description** | `Text` | Optional summary of personality traits. Max 100 chars. |
| **System Prompt** | `TextArea` | Custom instructions defining AI behavior. 500-2000 chars recommended. |
| **Proactive Frequency** | `Select` | **Off**, **Low** (1-2/day), **Medium** (3-5/day), **High** (6+/day). |
| **Export Personality** | `Button` | Save custom personality as JSON to share with others. |
| **Import Personality** | `File` | Load a shared personality from JSON file. |

### 6.11 Performance Settings
Located in **Settings → Performance**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Disable Battery Optimization** | `Button` | Requests Android exemption to allow background model loading and proactive features. **Recommended**. |
| **Keep Screen On** | `Toggle` | Prevents screen from sleeping during inference. Useful for long-running tasks. |
| **Thermal Awareness** | `Info` | Displays current device temperature. App automatically throttles at >45°C. |
| **Low Power Mode** | `Toggle` | Reduces thread count, disables vision, and limits context size to conserve battery. |
| **Clear Cache** | `Button` | Removes temporary files (model cache, image cache, logs). Frees storage. |
| **Reset to Defaults** | `Button` | ⚠️ Resets ALL settings to factory defaults. Does NOT delete memories or documents. |

### 6.12 AIMindMesh Support Server
Located `Settings -> App Settings -> Support Server`.
This feature delegates heavy data extraction (like web search scraping) to an external companion server (AIMindMesh Server) to drastically reduce RAM usage and prevent context length explosions on the mobile device.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable Support Server** | `Toggle` | Master switch for the support server capabilities. |
| **Server URL** | `Text` | The endpoint of the AIMindMesh Server (e.g. `http://192.168.1.100:3000`). |
| **Delegate Web Search** | `Toggle` | Offloads DuckDuckGo web scraping. Calls `POST /api/web/search` with `{query, num_results}`. |
| **Delegate Web Scraping** | `Toggle` | Offloads full web page parsing. Calls `POST /api/web/read` with `{url}`. |
| **Delegate Web Analysis** | `Toggle` | Offloads Search + AI Synth loop to containerized Ollama. Calls `POST /api/web/analyze` with `{query}`. |

### 6.13 AIMindMesh Server Settings
Located **Settings → AIMindMesh Server**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable** | `Toggle` | Master switch. Activates Feed tab, Server LLM provider, FCM token registration, and server-mode proactive suspension. |
| **Server URL** | `Text` | VPN endpoint of AIMindMesh Server. |
| **API Key** | `Password` | `x-api-key` header value for all server requests. |
| **Fallback Provider** | `Select` | LLM provider to use if server is unreachable (default: `gemini`). |
| **Participate as Worker** | `Toggle` | Allows the server to route inference tasks to this device. Activates the `NodeWorker` WebSocket. |
| **Mesh Activity** | `Indicator` | Real-time status card showing if the device is currently executing a distributed task. |
| **Test Connection** | `Button` | Fires `GET /api/health` and displays server version, uptime, and KG node count. |
| **Auto-Sync New Memories** | `Toggle` | Auto-POSTs each new local memory to `/api/kg/memories` (fire-and-forget). |
| **Bulk Sync Memories** | `Button` | Syncs all existing local memories to server KG with progress indicator. |

---

## 7. Supported Online Providers

### 7.1 Gemini (Google)
*   **Endpoint**: `generativelanguage.googleapis.com`
*   **Models**: `gemini-3.1-flash-lite` (balanced), `gemini-3.1-pro` (reasoning), `gemini-3.0-flash-lite`.
*   **Features**: Best Multimodal (Video/Audio/Image), Large Context (1M+), Search Grounding.

### 7.2 Perplexity (API)
*   **Endpoint**: `api.perplexity.ai`
*   **Models**: `sonar-pro` (recommended - formerly 70b), `sonar` (small), `sonar-reasoning`.
*   **Features**: Best for Real-time Web Search and Citations.

### 7.3 Claude (Anthropic)
*   **Endpoint**: `api.anthropic.com`
*   **Models**: `claude-3-5-sonnet-latest` (Best logic/coding), `claude-3-haiku`.
*   **Features**: Best nuance/writing/coding capability.

### 7.4 Local Server (Ollama / LM Studio)
*   **Endpoint**: Configurable (e.g., `http://192.168.1.5:11434/v1`).
*   **Models**: Any OpenAI-compatible model name.
*   **Use Case**: Run inference on a powerful PC and stream to phone.

---

## 8. UI/UX Standards

To ensure a premium and consistent experience across the application, the following styling standards MUST be followed for all UI components:

### Color System & Theming
All components must use theme-aware CSS variables defined in `src/index.css`. Ad-hoc hex codes or generic Tailwind colors (e.g., `bg-gray-800`) should be avoided in favor of:

| Element | CSS Variable | Tailwind Class | Usage |
|---------|--------------|----------------|-------|
| Background | `--color-background` | `bg-background` | Main app background |
| Surface | `--color-surface` | `bg-surface` | Card and modal backgrounds |
| Input | `--color-input` | `bg-input` | **MANDATORY for all input fields** |
| Text Primary | `--color-text-primary` | `text-textPrimary` | **MANDATORY for labels and main text** |
| Text Secondary | `--color-text-secondary` | `text-textSecondary` | Hint text and secondary info |
| Primary | `--color-primary` | `text-primary` / `bg-primary` | Action buttons, active states, accents |

### Modularity & Code Quality
- **File Size Limit**: Strict 600-line limit for all source files to ensure maintainability and readability.
- **Hook Extraction**: Persistent pattern of extracting complex UI state into custom hooks (`useAppDatabase`, `useNativeModels`, `useSettingsState`, etc.).
- **Sub-module Isolation**: Large services are decomposed into functional sub-directories with atomic responsibilities.
- **Re-export Layer**: Main entry points act as clean re-export layers for sub-modules to maintain API compatibility.

### Typography
- Use standard font weights: `font-medium` for labels, `font-semibold` for headers.
- Font sizes should be consistent: `text-xs` for hints, `text-sm` for normal text, `text-lg` for section headers.

---

## 9. Security & Privacy

### 9.1 Threat Model

#### Assets
| Asset | Sensitivity | Storage Location |
|---|---|---|
| Cloud API Keys (Gemini, Claude, Perplexity) | HIGH | Android Keystore (`EncryptedSharedPreferences`) |
| Chat History | MEDIUM | SQLite (app private storage) |
| Long-Term Memories | HIGH | SQLite (app private storage) |
| Voice Recordings (.m4a) | HIGH | App private files directory |
| Speaker Embeddings (biometric) | HIGH | SQLite (app private storage) |
| Calendar Events | MEDIUM | SQLite (app private storage) |
| Kanban Tasks | LOW | SQLite (app private storage) |

#### Threat Actors
| Actor | Capability | Mitigated By |
|---|---|---|
| Malicious app on same device | Read SharedPreferences | Android Keystore for secrets |
| Physical device theft | Filesystem access | Android FDE (File-Based Encryption, default API 24+) |
| ADB backup exfiltration | Backup file read | `android:allowBackup="false"` in Manifest |
| Rooted device | Root file access | Defense-in-depth; user is aware of device state |
| Network MITM | API key interception | HTTPS enforced; keys never in URL params |
| Prompt injection via tools | LLM manipulation | Tool confirmation system; dangerous tool whitelist |

#### Out of Scope Threats
- Nation-state level attacks
- Physical hardware tampering
- Vulnerabilities in upstream dependencies (llama.cpp, ExoPlayer, etc.)

---

### 9.2 Data Classification

| Category | Examples | Retention | Cloud Transmission |
|---|---|---|---|
| CRITICAL | API Keys | App lifetime | Never |
| SENSITIVE | Voice recordings, Speaker embeddings, Memories | Configurable (default: 30d for audio) | Never (local-first) |
| PERSONAL | Calendar, Tasks, Chat history | App lifetime | Only if cloud LLM selected |
| OPERATIONAL | Settings, Model paths, Logs | App lifetime | Never |

**Cloud Transmission Policy**: Data is sent to cloud providers (Gemini, Claude, Perplexity) ONLY when the user explicitly selects a cloud LLM provider. When using local GGUF/LiteRT, zero data leaves the device.

---

### 9.3 Android Security Hardening

#### Manifest Configuration
```xml
<application
    android:allowBackup="false"
    android:fullBackupContent="false"
    android:networkSecurityConfig="@xml/network_security_config"
    ... >
```

#### Network Security Config (`res/xml/network_security_config.xml`)
```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system"/>
        </trust-anchors>
    </base-config>
</network-security-config>
```

#### Permissions Rationale
| Permission | Reason | When Requested |
|---|---|---|
| `RECORD_AUDIO` | STT, Meeting Mode, Voice Mode | First use of voice feature |
| `READ_EXTERNAL_STORAGE` | Loading GGUF model files | Model selection in Settings |
| `FOREGROUND_SERVICE` | Background STT, KeepAlive, Proactive | App first launch |
| `RECEIVE_BOOT_COMPLETED` | Restart ProactiveService after reboot | Automatic |
| `INTERNET` | Cloud provider API calls (optional) | When cloud provider selected |

---

### 9.4 GDPR Compliance Reference (EU)

#### Legal Basis
Processing is based on **Art. 6(1)(b) GDPR** (performance of a contract/service requested by the user) and **Art. 6(1)(a)** (consent) for optional features such as cloud processing.

#### Data Subject Rights
| Right | Implementation |
|---|---|
| Right to Access (Art. 15) | Memory Browser exports all memories as JSON; Chat export available |
| Right to Erasure (Art. 17) | "Clear All Memories", "Clear Chat History", per-meeting audio delete |
| Right to Portability (Art. 20) | JSON export for memories, personalities, tasks |
| Right to Object (Art. 21) | All cloud features are opt-in; local-only mode available |

#### Special Categories (Art. 9)
Voice recordings and speaker embeddings may constitute **biometric data** under Art. 9 GDPR. Mitigations:
- Stored exclusively on-device in app private storage
- Never transmitted to cloud in local mode
- User can delete all recordings via Settings → Meeting → Manage Recordings
- Speaker embeddings deleted when meeting is deleted (CASCADE)

#### Data Minimization (Art. 5(1)(c))
- Voice recordings auto-delete after configurable retention period (default: 30 days)
- Speaker embeddings not linked to real identity unless user assigns name
- No device identifiers or analytics transmitted

---

### 9.5 Security Checklist (Pre-Release)
- [ ] `android:allowBackup="false"` in AndroidManifest.xml
- [ ] `cleartextTrafficPermitted="false"` in network security config
- [ ] All API keys stored via EncryptedSharedPreferences (Android Keystore)
- [ ] No sensitive data in Android logs (logcat) in release builds
- [ ] ProGuard/R8 minification enabled for release builds
- [ ] No hardcoded secrets in source code
- [ ] `run_termux_command` tool disabled by default; requires explicit user enable
- [ ] Voice recordings stored in `filesDir` (not `externalFilesDir`)
