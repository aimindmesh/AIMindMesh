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
4.  **Semantic Memory**: Features a vector-based long-term memory system that retrieves relevant context from past conversations based on meaning, not just keywords.
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
The `genie-capacitor` plugin provides dedicated native hardware execution for frontier generative models (including **Qwen 3.5**, **Qwen 2.5**, and **Gemma 2**) on Qualcomm Hexagon NPU.

*   **Runtime Stack**: Interfaces directly with Qualcomm GenieX / QAIRT SDK (`com.qualcomm.qti:geniex-android` and `libGenie.so` + `libQnnHtp.so`).
*   **Hardware Architecture & SoC Tuning**:
    *   **Snapdragon 8 Elite (SM8750 / SoC 69 / Hexagon v79)** on Z Fold 7:
        *   `perf_profile: "burst"`: Turbo clocking on HTP tensor processing units during token decoding.
        *   `mem_type: "shared_buffer"`: Zero-copy DMA-BUF/ION buffer sharing between CPU and Hexagon NPU.
        *   `rpc_control_latency: 100`: Microsecond target for FastRPC inter-process dispatch.
        *   `cpu-mask: "0xe0"`: Pins FastRPC helper threads to Oryon/Kryo Prime + Gold performance cores (cores 5, 6, 7).
        *   `poll: true`: Polling mode on FastRPC completion queues to eliminate Linux context switch overhead and minimize TTFT (Time To First Token).
        *   `share_resources: true`: Shared group context for multi-part binary context graphs (`part_1_of_3`, etc.).
*   **Model Package Lifecycle & Bundle Architecture**:
    *   **Qualcomm AI Hub Archives (`.zip`)**: Models downloaded from Qualcomm AI Hub (e.g. `qwen3_vl_4b_instruct-geniex_qairt-w4a16-qualcomm_snapdragon_8_elite.zip`) are structured multi-file packages.
    *   **Automatic Unpacking**: The native `GenieEngine` automatically extracts `.zip` bundles to `models/genie/<model_name>/` and detects internal directory trees.
    *   **Dynamic Path Resolution**: Parses `genie_config.json` and dynamically resolves relative file references into absolute device filesystem paths for:
        *   `dialog.tokenizer.path` -> `tokenizer.json`
        *   `dialog.engine.model.binary.ctx-bins` -> `part1_of_N.bin`, `part2_of_N.bin`, ...
        *   `dialog.embedding.lut-path` -> `embedding_weights.raw`
        *   `dialog.engine.backend.extensions` -> `htp_backend_ext_config.json` / generated `htp_config.json`
    *   **Multimodal Vision Support**: Automatically detects `vision_encoder.bin` or `visual.bin` in `metadata.json` for VL models (such as Qwen3-VL 4B Instruct), binding to `com.geniex.sdk.VlmWrapper` for zero-overhead multimodal projection on Hexagon HTP0 (`runtime_id: "qairt"`). Standard text models bind to `com.geniex.sdk.LlmWrapper`.
    *   **UI Model Management**: `GenieSettings.tsx` provides single-tap ZIP file import, live hardware throughput stats, and memory management.
