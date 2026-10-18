# AI Mind Mesh - Technical Specification
 
> **Version:** 0.1.0
> **Server Version:** 0.1.0
> **Repository:** https://github.com/aimindmesh/AIMindMesh
> **Last Updated:** October 3, 2026
> **Architecture:** Local-First Hybrid Agent + Distributed Ecosystem

## 1. Executive Summary & Philosophy

AI Mind Mesh is a privacy-focused, local-first personal assistant designed for Android. Unlike cloud-dependent assistants, it prioritizes **on-device execution**, **data sovereignty**, and **agentic capability**.

### Core Tenets
1.  **Local First**: Core intelligence (LLM, STT, TTS, Vector DB) runs on-device using optimized inference engines (llama.cpp, LiteRT, Vosk/Piper). Cloud fallback (Gemini/Perplexity) is optional.
2.  **Agentic Architecture**: The AI is not just a chatbot; it is an agent with a "body" (the device). It can execute shell commands, manage files, control hardware, and interact with other apps.
3.  **Hybrid Intelligence**: Seamlessly switches between lightweight local models for privacy/speed (Gemma 3, Llama 3) and powerful cloud models for complex reasoning (Gemini 3.1 Flash Lite, Sonar Pro).
4.  **Memory**: The assistant keeps what it learns about the user as facts (profile, people, goals, open loops), updated while the chat is quiet, and can search past conversations by meaning.
5.  **Context Saturation Protection**: Advanced multi-layered context management combining LLM-based summarization (cloud or local) with a robust "rolling context" fallback to ensure coherence in long conversations while protecting critical system anchors.

---

## 2. System Architecture

The application uses a **React Native-like** architecture but with a custom, highly optimized native layer.

### 2.1 Technology Stack
*   **Frontend**: React 18, TypeScript, Vite, TailwindCSS (Utility-first styling).
*   **Container**: Capacitor 7 (`@capacitor/core` 7.x, `@capacitor/android` 7.x; CLI 8.x) as Native Bridge.
*   **Vector Database**: SQLite (`@capacitor-community/sqlite`) storing 384-dim `all-MiniLM-L6-v2` embeddings (ONNX) as BLOBs. Similarity search is a brute-force cosine scan in TypeScript (`DocumentRetriever.ts`, `semanticMemoryRetriever.ts`); `sqlite-vec` is **not** used.
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
*   `plugins/`: 16 custom Capacitor plugin packages (`*-capacitor`, TypeScript definitions + Android library module), resolved by the TypeScript `paths` and Vite aliases to their `src/index.ts`.
*   `android/`: Native Android project. Further in-app plugins (Voxtral, KokoroTTS, AudioPlayback, MeetingExport, Performance, SystemMonitor, Proactive, SecureStorage) live directly in `android/app/src/main/java/com/aimindmesh/mobile/`.
    *   `utils/`: Native audio processing utilities (`AudioEncoder`, `AudioDecoder`, `WavHelper`).

### 2.3 Data Persistence & Resilience
*   **Database**: SQLite is the primary storage engine for all persistent data (Memories, Calendar, Settings).
    *   **Architecture**: Multi-database isolation (separate files for memories, meeting history, and global settings).
    *   **Journal mode**: `journal_mode = DELETE` (rollback journal). WAL is **not** enabled: `DatabaseManager.ts` sets DELETE because `@capacitor-community/sqlite` wraps statements in transactions. Write contention is handled by serialized writes and `busy_timeout`.
    *   **Performance Tuning** (`DatabaseManager.ts`):
        *   `synchronous = NORMAL`: Balanced safety/speed.
        *   `cache_size = -8000`: 8MB page cache per database connection.
        *   `busy_timeout = 5000`: Waits up to 5s on `SQLITE_BUSY` instead of failing.
        *   `foreign_keys = ON`.
        *   `wal_autocheckpoint` / `walCheckpoint()` are still issued but have no effect in DELETE mode.
*   **Not in SQLite**: chat threads (`threadManager.ts`) and most settings are stored in WebView `localStorage`; API keys live in the Keystore-backed secret store when encryption is available (see §9).
*   **Connection Management**: Uses a custom **Robust Proxy Pattern** to automatically handle Android lifecycle events.
*   **Auto-Recovery**: Automatically detects and recovers from OS-initiated connection closures (e.g., when app is backgrounded/killed) without data loss or user interruption.

---

## 3. Native Plugin Catalog

The unique power of AI Mind Mesh comes from its extensive suite of custom native plugins that bridge the web view with the operating system.

| Plugin Name | ID | Description & Key Capabilities |
| :--- | :--- | :--- |
| **FCM** | `fcm-capacitor` | **Firebase Cloud Messaging**. Native Kotlin plugin for receiving push notifications from AIMindMesh Server. Manages token lifecycle (register, refresh), dispatches foreground messages as typed events to the TypeScript event bus (`onFCMFeedEvent`), and handles inline `MARK_READ_ACTION` from notification tray. Google Services JSON required. |
| **LlamaCpp** | `llama-cpp-capacitor` | **Core LLM Engine**. Upgraded to `llama.rn@0.11.3` (PocketPal). Native support for Qwen 3.5 (Hybrid Mamba), Gemma 4 QAT, and modern GGUF architectures. Supports CPU, Vulkan, and OpenCL. |
| **MeetingExport** | `meeting-export-capacitor` | **Export & Share**. Renders HTML to PDF and handles Android Share Intents. |
| **LiteRT** | `litert-capacitor` | **Google Edge AI Engine**. Runs `.litertlm` models (Gemma 4 QAT, Gemma 4 E2B/E4B) via LiteRT 0.11.0 runtime. Optimized per hardware (NPU/GPU), Multi-Token Prediction (MTP), and memory-mapped embeddings. |
| **Vosk** | `vosk-capacitor` | **Offline Speech-to-Text**. Continuous large-vocabulary speech recognition. Fast, lightweight. Used for Meeting Mode and Voice Mode. |
| **Voxtral** | `voxtral-capacitor` | **Real-time STT**. Mistral Voxtral Mini 4B Realtime via `mtmd` multimodal API (PCM→mel→CLIP→llama). Greedy token sampling (temperature=0). Heavy model: the model orchestrator frees the LLM before it loads (§4.1.5). |
| **Whisper** | `whisper-capacitor` | **High-Fidelity STT**. Runs OpenAI Whisper models (cpp port). Supports multilingual transcription and diarization preprocessing. |
| **Piper** | `piper-capacitor` | **Neural TTS**. Synthesizes speech locally. Supports ONNX voice models with variable speech/pitch. |
| **KokoroTTS** | `KokoroTTS` | **State-of-the-Art Neural TTS**. Offline multi-lingual speech synthesis powered by Sherpa-ONNX (`OfflineTts` / Kokoro-82M). Features in-JVM streaming archive decompression (Apache Commons Compress) supporting `.tar.bz2`, `.tar.gz`, `.zip`, `.tar` bundles with `content://` URI resolution and path normalization. Supports Italian (`if_sara`, `im_nicola`), English US (`af_sky`, `am_michael`), and English UK (`bf_emma`, `bm_george`). |
| **Wakeword** | `wakeword-capacitor` | **Hotword Detection**. Runs `.tflite` models (e.g., "Hey Jarvis"). Monitoring usually 500ms intervals. |
| **VAD** | `vad-capacitor` | **Voice Activity Detection**. Silero VAD based. Detects when user starts/stops speaking to handle turn-taking. |
| **AudioOutput** | `audio-output-capacitor` | **Audio Routing**. Switches output between Earpiece (privacy) and Speakerphone. |
| **AudioPlayback** | `AudioPlaybackPlugin` | **Segment Playback**. Leverages AndroidX Media3 ExoPlayer for precise Tap-to-Play segment replay without degrading live mic recording quality (bypasses AEC ducking). |
| **AudioConverter** | `n/a` (Java Utility) | **Media Processing**. Uses specialized `AudioEncoder`, `AudioDecoder`, and `WavHelper` utilities to process PCM to AAC/M4A/WAV. |
| **Termux** | `termux-capacitor` | **Shell Execution**. Runs commands through Termux's `RUN_COMMAND` intent (needs Termux with `allow-external-apps=true` and the RUN_COMMAND permission, asked at runtime). Model-supplied arguments are always shell-quoted; installing packages asks for confirmation. |
| **BackgroundService** | `background-service-capacitor` | **Process Management**. Foreground service (type `microphone` when the mic permission is granted, otherwise `specialUse`): keeps a meeting recording with the screen off and backs the keep-alive option. |
| **Proactive** | `ProactivePlugin` | **Proactive Engine**. Schedules/cancels the periodic WorkManager job (`ProactiveWorker`) and gives it the server settings for contextual delivery. |
| **KeepAlive** | `KeepAliveService` | **Persistence**. Special use foreground service to guarantee "Always Loaded" model availability. One setting (`keep_alive_enabled`) drives it, the background service and the JS background features. |
| **AndroidAuto** | `android-auto-capacitor` | **Car Integration**. Projects a simplified UI (GridTemplate) to car dashboard via IOT category. Screens: Main, Call Mode, Calendar, To-Do, Kanban. |
| **Performance** | `performance-capacitor` | **Battery Opt**. Requests "Ignore Battery Optimizations" to allow heavy compute. Checks thermal state. |
| **SystemMonitor** | `system-monitor-cap` | **Diagnostics**. Real-time CPU/RAM usage tracking with granular visibility controls (RAM, CPU, GPU, App Mem). Floating overlay capability. |
| **SpeakerEmbedding** | `speaker-embedding-capacitor` | **Biometrics**. Generates vector embeddings from voice audio for Speaker Diarization (Guest vs User 1 vs User 2). |
| **TextEmbedding** | `text-embedding-capacitor` | **RAG Core**. Runs `all-MiniLM-L6-v2` to vectorize text for Semantic Memory storage and retrieval. |
| **Genie** | `genie-capacitor` | **Qualcomm NPU LLM Runtime**. Executes Qwen 3.5, Qwen 2.5, and Gemma models directly on Hexagon NPU (HTP v79/v75) via Qualcomm AI Engine Direct (QNN) & GenieX SDK. 50+ tok/s at 2W power draw. |
| **SD** | `sd-capacitor` | **Qualcomm NPU Image Generation**. Runs Stable Diffusion packages (`text_encoder.bin`, `unet.bin`, `vae.bin`, optional `vae_encoder.bin` / `realesrgan_x4plus.bin`, quantized or float) on the Hexagon NPU, ~1 s per step. |

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

### 3.4 Qualcomm Genie NPU LLM Subsystem (`genie-capacitor`)
The `genie-capacitor` plugin runs LLMs on the Qualcomm Hexagon NPU through the **GenieX SDK** (`com.qualcomm.qti:geniex-android:0.8.0`, Maven Central; also used by `sd-capacitor` for its QNN libraries — QNN 2.45.0.260326154327 in both 0.3.5 and 0.8.0). It has two runtimes, chosen by the model file:

| Runtime | Model | NPU support | Prompt |
| :--- | :--- | :--- | :--- |
| **`llama_cpp`** | One **`.gguf` file** (downloaded or imported, in the app's files dir) | Any Hexagon **v68+**: GenieX ships `libggml-htp-v68…v81.so` → **Fold5 (SM8550, v73) and Fold7 (SM8750, v79)**, same file | The GGUF's own chat template (`Genie.formatChat` → `LlmWrapper.applyChatTemplate`) |
| **`qairt`** | A Qualcomm AI Hub bundle (`.zip` → `models/genie/<name>/`, `genie_config.json` + context binaries) | Compiled for one NPU generation; GenieX ships the QNN HTP libraries for **v79/v81 only** → Fold7 | Formatted in JS (`genieSupport.formatBundlePrompt`: ChatML for Qwen, turns for Gemma) |

*   **SoC detection** (`HexagonSoc.kt`, unit tested): `SOC_MODEL`/board → Hexagon arch (`sm8550`/`kalama` → v73, `sm8650`/`pineapple` → v75, `sm8750`/`sun` → v79, `sm8850` → v81). `getCapabilities()` returns `npuArch`, `socModel`, `ggufNpuSupported` and `qairtSupported`; the UI shows only what the phone can run.
*   **GGUF loading** (`GenieEngine.loadGguf`, pure decisions in `GgufSupport.kt`, unit tested): `LlmCreateInput(runtime_id = "llama_cpp", compute_unit = …, ModelConfig(nCtx = contextLength ?: 4096, nGpuLayers = 999 | 0 on CPU))`. `LLMConfig.genieRuntime`: `auto` (default) tries **NPU → GPU → CPU** (a failed create moves to the next unit), or a fixed `npu`/`gpu`/`cpu`. Weights without NPU kernels (K-quants) start from the **GPU** under `auto`: on the NPU they load, but almost all of them run on the CPU (Gemma 4 E2B Q4_K_M on SM8750: 14.5 tok/s "on NPU" vs 23.4 on GPU). The unit actually used is returned (`computeUnit`) and shown in the settings, with a warning when `auto` fell back from the NPU and a note for formats without NPU kernels. Loads and unloads are serialized (`loadMutex`): two activity instances loading the same 4B model together doubled the RAM and the low-memory killer closed the app. The model is reloaded when the configured unit or context changes (`genieLoadMatches`). `nCtx` is always the configured window: 0 would mean the GGUF's training window (far too much RAM).
*   **Weights on the NPU**: the Hexagon kernels of GenieX (also in `libggml-htp-v73.so`) run **Q4_0, Q4_1, IQ4_NL, MXFP4 and Q8_0** weights — matmul and flash attention on the HMX tensor unit, `gated_delta_net`/`ssm_conv` (Qwen3.5), GELU/GEGLU (Gemma), RoPE, softmax. K-quants (Q4_K_M…) fall back to GPU/CPU: `npuReady` (from the file name) marks the models with an NPU badge. GenieX's llama.cpp knows the `qwen35`, `gemma4` and `gemma3n` architectures.
*   **Recommended GGUFs for the NPU** (`RECOMMENDED_GENIE_MODELS`, files and sizes checked on the Hugging Face API, none gated; saved as `<id>.gguf` by the GGUF downloader, so the weight format stays in the name):

| Model | Repository · file | Size | Notes |
| :--- | :--- | :--- | :--- |
| Qwen3.5 4B | `unsloth/Qwen3.5-4B-GGUF` · `Qwen3.5-4B-Q4_0.gguf` | 2.58 GB | Best quality under 5B. Hybrid (Gated DeltaNet): no prefix reuse, every turn re-reads the conversation |
| Qwen3.5 2B | `unsloth/Qwen3.5-2B-GGUF` · `Qwen3.5-2B-Q4_0.gguf` | 1.21 GB | Lightest, same caveat |
| Gemma 4 E2B | `google/gemma-4-E2B-it-qat-q4_0-gguf` · `gemma-4-E2B_q4_0-it.gguf` | 3.35 GB | Google QAT Q4_0, ~2B effective, standard attention → prefix reuse |
| Gemma 4 E4B | `google/gemma-4-E4B-it-qat-q4_0-gguf` · `gemma-4-E4B_q4_0-it.gguf` | 5.15 GB | ~4B effective; above the ~3.5 GB of one NPU session and heavy for 12 GB: the benchmark decides |

    Qwen 3.6/3.8 have no small models. On the Fold7 the AI Hub QAIRT bundles remain importable (e.g. Qwen3-VL-4B, Qwen3-4B-Instruct-2507, **Gemma-4-E4B-it** with vision). Gemma 4 bundles need **GenieX ≥ 0.8.0** (0.3.5 had no factory: `dispatch: no VLM factory matches model_id 'gemma_4_e4b_it'`). Bundle prompts come from the bundle's own chat template (`VlmWrapper`/`LlmWrapper.applyChatTemplate`, e.g. Gemma 4: `<bos><|turn>role … <turn|>`); `formatBundlePrompt` (ChatML, Gemma 4 and Gemma 2/3 turns) is only the fallback. Vision projectors (`mmproj`) of GGUFs are not used by this engine yet.
*   **Gemma-4-E4B-it bundle (w4a16, 9.2 GB on disk)**: 6.5 GB are the embedding tables stored as **uncompressed int16 lookup tables** (`embed_token_int16_lut.bin` 5.25 GB with the 42×256 per-layer embeddings, `embedding_int16_lut.bin` 1.25 GB), 2.25 GB the 4-bit NPU context binaries (`part1…4_of_4.bin`: `prompt_ar128_cl4096` and `token_ar1_cl4096` graphs, context 4096), 0.45 GB the vision encoder. The tables are read from the file (the per-layer embedding provider looks rows up), not loaded: with the bundle loaded the phone had **more** free RAM (4.88 GB) than with Gemma 4 E2B GGUF (4.80 GB). The equivalent GGUF keeps the same tables quantized (q4/q6) in CPU RAM.
*   **Vision (QAIRT VLM bundles)**: `formatChat` messages take `imageCount`, which puts the template's image slots (Gemma 4: `<|image|>`/`<__image__>`) before that message's text; `generateStream` takes `images` (data URLs), written to `cache/genie_images/` (`GenieChat.writeImages`, unit tested) and passed as `GenerationConfig.imagePaths` in the same order. `genieProvider` sends only the images of the user message being answered (older ones would be re-encoded every turn), and only when the loaded model reports `isVision`; without a chat template the images are dropped with a warning. Measured on the Fold7: one 640×480 JPEG → 256 vision tokens spliced into the prompt, first token 2.3 s, then 11.3 tok/s; shapes, colours and text read correctly.
*   **Generation**: `generateStream` passes `SamplerConfig` (temperature, top-p, top-k 40, min-p 0.05, a fresh seed) to GGUFs; QAIRT bundles sample as their `genie_config.json` says. The whole conversation is sent every turn: GenieX's llama_cpp keeps the KV of the longest common prefix (measured: the second chat turn processes only its new tokens). **GenieX 0.3.5 cache bug**: after a partial rollback (a prompt that diverges from the cached one, e.g. a background memory task between two chat turns) its token list keeps growing and every later call fails with "Context length exceeded" until the model is reloaded. `GenieEngine` therefore resets the cache (`LlmWrapper.reset()`) unless the new prompt continues the last completed one, or when the last generation failed or was stopped (`GgufSupport.mustResetBefore`), and on a context overflow before any token it resets and runs the prompt once more. The last chunk carries GenieX's **profile** (`ttftMs`, `promptTokens`, `prefillSpeed`, `generatedTokens`, `decodingSpeed`, `computeUnit`), recorded by `npuStats.ts`, logged and shown in the settings ("Last answer: NPU · first token … · prompt … tok/s · answer … tok/s").
*   **Native tools and reasoning** (Gemma 4, Qwen 3): `Genie.formatChat({ messages, enableThinking, tools })` passes the tool declarations (JSON array, OpenAI style, from `nativeToolDeclarations.ts`) and the agent's tool turns — assistant `toolCalls` (`GenieChat.toChatMessages`/`toVlmMessages` → GenieX `ChatMessage(role, content, toolCalls, toolCallId, toolName)`, unit tested) and `tool` results — to the model's own template, which writes them as the model was trained (Gemma 4: `<|tool>declaration:…` in the system turn, `<|tool_call>call:name{…}<tool_call|>`, `<|tool_response>response:name{value:…}<tool_response|>`). Whether a template renders tools is checked once per model (`nativeToolSupport.ts`: a probe declaration): `template` → native format; `ignored` → the ReAct prompt (the Gemma-4-E4B QAIRT bundle's VLM template drops the tools; with ReAct it called the right tool 10/11 times on the Fold7, with the app-written native format 0/11: JSON in markdown, and the VLM pipeline refused the pre-formatted prompts as too long); `none` (a Gemma 4 bundle without a template) → `gemma4Format.ts` writes the same prompt in JS (checked against llama.cpp's `/apply-template` in `test/fixtures/gemma4-template-golden.json`). Generation stops at `<|tool_response>` (Qwen: `<tool_response>`); the call is parsed at the end (`parseToolCalls`: Gemma 4 `<|"|>` strings, objects, arrays, numbers, the bare `call:name{…}` form; Qwen JSON in `<tool_call>`) and never shown in the bubble (`visibleText`); a call written inside the thought channel is ignored. The model gets short localized tool rules instead of the ReAct instructions (use a tool only when needed; never claim an action without its call; the user's life from memory, not the web) and reasons natively with tools on too. A tool-free final step keeps the earlier tool turns in the native format.
*   **Grammar**: `generateStream({ grammar })` sets `SamplerConfig.grammarString` on GGUFs (memory extraction, §4.2.2); QAIRT bundles ignore it.
*   **QAIRT sampling**: bundles get the app's `SamplerConfig` (temperature, top-p, top-k 40, min-p 0.05) too; if GenieX refuses it before the first token, the bundle falls back to its `genie_config.json` sampling for as long as it stays loaded (`qairtSampler`).
*   **Assistant quality on the phones** (on-device eval, `npm run eval:device`, Atlas, auto context; % of scenarios passed):

| Phone · model (NPU) | Reasoning | Recall | Tools | Hygiene | Extraction | Answer time (median: recall / tool turn) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| Fold7 · Gemma 4 E2B Q4_0 | on | 91 | 95 | 100 | 69 (3×) | 14.9 s / 24.6 s |
| Fold7 · Gemma 4 E2B Q4_0 | **off** | 91 | 95 | 100 | — | **1.5 s / 2.7 s** |
| Fold5 · Gemma 4 E2B Q4_0 | on | 100 | 94 | 100 | 83 | — |
| Fold7 · Gemma 4 E4B Q4_0 | on | 100 | 100 | 100 | 83 | 31.8 s / 39.3 s |
| Fold7 · Gemma 4 E4B Q4_0 | off | 100 | 86 | 100 | — | 2.8 s / 5.2 s |

    The reasoning costs ten times the time for the same scores on E2B: off is the right default. E4B without reasoning asked for details instead of acting ("which brightness level?", "which date is Thursday?"); the tool descriptions now say that dates and times may be the user's words and give typical values (brightness, default time). Long series heat the phone (§ device eval: thermal pause).
*   **Checked on the phones** (2026-10-04, GenieX 0.8.0, Gemma 4 E2B Q4_0 on the NPU of the Fold7 v79 and the Fold5 v73): the GGUF template renders the tool declarations (probe `template`); special tokens reach the stream as text (`<|channel>thought`, `<|tool_call>`), so the parsers see them; prefill 760–830 tok/s and decode 21 tok/s on both phones. GenieX's native library logs every prompt and output at VERBOSE level under the tag `GenieXSdk` (no API to lower it): readable only through adb or system apps.
*   **Context**: GGUFs follow the app's context (§4.1.4: auto 8192 on v79/v81, 4096 otherwise); a QAIRT bundle reports the context it was exported with (`genie_config.json` `dialog.context.size` → `contextLength`), which the budgets use.
*   **QAIRT bundle lifecycle**: `.zip` bundles (e.g. `qwen3_vl_4b_instruct-geniex_qairt-w4a16-qualcomm_snapdragon_8_elite.zip`) are extracted to `models/genie/<model_name>/`; `resolveGenieConfig` rewrites the relative paths of `genie_config.json` (tokenizer, `ctx-bins`, embedding LUT, HTP backend extensions with `perf_profile: burst`, shared buffers, FastRPC tuning); `vision_encoder.bin`/`visual.bin` binds `VlmWrapper`, text models `LlmWrapper`.
*   **UI** (`GenieSettings.tsx` + `GenieGgufSection`, `GenieQairtSection`, `GenieModelRow`, hook `useGenieModels`): what the phone supports, the active model and the unit it runs on, the compute-unit selector (Auto/NPU/GPU/CPU), GGUFs on disk (NPU badge, Load, Delete), recommended downloads with progress (resumed after the screen closes), and the AI Hub import (only where QAIRT runs, otherwise an explanation). Loading goes through `initGenieModel`, so the model orchestrator frees the other LLM engines first.
*   **Measured, not assumed**: the speed and energy of each engine/unit come from the benchmark (§6.1, "Speed & battery benchmark"); background memory work uses the chat model, so choosing the NPU there moves it to the NPU too. Measured on the Fold7 (SM8750, 2026-10-04, on USB power, so no energy; GenieX 0.3.5 unless noted):

| Model · engine/unit | Load | Prompt (short / ~1.2–1.7k tok) | Answer |
| :--- | ---: | ---: | ---: |
| Gemma 4 E2B Q4_0 · GenieX **NPU** (36/36 layers on HTP0, ~1 GB weights; per-layer embeddings in CPU RAM) | 2.8–3.2 s | 393 / 895–955 tok/s | **25.5 tok/s** |
| Gemma 4 E2B Q4_0 · GenieX GPU | 15.6 s | 196 tok/s | 19.2 tok/s |
| Gemma 4 E2B Q4_0 · GenieX CPU | 4.9 s | 102 tok/s | 16.6 tok/s |
| Gemma 4 E2B Q4_0 · llama.cpp engine (CPU) | 11.7 s | ~261 tok/s | 7.2 tok/s |
| Gemma 4 E4B QAT Q4_0 · GenieX NPU (43/43 layers, 2.1 GB on HTP0; ~5.4 GB RAM in all) | 5.5 s | 228 tok/s | 14.9 tok/s |
| Qwen3.5 2B Q4_0 · GenieX NPU (good speed, poor Italian) | 2.4 s | 398 tok/s | 27.6 tok/s |
| Qwen3-VL 4B · QAIRT bundle (NPU) | — | 398 tok/s | 20.9 tok/s |
| **Gemma-4-E4B-it · QAIRT bundle (NPU, GenieX 0.8.0)** | 7.8 s | 303 / 550–681 tok/s | 11.2 tok/s |
| Gemma 4 E2B Q4_0 · GenieX NPU, **GenieX 0.8.0** | — | 664 tok/s (short) | 28.0 tok/s |

*   **Data Flow**:
```
Settings / chat (genieProvider.ts)
  └─> initGenieModel(path, {genieRuntime, contextSize}) ── ensureResident('genie')
        └─> Genie.loadModel ─> GenieEngine.kt
              ├─ .gguf ─> GgufSupport.resolve / unitsFor ─> LlmWrapper (llama_cpp, npu → gpu → cpu)
              └─ bundle ─> extractZipStream / resolveGenieConfig ─> Llm/VlmWrapper (qairt, NPU v79/v81)
  └─> prompt: Genie.formatChat (GGUF template) | formatBundlePrompt (bundle)
  └─> Genie.generateStream ─> tokens … last chunk {done, profile} ─> npuStats ─> settings
```

### 3.5 Whisper STT NPU Hardware Optimization & Model Bundle Management
The `whisper-capacitor` plugin features automated hardware detection, versatile model importing, and SoC acceleration:
*   **SoC Recognition**: Identifies Snapdragon 8 Elite (SM8750 / Hexagon v79) and Snapdragon 8 Gen 2/3.
*   **NPU Offload**: Routes heavy encoder convolutions and attention blocks to Hexagon NPU, reducing transcription latency from ~3–5s on CPU down to ~150–300ms.
*   **Dedicated "Whisper Only" STT Mode**:
    *   **Assistant Voice Input (`VoiceChatOverlay`)**: Leverages `WhisperLiveStreamManager` and `HighQualityAudioRecorder` (16kHz PCM mono) with low-latency RMS energy speech activity chunking, providing instant on-device neural transcription without requiring Vosk models.
    *   **Meeting Assistant**: Direct real-time audio chunk stream transcription (`transcriptionMode === 'whisper'`) bypassing Vosk overhead, paired with ONNX ECAPA-TDNN precise speaker diarization.
*   **ZIP Bundle & Standalone Model Import**:
    *   Supports single `.bin` model files (GGML format) and `.zip` archives (Qualcomm AI Hub QNN Context Binary packages containing `encoder.bin`, `decoder.bin`, `metadata.json` or GGML `.bin` archives).
    *   `WhisperFileUtils` provides streaming ZIP extraction, path traversal security, and automatic directory flattening.
    *   Dynamic binary path resolution (`resolveModelBinaryPath`) automatically indexes and resolves both root `.bin` files and nested directory bundles in `whisper-models/`.
*   **Meeting Mode Efficiency**: Consumes up to 75% less battery during continuous meeting diarization.

### 3.6 Stable Diffusion Qualcomm NPU Subsystem (`sd-capacitor`)
The `sd-capacitor` plugin implements the high-performance on-device Stable Diffusion synthesis pipeline on Qualcomm Hexagon NPU:
*   **Pre-compiled Graphs**: Loads `text_encoder.bin`, `unet.bin`, `vae.bin` (required), `vae_encoder.bin` (image editing) and `realesrgan_x4plus.bin` (AI upscaling): QNN context binaries for the Hexagon HTP, either quantized (Qualcomm AI Hub `w8a16`, uint16 tensors) or float exports (float32 tensors, e.g. the UberRealistic package).
*   **Tensors read from each binary**: `qnn_graph_io.cpp` reads graph name, tensor ids, data types, quantization (`scale`/`offset`) and shapes through the QNN System API (`libQnnSystem.so`), so any package runs without per-model constants (the Qualcomm SD 2.1 layout is kept only as a fallback when the System API is unavailable). The engine checks that the graphs fit together (text embedding size, latent shape, image size) and refuses an inconsistent package. Binaries are memory-mapped while their NPU context is created (no heap copy of a 1.7 GB UNet). `qnn_types.h` mirrors the QNN ABI with `static_assert`ed offsets; unloading frees every context and the backend.
*   **Subsystem Components**:
    *   `ClipTokenizer.kt`: 77-token CLIP BPE tokenizer (`vocab.json`, `merges.txt`); pads with `!` (id 0) for SD 2.x and with `<|endoftext|>` for SD 1.x (768-dim text encoders); prompt weights `(text:1.3)`, `(text)` ×1.1, `[text]` ÷1.1; reports prompts cut at 75 tokens.
    *   `PromptTools.kt`: weights move a token's embedding relative to the empty prompt's; `PredictionTypeProbe` (epsilon vs v-prediction, see below); `SDGeometry` (aspect crops, fitting a source into the square, mirrored margins).
    *   `DiffusionScheduler.kt`: scaled-linear schedule in the sigma formulation, "trailing" timestep spacing capped at the UNet's calibrated maximum (951 for the quantized Qualcomm package, whose timestep input cannot carry more), samplers **Euler** (default) and **DPM++ 2M** working on the denoised estimate for both epsilon and v-prediction models, CFG, img2img start step = `steps × strength` as in diffusers.
    *   `SDImageOps.kt`: decodes data URLs, base64, file paths, `content://` and Capacitor web paths with EXIF orientation and high-quality downscaling; fits the image to edit into the square without distortion (mirrored margins, cropped away after decoding); upscales the whole square with Real-ESRGAN and only then crops; returns PNG up to 1024 px and JPEG (q95) above.
    *   `SDEngine.kt`: text conditioning (the negative prompt is the unconditional CFG branch; CFG ≤ 1 runs one UNet pass per step), denoising loop, decoding, cropping and upscaling; returns the seed actually used (random seeds included), sampler, prediction type and whether the prompt was truncated.
    *   `SDDiagnostics.kt`: tensor statistics, NaN/Inf guard on every text encoder and UNet output (an FP16 overflow in an exported graph fails with an explicit error instead of a broken image), untrained text encoder signature.
*   **Prediction type**: `metadata.json` `"prediction_type"` when present; otherwise one UNet call on a blank latent at t=900 at load time decides it (an epsilon model returns the input noise, correlation > 0.85; a v model a weakly correlated output, < 0.7: UberRealistic measures 0.21 at 512 px and 0.41 at 768 px) and the result is cached per `unet.bin`; undetermined → v-prediction for SD 2.x (768-v), epsilon for SD 1.x. The Qualcomm AI Hub SD 2.1 package derives from SD 2.1 768-v and runs at 512×512 (`v_prediction`).
*   **NPU versions**: a QNN context binary runs only on the Hexagon version it was compiled for, so each package targets one NPU (`metadata.json` `"hexagon"`, or `chipset_attributes.htp_version` in Qualcomm packages): `sd2.1lora` / `sd2.1lora768` for v79 (Snapdragon 8 Elite, Z Fold7), `sd2.1lora_v73` for v73 (Snapdragon 8 Gen 2, Z Fold5). `SDEngine` maps the phone's SoC to its Hexagon version (SM8550 v73, SM8650 v75, SM8750 v79, SM8850 v81), refuses a package built for another one with an explicit error before touching the NPU, and passes the version to the native engine, which preloads the matching `libQnnHtpVxxStub.so`. The NPU counts as available only when the APK ships that stub: GenieX's AAR brings the V79/V81 runtime, `scripts/fetch-qnn-htp-libs.sh` adds V73 (stub, skel, `libQnnHtpV73.so`) from the QAIRT SDK of the same build as GenieX's `libQnnHtp.so` (2.45.0.260326154327; the script refuses any other).
*   **Custom packages**: UberRealistic (SD 2.1 768-v fine-tune, `v_prediction`) ships as `sd2.1lora` (512 px: FP16 text encoder and UNet, Qualcomm VAE) and `sd2.1lora768` (768 px: all graphs FP16, UNet ~0.5 s per call on the Snapdragon 8 Elite vs ~0.16 s at 512, about 3× slower per image, noticeably better anatomy and detail) and `sd2.1lora_v73` (512 px for the Z Fold5), plus `sd2.1lora_v73_w8a16` (same with a w8a16 UNet: 0.88 GB instead of 1.74 GB, 20 MB spill-fill buffer instead of 181 MB, ~0.16 s per UNet call on an AI Hub S23 against ~0.8 s for FP16; the text encoder stays FP16 because min_max int16 ranges break it). Measured on the Z Fold5 with the performance vote below: ~10 s per 512 px image (FP16 package ~16 s), same pictures for the same seed, Real-ESRGAN loads again (2x upscale in 16:9 ~14 s in total). Measured on 2026-10-04 (25 Euler steps, CFG 7.5): Z Fold7 ~12 s at 512 and ~38 s at 768, Z Fold5 ~41 s at 512; on the Fold5 the FP16 graphs fill the v73 NPU's address space, so Real-ESRGAN does not load (context error 0x3ea, upscaling falls back to bilinear). Both are built and validated by `scripts/export_uberrealistic.py` (DEVELOPMENT_GUIDE §4.3).
*   **NPU performance vote**: for the duration of each generation `SDEngine` asks the native engine for Qualcomm's "burst" power configuration (HTP perf infrastructure through `deviceGetInfrastructure`: DCVS off, bus and core at the maximum voltage corner, no DSP sleep, RPC control latency 100 µs and polling 9999 µs, HMX at turbo from v75) and withdraws it in a `finally` block (the power config id is destroyed; release() also drops it). Without it the NPU follows the default DCVS policy: on the Z Fold5 a w8a16 UNet call took ~0.52 s instead of ~0.19 s (27.4 s → 9.7 s per image, bit-identical pictures); the Z Fold7's default policy was already close (512 px ~11.7 s → ~10.5 s, 768 px ~39 s → ~36 s). The result reports `npuBurst`.
*   **Sanity checks**: at load the empty-prompt embedding is logged; if every token is normalized to mean 0 / std 1 (a final LayerNorm still at its initial weights, i.e. a `text_encoder.bin` compiled without its weights) an error is logged, because images would ignore the prompt. With `log.tag.SDEngine` at DEBUG each step logs latent and denoised-estimate statistics and the RMS of the conditional minus unconditional UNet output (how much the prompt steers the step).
*   **Editing (img2img)**: needs `vae_encoder.bin`; without it, or when the source cannot be read, the request fails with an explicit error (no black canvas, no zero latents). The result keeps the source's proportions. SD 2.1 cannot follow instructions: the prompt must describe the final picture.
*   **Super-Resolution & Aspect Ratio**:
    *   **Real-ESRGAN x4plus** on the NPU (`realesrgan_x4plus.bin`): the full 512×512 image becomes 2048×2048, then the aspect crop is taken; 2x halves it with high-quality filtering. Without the model, bilinear scaling (the image screen says so). The bundled model takes 512×512 input, so the engine disables it for 768 px packages (bilinear 2x/4x).
    *   **Aspect ratios** are centered crops of the square (each package's graphs have a fixed square size, read from the binaries: 512×512, or 768×768 for `sd2.1lora768`): `16:9` → 512×288 / 1024×576 / 2048×1152 at 512 px, `9:16`, `4:3`, `3:4` likewise.
*   **Model Bundle Management**:
    *   `sdModelDownloader.ts` and `SDFileUtils.kt` provide complete model package import, streaming ZIP extraction, macOS metadata filtering (`__MACOSX`, `.DS_Store`), and automatic directory flattening into `sd-models/<modelName>/`.
    *   Full model manager in **Settings > Vision & Image Creation** (`StableDiffusionSection.tsx`) with active model selection, model directory listing, and recursive deletion.
*   **Path Resolution & Multi-Stage Auto-Load**:
    *   `imageGenService.ts` automatically strips URI scheme prefixes (`file://`) and normalizes paths before communicating with the native layer, preventing path duplication bugs across Capacitor Filesystem bridges.
    *   `SDEngine.kt` implements a robust multi-stage fallback lookup (direct path, `filesDir`, `sd-models/`, and recursive `findSDModelDirectory` up to depth 3) to seamlessly locate model binaries even in nested archive structures.
    *   `imageGenService.ensureLoaded()` verifies native engine status (`isLoaded`) and loads the model chosen in Settings (`llm-config.sdModelId/sdModelPath`) before falling back to local installed models; selecting a model in Settings only verifies it (loads and frees it again). `isLoaded`/`loadModel` also report what the package supports (`hasVaeEncoder`, `hasSuperResolution`, `predictionType`).
*   **Performance & Flexibility**:
    *   ~1.0 s per step on Snapdragon 8 Elite (two UNet passes with CFG) for the quantized package; float packages are slower.
    *   Steps 5–50 (default 25), CFG 1–25 (default 7.5), sampler, seed (empty = random), aspect ratio, resolution 512/1024/2048.
*   **Modal Studio & GUI**:
    *   `ImageGenModal` (🎨 in the chat input bar): text-to-image, image editing, style presets (prompt suffix + negative prompt), aspect ratio (txt2img only: edits keep the source shape), AI upscaling, advanced controls (negative prompt, steps, CFG, sampler, seed), progress bar; the result card shows the seed with a "reuse" button and warns about truncated prompts. Editing from a chat image starts with an empty prompt (a description of the result, not an instruction).
    *   **Save / Share**: `AIMindMesh_SD_{timestamp}.png|jpg` in Documents, or the Android share sheet.
*   **Conversational Chat Integration**:
    *   `/image <text>` (`/draw`) and `/edit <text>`: the chat LLM, still in RAM, rewrites the request as an English Stable Diffusion prompt (for `/edit`, a description of the edited picture; 20 s timeout, original text on failure), then SD takes its place; a default negative prompt is applied. `/edit` uses the attached image, else the newest image in the chat. The reply shows the prompt used and the seed.
    *   Tool `generate_image(prompt, negative_prompt?, source_image?, strength?)`: the model writes the English prompt itself; `source_image: "last"` means the newest image of the run or the chat (the model cannot copy pixels into arguments). The picture is attached to the answer bubble and never sent back to the model.
*   **Data Flow**:
```
Chat Input (🎨) / Slash Command (/image, /edit) / Tool Call (generate_image)
  └─> [chat] rewriteImagePrompt (chat LLM → English SD prompt) → imageGenService.generateFromChat
  └─> imageGenService.generateImage({ prompt, negativePrompt, sourceImage?, strength?, steps, cfgScale, seed, sampler, aspectRatio, upscale }) (TS)
        └─> SD.generateImage(...) (sd-capacitor) → SDPlugin.kt → SDEngine.kt
              ├─> ClipTokenizer.kt + PromptWeighting (77 tokens, weights vs empty prompt)
              ├─> text_encoder.bin ─┐
              ├─> [img2img] SDImageOps (EXIF, fit + mirrored margins) → vae_encoder.bin → noise at steps×strength
              ├─> DiffusionScheduler.kt (Euler / DPM++ 2M, epsilon / v) ⇄ unet.bin (cond + uncond per step)
              ├─> vae.bin → 512×512 RGB
              ├─> realesrgan_x4plus.bin (whole square) → crop (aspect ratio or source shape) → resize
              └─> PNG (≤1024 px) / JPEG data URL + seed, sampler, predictionType, promptTruncated
        (all graphs go through qnn_graph_io: tensor specs read from each context binary)
```

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

**Agent runner (`src/services/agent/agentRunner.ts`, `loopControl.ts`)**: the loop runs without React, driven by callbacks (`generate`, `runTool`, `isDenied`, `needsConfirmation`, `compress`, `update`). `useAgenticLoop.ts` is a thin adapter (chat bubble, toasts, confirmations, TTS) and the eval harness (`eval/`) runs the same runner. Rules:
*   On-device models get at most 3 tool steps (`maxToolSteps`); a call identical to one already run (`callSignature`: name plus sorted, normalized arguments) is not run again and the model is asked for the answer; a call repeated within the same output runs once (the QAIRT bundle wrote each call twice: two shopping items).
*   When the steps run out, a hidden `final_…` user turn asks for the answer with the tools off (localized `finalAnswer`).
*   A step whose reasoning plans one of the offered tools ("I should use `add_shopping_item`") but answers without the call ("Ho aggiunto il latte") is dropped once, and a hidden turn asks for the call (`plannedTool`, localized `callNow`): measured on Gemma 4 E2B with native reasoning on.
*   A recall question ("ricordi dove abito?") is answered with the tools off; a web call for one becomes `search_memory`.
*   Each step's reasoning is shown on its own (it no longer piles up into the next step); the final text goes through `cleanAnswerText` (`prompt/answerHygiene.ts`: stray `<tool_code>`, `<observation>`, channel blocks, template tokens, "Answer:", "In Italian:").
*   Long tool results are summarized with `memoryTaskConfig` (an internal task, not the chat configuration).
*   A confirmation pauses the run (`AgentRunState` kept in the hook) and resumes it with the user's decision.

**Example Flow**:
```
User: "What's the weather in Tokyo?"
LLM Thought: I need to search the web for current weather
[Tool: search_web("Tokyo weather")]
Observation: "Currently 18°C, partly cloudy..."
LLM Response: "The weather in Tokyo is currently 18°C and partly cloudy."
```

**Tool routing** (`tools/routing/toolRouter.ts`, on-device models only): 0–4 tools per turn by intent (Italian and English regexes: current information → `search_web`/`read_web_page`; a URL → `read_web_page`; calendar, reminders, tasks, shopping list, alarm, apps, brightness, volume, shell/files, "ricordati che…" → `save_memory`, "dimentica…" → `search_memory`/`forget_memory`), no LLM call. Small talk, recall questions and requests no rule matches get **no tools** (the turn runs with tool calling off). The set is sticky per conversation (the union of the tools routed so far, fixed order, reset above 6): declarations sit in the system turn, so a set changing every turn would make the engine read the whole prompt again. The choice travels as a runtime flag (`withRoutedTools`) to the providers (native declarations, the compact ReAct list, LiteRT's registered tools).

**Argument checks** (`tools/routing/toolArgs.ts`): before a call runs, its arguments are checked against the tool's schema and repaired when the intent is clear — numbers written as text, times as "7"/"7.30" → `HH:MM`, dates as words ("domani", "venerdì") → `YYYY-MM-DD` through `dateResolver`. What cannot be repaired (missing required argument, unknown enum value, unreadable date) goes back to the model as a localized error (`toolError`); a second failure of the same tool ends the tools for the turn.

**Other on-device engines**: the llama.cpp engine passes `tools` and `enableThinking` to `LLMInference::getFormattedChat` (`common_chat_templates_apply`: OpenAI messages with `tool_calls` and `tool` results; the thinking flag used to default to on, so Gemma 4 reasoned on every turn whatever the setting) and follows the same native path when the GGUF template renders tools (`ggufToolSupport.ts`). LiteRT registers only the on-device (routed) tools, not all 58 (~3k tokens). The compact ReAct prompt, still used by models without native tools, lost its off-topic examples ("Find gemma weights", copied by small models) and gained the rule "never claim an action without its call".

#### 4.1.3 Thinking Mode
Off by default for new installs (`enableThinking: false`); the user turns it on in Settings → Advanced AI Features. The stream parser (`thinkingParser.ts`) ends a block opened by a tag (`<think>`, `<|channel>thought`) only at its closing tag; the "Answer:" heuristic applies only to implicit blocks ("Thinking Process:"), at a real line start — streamed a few characters at a time, Gemma 4's "**Formulate the Answer:**" inside its thought ended the block and the rest of the thought became the answer (seen on the Fold5). When the reasoning uses the whole budget without an answer, the agent repeats the step without reasoning (§4.1.2). On Genie, Gemma 4 and Qwen 3 reason natively through their chat template's thinking flag (`formatChat({ enableThinking })`) when tools are off; other models get the `<thinking>` instruction. The answer budget gets `thinkingBudget` (or 512) tokens on top for the reasoning (`withReasoningAllowance`).
When enabled, displays internal reasoning process before final answer:
*   **Visual Distinction**: Thinking block shown in muted color with "thought bubble" icon
*   **Token Budget**: Configurable limit (default: unlimited)
*   **Use Cases**: Complex reasoning, math problems, code debugging, multi-step planning
*   **Performance**: Adds latency but improves answer quality for complex queries

#### 4.1.4 Message Persistence & Context
*   **Auto-Save**: New messages are persisted immediately to WebView `localStorage` (`threadManager.ts`); a streamed answer is saved once its text stops changing (no write per token). A full storage shows a warning, and threads that cannot be parsed are copied to `conversation-threads-unreadable` instead of being overwritten.
*   **Context Window** (`src/services/llm/context/contextSize.ts`): `contextMode` `auto` (default) picks it from the phone — 8192 on Hexagon v79/v81 (Fold7), 4096 elsewhere (Fold5) — after reading the NPU once (`Genie.getCapabilities`, cached in `aimm-npu-arch`). Gemma 4 shares most of its KV cache (f16 per token: E2B ~18 KB, E4B ~56 KB), so RAM is not the limit; re-reading the whole prompt after a cache reset is (650–950 tok/s on the NPU, ~7 s for 6k tokens). Moving the slider (one `ContextWindowSetting` for GGUF, LiteRT and Genie) switches to `manual` and uses `nCtx`. QAIRT bundles keep the context they were exported with (`genie_config.json` `dialog.context.size`, reported as `contextLength`). Every reader (load, trimming, compression, summarization, task checks) goes through `onDeviceContextSize`; a GGUF reloads when its context changes. In Dual-Model Tool Calling (GGUF), `nCtx` is automatically synchronized across both Chat and Extraction models. **Update**: Introduced Intelligent Context Summarization for extraction. If the extraction prompt exceeds the tool model's limit (e.g., 2048 tokens), the main model automatically generates a concise summary of the relevant history to ensure accurate tool selection without context overflow.
*   **Native Statefulness**:
    *   **GGUF (PocketPal Engine)**: Uses native C++ Jinja2 templates (via `llama.rn` matching) instead of manual TypeScript formatters. Resolves formatting errors by passing OpenAI-compatible `messages` arrays directly to the C++ backend. Employs a Mutex locked `initContext` pattern with Memory-Pressure batch constraints to prevent initialisation race conditions. Uses KV Cache reuse (~95% hit rate via System Prompt Optimization) and token diffing to avoid re-processing the entire prompt history on every turn. Only new tokens are computed.
    *   **LiteRT**: Maintains `Conversation` state object in native memory, syncing message counts with frontend to ensure consistency. 
    *   **LiteRT KV Protection**: The streaming engine relies on the model cleanly outputting its `<end_of_turn>` EOS token. Tool calls (`</tool>`) do **not** forcibly stop the native engine—this prevents syntactical corruption of the Conversation buffer which would otherwise cause severe tool hallucinations (e.g. `<tool>Answer</tool>`).
    *   **LiteRT Template Wrapping**: Manual prompt tags (`<start_of_turn>`) are omitted when passing string buffers to Android because LiteRT's `Conversation` engine automatically wraps User/Model turns. Passing pre-formatted strings causes "Double-Wrapping", immediately breaking Gemma generation.
    *   **LiteRT-LM Architecture**: Upgraded engine to LiteRT-LM `0.11.0` (released May 2026). Supports **Multi-Token Prediction (MTP)** for speculative decoding on GPU backends, significantly improving generation speed on compatible hardware. GPU/NPU acceleration is handled via `Backend` sealed classes. **Gemma 4 Support**: Optimized for the latest `.litertlm` models. The implementation handles response extraction by filtering `Message.contents` for `Content.Text` instances, ensuring compatibility with the latest bytecode-verified API. Engine initialization uses `EngineConfig` with persistent `cacheDir` for accelerated cold starts.
    *   **Drift Detection**: Automatically resets native context if frontend history diverges from native state (e.g., deleted messages).
*   **Context Management**: Automatically truncates oldest messages when limit reached
*   **Memory Integration**: Semantic memories injected into context based on relevance

#### 4.1.5 Context Management & VRAM Optimization
To prevent OOM (Out Of Memory) kills on Android and Adreno GPU crashes, the system implements a multi-layered context protection strategy:
*   **Turn Budget** (`context/turnBudget.ts`): `budgetFor(config, persona, style, context)` gives the answer tokens (the persona's limit, else the response style), the answer plus reasoning the trimming keeps free, and the generation cap (≤ half the window). Genie and GGUF use the same numbers for trimming and generation (GGUF used to reserve the answer without the reasoning, then generate with it).
*   **Trimming Order** (`refineContext`): older history goes first; then the `<context>` block of the last user turn (facts, memories, documents) shrinks, keeping its intro and its last paragraph (the recall instruction); the user's request is cut only when it alone is too long. A system prompt still too large loses its middle (the profile), never the persona at the start or the rules, tools and language rule at the end (`cutMiddle`, `fitTurnText`).
*   **Real Tokenization (BPE)**: Uses `js-tiktoken` (`cl100k_base`) for accurate token estimation. Replaces character-based heuristics to ensure the LLM never receives a prompt exceeding its hardware-allocated context window.
*   **Model Residency (`modelOrchestrator.ts`)**: RAM holds one heavy model at a time: an LLM engine (GGUF chat+tool, LiteRT or Genie), Stable Diffusion, Voxtral or a medium/large Whisper (a tiny/base/small Whisper may stay next to the LLM). At startup only the configured LLM loads (`useModelLoader`); STT loads with a call or a meeting, TTS with the first spoken reply. Opening the image screen (or `/image`, `/edit`, `generate_image`) unloads the LLM and loads Stable Diffusion; closing it frees SD and reloads the LLM. Meetings and calls free their speech models on exit. A recording pins its speech model; a voice call refuses a heavy STT with an on-device LLM. Android memory pressure unloads the heavy models the current feature does not need (critical, foreground) or every unpinned one (app about to be killed).
*   **Tool Output Pruning**: Large tool results (> 800 tokens) are automatically summarized by a fast cloud or local model before being injected into the conversation, preserving reasoning space. The summary prompt carries the user's request, so the facts needed to answer it are kept. Web tools bound their own output below this threshold (§4.1.7).
*   **GGUF Context Reuse (no reset between turns)**: every turn sends the system prompt and the whole (refined) conversation; the native layer (`LLMInference.cpp`) keeps the KV cache and decodes only the tokens after the longest common prefix with the previous prompt. `contextSync.ts` resets the native context only for prompts with images (that path does not track the prefix). The prefix logic is hardened: an identical prompt ("regenerate") re-decodes its last token so the logits are fresh; the reused prefix never exceeds what the KV really holds (`llama_memory_seq_pos_max`); models that cannot drop a suffix of their state (hybrid/recurrent: Qwen3.5, LFM2) clear the memory and decode the whole prompt. The prompt only changes at the top when the hour in `CURRENT CONTEXT`, the profile (new facts) or the context window moves.
*   **Template De-Duplication**: Strips outer chat wrappers from formatted prompts when passing to native engines (GGUF/LiteRT) to prevent "Double-Wrapping" (e.g., nested `<|user|>` tags), which otherwise causes infinite loops or truncated responses.

#### 4.1.6 Persistent KV Cache
To eliminate redundant "Prefill" times (the time taken to process the conversation history) during app restarts or context switching, the system implements a disk-based KV cache persistence layer for native providers:
*   **LiteRT-LM**:
    *   **Persistent History**: A dedicated `ConversationPersistenceManager` serializes the message history (including base64 media) to JSON in the app's `cache/litert_cache/` directory.
    *   **Auto-Restore**: Upon engine initialization, if the native context is empty, the system automatically re-loads and re-submits the persisted history. This efficiently rebuilds the LiteRT-LM KV cache state, ensuring the next generation starts from the previous state without reprocessing everything from scratch.
    *   **Invalidation**: The cache is automatically cleared when a "Hard Reset" or "New Chat" is initiated.
*   **LlamaCpp (GGUF)**:
    *   **In-session prefix reuse**: between turns the native KV cache is kept and only the new tokens are decoded (§4.1.5). GenieX's `llama_cpp` runtime does the same for GGUFs on the NPU (§3.4).
    *   **Slot-Based Persistence**: Utilizes the `/slots/{id}?action=save/restore` REST API for persistent KV management. 
    *   **Server-Side State**: If running `llama-server`, binary KV state is flushed to disk (e.g., in the `--slot-save-path` directory) ensuring instant resumption after app backgrounding or server restart.
*   **Lifecycle Synchronization**: Integrated with the Android application lifecycle. The `NodeWorker` and native plugins automatically flush the active KV state to disk when the application transitions to the background (`appStateChange: inactive`).

#### 4.1.7 Web Search & Page Reading (`src/services/web/`)
`search_web` finds pages, `read_web_page` reads one, `analyze_web` asks the server for a sourced synthesis. No API key is needed: the phone parses the result pages of keyless engines, or delegates to the AIMindMesh Server (SearXNG) when the user enables it (§6.13, *Web tools*).

```
 search_web({query, num_results?, time_range?})
        │
        ├─ delegateWebSearch on ──► POST /api/web/search (SearXNG, standard mode, 20 s) ──┐ results
        │                                   │ error / no results                            │
        ▼                                   ▼                                               │
 html.duckduckgo.com ──► lite.duckduckgo.com ──► search.brave.com     (first engine with    │
   (HTTP 202 / bot check / no results → next engine)                     results wins)      │
        │                                                                                   │
        ▼                                                                                   │
 dedupe by URL ──► re-rank (engine order ⊕ embedding similarity, RRF) ──► top N ◄────────────┘
        │
        ▼
 Observation: "[1] title / URL / snippet …" + hint to read pages   ─── sources → chips under the answer

 read_web_page({url, query?, chunk_index?})
        │  public http(s) only (localhost, LAN, VPN, link-local, .local refused)
        ├─ cache (8 pages, 10 min) ──────────────────────────────────────────────┐
        ├─ delegateWebScraping on ──► POST /api/web/read {url} ─────────────────┤ title + text
        └─ CapacitorHttp GET (10 s connect / 20 s read) ──► pageExtractor ──────┘
                                                            │
             query given ──► 650-char passages ──► top 3 (BM25 ⊕ embeddings) in page order
             otherwise   ──► 2200-char parts ──► part `chunk_index` + "Part i of n, next: …"
```

| Component | File | Responsibility |
| :--- | :--- | :--- |
| Search orchestration | `web/webSearch.ts` | Server delegation, engine fallback chain, region (`kl` from the device locale, e.g. `it-it`), time range (`df=d/w/m/y` for DuckDuckGo, `tf=pd/pw/pm/py` for Brave), deduplication (URL without fragment, `utm_*`, trailing slash), result count clamp (default 5, max 6). Never throws: failures return `success: false` with each engine's error. |
| Result parsers | `web/searchParsers.ts` | DuckDuckGo html (`result__a` / `result__snippet`), DuckDuckGo lite (`result-link` / `result-snippet`), Brave (`div.snippet[data-type=web]`). Each result is read as a unit (title link, then its own snippet): ads (`duckduckgo.com/y.js`) and results without a snippet never shift the others. Snippets are cut at 320 chars. Bot check page detected (`anomaly-modal`). |
| Ranking | `web/ranking.ts` | BM25 keyword scores (Italian + English stopwords, accents folded), cosine similarity through `embedText` (E5 `query:`/`passage:` prefixes) **only when the embedding model is already loaded** (a search never loads a model), reciprocal rank fusion with the semantic list weighted 1.2. At most 30 passages per page are embedded (the best keyword matches). |
| Page reader | `web/pageReader.ts` | URL safety check, server delegation, local GET with a mobile browser User-Agent, redirect target re-checked, binary types refused (`application/pdf`, images, archives → "use download_file"), JSON/plain text passed through, part/passage slicing, per-page cache. |
| Text extraction | `web/pageExtractor.ts` | Quote-aware tag scanner (attribute values may contain `>`, e.g. Wikipedia `data-mw`): drops script/style/svg/head…, hidden elements (`hidden`, `display:none`), ARIA chrome roles, class/id chrome (cookie, consent, share, social, dropdown, sidebar, navbox, toc… only when shorter than 4000 chars, so a content wrapper is never removed) and lists that are only links (≥ 5 items, 80% link-only). Takes `<main>`, else the longest `<article>` (≥ 400 chars), else the body without nav/header/footer/aside/form. Output keeps paragraphs, `## ` headings, `- ` list items and `| ` table cells. |
| URL safety | `web/urlSafety.ts` | Refuses non-http(s) schemes, `localhost`, `*.local`, `*.internal`, single-label hosts, private/loopback/link-local/CGNAT IPv4 and IPv6 (incl. IPv4-mapped). |
| Delegation settings | `web/webDelegation.ts` | Reads `aimindmesh-server-settings` through `readSetting` (API key from the Keystore secret store) and posts JSON with `x-api-key`. |

**Model-facing contract**:
*   **What the model sees** is the tool's `message` only (the agent loop never forwards `data`): search results, page text and the analysis are all in `message`. `ToolResult.sources` (title + URL) feeds the *Sources* chips of the answer (merged with Gemini grounding sources, each URL once, max 10).
*   **Bounded outputs**: a page part is ≤ 2200 chars and a query answer is 3 passages of ≤ 650 chars, so web results stay under the 800-token tool-output summarization threshold (§4.1.5). When a summary is still needed it is focused on the user's request (`buildToolSummaryPrompt`).
*   **Prompt rule (ReAct compact prompt)**: answer from snippets only when they clearly contain the answer; otherwise read the most relevant page; cite URLs; say so when the results do not contain the answer.
*   **`analyze_web`** is offered to the model only while *Web analysis* is enabled for the server (`ToolDefinition.isAvailable`, honored by Gemini declarations, the GGUF tool list and LiteRT tool specs).

**Security**: `read_web_page` is **GET-only** (the former `method`, `headers` and `body` parameters were removed): a page read by the model may contain instructions (prompt injection), so the tool must not be able to POST data elsewhere. Local and private addresses are refused on the phone and, independently, on the server (`aimindmesh-server/src/utils/safeHttp.ts`: the resolved IPs of every connection and every redirect are checked).

#### 4.1.8 On-Device Prompt & Language (`src/services/llm/prompt/`)
Genie, GGUF and LiteRT get a compact system prompt in the assistant's language (`onDevicePrompt.ts`, texts in `promptTexts.ts`) instead of the long English companion prompt of the remote models (truncated on a 2048 context, it made 2–4B models switch to English):
*   persona (name, the personality's own prompt, traits), the profile with localized headers, two rules (use what you know, and say "you haven't told me" instead of "I have no memory"; use tools for current information) — no rule about *how to answer*: on turns with tools, "Rispondi in modo naturale e diretto" plus any other rule made Gemma 4 E2B answer instead of calling (5/12 calls on action requests vs 12/12 without, 0/6 spurious calls either way), a length rule when the answer budget is short (≤ 300 tokens: two or three sentences; ≤ 600: concise) — only on turns without tools: with it Gemma 4 E2B answered instead of calling the tool (0/4 calls, 4/4 without), and the token budget bounds the answer anyway, and the date with the part of the day — no hour, so the prompt and its KV cache last;
*   the tool instructions (native tools: "to do what the user asks — lists, alarms, events, reminders, searches — call the right tool", never claim an action without its call, the user's life from memory, dates as the user's words), then the language rule last (`withLanguageRule`, written in that language: "Scrivi sempre e solo in italiano, anche se le istruzioni sono in inglese." — "Scrivi", not "Rispondi", for the same reason);
*   the turn context (related facts, past-conversation memories, documents, the recall instruction) is localized too;
*   no inline `<save_memory>` rule: facts come from the background consolidation.

**Language** (`languageRule.ts`): setting `assistantLanguage` `auto | it | en` (Settings → Advanced AI Features). `auto` follows the user's last messages (function-word ratio), then the device locale.

### 4.2 Memory (What the Assistant Knows)
Two layers: **facts** (what the assistant knows about the user, always in the prompt) and **conversation memory** (semantic search over past chats, optional). Facts work with every provider, on-device engines included, and on the web build.

```
 Chat ──(answer done)──► ConsolidationScheduler ──(chat quiet ≥3 min / proactive check)──► runBackgroundTask
   │                                                                                           │ JSON ops
   │  save_memory · update_memory tools ──► factGate ◄── JSON ops (add / update / done) ◄────┘
   │  Settings → Memory ─────────────────────────────┐   │                 └──► episode summary
   ▼                                                 ▼   ▼                              │
 buildPromptContext ◄── profile (pinned · important · coming up) ◄── factStore          │
   │               ◄── related facts (embeddings, else keyword stems) ◄─┘               │
   │               ◄── conversation memories (dated) ◄── `memories` table ◄────────────┘
   ▼
 Provider: system prompt (remote) · <context> on the user turn (on-device)
```

#### 4.2.1 Facts (`src/services/memory/facts/`)
| Field | Description |
| :--- | :--- |
| `kind` | `identity`, `person`, `preference`, `goal`, `project`, `routine`, `commitment` (something to do), `event` (something on a date), `other` |
| `content` | One statement, third person, in the user's language (max 400 characters) |
| `subject` | Person the fact is about, when it is not the user |
| `importance` | `1` (trivia) – `5` (core to who the user is) |
| `confidence` | `0`–`1` (`1` = said or confirmed by the user) |
| `source` | `manual`, `extracted` (consolidation), `inline`, `tool`, `imported`, `migrated` |
| `dueAt` | Date of a commitment or an event |
| `status` | `active`, `done`, `superseded` (replaced, kept as history), `expired`, `review` (stored before the fact gate and refused by it now: out of the prompt until the user keeps or deletes it) |
| `pinned` | Always in the profile |
| `category` | Optional user label (the memory categories of the settings) |
| `lastUsedAt` / `useCount` | Retrieval usage (never used to order the profile) |

*   **Storage**: SQLite table `memory_facts` (plus `memory_meta` for markers and cursors) in the `memory` database on Android, written through the `DatabaseManager` write queue; `localStorage` (`memory-facts`) on the web build. `factStore` caches them in memory and announces every change (`subscribe`, `onChange`).
*   **Nothing is merged away**: a fact said again is *reinforced* (importance, confidence, date) instead of duplicated; a fact that changes is *superseded* (the old one stays as history); facts are never summarized.
*   **Open loops**: active commitments and events. Two days past their date they become `expired` (kept for the follow-ups of the next phase).
*   **Embeddings**: with conversation memory on, `embeddingReindexer` gives facts their vector (rows whose `embedding_model` differs from the active model: new and edited facts too).
*   **Migration** (once, marker `facts-migration-v1` in `memory_meta`, deterministic ids): the manual memories (`companion-memories`) become pinned facts (`m:<id>`, kind from the category); the `extracted` rows of older versions become facts (`x:<id>`, vector copied). Nothing is deleted.
*   **Review** (once, marker `facts-review-v1`, `factReview.ts`): active facts that the gate would refuse now — questions, notes of the model, a relative date with no day, trivia of no kind — become `review`; pinned facts and what the user typed are never flagged. Settings → Memory → *To review* keeps or deletes them; nothing is deleted automatically.

#### 4.2.1a Fact Gate (`factGate.ts`)
Every writer — consolidation, `save_memory`, `update_memory` — goes through `gateFact(candidate, { userMessages?, now, known })`:
1.  **Quality** (`factQuality.rejectFact`): empty, too short/long, questions, notes of the model, text about the assistant.
2.  **Grounding** (consolidation only, `factGrounding.groundingMessage`): the quoted `evidence` must cover ≥ 80 % of its words in one message **the user** wrote and share a meaning word with the fact; without a usable quote, that message must contain at least half of the fact's meaning words (two for facts of three or more). The assistant's lines and the prompt are never a source. The message also gives the reference time for dates.
3.  **Dates** (`dateResolver.resolveWhen`, Italian and English): from the `when` words — ignored when the user did not write them (today's date copied from the prompt header) — else from the fact itself, else from the evidence (only for what may be dated: a beagle named Pepe is not an event because the same sentence says "tomorrow"), else a tool's `due_date`. Recurring words ("ogni", "il sabato", "every") mean a routine with no date; a relative date that cannot be resolved, or a day already past, refuses the fact.
4.  **Kind**: the model's, unless missing or `other` (rules: `guessKind`); a recurring event becomes `routine`; a dated fact must be an `event`/`commitment` (a dated `person` or `identity` fact keeps no date); "lives/works…" called a preference becomes `identity`.
5.  **Importance**: clamped 1–5, at most 2 for `other`; 1 (trivia) is refused.
6.  **Duplicates**: same normalized text, or ≥ 80 % shared meaning stems on the same day, against the active facts and the operations already accepted in the same answer.

#### 4.2.2 Consolidation (`factConsolidator.ts`, `consolidationScheduler.ts`)
*   **When**: after an answer the conversation is queued and read once the chat has been quiet for **3 minutes** (for every provider: the user's choice for on-device models), at every proactive check, and — after a restart — for the active conversation. Never while a generation runs; it runs through `runBackgroundTask` (§4.7.7), so the chat always interrupts it.
*   **What**: the messages after the conversation's cursor (hidden system turns, tool turns and errors excluded), in batches of 2,500 characters (on-device) or 6,000 (remote). The prompt (`consolidationPrompt.ts`) is in the assistant's language (setting, else the user's messages) and carries today's date, the date of each message, the related known facts and the open loops as `F1..Fn`, and the user's categories when **AI Auto-Categorization** is on.
*   **Operations**: the model answers `{"ops":[...]}` (max 5 valid ones): `add` (new fact), `update` (`Fn` superseded by the new text), `done` (an open loop is closed). Each carries `evidence` (the user's words, copied) and, for dates, `when` (the date words as said: the app computes the day). One fact per operation.
*   **Grammar**: on GenieX GGUFs the answer is sampled under `FACT_OPS_GRAMMAR` (GBNF: an object with an `ops` array of flat objects with known keys; one blank at most between tokens), passed as a runtime task flag (`withGrammar`) to `Genie.generateStream({ grammar })` → `SamplerConfig.grammarString`. Other engines rely on the tolerant `parseOps`.
*   **Validation** (`validateOps`): every `add` and `update` through the fact gate (§4.2.1a) with the batch's user messages; refs must exist; an `update` must change the text and keeps the target's kind; `done` only on open loops and only when the user's words support it; an operation on a fact edited meanwhile (e.g. by the user) is skipped. Rejections are logged with their reason.
*   **Cursor**: per conversation in `memory_meta`, moved only after a batch is applied: a busy model, a missing key or an active chat leave it in place for a later run.

#### 4.2.3 Prompt Context (`src/services/llm/promptContext.ts`, `memory/context/memoryContext.ts`)
One builder for every provider (Gemini, Claude, Perplexity, OpenRouter, Ollama/local, GGUF, LiteRT, Genie):
*   **Profile** (system prompt): pinned facts, then by importance, kind and age — never by usage, so the system prompt (and the on-device KV cache) only changes when a fact does — plus the dates "coming up" in the next 14 days, as absolute dates. Budget: 900 characters for context windows ≤4k tokens, 1,800 up to 16k, 3,000 above. The first turn after a cold start waits up to 1.5 s for the facts.
*   **Turn context** (built for the real user turn, never for tool observations, nudges or the final-answer turn): up to 3 related facts outside the profile (cosine similarity with the model's threshold when an embedding model is active, otherwise keyword stems with Italian and English stopwords), conversation memories (dated; the messages of the current thread already in the context and the legacy `extracted` rows are excluded), workspace documents. Facts and memories share one budget of **400 tokens** (memories fill what the facts leave, the last one cut to fit). Remote providers append it to the system prompt; on-device engines prepend it to the user turn as a `<context>` block.
*   **Once per turn** (`turnContextCache.ts`): while the agent runner holds the cache, every step of the same turn gets the same context (no new memory search per tool step, and the user turn — hence the engine's KV cache — does not change between steps).
*   **Recall questions** (`recallQuestion.ts`, Italian and English: "ricordi…", "ti ho detto…", "sai dove/come/chi…", "dove abito", "come si chiama mia…", "do you remember…", "where do I live", "what's my…"): up to 10 facts outside the profile (the related ones first, then by pin and importance, so a question with no word in common still sees what is known), conversation memories with a looser search (the model's recall threshold, ≥ 5 results), and an instruction closing the turn context: answer from what is known; if it is not there, say the user has not told you yet, mention what is related and ask; never claim to have no memory, never search the web for personal facts. Small on-device models ignored the profile and the system-prompt rule (Fold7 test: "Ricordi dove abito?" → "I have no memories", then a web search). The compact tool prompt has the same rule: personal questions → `search_memory`, never `search_web`; since the model still searched the web, a web tool called on a recall turn is run as `search_memory` with the user's question (`redirectRecallToolCall`). `search_memory` with no matching fact returns the most important known facts, marked as not about the question, so the answer can be "you have not told me, but I know…".
*   **Internal tasks** (memory work, mesh tasks): only their own instructions — no persona, profile, documents, inline memory rule or web search. **Background texts** (proactive messages, briefings): persona and profile, with the context they retrieved themselves.
*   **Gemini Live**: the profile is part of the session instructions. **AIMindMesh Server provider**: the profile is sent as a system message only with *Share What I Know With the Server* on (§6.13).

#### 4.2.4 Conversation Memory (episodic, `memories` table)
*   **Capture** (`episodes/episodeSummary.ts`): raw chat messages are no longer stored (questions and small talk crowded the search out). After the consolidation of a conversation, the stretch not summarized yet (cursor `episode-cursor:<thread>`, at least 2 user messages and 60 characters) becomes one or two sentences in the assistant's language ("L'utente…", with names, places and dates), stored as a `[MEMORY SUMMARY]` row of role `system`; "NIENTE"/"NOTHING" stores nothing. An internal task through `runBackgroundTask`: no autonomous permission needed. Requires an embedding model: `multilingual-e5-small` is the recommended one (the other models are English-only). Every vector records its model; vectors of another model are re-embedded in the background.
*   **Retrieval**: brute-force cosine scan over the active model's vectors (turns of the last 30 days, summaries of any age), top `semanticMemoryMaxResults` (default `3`). Thresholds per embedding model family (`memoryThresholds.ts`), unless `semanticMemorySimilarityThreshold` is set by hand: **E5 0.82 / recall 0.81**, measured on the Fold7 (`eval/calibrate.eval.ts`: 25 Italian question/memory pairs vs 850 non-matching ones; matching median 0.845, non-matching median 0.785 and 95th percentile 0.82; ranking AUC 0.965 with the query/passage prefixes, 0.955 without); MiniLM 0.5 / 0.45 and BGE 0.7 / 0.65 not calibrated; unknown 0.75 / 0.6.
*   **Imported models** (`modelSources.ts`): the family is read from the model's `config.json` `_name_or_path` as well as its folder name — the multilingual-e5-small imported as `memories3` got no query/passage prefixes before. An E5 recognized only by its config gets its own vector key (`…#v2-e5`), so the rows embedded without prefixes are re-embedded in the background. No graph neighbours and no recency fallback (no query, no model or an error give no memories): rows below the threshold confused small models.
*   **Raw rows of older versions**: still searchable under the threshold until summarized or pruned; Settings → Memory → *To review* shows their count and deletes them on request.
*   **Maintenance** (§4.7.4): near-identical rows of the same role are removed (≥0.95); turns older than 30 days are summarized per conversation and day (`[MEMORY SUMMARY] 2026-09-12: …`, dated like the conversation) before the 90-day pruning.
*   **Memory graph**: `follows`, `similar_to` and `mentioned_with` (shared keyword stems, Unicode-aware) links between rows.

#### 4.2.5 Who Writes Facts
| Source | How |
| :--- | :--- |
| Settings → Memory | *Tell me something about you*: pinned, confidence 1 |
| Chat models | No inline rule any more: "ricordati che…" is read by the consolidation. A `<save_memory>` tag a model still writes is removed from the answer, not stored |
| Agent tools | `save_memory`, `update_memory` through the fact gate (dates from the words at the time of the call; a refusal tells the model why), `forget_memory` (§5) |
| Consolidation | §4.2.2, through the fact gate with grounding in the user's messages |
| Backup restore | v2 files (facts) and v1 files (old manual list) |

#### 4.2.6 Memory Management UI
See §6.9.

### 4.3 Meeting Mode & Diarization
Ported from the standalone Meeting Assistant app (same formats: backups go both ways).

*   **Native recording** (`android/.../recording/`): `RecordingEngine` owns one `AudioRecord` (16 kHz mono) and writes a WAV that is valid at every moment, plus a JSON sidecar (`RecordingStore`). A consumer thread feeds live Vosk (`VoskAudioBridge`) and the other taps (`RecordingAudioTaps`, e.g. Voxtral) from the same microphone. `RecordingService` is a `microphone` foreground service with a wake lock and a "Mark moment" notification action. Pause really cuts audio and text. `MeetingRecorderPlugin` (`start/pause/resume/stop/finalizeRecording/getStatus/listRecoverable/discard/addBookmark`) finalizes to AAC `.m4a` in `meeting-audio/`.
*   **Screen lifecycle**: closing Meeting mode while recording or transcribing keeps it mounted but hidden (`MeetingStatusChip` reopens it); the UI re-attaches to a running session after the Activity or WebView is recreated (`getStatus`).
*   **One microphone**: while a meeting records (`meetingCapture.ts`) the wake word is off and voice mode is refused with a toast. Vosk `startRecognition({externalAudio})` runs the external recognizer; starting the microphone or loading/unloading a Vosk model meanwhile is rejected with `MEETING_RECORDING`. Events carry `source: 'mic' | 'external'`.
*   **Live modes** (`TranscriptionMode = 'off' | 'vosk' | 'voxtral'`; old `whisper`/`hybrid` settings migrate to `vosk`):
    *   **Vosk** (Italian / English models): immediate text, times from the recording clock.
    *   **Voxtral**: fed by the native recorder through `ExternalAudioFeeder` (bounded 60 s queue, own inference thread, `voxtralLagging` event, token times from sample offsets, stop drains for at most 10 s). The model is loaded and pinned by the meeting; it is unloaded before post-processing.
    *   **Transcribe while recording** (`liveTranscriber.ts`, not in Voxtral mode): Whisper transcribes finished speech in the background, so the accurate text is ready a few seconds after Stop.
*   **Post-processing on the phone** (`services/meeting/postProcessing/`, automatic after Stop, cancellable, `ProcessingService` keeps it alive in the background): Silero VAD (`processRange`, streamed with hysteresis) → speech windows → ECAPA embeddings (`extractEmbeddingsFromFile`) → AHC → one-speaker chunks ≤ 28 s → Whisper `transcribeRange` (`audio_ctx`, abort, language lock) → cleanup. Whisper is loaded through the model orchestrator (`pin('whisper')`, re-checked before each chunk), so voice chat can still run meanwhile. Model "Auto" prefers `small-q8_0 > small-q5_1 > small > base-q8_0 > base > tiny`.
*   **Whisper native** (`whisper-capacitor`): `-O3 -DNDEBUG` in every build type, `armv8.2-a+dotprod+fp16`; a CPU check before loading the library (ARMv8.0 devices get a clear `UNSUPPORTED` error), abort callback, detected language in the result.
*   **Speakers**: ECAPA features are Kaldi fbank + CMN (`FeatureExtractor.java`), thresholds 0.60 (same speaker) / 0.35 (new speaker). A one-time `migrateSpeakerCalibration` resets old thresholds and asks to enroll the owner voice again. Known voices (`voice_profiles` table, `services/speaker/voiceProfiles.ts`) name speakers across meetings and learn when a speaker is named; the owner voice is the reserved profile `voice_owner` ("You"). Profiles with another embedding size are ignored.
*   **Bundled models** (`ModelAssetManager`, `scripts/fetch-bundled-models.sh`, SHA-256 pinned): Vosk small-it / small-en / en-us-lgraph / spk, Silero VAD v6.2, ECAPA, Whisper `base-q8_0` ship in the APK and are copied on first launch, never overwriting or deleting existing files. Settings show them as "Bundled" without a delete button.
*   **Notes and bookmarks**: title, bookmarks, AI notes (summary, decisions, action items with times) and questions are saved with the meeting and synced with the AIMindMesh server (server migration v6). `voices_json` and `search_text` never leave the phone. A save without notes never clears them; the sync push uses explicit columns and the pull/server upsert write notes only when present.
*   **AI notes adapter** (`services/llm/taskCompletion.ts`): Gemini (streaming, JSON mode, Files API above 14 MB of audio), OpenRouter / local OpenAI-compatible, and every other provider through `generateTextResponseStream` as an internal task (no persona, memories or tools). The prompt is checked against the context window first (readable error instead of silent truncation); `<think>` blocks are stripped and JSON is parsed leniently with a Markdown fallback.
*   **History, search and playback**: history with accent-insensitive search over transcripts (`search_text`), one `<audio>` element with seek and 1×–2× speed, the transcript follows playback; bookmarks and note times seek.
*   **Editing**: titles, segment text, renaming a speaker or moving a segment to another (or a new) speaker, in-app dialogs (`DialogHost`) instead of `prompt()`/`confirm()`.
*   **Recovery**: automatic. Interrupted native sessions are finalized into their meeting (bookmarks included); if that meeting was deleted or tombstoned the audio goes to a `recovered_<ts>` meeting. Old `.pcm` orphans are still recovered for one release. `RecoveryBanner` appears only when a finalization fails (Retry / Discard).
*   **Export**: Markdown, PDF (WebView print adapter), SRT, VTT and the audio, optionally with notes and bookmarks.
*   **Backup** (Settings → App): one zip with `meetings.json` + `audio/{id}.audio` (format `meeting-assistant-backup` v1, shared with the standalone app). Restore skips meetings already present, deleted or tombstoned, never restores the owner voice, and is refused while recording; restored meetings are pushed at the next sync.
*   **ONNX Runtime Safety**: VAD and ECAPA plugins share a single process-global `OrtEnvironment`; neither closes it. ECAPA runs on CPU with 2 threads.
*   **Memory Optimization**: Voxtral and Whisper go through the model orchestrator (§4.1.5): loading them unloads any LLM engine (GGUF, LiteRT, Genie); leaving the meeting frees them and reloads the configured LLM.

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
        1.  **Manual Sync Trigger**: Settings -> Server -> Sync Now (`GlobalSyncService.performSync`, which returns `{ ok, error }`; the outcome is shown under the button).
        2.  **Push / Pull**: meetings, edited segments, memories (with their embedding), calendar events and chat threads are pushed (`POST /api/sync/push`, one server transaction; memories the KG could not store stay unsynced). The pull (`GET /api/sync/pull`) uses the server clock as cursor and merges messages of other devices into their threads, without duplicates. Deleted meetings and segments travel as tombstones (`sync_deletions` on the phone, `sync_tombstones` on the server) and are never brought back by a device that synced late. Documents are not synced.
        3.  **FCM Sync Triggers**: The server can broadcast `SYNC_REQUEST` push notifications via Firebase to all registered mobile nodes, triggering background "Silent Syncs" to ensure ecosystem-wide eventual consistency.
        4.  **Local Fallback**: If the server is disabled or unreachable, the system automatically falls back to the strictly local pipeline.
*   **Workspaces**: Logical grouping of documents (e.g., "Personal", "Work", "Project X"). Search is scoped to the active workspace.
*   **Hybrid Search**: Combines FTS5 (Keyword: query words joined with OR, ranked by bm25) and Vector (Semantic: embeddings scanned in pages, text loaded for the best chunks only) search using Reciprocal Rank Fusion (RRF).
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
*   **Local Checks in Server Mode**: Local checks (battery, agenda, overdue tasks, briefings) keep running when the server is online, because server insights only cover the knowledge graph; the check listener is registered once.
*   **Server Delegation**: The AIMindMesh Server generates insights and sends `NEW_INSIGHT` push notifications.
*   **Automatic Fallback**: The `useServerMode` hook pings `/api/health` every 60 seconds. After 3 consecutive failures, `ProactiveService.disableServerMode()` is called, restoring local proactive behavior.
*   **State Events**: `onServerModeChange(cb)` notifies UI consumers of online/offline transitions for banner display.

#### 4.7.1 Action Categories & Types

The Proactive Assistant operates through **5 action categories**, each with specific behaviors and user interaction patterns. Every action type has a fixed category (`ACTION_CATEGORY` in `types/proactive.ts`).

> **Implemented today**: Low Battery (Optimization card), Overdue Tasks (Task Review card), Meeting Briefing, Spontaneous Message, Memory Maintenance, Context Summarization. The other actions below are planned.

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
*   **Spontaneous Message**: the personality timer (Settings → Personality → Proactive Frequency) starts a conversation. It follows the rules of every proactive chat message (`CHAT_CURIOSITY`: master switch, interactive permission, quiet hours, hourly limit, daily chat-message limit), only after 10 minutes of quiet chat, and runs as a background generation (§4.7.7). With *Allow Autonomous Calls* it may start a call instead (same rules).

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
*   Screen on/off and system Do Not Disturb, measured by the native worker at each check (DND counts as focus mode)
*   Storage availability
*   CPU/thermal state

**App Context:**
*   Current screen (chat, calendar, settings, etc.)
*   Focus mode enabled/disabled
*   Time since last user interaction

**User Context:**
*   Activity state: Active, Idle (30+ min without chat activity, or 3+ min with the screen off), Focus (system DND)
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
*   **Permission System** (`PermissionManager`): master switch, per-action toggle, category permission (*Context Summarization* follows its own toggle), then:
    *   **Quiet hours and focus mode** hold back only what reaches the user (informative, suggestive, interactive): silent and autonomous work (memory maintenance, summaries) runs at night.
    *   **Low battery** (<20%, not charging) blocks silent and autonomous work.
    *   **Respect Data Usage**: on cellular, memory maintenance and data sync wait for Wi-Fi.
    *   **Limits**: *Max Actions Per Hour* counts only what reached the user; *Max Autonomous Actions Per Day* and *Max Chat Messages Per Day* are daily budgets (from local midnight). Priority ≥9 bypasses the limits.
*   **Background Checks**: A periodic WorkManager job (`ProactiveWorker`, every 15 min, Doze-aware, no network constraint so the local checks run offline too) delivers the server's queued insights (CONTEXTUAL mode, outside quiet hours) and sends a `proactiveCheck` event to the app when it is alive, with `{checkId, screenOn, charging, dnd, score}`. The worker then **waits up to 120 s for the app's acknowledgement** (`ProactivePlugin.checkDone`), so the process stays awake while the JS checks and the memory consolidation run. `ProactivePlugin` schedules/cancels it with the user's preference; `syncServerConfig` gives it the server settings (the API key comes from the Keystore). Real intervals depend on Doze and standby buckets.
*   **Persistence**: Automatically starts `KeepAliveService` on app mount and synchronizes settings with native layer to prevent OS from unloading the mission-critical LLM state.
*   **Activity Logging**: All actions logged locally for transparency and learning (dismiss rates, interaction patterns).

#### 4.7.4 Memory Maintenance (Autonomous)
*   **Purpose**: keep the conversation memory (§4.2.4) compact without losing anything. Facts (§4.2.1) are never touched: they are updated by consolidation, not merged.
*   **Trigger Conditions**:
    *   Memory count exceeds 50 entries
    *   User idle (or charging and not active), autonomous permission on, Wi-Fi when *Respect Data Usage* is on
    *   Minimum 24-hour cooldown since last maintenance
*   **Steps** (`episodicMaintenance.ts`):
    1.  **Deduplication**: near-identical rows of the **same role** and embedding model (cosine ≥0.95) are removed; a fact is never dropped for a chat turn that says the same thing.
    2.  **Day summaries**: chat turns older than 30 days (already outside retrieval, pruned at 90) are summarized per conversation and day, up to 3 groups per run, with any provider through `runBackgroundTask` (§4.7.7); the summary keeps the date and thread of the conversation and replaces its turns in one transaction.
*   **Manual run**: Settings → Memory → *Compress & Summarize* runs the same steps (no quiet time required).
*   **User Control**: *Autonomous Memory Maintenance* in Settings → Proactive → Context Awareness (the autonomous permission).

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
    3.  **Summarize**: Uses the active provider through `runBackgroundTask` (§4.7.7): any provider with its own key, an on-device model only when it is loaded and the chat has been quiet for 3 minutes.
    4.  **Store**: Saves the summary per thread (`context-summaries`, `contextSummaryStore.ts`) with the id of the last message it covers; a later summary folds the earlier one in.
    5.  **Apply**: Only the history sent to the model is `[Context Summary] + messages after it`; the chat and the saved thread keep every original message.
*   **Context Safety Fallback (Rolling Context)**: If summarization is disabled or reaches its limits, the system employs **Anchor Protection** during history pruning:
    *   **Always Protected**: System prompts, tool rules, and the most recent `[Context Summary]` message.
    *   **Rolling Window**: Oldest conversational turns are gradually discarded to stay within the model's `nCtx`, while keeping the "anchors" to preserve high-level coherence.
*   **Cross-Context Synchronization**: Active chat instances detect background history updates via storage event listeners; context summarization never rewrites the chat, so it cannot drop messages written meanwhile.
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
    *   **Background Execution**: The native `ProactiveWorker` runs under WorkManager, which holds the wake lock for the job; it never retries with backoff (the next periodic run is the retry).
    *   **Main Thread Yielding**: Heavy $O(N^2)$ computations in the JS layer (e.g., vector similarity clustering) include intentional yield points to the event loop (`setTimeout(0)`) to remain responsive to system signals.
    *   **Concurrency Guards**: `ActionExecutor` runs one autonomous task at a time (the lock is released in `finally`, also when a task fails); LLM work goes through the arbiter of §4.7.7.
    *   **Resource Throttling**: Automatically skips non-critical maintenance if the user is currently "active" in the app, prioritizing foreground interface smoothness.

#### 4.7.7 Background Generations (Arbiter)
On-device engines hold one conversation at a time (GGUF chat slot, LiteRT session, Genie stream): a background generation running when the user writes would break the answer.
*   **Chat activity** (`llm/background/chatActivity.ts`): every foreground generation and every sent message is counted; background work needs `isChatIdleFor(ms)`.
*   **Arbiter** (`llmArbiter.ts`): one background generation at a time. Every foreground generation first calls `yieldToChat()`: the background task is aborted **and awaited** (Genie gets a short grace for its native stop); "the chat always wins".
*   **Runner** (`backgroundLlm.ts`, `runBackgroundTask`): reads the stored settings, uses the API key of the provider that answers (`providerKeys.ts`, never another vendor's key), routes through the server when it is the provider (with a local fallback only if the device engine may run). On-device engines are used only if the model is **already loaded**, no other feature (image, meeting, voice) holds the device, and the chat has been quiet for 3 minutes. Partial text of an aborted run is discarded.
*   **Engine safety**: GGUF forgets the chat prompt after a background request (the next chat turn rebuilds its context); LiteRT and Genie listen to the abort signal with `addEventListener` and never start once aborted; Genie's delayed native stop only stops the generation it was meant for.
*   **Users**: memory consolidation, episodic maintenance, context summarization, spontaneous messages, meeting briefings, mesh tasks (§4.13.7).

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
*   **Global Promise Mutex**: A strict queue `window.__LITERT_MUTEX__` is enforced at the `liteRTProvider` level. If a background event triggers LLM interaction while the user is chatting, the UI gracefully enters a loading state and waits for the unlock.
*   **KV Cache Preservation**: Background tasks (like `PERFORM_MEMORY_MAINTENANCE` and `SUMMARIZE_CONTEXT`) explicitly abort if `litert` is the user's active foreground engine. This guarantees the user's active Conversation buffer is never destroyed or polluted by background extraction instructions, preventing "Context Thrashing".

### 4.11 AI Organization & Governance Layer

To manage scale-out operations, code generation, and team structure, the platform implements a centralized server-side Organization Layer with client-side controls.

#### 4.11.1 AI Council Orchestrator
The governance body reviews a venture idea in a short structured debate; the verdict comes from votes, never from the wording of a summary.
*   **Participants**: the active roles preferred for the mode (`organization.council.roles`, default Researcher, Developer, Reviewer, Security, QA), then other voting roles, up to `organization.council.maxParticipants` (default 6). The Director (the human operator) and the Meeting Analyst never vote.
*   **Rounds**: `organization.council.rounds` (default 2). Each round sees only the previous one; in the last round every role answers with JSON `{vote: approve|reject, confidence, conditions[], argument}`.
*   **Consensus**: approved when approvals are at least two thirds of the valid votes, with at least 3 valid votes (`tallyVotes`). The Markdown synthesis summarizes the debate and ends with the computed verdict and the votes; votes are stored in the `idea:review` audit entry.
*   **Asynchronous**: `POST /ideas/:id/review` answers `202` and moves the idea to `reviewing`; the council runs in the background and sets `approved` or `rejected` (back to the previous status on error). Clients poll `GET /ideas`.

#### 4.11.2 Idea Lifecycle & Human Gate
| Status | Set by | Next |
| :--- | :--- | :--- |
| `proposed` | discovery, manual creation | review, approve |
| `reviewing` | `/review`, auto-council | `approved` / `rejected` |
| `approved` | council consensus, `/approve` | `/transition` or `/approve` (build) |
| `characterized` | specification generated | repository provisioned |
| `development` | repository exists | development runs, milestone by milestone |
| `mvp_ready` | every milestone passes its acceptance tests | decision: continue, pivot, kill |
| `killed` | owner closed the venture | none (the reason feeds discovery) |
*   **Single gate** (`venture/IdeaLifecycle.ts`): only `POST /ideas/:id/approve` or `/transition` (human), or the auto-council when `organization.allowAutoRepoCreation` is `true`, start characterization, repository and development runs. Transitions are compare-and-set updates; an invalid one answers `409`, a duplicate click starts nothing.
*   **Characterization** (`DesignOrchestrator`, task type `ORGANIZATION_DESIGN`, never the tool-using agent): one design per idea (reused on retry). A specialist suggested by the HR assessment becomes a role *proposal* for the HR panel unless `organization.allowAutoRoleMaterialization` is `true`.
*   **Directives**: council recommendations become directives scoped to their idea (`organization_directives.idea_id`, `DirectiveExtractor`); they guide that idea's agent only. Discovery uses organization-wide directives (`idea_id IS NULL`).
*   **Decisions** (`POST /ideas/:id/decision {decision, notes}`): `continue` (from `mvp_ready`) extends the spec with new criteria and up to 3 milestones from the notes and resumes the builds; `pivot` (from `mvp_ready` or `development`) deletes spec and milestones and returns the idea to `approved` with the notes, so the next approval writes a new spec for the same repository; `kill` closes the venture, blocks its repository and stores the reason in `outcome_notes`.
*   **Delete**: an idea with a run in progress cannot be deleted (`409`).

#### 4.11.3 Venture Discovery
*   **Evidence**: a planner writes 3 searches per topic (pain points, alternatives, communities; `QUERY_EXPANSION`), run through SearXNG (`deep: false`), deduplicated by URL and numbered (up to 12 results).
*   **Generator** (`PROACTIVE_INSIGHT`): proposes up to 2 products buildable as a Node.js library or HTTP API; each must cite at least 2 result numbers, otherwise it is dropped. The prompt shows the schema only (a concrete example used to be copied verbatim) and lists the last 30 `rejected`/`killed` ideas with their reasons so they are not proposed again. The generator never scores.
*   **Judge** (`ORGANIZATION_DESIGN`): a separate call scores each idea from its evidence (strategic, feasibility, novelty, privacy, maintenance, 0..1) with a rationale (`organization_ideas.judge_rationale`, `judgeRationale` in `GET /ideas`); an idea without a verdict is dropped. Weights: `OpportunityScoringService`.
*   **Sources**: the cited pages are stored as `sources` (`sources_json`, `{title, url}`), with a text copy in `sourceSignals` for older apps.
*   **No fallback**: an unparsable answer yields no idea. One-element JSON arrays are read with `Parser.parseLLMJsonArray` (`parseLLMJson` returns the object inside them).
*   **Persistence** (`IdeaStore.saveDiscovered`, shared by the autonomous engine and `POST /ideas/discover`): ideas whose title equals or overlaps (word Jaccard ≥ 0.8) an existing idea are skipped, as are ideas under `min_score_threshold`; the route returns the skipped ones.

#### 4.11.4 Gitea Repository Provisioning
*   **Server-side**: the server creates the repository in `organization.defaultGiteaNamespace` and commits `TECHNICAL_SPECIFICATION.md`. No Gitea Actions workflow nor webhook is bootstrapped for ventures (validation is server-side); `POST /repositories/:id/bootstrap-ci` still adds a Node 22 workflow on demand. A CI webhook only records `last_ci_status`/`last_ci_at`.

#### 4.11.5 Venture Build Loop
```
VentureScheduler.requestRun ──lock (active_run_id, CAS)──► VentureWorkspace.prepare (fetch main, reset work tree)
        │                                                        │
        │                                       OpenClaw run (runStrict, session develop-<repo>, no credentials)
        │                                                        │
        └── finish: healthy → push │ failed → attempt++ ◄── snapshot (server commit) ──► ContainerValidationService
```
*   **Kill switch & budget** (`organization.build` in `system_settings`, `GET/PATCH /api/organization/build-config`): `enabled` (off by default), `model`, `maxAttempts` (4), `dailyRunLimit` (6), `maxConcurrentBuilds` (1), `maxRunsPerVenture` (12), `agentRunTimeoutMs` (45 min), `validationImage` (`node:22-bookworm-slim`), `validationTimeoutMs` (20 min).
*   **Workspace** (`VentureWorkspace`): the git dir stays on the server (`data/ventures/<repo>.git`), the files in the agent mount `venture-workspaces/<repo>` (agent path `ventures/<repo>`, a mount point the agent cannot replace). Git runs with hooks, fsmonitor and system/global config disabled; fetch and push authenticate with an `http.extraHeader` passed through the environment, sent only to the Gitea host. A work tree that resolves elsewhere (symlink) is refused.
*   **Agent run** (`openclaw/agentRun.ts`): the prompt has no URL or credential; it carries the spec location, the directives and, after a failure, the last validation report. The gateway gets the time budget (`timeout`) and a `chat.abort` when the server stops waiting. A chosen `model` goes through the OpenClaw provider `aimindmesh-builder` → `/api/freellmapi-proxy/builder/v1`.
*   **Outcome**: the server commits what the agent wrote (`node_modules`, `dist`, `.env`… excluded). A validation that passes is pushed to `main` and resets the attempt counter (`healthy`); a failure or a run that changed nothing costs an attempt (`cooldown` 5→60 min); at `maxAttempts` the repository is `blocked` with `blocked_reason` until a human presses *Develop/Unblock* (`POST /repositories/:id/force-develop`, fresh budget). `POST /repositories/:id/cancel` stops a run (repository blocked). The outcome summary is kept in `last_validation` and shown as `lastValidation`.
*   **Ownership**: `VentureScheduler` (started after `InferenceRouter.init`) is the only resumer: at boot it closes interrupted runs as a failed attempt and removes leftover validation containers; every 10 min it starts `pending` repositories and expired cooldowns, one at a time. Runs are listed in the activity queue as external tasks: never zombie-killed, re-queued or re-routed; cancel and the infrastructure brake abort them.

#### 4.11.6 Specification, Milestones & Acceptance Tests
*   **Structured spec** (`venture/VentureSpec.ts`): the model returns JSON (audience, problem, ≤5 MVP features, out of scope, template `node-library` | `node-api`, public interface with exact signatures/routes, ≤15 acceptance criteria `AC-n` given/when/then, ≤4 milestones covering every criterion once). It is validated in code (one retry with the problems found) and `TECHNICAL_SPECIFICATION.md` is rendered from it (`spec_json` in `organization_product_designs`).
*   **Acceptance tests** (`venture/VentureScaffold.ts`): one vitest file per criterion, `acceptance/AC-n.test.ts`, written by a non-agentic call against the public interface before the code exists (`acceptance_json`). They belong to the server: before every run and before every snapshot the server rewrites `acceptance/` and `vitest.config.ts` from the database (files the agent changed or added there are discarded and reported to the next run). Writes never follow a symlink.
*   **Scaffold**: on the first run the server copies `aimindmesh-server/templates/ventures/<template>/` (package.json with vitest and typescript, tsconfig on `src`, smoke test, README) into the work tree.
*   **Milestones** (`organization_venture_milestones`): a run works on the first milestone not done. It is done when the build passes, every test outside `acceptance/` passes, and the acceptance files of this and earlier milestones pass (later ones may fail: `milestoneVerdict.ts`). A done milestone is pushed and the repository returns to `pending` for the next one; after the last, the idea becomes `mvp_ready` and the owner is notified. Each venture may use `maxRunsPerVenture` runs (default 12), then it is `blocked`.
*   **Repositories**: `GET /repositories` adds `milestones` (`seq`, `title`, `criteria`, `status`, `attempts`, `passed`).

#### 4.11.7 Container Validation
*   **Container** (`ContainerValidationService`): `docker run -d --rm` of the validation image, labelled `aimindmesh.venture=1`, `--cap-drop ALL`, `no-new-privileges`, 2 GB / 2 CPU / 512 pids, user `1000:1000`, no volume. The snapshot is streamed in with `git archive` (symlinks kept as links).
*   **Steps**: inspect `package.json` → `npm ci` (or `npm install`) `--ignore-scripts` → **network disconnected** → `npm run build` (if defined) → vitest (`--reporter=json`) or jest (`--json`). The test runner must be a registry version range (no `file:`, git or URL dependency).
*   **Pass**: at least one test and no failure; the result maps to `healthy`/`broken` in one place (`toRepoStatus`). `POST /repositories/:id/validate` runs the same check on the published `main` in the background (`202`). Kasm stays available for manual workspaces only.

#### 4.11.8 HR Recruitment Service
*   **Role Proposing**: analyzes roles, directives and ideas to propose a missing role (`organization_role_proposals`).
*   **Materialization**: a human materializes a proposal into an active role (`POST /hr/proposals/:id/materialize`); only then it can join the council.

#### 4.11.9 Meeting-to-Organization Bridge
A client-side pipeline routes physical meeting discussions to organizational actions.
*   **Action Candidate Extraction**: Uses the meeting's AI notes when present (action items become tasks, decisions directives); otherwise scans the transcript for intent indicators (verbs, goals).
*   **Selective Submission**: Provides interactive UI selectors to submit approved candidates to the server as Directives or Ideas.

#### 4.11.10 Safety Notes
*   **Autonomous Discovery**: off by default. The row `organization_discovery_config` decides (schema v7 switched existing rows off); `config.json` `organization.autonomousDiscovery.enabled: true` only seeds a new database.
*   **No Credentials for the Agent**: the OpenClaw container gets no `.env`, no `GITEA_TOKEN` and no git credential helper. Old `develop-<repo>` transcripts held the token: `node dist/scripts/purgeVentureSessions.js` deletes them.
*   **Restarts**: an agent task interrupted by a restart ends as `FAILED 'Interrupted by restart'`; the admin retry and restore-all refuse agent tasks.
*   **Parked Repositories**: schema v7 moved repositories left `pending`, `evolving`, `cooldown`, `verifying` or `needs_verification` to `blocked` (`blocked_reason = 'paused by upgrade'`).

### 4.12 Neural Wiki
The Neural Wiki is a structured, collaborative-style knowledge base automatically compiled from the Knowledge Graph on the AIMindMesh Server.
*   **Two Modes**:
    *   **List Mode**: Searchable and paginated catalog of all compiled wiki pages.
    *   **Detail Mode**: Full-screen Markdown viewer with [[Wikilink]] support for seamless navigation between related entities and concepts.
*   **Navigation**: Maintains a historical back-stack for deep-diving into complex knowledge clusters.
*   **Export to Markdown**: Individual pages can be exported as `.md` files. On Desktop, this invokes a native save dialog via `@tauri-apps/plugin-dialog`. On Mobile, it triggers the native share intent via `@capacitor/share` to allow saving to the filesystem or sharing with external productivity apps.
*   **Sync & Regeneration**: Support for manual triggering of synthesis cycles and per-page regeneration via the AIMindMesh Server API to ensure knowledge remains current.

### 4.13 AIMindMesh Server Integration
AI Mind Mesh introduces optional integration with the **AIMindMesh Server** — a Cloud VPS accessible over a WireGuard VPN. The integration is strictly additive; no existing local features are altered.

#### 4.13.1 System Architecture

```
┌──────────────────────────────┐        WireGuard VPN (10.2.0.1:3030)        ┌─────────────────────────────────────────┐
│  AIMindMesh App (Android)    │ ─────────────────────────────────────────── │  AIMindMesh Server (VPS, Fastify)       │
│                              │  REST  x-api-key: <apiKey>                  │                                         │
│  FeedView / ThreadView ──────┼──────► /api/feed, /api/kg/*, /api/documents │  authHook (API key, every route)        │
│  ImportSheet                 │                                             │  InferenceRouter                        │
│  ServerLLM Provider ─────────┼──────► /ws/chat?mode=completion (stream)    │   ├─ Claude/Gemini/OpenRouter/FreeLLMAPI│
│                              │        POST /api/chat           (fallback)  │   ├─ Ollama (SERVER_LOCAL, PC client)   │
│  NodeWorker ◄────────────────┼─────── /ws/nodes?id=&name=&token= (tasks)   │   └─ mobile worker nodes (/ws/nodes)    │
│  FCMService ◄────────────────┼─────── Firebase Cloud Messaging (push)      │  Knowledge Graph (Neo4j), SQLite        │
└──────────────────────────────┘                                             └─────────────────────────────────────────┘
```

#### 4.13.2 Feed Screen
*   **Purpose**: Displays AI-generated insights, connection summaries, and document ingestion results from the server KG.
*   **Architecture**: Bottom-nav tab (💬 Chat | ✨ Feed). Uses `IntersectionObserver` for infinite scroll.
*   **Live Updates**: FCM insight messages (`INSIGHT_DELIVERY`, `INSIGHT_FALLBACK`, and `NEW_INSIGHT` of older servers) dispatch to the `onFCMFeedEvent` event bus → `FeedView` re-fetches the top of the list without a full reload.
*   **Thread View**: Each insight opens a `FeedThreadView` with a chat-bubble reply interface, streaming server responses via WebSocket. A `DEBATE_UPDATE` push for the open insight reloads its thread (not while a reply is streaming).
*   **Notification Tap**: opens the app on the Feed (also from a cold start: the request is kept by `MainActivity` as the pending launch action until JS reads it) without recreating the activity, so a running generation and the worker link survive.
*   **Unread Badge**: Bottom nav badge count reflects unread insights; resets on feed tab open.
#### 4.13.3 AIMindMesh Server LLM Provider
*   **Provider ID**: `'aimindmesh-server'` in `LLMConfig.provider`.
*   **Primary Transport**: one WebSocket per request, `ws://<serverUrl>/ws/chat?mode=completion&token=<apiKey>`, stateless: `{ type: 'completion', requestId, messages, options }` → `ack`, then `delta` / `thought`, then `done` (node used) or `error`. Timeouts: 10s for the ack, 90s for the first event, 60s of inactivity.
*   **Fallback**: `POST /api/chat` (120s) only when the WebSocket is unusable (no connection, or no ack from an older server). If part of the answer was already shown, an error is shown instead of falling back (no duplicated answers); before any text, `fallbackProvider` answers locally.
*   **Health Tracking**: `server:unreachable` is emitted for connection failures only (not for inference errors reported by the server).
*   **Authentication**: REST requests carry the `x-api-key: <apiKey>` header. Browser WebSockets cannot set headers, so WebSocket URLs carry the same key as the `token` query parameter; the server rejects the handshake (HTTP 401) without it.

#### 4.13.4 Knowledge Import Sheet
*   **Triggers**: FAB button on FeedView, or paperclip attachment in chat.
*   **Tabs**: Document (file picker: PDF/DOCX/TXT/MD), URL (HTTP), Clipboard (auto-detects URL).
*   **Server Pipeline**: `POST /api/documents/ingest/file` or `/url` → receives `{jobId}` → polls `GET /api/documents/jobs/<jobId>` every 5s for up to 2 minutes.
*   **Local Fallback**: When server not configured, files are queued to local `DocumentIngestionService`.

#### 4.13.5 Memory KG Sync
*   **Auto-Sync** (`autoSyncNewMemories = true`, `memorySyncService.ts`): every fact change is mirrored on the server KG — an active fact is upserted with `POST /api/kg/memories` `{id, content, category: kind, source: 'aimindmesh_android', createdAt}` (the server keys it `syncId = fact:<id>`, so it is updated, never duplicated), a deleted, replaced, done or expired fact is removed with `DELETE /api/kg/memories/:id`. Requests are sequential with `setTimeout(0)` yields (ANR prevention).
*   **Not mirrored**: *Delete All Memories* (the server copies stay; delete them from the server admin). Facts are not part of `GlobalSyncService` (which syncs the conversation memory rows).
*   **Profile in prompts**: separate opt-in, §6.13.

#### 4.13.6 FCM Push Notification Architecture
*   **Plugin**: `fcm-capacitor` (Kotlin). Registers `FCMCapacitorPlugin` with Capacitor bridge.
*   **Services**: `FCMMessagingService` (extends `FirebaseMessagingService`), `FCMActionReceiver` (handles inline actions).
*   **Token Lifecycle**: On init → request permission → `getFCMToken()` → `POST /api/nodes/register`. On rotate → re-register via `tokenRefresh` listener.
*   **Message Types**:
    | Type | Sent by | App |
    | :--- | :--- | :--- |
    | `INSIGHT_DELIVERY` | `DeliveryScheduler.deliver` (PUSH mode, outside quiet hours) | Feed refresh |
    | `INSIGHT_FALLBACK` | Fallback cycle (pending > 6 h, outside quiet hours) | Feed refresh |
    | `NEW_INSIGHT` | Older servers | Feed refresh |
    | `DEBATE_UPDATE` | `DebateEngine` (PUSH mode, outside quiet hours) | Thread refresh |
    | `WAKE_FOR_INFERENCE` | `InferenceRouter` (data-only) | `nodeWorker.wake()` |
    | `SYNC_REQUEST` | `SyncManager` (data-only, never to the sender) | `GlobalSyncService.performSync` |
    | `MARK_READ_ACTION` | Notification action | `POST /api/feed/:id/read` + Feed update |
*   **Delivery Preferences** (`PUT /api/delivery/settings`, partial): `{deliveryMode?, quietHours?: {enabled, start, end}, timezone?}`, sent by `useServerMode` when the server comes online and when the mode or the proactive quiet hours change. The server normalizes the device id to the node id (upper case) and checks quiet hours **in the device's time zone** (the container runs in UTC); devices that never sent theirs follow the server-wide quiet hours in `proactive.timezone`.
*   **Notification Channel**: SDK-rendered pushes use `aimindmesh_feed` (`default_notification_channel_id` in the manifest).
*   **Data Flow**:
```
Firebase Cloud Messaging
  └─> FCMMessagingService.onMessageReceived()
        └─> capacitorPlugin.notifyListeners("fcm:message", payload)
              └─> fcmService.ts dispatchMessage()
                    └─> emitFeedEvent() → onFCMFeedEvent listeners
                          └─> FeedView.tsx → prepend new insight card
```

#### 4.13.7 Mobile Worker Node
*   **Purpose**: Allows the mobile device to act as an active inference worker for the entire mesh cluster.
*   **Mechanism**: The app establishes a dedicated bidirectional WebSocket neural link to `/ws/nodes?id=<deviceId>&name=<deviceName>&token=<apiKey>` on the server. The device ID (`Device.getId()`) identifies the node.
*   **Task Ownership**: The server accepts `token`, `thinking` and `result` messages for a task only from the node it was dispatched to; messages for other nodes' tasks are discarded.
*   **Configuration Injection**: the `NodeWorker` inherits the active `LLMConfig` (model paths, thread counts) and the personality's instructions. Tasks run as **internal tasks**: none of the owner's facts, conversation memories or workspace documents reach requests that may come from other people through the mesh.
*   **Owner First**: tasks run as background generations (§4.7.7). While the owner chats, or when the owner starts chatting during a task, the task ends with a `WORKER_BUSY` error result so the server routes it elsewhere instead of waiting.
*   **Execution Flow**:
    1.  Server dispatches task via WebSocket.
    2.  `NodeWorker.ts` receives payload (prompt + task ID).
    3.  Worker retrieves active configuration and triggers `generateTextResponseStream`.
    4.  Response is streamed back to the server in real-time.
*   **Robust Error Reporting**: Any exception during local inference (e.g., model not found, OOM) is caught and reported back to the server as a `WORKER_EXECUTION_FAILED` result. This prevents tasks from hanging in `PROCESSING` state and allows for automatic server-side retries or routing fallback.
*   **Wakeup Layer**: If the WebSocket is closed, the server dispatches a `WAKE_FOR_INFERENCE` FCM message. With the app alive, `nodeWorker.wake()` reconnects with the last settings — also after the heartbeat stopped the worker (e.g. Doze cut the network). With the app closed only a notification can be shown (inference without the WebView is planned).
*   **Lifecycle & UI Sync**: The worker's status is synchronized with the "AIMindMesh Server" settings panel. A dedicated listener pattern ensures the "READY FOR TASKS" badge reflects the real-time connectivity of the WebSocket link.
*   **Controls**: Users can enable/disable this feature via "Participate as Worker Node" in AIMindMesh Server settings.

#### 4.13.8 Claude Provider (Server)
The Claude Max 20x plan includes **200 USD of Claude API credits per month**, credited to the Claude Console organization linked to the plan. The credits refresh on the plan's renewal day and expire at the end of each billing cycle (no rollover). The organization has no payment method: when the credit is gone the API refuses requests, nothing is ever charged. The server spends this credit first, natively through the official SDK (`@anthropic-ai/sdk`), and falls back to the existing chain when it runs out.

*   **Module** (`aimindmesh-server/src/services/inference/claude/`):
    | File | Role |
    | :--- | :--- |
    | `claudeSettings.ts` | Reads the `claude` section of `config.json` with defaults and validation (the unversioned `src/config.ts` needs no change). |
    | `claudeClient.ts` | SDK client built only with an explicit, non-empty key (never `ANTHROPIC_API_KEY` or a local `ant` profile). |
    | `ClaudeProvider.ts` | Realtime call: streaming, effort per category, server-side refusal fallback, usage recording. |
    | `ClaudeCreditState.ts` / `claudeGate.ts` | Availability (credit, key, model, budget) and the concurrency slots of the router and of the agents. |
    | `ClaudeUsage.ts` / `claudePricing.ts` | Tokens and estimated cost per day, model, mode and source (`claude_usage`, migration v10). |
    | `ClaudeBatchQueue.ts` | Message Batches for background cycles (`claude_batch_requests`, migration v10). |
    | `claudeRetry.ts` / `claudeErrors.ts` | Error classification and what the router does after a Claude failure. |
    | `agentBridge/` | OpenAI ⇄ Claude bridge of the agent proxy (OpenClaw, Hermes, venture builds). |
    | `claudeStatus.ts` | `claude` block of `GET /api/admin/status`. |
*   **Routing** (`InferenceProviders.effectivePriorities` / `resolveTarget`):
    | Category | Task types | Model (default) | Effort | Claude first |
    | :--- | :--- | :--- | :--- | :--- |
    | LIGHTWEIGHT | intent, query expansion, concepts, improvement detection | `claude-haiku-5-5` | `low` | No (selectable) |
    | STANDARD | chat, debates, insights, dedup, scheduled tasks, directives, validation | `claude-sonnet-5-5` | `medium` | Yes |
    | RESEARCH | web research (`/api/web/analyze`) | `claude-sonnet-5-5` | `medium` | Yes |
    | COMPLEX | wiki synthesis and topic maps, organization design | `claude-opus-5-5` | `high` | Yes |
    | EVOLUTION | code generation | `claude-opus-5-5` | `high` | Yes |
    *   A priority list without `CLAUDE` gets it **first** when its category is in `claude.firstForCategories` (default STANDARD, COMPLEX, EVOLUTION, RESEARCH); a list that contains `CLAUDE` keeps its position. Nothing is written to `config.json`: `GET /api/admin/config` returns `effectivePriorities` and the priority editors (PC, admin mobile) start from it, so saving a list keeps Claude where it was.
    *   `EMBEDDING_GENERATION` and `AGENTIC_TASK` never go to Claude through the router (no embeddings, no tool loop); agents reach Claude through the agent proxy below.
    *   Explicit routing `CLAUDE` (chat selector, queue re-route, phone "Preferred Routing Target") falls back to the AUTO list when Claude is unavailable, like an offline node. `routing.preferredNode = CLAUDE` sends every task type it serves to Claude, lightweight ones included.
    *   A task Claude failed (any error) gets `CLAUDE` in its `options.skipProviders` and is re-queued on the next provider of its list; a task the caller routed explicitly to Claude is rejected to that caller instead (`CodeGenerationTask` then tries Gemini, then OpenRouter). An admin retry or explicit re-route clears `skipProviders`.
*   **Calls**: streamed (`client.beta.messages.stream`), `max_tokens` 32000, `output_config.effort` per category (`thinking: true` raises it to at least `high`). Adaptive thinking is the models' default and is not sent, nor are sampling parameters. Opus and Sonnet calls carry `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`; dropped automatically if the organization rejects it); a `refusal` stop reason is an error. A non-Claude `options.model` (e.g. an Ollama name) is ignored. Chats from the phone (`/ws/chat?mode=completion`) receive the answer as `delta` events while it is generated; when the phone asked for thinking, the reasoning summary arrives as `thought` events.
*   **Concurrency**: Claude takes no provider lock. `claudeGate` grants `claude.maxConcurrent` (3) router slots and `claude.agents.maxConcurrent` (2) agent slots; a router task waiting for a slot stays `QUEUED` (still re-routable) and availability is checked again at dispatch.
*   **Availability states** (`ClaudeCreditState`, persisted in `system_settings` id `claude_credit_state`):
    | State | Cause | Effect | Cleared by |
    | :--- | :--- | :--- | :--- |
    | `ok` | — | Claude used per the priority lists | — |
    | `no_key` | `claude.apiKey` empty or `claude.enabled` false | Never used | Setting a key |
    | `credit_exhausted` | 402 `billing_error`, or 400 about the credit balance | Not used; one probe call every `exhaustedRetryHours` (6 h) | A successful call, or the next billing cycle |
    | `budget_reached` | Estimated cycle spend (recorded + reserved) ≥ `monthlyBudgetUsd` | Not used (agents also stop at `agents.monthlyBudgetUsd`) | The next billing cycle or a higher budget |
    | `auth_error` | 401 / 403 | Not used | A new key |
    | `unavailable` | 404 (model not available) | Not used; probe every `exhaustedRetryHours` | A successful call |
*   **Budget**: cost is estimated from each response's `usage` (input, output, 5-minute/1-hour cache writes at 1.25x/2x, cache reads at the model's rate; long-prompt Haiku prices above 100K tokens; Batches at 50%), priced at the model that served each iteration (a server-side fallback may answer with Opus 5). The billing cycle starts on `billingCycleDay` (29; the last day of shorter months). Batch requests reserve their estimated cost until their result is recorded. The workspace spend limit of the Claude Console remains the only hard cap.
*   **Message Batches** (half price): the scheduled cycles mark their tasks `options.batchable` — wiki synthesis (pages and topic maps, sent together and awaited with `Promise.allSettled`), insight merge, proactive cycle and the nightly evolution cycle. The same methods triggered from the admin routes run in real time.
    *   One row per task in `claude_batch_requests` makes submissions idempotent: a task dispatched again (restart, brake, cooldown) waits for its request or takes its stored result instead of paying twice. Requests arriving within `batch.windowMs` share a batch; one poller per batch reads results by `custom_id` (the task id).
    *   The queue starts after the wiki, evolution and improvement listeners are registered (`index.ts`), so results read back after a restart are saved. Tasks waiting on a batch are exempt from the 24-hour discard rules; expired or server-failed requests are re-submitted once.
    *   Brake: nothing is submitted while it is engaged, and a braked task keeps its request. Cancel or re-route: an unsent request is dropped, a batch that held only that request is cancelled.
*   **Prompt caching**: `TaskPayload.cachePrefix` is sent as a first content block with `cache_control`; other providers receive it first in the prompt text. `DebateEngine` puts the insight and the debate up to the start of the round there (shared by every participant of the round) and the persona after it. The agent bridge caches the system prompt and, automatically, the growing conversation. The minimum cacheable prefix is 512 tokens on the current models; the admin status reports today's cache hit ratio.
*   **Agent proxy** (`api/routes/agentProxy.ts`, `agentBridge/`):
```
OpenClaw / Hermes ──► POST /api/freellmapi-proxy/v1/chat/completions ─────────┐
Venture builds    ──► POST /api/freellmapi-proxy/builder/v1/chat/completions ─┤
                                                                               ▼
       agentClaudeGate: agents enabled, Bearer key known, Claude available, agent slot free
                │ yes                                            │ no, or Claude error before the first byte
                ▼                                                ▼
   agentBridge: OpenAI chat completion ⇄ Claude Messages     FreeLLMAPI (as before)
```
*   **Agent proxy, translation**: system/developer messages → top-level `system` (cache breakpoint); `tool_calls` → `tool_use`, `role: tool` → `tool_result` grouped in one user turn; `image_url` → image blocks; tools → `input_schema`; `tool_choice` `required`/named → `auto` (forced tool use is rejected by the current models); `parallel_tool_calls: false` → `disable_parallel_tool_use`; `json_schema` → `output_config.format`; sampling parameters dropped; `max_tokens` kept between 4096 and 64000. Answers return as `chat.completion` or `chat.completion.chunk` SSE (`delta.content`, `delta.tool_calls`, finish reason, usage with cached tokens). A request the bridge cannot express goes to FreeLLMAPI unchanged.
*   **Agent proxy, thinking blocks**: the OpenAI format cannot carry them; the server keeps them (memory, 2 h, by tool call id) and puts them back when the agent re-sends the turn, with `prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`) so a trimmed history drops them instead of failing.
*   **Agent proxy, models**: general route `claude.agents.model` (Sonnet 5.5, STANDARD effort). Venture builds call the builder route only when the build settings name a model (OpenClaw provider `aimindmesh-builder`): a `claude-*` model runs on Claude with the EVOLUTION effort, any other model on FreeLLMAPI; `claude.agents.builderModel` (Opus 5.5) answers builder calls that arrive without a build model. With an empty build model, builds use OpenClaw's default model through the general route. Spend is recorded as source `agent` or `builder`.
*   **Admin**: `GET /api/admin/status` → `claude` (state, reason, next probe, cycle spend/reserved/budget by source, today's tokens and cache, slots in use, open batch requests). PC client: Claude monitor and configuration cards, "Claude (all tasks)" routing override, Claude in the priority editor, queue re-route, chat selector, AI tasks and build model suggestions. Admin mobile: Claude cockpit card, settings section, priority editor, queue and evolution routing. Phone: `CLAUDE` in "Preferred Routing Target" (§6.13).

### 4.14 Auto-Evolution Engine (Server)
The Auto-Evolution Engine is a server-side pipeline that lets the ecosystem propose changes to its own codebase. It never merges nor deploys by itself: every change is a Gitea Pull Request that a human reviews.

*   **Improvement Detection** — evidence first (`services/evolution/signals/`):
    *   **Runtime errors**: `ERROR` lines of `system_logs` from the last 7 days, grouped by module and normalized message (ids, numbers, quoted values and URLs removed). A group becomes a candidate after `autoEvolution.signals.minOccurrences` (5) occurrences on `minDays` (2) distinct days; environment failures (timeouts, connection errors, rate limits, cancellations) never do.
    *   **Inference failures**: `FAILED` rows of `inference_queue`, grouped by task type and normalized error, same thresholds.
    *   **Target**: from a stack trace (`dist/x.js` → `src/x.ts`) or the file emitting the module tag; otherwise the model picks among the files that log it. The model writes title, description and approach, or `skip` when the code should not change.
    *   **Severity** comes from frequency and persistence (5–10), not from words. One candidate per error group (`id = <kind>-<fingerprint>`); deleting it lets the group be proposed again. At most `signals.maxCandidatesPerCycle` (3) per cycle.
    *   **Insights** (Knowledge Graph `open_question`/`observation`, `DebateEngine` conclusions, wiki "Open Questions") are off unless `autoEvolution.sources.insights` is `true`: they are reflections on the user's notes, not evidence about the code. A debate concludes on code only when a `DEVELOPER` participant spoke. `sources.runtimeErrors` / `sources.inferenceFailures` can switch the evidence sources off.
*   **Contextual Code Generation**: `MultiFileContextBuilder` assembles the target plus related files (imports, callers, shared types, DB schema, `ServerConfig` interface) and routes an `EVOLUTION` task to Claude while it has credit (§4.13.8), then Gemini, then OpenRouter. The nightly cycle uses Claude's Message Batches. Chat requests classified as development intents (`injectUserRequest`) follow the same pipeline.
*   **Edit-based Output** (`services/evolution/EditApplier.ts`): the model returns `edits` (`{path, search, replace}`) and `newFiles`, never whole files. Each search text must occur exactly once in the current file (after the previous edits of that file); otherwise the candidate fails with the reason. The resulting full contents go through the usual checks and commit. Feedback iterations still regenerate the whole target from the branch content.
*   **Path Policy** (`services/evolution/EvolutionPathPolicy.ts`), enforced at every entry point and again right before each Gitea commit:
    *   **Secrets** are never read, sent to an LLM, nor committed: `config.json`, `.env*`, Firebase service accounts, `openclaw-config/`, `openclaw-workspace/`, `hermes-data/`, server `data/` and `backups/`, databases and keys, the deployment `src/config.ts`.
    *   **Protected paths** are never written: a built-in baseline that cannot be disabled (the evolution services themselves, auth middleware, `index.ts`, DB layer, Dockerfile/compose, every `package.json`/`package-lock.json`/`tsconfig*.json`/`vite.config.*`, CI workflows, shell scripts, the server test suite, the mobile `MainActivity`/manifest and the Tauri backend), plus `.noautoedit` and the `protected_paths` registry.
    *   Paths are normalized (no absolute paths, no `..`, no URL-breaking characters) and repository names validated before reaching the Gitea API.
*   **Validation** (`ValidationLayer` + `PatchTypeChecker` + `PatchTestRunner`): the patched files (target, additional files and generated tests) are laid over a temporary copy of the server sources and checked with a real `tsc --noEmit`; then `vitest related` runs the server tests that import them (`autoEvolution.runRelatedTests`, default on; the image ships the `test/` folder for this). In both steps failures already present without the patch are not counted. A change that cannot be type-checked for a server TypeScript file is rejected.
*   **Outcome Stats**: `GET /api/evolution/stats` returns, per candidate source, candidates, failures, skips, proposals, merged and rejected; shown in the Evolution views (PC and admin mobile).
*   **Rate Limits**: `autoEvolution.maxProposalsPerDay` covers proposals created today plus candidates in flight, and applies to chat requests as well as the cron cycle.
*   **Human-in-the-loop (Gitea Integration)**:
    *   Automated creation of `feature/auto-*` branches and Pull Requests in the local Gitea instance.
    *   PR comments (Gitea webhook, HMAC-signed — see §9.6) feed an iterative regeneration loop; the bot's own comments are ignored to prevent loops.
    *   Requires manual review and approval via the Evolution API or Admin Cockpit before merging.
*   **Autonomous Organization**: the AI council only votes (`/ideas/:id/review` and the auto-council set `approved`/`rejected`); repository creation and development agents start only after a human confirmation (`/ideas/:id/approve` or `/ideas/:id/transition`) unless `organization.allowAutoRepoCreation` is explicitly `true`, and never while venture builds are disabled (§4.11.5). The organization code (`src/services/organization/**`, `OpenClawBridge.ts`, `src/services/openclaw/**`, `templates/ventures/**`) is protected from auto-evolution.
*   **Developer Controls**: The Admin Panel (PC/Mobile) provides full visibility into proposals, allowing for approval, rejection, and manual triggering of evolution cycles.

### 4.15 Server-Side Knowledge Import
See §4.13.4 for the import sheet UI. The server-side pipeline (`DocumentIngester`):
1.  **File ingest**: `POST /api/documents/ingest/file` (multipart). Text is extracted (`pdf-parse-fork` for PDF, `mammoth` for DOCX, plain text otherwise), chunked, embedded and stored in the Neo4j KG.
2.  **URL ingest**: `POST /api/documents/ingest/url`. The server fetches the page, extracts the readable text with `cheerio`, then processes it like a file.
3.  **Job Status**: `GET /api/documents/jobs/<jobId>` returns an `IngestionJob` with `status` ∈ `PENDING | EXTRACTING | CHUNKING | VECTORIZING | INDEXING | DONE | ERROR | SKIPPED | CANCELLED` and `progress` (0-100).
4.  **Completion**: the client polls the job status; the server does not currently send an ingestion-complete FCM message.

## 5. Agent Tool Catalog

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

### Category: Web
| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `search_web` | `query`, `num_results?` (default 5, max 6), `time_range?` (`day`/`week`/`month`/`year`) | Web results (title, URL, snippet) from the server's SearXNG or DuckDuckGo/Brave; re-ranked; shown as sources. |
| `read_web_page` | `url`, `query?`, `chunk_index?` | Readable text of a public page: relevant passages for `query`, or part `chunk_index` (0-based) of the page. GET-only, no local addresses. |
| `analyze_web` | `query` | Server-side search + page reading + LLM synthesis with citations. Offered only when *Web analysis* is enabled in the server settings. |
| `open_browser` | `url` | Open a URL in the system browser. Requires confirmation. |
| `search_maps` | `query`, `navigate_to?` | Open Google Maps on a search or directions. |

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
| `save_memory` | `content`, `kind?`, `importance?`, `due_date?`, `about?` | Remembers a lasting fact about the user (a fact said again is reinforced, not duplicated). |
| `search_memory` | `query` | What the assistant knows on a topic, with fact ids. |
| `update_memory` | `memory_id`, `content` | Replaces a fact that changed (the old one is kept as history). |
| `forget_memory` | `memory_id` | Deletes a fact. Requires confirmation. |

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
| **Genie compute unit** (`genieRuntime`) | `Auto / NPU / GPU / CPU` | GGUF models on the Genie NPU engine (GenieX `llama_cpp`). **Auto** (default) tries the NPU, then the GPU, then the CPU; the unit in use is shown under the active model. Ignored by AI Hub bundles (always NPU). |
| **Speed & battery benchmark** | `Panel` | Below the engine settings. Runs fixed workloads — a long prompt (~1500 tokens, like the memory consolidation, 64-token answer) and a long answer (256 tokens) — on the chosen targets: each GGUF on GenieX NPU/GPU/CPU and on llama.cpp (with the GGUF engine settings), AI Hub bundles where QAIRT runs. Per target: load time, first token, prompt and answer tok/s (GenieX profile; llama.cpp from JS timings, prompt tokens estimated "~"), mean battery power and **J per 1000 tokens** (battery energy above a 3 s idle baseline, sampled every 250 ms via `SystemMonitor.getPowerSample()`; not measured while charging). A nonce at the start of the prompt defeats prefix reuse; a warm-up runs first. Runs as a background task (the chat stops it). Results are kept per SoC (`llm-benchmark-results`); **Use this** makes a target the chat model (and so the background model). |
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
| **STT Provider** | `Select` | **Whisper Only** (Offline, Ultra Fast NPU/CPU), **Vosk / Hybrid** (Offline, Lightweight + Post-refinement), **Voxtral** (Offline, High-quality Real-time), **Gemini** (Online). |
| **STT Processing Mode** | `Radio` | `whisper-only` (Direct on-device Whisper), `hybrid` (Vosk live + Whisper background), `vosk-only` (Lightweight live), `whisper-post` (Post-recording refinement), `off`. |
| **Vosk Model** | `Select` | `vosk-model-small-ex` (Light), `vosk-model-en-us` (Accurate). |
| **Voxtral Model** | `File` | Path to `.gguf` file (e.g., `Voxtral-Mini-4B-Realtime-Q4_K_M.gguf`). |
| **Voxtral Latency** | `Select` | **Fast** (240ms), **Balanced** (480ms, default), **Accurate** (960ms), **Best** (2400ms). |
| **Whisper Model** | `Select` | QNN Context Binary (NPU), Turbo v3, or GGML `.bin` (`tiny`, `base`, `small`, `turbo`). |
| **Whisper Threads**| `Number` | Threads for encoder. Default: `4`. |
| **Enable VAD** | `Toggle` | Voice Activity Detection. Fixes cutting off sentences too early. |
| **VAD Sensitivity**| `0.0-1.0` | Higher = Triggers on quieter sounds. Default `0.5`. |

### 6.3 Text-to-Speech (`SpeechConfig`)
Located in **Settings -> Audio**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **TTS Provider** | `Select` | **Kokoro** (Offline, best quality), **Piper** (Fast offline neural), **System** (Android default), **Gemini** (Cloud). |
| **Kokoro Voice** | `Select` | `Sara` / `Nicola` (IT), `Sky` / `Michael` (EN-US), `Emma` / `George` (EN-UK). |
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
| **AI Auto-Categorization** | `Toggle` | Consolidation files the facts it learns under the user's categories. Default: `OFF`. |
| **Backup / Restore** | `Button` | JSON file in Documents: v2 (facts and categories); v1 backups of older versions are accepted. |
| **Open loops** | `List` | Active commitments and events, soonest first: *Done* or delete. |
| **To review** | `List` | Facts older versions stored without checks and the fact gate refuses now (status `review`, out of the prompt): *Keep* or delete. Plus the count of raw chat rows in the conversation memory, with *Delete* (after confirmation). Hidden when empty. |
| **What I know about you** | `List` | Facts by kind, with search and *History* (replaced, done, expired). Tap a text to correct it; change kind or category; 📌 pins it in the profile; 🗑 forgets it. Badges: *You* (told or migrated), *Learned*, *Backup*. |
| **Categories** | `List` | Create and delete labels; filter the list. Deleting a label keeps its facts. |
| **Tell me something about you** | `Form` | Adds a pinned fact with kind, optional label and, for to-dos and dates, a date. |
| **Conversation Memory** | `Toggle` | Semantic search over past chats and fact matching by meaning. Needs an embedding model. Default: `OFF`. |
| **Conversation memories** | `List` | Stored chat memories (latest 100) with *Compress & Summarize* (§4.7.4). |
| **Embedding Model** | `Select` | `multilingual-e5-small` recommended (others are English-only); vectors are re-embedded on change. The similarity threshold follows the model unless moved by hand. |
| **Delete All Memories** | `Button` | ⚠️ **DANGEROUS**. After confirmation erases the facts and the conversation memory (with its graph links). Server copies of synced facts stay. |

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
| **LLM benchmark** | `Info` | Speed and energy per engine/compute unit: **Settings → Model**, "Speed & battery benchmark" (§6.1). |
| **Thermal Awareness** | `Info` | Displays current device temperature. App automatically throttles at >45°C. |
| **Low Power Mode** | `Toggle` | Reduces thread count, disables vision, and limits context size to conserve battery. |
| **Clear Cache** | `Button` | Removes temporary files (model cache, image cache, logs). Frees storage. |
| **Reset to Defaults** | `Button` | ⚠️ Resets ALL settings to factory defaults. Does NOT delete memories or documents. |

### 6.12 Web Tools Delegation
The web tools can run on the AIMindMesh Server instead of the phone (saving mobile data, RAM and battery). The switches are in **Settings → AIMindMesh Server → Web tools** (§6.13) and need the server enabled. Every delegated call falls back to the on-device implementation when the server fails or returns nothing.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Web search on the server** (`delegateWebSearch`) | `Toggle` | `search_web` calls `POST /api/web/search` with `{query, num_results, time_range?, lang}` (standard SearXNG search, 20 s timeout; snippets cut at 320 chars on the phone). |
| **Page reading on the server** (`delegateWebScraping`) | `Toggle` | `read_web_page` calls `POST /api/web/read` with `{url}` (GET-only on the server too; private addresses refused) and receives `{title, url, data}`; the phone then slices parts/passages as in §4.1.7. |
| **Web analysis** (`delegateWebAnalysis`) | `Toggle` | Offers `analyze_web` to the model: `POST /api/web/analyze` with `{query}` (deep search + synthesis by the server's InferenceRouter, 120 s timeout). |

### 6.13 AIMindMesh Server Settings
Located **Settings → AIMindMesh Server**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable** | `Toggle` | Master switch. Activates Feed tab, Server LLM provider, FCM token registration, and server-mode proactive suspension. |
| **Server URL** | `Text` | VPN endpoint of AIMindMesh Server (default `http://10.2.0.1:3030`). The server port is bound only to the VPN address and localhost. |
| **API Key** | `Password` | Sent as the `x-api-key` header on REST requests and as the `token` query parameter on WebSockets (`/ws/chat`, `/ws/nodes`). Stored in the Keystore-backed secret store (see §9.1). |
| **Fallback Provider** | `Select` | LLM provider to use if server is unreachable (default: `gemini`). |
| **Preferred Routing Target** | `Select` | Sent as `routing` with every server request: `AUTO` (server priority lists: Claude first for chat and web analysis while its credit lasts, §4.13.8), a node, `GEMINI`, `OPENROUTER` or `CLAUDE (Anthropic, via server)`. An explicit target wins over the server's lists. |
| **Participate as Worker** | `Toggle` | Allows the server to route inference tasks to this device. Activates the `NodeWorker` WebSocket. |
| **Web tools** | `Toggles` | Web search, page reading and web analysis on the server (§6.12, §4.1.7). |
| **Mesh Activity** | `Indicator` | Real-time status card showing if the device is currently executing a distributed task. |
| **Test Connection** | `Button` | Fires `GET /api/health` and displays server version, uptime, and KG node count. |
| **Auto-Sync New Memories** | `Toggle` | Mirrors the facts on the server KG: upserted by id, deleted when forgotten or replaced (§4.13.5). |
| **Share What I Know With the Server** | `Toggle` | When the server answers (provider `aimindmesh-server`), the user profile is sent as a system message. Default: `OFF` (the server may route the request to other mesh nodes). |
| **Delivery Mode** | `Select` | `PUSH` or `CONTEXTUAL` (queued, fetched by the native worker when the user is available). Sent with the proactive quiet hours and the time zone (§4.13.6). |

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

This section describes the **current** state. Items marked *(planned)* are known gaps tracked in the security roadmap, not implemented behaviour.

### 9.1 Threat Model

#### Assets
| Asset | Sensitivity | Storage Location |
|---|---|---|
| Cloud API Keys (Gemini, Claude, Perplexity, OpenRouter, HF) | HIGH | Android: EncryptedSharedPreferences (Keystore) via `secretStore.ts`; `localStorage` only if encryption is unavailable. Desktop: `secrets.json` |
| AIMindMesh Server API Key | HIGH | Same secret store (`aimindmesh-server-settings.apiKey`) |
| Chat History | MEDIUM | WebView `localStorage` (`threadManager.ts`) |
| Long-Term Memories | HIGH | SQLite (app private storage, unencrypted) |
| Voice Recordings (.m4a) | HIGH | App private files directory |
| Speaker Embeddings (biometric) | HIGH | SQLite (app private storage) |
| Calendar Events | MEDIUM | SQLite (app private storage) |
| Kanban Tasks | LOW | SQLite (app private storage) |

#### Threat Actors
| Actor | Capability | Mitigated By |
|---|---|---|
| Malicious app on same device | Send intents to the exported `MainActivity` | Intent extras (`route`, widget host) are JSON-escaped before reaching `evaluateJavascript`; WebView permission requests are granted only to the app origin (`localhost`) |
| Physical device theft | Filesystem access | Android FDE (File-Based Encryption, default API 24+) |
| ADB backup exfiltration | Backup file read | `android:allowBackup="false"` in Manifest |
| Debugger attached to a release build | Inspect WebView, read `localStorage` | `webContentsDebuggingEnabled` left to Capacitor's default: enabled on debug builds only |
| Rooted device | Root file access | Defense-in-depth; user is aware of device state |
| Network MITM | API key interception | Server traffic runs inside the WireGuard VPN; cleartext HTTP is permitted app-wide (`usesCleartextTraffic="true"`) for VPN and LAN endpoints |
| Prompt injection via tools | LLM manipulation | Tool confirmation system; dangerous tool whitelist |

#### Out of Scope Threats
- Nation-state level attacks
- Physical hardware tampering
- Vulnerabilities in upstream dependencies (llama.cpp, ExoPlayer, etc.)

---

### 9.2 Data Classification

| Category | Examples | Retention | Cloud Transmission |
|---|---|---|---|
| CRITICAL | API Keys | App lifetime | Only to the provider they belong to; the server key goes to the AIMindMesh Server (header on REST, `token` query parameter on WebSockets) |
| SENSITIVE | Voice recordings, Speaker embeddings, Memories | Configurable (default: 30d for audio) | Memories only when KG sync is enabled (§4.13.5) |
| PERSONAL | Calendar, Tasks, Chat history | App lifetime | Only if a cloud LLM or the AIMindMesh Server is selected |
| OPERATIONAL | Settings, Model paths, Logs | App lifetime | Never |

**Cloud Transmission Policy**: Data is sent to cloud providers (Gemini, Claude, Perplexity, OpenRouter) ONLY when the user explicitly selects a cloud LLM provider. When using local GGUF/LiteRT/Genie, zero data leaves the device. When the AIMindMesh Server is enabled, data goes to the user's own VPS over the VPN, which may in turn route tasks to cloud providers according to its routing configuration: by default Anthropic Claude answers chats, web analysis, debates, wiki pages and code generation while its monthly API credit lasts, and the requests of the server agents (OpenClaw, Hermes, venture builds) as well (§4.13.8).

---

### 9.3 Android Security Hardening

#### Manifest Configuration (current)
```xml
<application
    android:allowBackup="false"
    android:usesCleartextTraffic="true"
    ... >
```
*   There is no `network_security_config.xml`: cleartext is allowed for all hosts *(planned: restrict cleartext to the VPN/LAN ranges)*.
*   Capacitor serves the app from `http://localhost` (`androidScheme: 'http'`, `cleartext: true` for the plain-HTTP LAN servers). There is no `allowNavigation` and no `allowMixedContent`: the WebView never navigates away from the app, and external links open in the system browser (`window.open(url, '_system')`).

#### App Lock
*   Settings → App → Privacy: `AppLockPlugin` asks for the fingerprint, face or screen lock (BiometricPrompt `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`) at launch and after more than 60 s in the background (`shouldRelock`). Recordings keep going while locked; the wake word is off behind the lock screen.
*   With the lock on, `FLAG_SECURE` hides the app from screenshots and the recent apps view. The flag is saved in SharedPreferences and applied in `MainActivity.onCreate`, before the first frame.

#### Permissions Rationale
| Permission | Reason |
|---|---|
| `INTERNET` | Cloud providers, AIMindMesh Server |
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | STT, Meeting Mode, Voice/Call Mode, wake word |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES/VIDEO/AUDIO` | Model files, document import, media for vision features |
| `POST_NOTIFICATIONS` | FCM insights, proactive suggestions |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_SPECIAL_USE` | Wake word service, KeepAlive (always-loaded model), meeting recording (`RecordingService`) |
| `FOREGROUND_SERVICE_DATA_SYNC`, `FOREGROUND_SERVICE_MEDIA_PROCESSING` | Meeting transcription after Stop running in the background (`ProcessingService`) |
| `USE_BIOMETRIC` (from `androidx.biometric`) | App lock |
| `WAKE_LOCK` | Long inference and recordings |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Heavy on-device compute (Performance plugin) |
| `READ_CALENDAR`, `WRITE_CALENDAR` | Agenda integration |

`RECEIVE_BOOT_COMPLETED` is **not** declared: the Proactive service does not restart after a reboot until the app is opened.

---

### 9.4 GDPR Compliance Reference (EU)

#### Legal Basis
Processing is based on **Art. 6(1)(b) GDPR** (performance of a contract/service requested by the user) and **Art. 6(1)(a)** (consent) for optional features such as cloud processing.

#### Data Subject Rights
| Right | Implementation |
|---|---|
| Right to Access (Art. 15) | Settings → Memory shows every fact (with history) and *Backup* exports them as JSON; Chat export available |
| Right to Erasure (Art. 17) | "Delete All Memories" (facts and conversation memory), per-fact forget (also on the server when synced), "Clear Chat History", per-meeting audio delete |
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
- No analytics are collected. When the AIMindMesh Server is enabled, the device ID (`Device.getId()`) is sent to the user's own server to identify the node (`/ws/nodes`, `x-device-id`, FCM registration, sync); it is never sent to third parties.

---

### 9.5 Security Checklist (Pre-Release)
- [x] `android:allowBackup="false"` in AndroidManifest.xml
- [ ] Cleartext restricted via a network security config *(planned)*
- [x] API keys stored via the Keystore-backed `SecureStorage` plugin (migrated from `localStorage` at startup; the plain copy is removed only after a verified encrypted write)
- [x] WebView debugging disabled in release builds (Capacitor default)
- [x] Intent data JSON-escaped before `evaluateJavascript`; WebView permissions granted only to the app origin
- [x] `localStorage` values are never logged (`useLocalStorage.ts`)
- [ ] No sensitive data in Android logs (logcat) in release builds
- [x] ProGuard/R8 minification enabled for release builds
- [x] No hardcoded secrets in source code
- [ ] `run_termux_command` tool disabled by default; requires explicit user enable
- [ ] Voice recordings stored in `filesDir` (not `externalFilesDir`)

---

### 9.6 AIMindMesh Server Security

| Control | Implementation |
|---|---|
| **Authentication** | Every route goes through `authHook` (`middleware/auth.ts`): the `x-api-key` header must match `server.apiKey` or one of `auth.keys` (constant-time comparison). WebSocket upgrades use the `token` query parameter; without a valid key the handshake is rejected with HTTP 401. Tokens are masked (`token=***`) in logs. |
| **Exempt routes** | `POST /api/freellmapi-proxy/v1/chat/completions` and `/builder/v1/chat/completions` (require the caller's own `Authorization: Bearer` FreeLLMAPI key, the server key is never injected; before answering with Claude the server checks that key itself against `freellmapi.apiKey` and `claude.agents.proxyKeys` in constant time, and any other key goes to FreeLLMAPI, which checks it); Gitea webhooks `POST /api/evolution/gitea/webhook` and `POST /api/organization/webhooks/gitea` (HMAC-SHA256 `X-Gitea-Signature` with `autoEvolution.giteaWebhookSecret`, rejected with 401 when the secret is missing or the signature is wrong); `GET /dl/*` installers (VPN IP filter). |
| **Network exposure** | Docker publishes the server (3030) and Neo4j (7474/7687) only on `127.0.0.1` and the VPN address `10.2.0.1`, never on public interfaces. |
| **Secrets in the API** | `GET /api/admin/config` returns credentials (including `claude.apiKey`) masked as `********`; masked values sent back by `PATCH` are ignored, so they never overwrite real secrets. The Docker image does not contain `config.json`, `.env` or the Firebase key (mounted at runtime). |
| **Command execution** | No user- or LLM-controlled string reaches a shell: external tools (`whisper`, `tar`, `git`, `grep`, `docker exec`) run via `execFile` with argument arrays; backup names are validated against path traversal. |
| **Mesh integrity** | A worker node can stream or resolve only the tasks dispatched to it (§4.13.7). |
| **Auto-evolution** | Path policy, real type-check, rate limits and human approval (§4.14). |

### 9.7 Testing & Continuous Integration
*   **Server tests**: Vitest suite in `aimindmesh-server/test/` (`npm test`), covering authentication and WebSockets, webhook signatures, config redaction, command-injection and path-traversal regressions, the auto-evolution path policy and real patch type-checking, the API contract fixes, and the Claude provider (credit states and budget, routing and retries, Message Batches, the agent bridge) with the Anthropic SDK mocked. Tests run against an in-memory SQLite database and a test configuration, with outgoing network calls disabled.
*   **Shared API contract**: `aimindmesh-server/src/types/api.ts` (types only) is imported by the desktop, admin and mobile apps through the `@aimindmesh/api-types` path alias; a type-level test keeps the server's internal types compatible with it.
*   **CI**: `.gitea/workflows/ci.yml` type-checks the four projects and runs the server tests on every push to `master` and on pull requests (Gitea Actions). Branches written by the auto-evolution engine (`feature/auto-*`, `fail/*`) are skipped so that LLM-written code never runs on the runner.