*   **Energy & Throughput**: Delivers ~45–65 tok/s at ~1.5–2.5W power draw, preventing CPU thermal throttling during prolonged reasoning sessions.
*   **Data Flow**:
```
User imports .zip / content:// URI
  └─> filePicker / useNativeModels.ts
        └─> Genie.loadModel({ modelPath })
              └─> GenieEngine.kt / GenieConfigUtils.kt
                    ├─> extractZipStream() (handles content:// and file:// URIs)
                    ├─> resolveGenieConfig() (replaces relative paths with absolute)
                    ├─> parseModelMetadata() (extracts w4a16, vision flags)
                    └─> Builds VlmWrapper / LlmWrapper on Qualcomm Hexagon NPU (HTP0 / v79)
                          └─> generateStreamFlow() token emission -> GeniePlugin.kt -> React Web UI
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
*   **Prediction type**: `metadata.json` `"prediction_type"` when present; otherwise one UNet call on a blank latent at t=900 at load time decides it (an epsilon model returns the input noise, a v model a nearly uncorrelated output) and the result is cached per `unet.bin`; undetermined → v-prediction for SD 2.x (768-v), epsilon for SD 1.x. The Qualcomm AI Hub SD 2.1 package derives from SD 2.1 768-v and runs at 512×512 (`v_prediction`).
*   **Editing (img2img)**: needs `vae_encoder.bin`; without it, or when the source cannot be read, the request fails with an explicit error (no black canvas, no zero latents). The result keeps the source's proportions. SD 2.1 cannot follow instructions: the prompt must describe the final picture.
*   **Super-Resolution & Aspect Ratio**:
    *   **Real-ESRGAN x4plus** on the NPU (`realesrgan_x4plus.bin`): the full 512×512 image becomes 2048×2048, then the aspect crop is taken; 2x halves it with high-quality filtering. Without the model, bilinear scaling (the image screen says so).
    *   **Aspect ratios** are centered crops of the square (the graphs are fixed at 512×512): `16:9` → 512×288 / 1024×576 / 2048×1152, `9:16`, `4:3`, `3:4` likewise.
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
*   **Auto-Save**: New messages are persisted immediately to WebView `localStorage` (`threadManager.ts`); a streamed answer is saved once its text stops changing (no write per token). A full storage shows a warning, and threads that cannot be parsed are copied to `conversation-threads-unreadable` instead of being overwritten.
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

#### 4.1.5 Context Management & VRAM Optimization
To prevent OOM (Out Of Memory) kills on Android and Adreno GPU crashes, the system implements a multi-layered context protection strategy:
*   **Real Tokenization (BPE)**: Uses `js-tiktoken` (`cl100k_base`) for accurate token estimation. Replaces character-based heuristics to ensure the LLM never receives a prompt exceeding its hardware-allocated context window.
*   **Model Residency (`modelOrchestrator.ts`)**: RAM holds one heavy model at a time: an LLM engine (GGUF chat+tool, LiteRT or Genie), Stable Diffusion, Voxtral or a medium/large Whisper (a tiny/base/small Whisper may stay next to the LLM). At startup only the configured LLM loads (`useModelLoader`); STT loads with a call or a meeting, TTS with the first spoken reply. Opening the image screen (or `/image`, `/edit`, `generate_image`) unloads the LLM and loads Stable Diffusion; closing it frees SD and reloads the LLM. Meetings and calls free their speech models on exit. A recording pins its speech model; a voice call refuses a heavy STT with an on-device LLM. Android memory pressure unloads the heavy models the current feature does not need (critical, foreground) or every unpinned one (app about to be killed).
*   **Tool Output Pruning**: Large tool results (e.g., web searches > 800 tokens) are automatically summarized by a fast cloud or local model before being injected into the conversation, preserving reasoning space.
*   **GGUF Context Sync (Append Mode)**: Synchronizes the UI message count with the native `llama.cpp` KV cache. 
    *   **Append Mode**: If counts match, only the newest message is sent, enabling incremental KV cache reuse (~90% speedup).
    *   **Hard Reset**: If history diverges, the native context is explicitly reset to prevent "inconsistent sequence position" errors.
*   **Template De-Duplication**: Strips outer chat wrappers from formatted prompts when passing to native engines (GGUF/LiteRT) to prevent "Double-Wrapping" (e.g., nested `<|user|>` tags), which otherwise causes infinite loops or truncated responses.

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

### 4.2 Semantic Memory (Long-Term RAG)
Vector-based memory system that enables the AI to recall relevant context from past conversations.

#### 4.2.1 Ingestion Pipeline
*   **Auto-Capture**: Messages exceeding 20 characters automatically saved
*   **Embedding Model**: `all-MiniLM-L6-v2` by default (384-dim, ONNX, up to 512 tokens); E5 models get their `query:`/`passage:` prefixes and `multilingual-e5-small` uses a SentencePiece (Unigram) tokenizer. Every vector records the model that produced it: rows of another model are ignored by search and re-embedded in the background after a model change.
*   **Storage**: SQLite (`memories` database) with embeddings stored as BLOBs; retrieval is a brute-force cosine scan over every memory of the age window (ids and embeddings only, read in pages), then the text of the top K is loaded (`semanticMemoryRetriever.ts`)
*   **Metadata**: Each memory stores timestamp, category, embedding (with its model), and original text. Extracted facts and summaries never age out of retrieval; plain chat turns are searched for 30 days and deleted after 90.

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
    *   **Export**: Full transcripts can be exported to Markdown, PDF (via WebView Print Adapter), SRT, and VTT with accurate timestamping, and the audio recording can be shared. **Safe recording**: each recording is a new meeting with its own id; edits autosave (one SQLite transaction per save), Back/X ask before stopping and save first, Pause really cuts the audio and text, and a foreground service keeps the microphone alive with the screen off. Meetings are never deleted automatically; a recording interrupted by the app being killed is recovered (audio + last checkpoint) the next time Meeting mode opens.
*   **Speaker Separation**:
    *   **Real-time**: ECAPA-TDNN embedding-based identification with **Periodic Mini-Clustering** — every 30s (or 10 segments), `IncrementalStrategy` re-clusters all session embeddings to refine speaker centroids and correct prior greedy assignments, bringing post-processing quality to live transcription.
    *   **Post-Process (Reprocessing)**: Robust **3-Pass Diarization**:
        1.  **Profiling**: Global clustering of sliding-window ECAPA-TDNN embeddings to create stable Speaker Profiles. Windows are filtered to exclude silence using **VAD-gated filtering** (Silero VAD when `enableVAD` is on and model is loaded) or **RMS energy gating** (fallback, threshold: 0.01).
        2.  **Classification**: Re-assigns transcript segments by averaging embeddings in each segment's time window and matching to the closest global centroid.
        3.  **Smoothing**: Configurable temporal smoothing:
            *   **HMM Viterbi Decoder** (Recommended): Eliminates rapid speaker changes using hidden Markov model transition probabilities.
            *   **Median Filter**: Simple 5-segment sliding window to eliminate spurious single-segment oscillations (e.g., `[0,1,0,0,0]` → `[0,0,0,0,0]`).
*   **ONNX Runtime Safety**: VAD and ECAPA plugins share a single process-global `OrtEnvironment` singleton. VAD's `release()` only closes its `OrtSession`, not the shared environment.
*   **Memory Optimization**: Voxtral and medium/large Whisper models go through the model orchestrator (§4.1.5): loading them unloads any LLM engine (GGUF, LiteRT, Genie); leaving the meeting frees them and reloads the configured LLM.
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
*   **Background Checks**: A periodic WorkManager job (`ProactiveWorker`, every 15 min, Doze-aware) runs contextual delivery and sends a `proactiveCheck` event to the app when it is alive. `ProactivePlugin` schedules/cancels it with the user's preference; `syncServerConfig` gives it the server settings (the API key comes from the Keystore). Real intervals depend on Doze and standby buckets.
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
    3.  **Summarize**: Uses active provider (Cloud, GGUF, or LiteRT) to generate concise summary. Supports local models like Gemma 4 QAT per estrazione e offline summarization a basso consumo.
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
*   **Global Promise Mutex**: A strict queue `window.__LITERT_MUTEX__` is enforced at the `liteRTProvider` level. If a background event triggers LLM interaction while the user is chatting, the UI gracefully enters a loading state and waits for the unlock.
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
│  ServerLLM Provider ─────────┼──────► /ws/chat?mode=completion (stream)    │   ├─ Gemini / OpenRouter / FreeLLMAPI   │
│                              │        POST /api/chat           (fallback)  │   ├─ Ollama (SERVER_LOCAL, PC client)   │
│  NodeWorker ◄────────────────┼─────── /ws/nodes?id=&name=&token= (tasks)   │   └─ mobile worker nodes (/ws/nodes)    │
│  FCMService ◄────────────────┼─────── Firebase Cloud Messaging (push)      │  Knowledge Graph (Neo4j), SQLite        │
└──────────────────────────────┘                                             └─────────────────────────────────────────┘
```

#### 4.13.2 Feed Screen
*   **Purpose**: Displays AI-generated insights, connection summaries, and document ingestion results from the server KG.
*   **Architecture**: Bottom-nav tab (💬 Chat | ✨ Feed). Uses `IntersectionObserver` for infinite scroll.
*   **Live Updates**: FCM `NEW_INSIGHT` messages dispatch to `onFCMFeedEvent` event bus → `FeedView` re-fetches top of list without full reload.
*   **Thread View**: Each insight opens a `FeedThreadView` with a chat-bubble reply interface, streaming server responses via WebSocket.
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
*   **Auto-Sync**: When `autoSyncNewMemories = true`, each `addMemory()` call fires a fire-and-forget `POST /api/kg/memories`.
*   **Bulk Sync**: `bulkSyncMemoriesToServer()` in `memorySyncService.ts` iterates all local memories with `setTimeout(0)` yield points between each POST (ANR prevention).
*   **Payload**: `{content, category, source: 'aimindmesh_android', createdAt}` (the server currently ignores `createdAt` and timestamps on arrival).

#### 4.13.6 FCM Push Notification Architecture
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

#### 4.13.7 Mobile Worker Node
*   **Purpose**: Allows the mobile device to act as an active inference worker for the entire mesh cluster.
*   **Mechanism**: The app establishes a dedicated bidirectional WebSocket neural link to `/ws/nodes?id=<deviceId>&name=<deviceName>&token=<apiKey>` on the server. The device ID (`Device.getId()`) identifies the node.
*   **Task Ownership**: The server accepts `token`, `thinking` and `result` messages for a task only from the node it was dispatched to; messages for other nodes' tasks are discarded.
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

### 4.14 Auto-Evolution Engine (Server)
The Auto-Evolution Engine is a server-side pipeline that lets the ecosystem propose changes to its own codebase. It never merges nor deploys by itself: every change is a Gitea Pull Request that a human reviews.

*   **Improvement Detection**: Monitors the Knowledge Graph for high-severity `open_question` / `observation` insights, `DebateEngine` conclusions and wiki "Open Questions", and asks an LLM to map them to a target file.
*   **Contextual Code Generation**: `MultiFileContextBuilder` assembles the target plus related files (imports, callers, shared types, DB schema, `ServerConfig` interface) and routes an `EVOLUTION` task to Gemini, then OpenRouter. Chat requests classified as development intents (`injectUserRequest`) follow the same pipeline.
*   **Path Policy** (`services/evolution/EvolutionPathPolicy.ts`), enforced at every entry point and again right before each Gitea commit:
    *   **Secrets** are never read, sent to an LLM, nor committed: `config.json`, `.env*`, Firebase service accounts, `openclaw-config/`, `openclaw-workspace/`, `hermes-data/`, server `data/` and `backups/`, databases and keys, the deployment `src/config.ts`.
    *   **Protected paths** are never written: a built-in baseline that cannot be disabled (the evolution services themselves, auth middleware, `index.ts`, DB layer, Dockerfile/compose, every `package.json`/`package-lock.json`/`tsconfig*.json`/`vite.config.*`, CI workflows, shell scripts, the server test suite, the mobile `MainActivity`/manifest and the Tauri backend), plus `.noautoedit` and the `protected_paths` registry.
    *   Paths are normalized (no absolute paths, no `..`, no URL-breaking characters) and repository names validated before reaching the Gitea API.
*   **Validation** (`ValidationLayer` + `PatchTypeChecker`): the patched files (target, additional files and generated tests) are laid over a temporary copy of the server sources and checked with a real `tsc --noEmit`; errors already present without the patch are not counted. A change that cannot be type-checked for a server TypeScript file is rejected.
*   **Rate Limits**: `autoEvolution.maxProposalsPerDay` covers proposals created today plus candidates in flight, and applies to chat requests as well as the cron cycle.
*   **Human-in-the-loop (Gitea Integration)**:
    *   Automated creation of `feature/auto-*` branches and Pull Requests in the local Gitea instance.
    *   PR comments (Gitea webhook, HMAC-signed — see §9.6) feed an iterative regeneration loop; the bot's own comments are ignored to prevent loops.
    *   Requires manual review and approval via the Evolution API or Admin Cockpit before merging.
*   **Autonomous Organization**: the AI council may approve ideas on its own, but repository creation and development agents start only after a human confirmation (`/ideas/:id/approve`) unless `organization.allowAutoRepoCreation` is explicitly `true`.
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
| **Server URL** | `Text` | The endpoint of the AIMindMesh Server over the VPN (e.g. `http://10.2.0.1:3030`). |
| **Delegate Web Search** | `Toggle` | Offloads DuckDuckGo web scraping. Calls `POST /api/web/search` with `{query, num_results}`. |
| **Delegate Web Scraping** | `Toggle` | Offloads full web page parsing. Calls `POST /api/web/read` with `{url, query?, method?, headers?, body?}` (`headers` as a JSON object). |
| **Delegate Web Analysis** | `Toggle` | Offloads Search + AI Synth loop to containerized Ollama. Calls `POST /api/web/analyze` with `{query}`. |

### 6.13 AIMindMesh Server Settings
Located **Settings → AIMindMesh Server**.

| Option | Type | Description |
| :--- | :--- | :--- |
| **Enable** | `Toggle` | Master switch. Activates Feed tab, Server LLM provider, FCM token registration, and server-mode proactive suspension. |
| **Server URL** | `Text` | VPN endpoint of AIMindMesh Server (default `http://10.2.0.1:3030`). The server port is bound only to the VPN address and localhost. |
| **API Key** | `Password` | Sent as the `x-api-key` header on REST requests and as the `token` query parameter on WebSockets (`/ws/chat`, `/ws/nodes`). Stored in the Keystore-backed secret store (see §9.1). |
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

**Cloud Transmission Policy**: Data is sent to cloud providers (Gemini, Claude, Perplexity, OpenRouter) ONLY when the user explicitly selects a cloud LLM provider. When using local GGUF/LiteRT/Genie, zero data leaves the device. When the AIMindMesh Server is enabled, data goes to the user's own VPS over the VPN, which may in turn route tasks to cloud providers according to its routing configuration.

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
*   Capacitor serves the app from `http://localhost` (`androidScheme: 'http'`, `allowNavigation: ['*']`, `allowMixedContent: true`).

#### Permissions Rationale
| Permission | Reason |
|---|---|
| `INTERNET` | Cloud providers, AIMindMesh Server |
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | STT, Meeting Mode, Voice/Call Mode, wake word |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES/VIDEO/AUDIO` | Model files, document import, media for vision features |
| `POST_NOTIFICATIONS` | FCM insights, proactive suggestions |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_SPECIAL_USE` | Wake word service, KeepAlive (always-loaded model) |
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
| **Exempt routes** | `POST /api/freellmapi-proxy/v1/chat/completions` (requires the caller's own `Authorization: Bearer` FreeLLMAPI key, the server key is never injected); Gitea webhooks `POST /api/evolution/gitea/webhook` and `POST /api/organization/webhooks/gitea` (HMAC-SHA256 `X-Gitea-Signature` with `autoEvolution.giteaWebhookSecret`, rejected with 401 when the secret is missing or the signature is wrong); `GET /dl/*` installers (VPN IP filter). |
| **Network exposure** | Docker publishes the server (3030) and Neo4j (7474/7687) only on `127.0.0.1` and the VPN address `10.2.0.1`, never on public interfaces. |
| **Secrets in the API** | `GET /api/admin/config` returns credentials masked as `********`; masked values sent back by `PATCH` are ignored, so they never overwrite real secrets. The Docker image does not contain `config.json`, `.env` or the Firebase key (mounted at runtime). |
| **Command execution** | No user- or LLM-controlled string reaches a shell: external tools (`whisper`, `tar`, `git`, `grep`, `docker exec`) run via `execFile` with argument arrays; backup names are validated against path traversal. |
| **Mesh integrity** | A worker node can stream or resolve only the tasks dispatched to it (§4.13.7). |
| **Auto-evolution** | Path policy, real type-check, rate limits and human approval (§4.14). |

### 9.7 Testing & Continuous Integration
*   **Server tests**: Vitest suite in `aimindmesh-server/test/` (`npm test`), covering authentication and WebSockets, webhook signatures, config redaction, command-injection and path-traversal regressions, the auto-evolution path policy and real patch type-checking, and the API contract fixes. Tests run against an in-memory SQLite database and a test configuration, with outgoing network calls disabled.
*   **Shared API contract**: `aimindmesh-server/src/types/api.ts` (types only) is imported by the desktop, admin and mobile apps through the `@aimindmesh/api-types` path alias; a type-level test keeps the server's internal types compatible with it.
*   **CI**: `.gitea/workflows/ci.yml` type-checks the four projects and runs the server tests on every push to `master` and on pull requests (Gitea Actions). Branches written by the auto-evolution engine (`feature/auto-*`, `fail/*`) are skipped so that LLM-written code never runs on the runner.
