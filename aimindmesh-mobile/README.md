# AI Mind Mesh

**AI Mind Mesh** is a privacy-focused, local-first personal assistant designed for Android. It prioritizes data sovereignty and agentic capability by running core intelligence (LLM, STT, TTS, Vector DB) directly on-device.

---

## 🚀 Key Features

- **Agentic Chat**: Execute shell commands, manage files, and control hardware via natural language.
- **Semantic Memory**: A vector-based long-term memory system (RAG) that preserves context across conversations.
- **Offline TTS Engine**: Multi-lingual, zero-latency local voice synthesis using Kokoro v1.0 (via Sherpa-ONNX) and Piper.
- **Meeting Mode**: Native background recording with live Vosk or Voxtral, accurate on-device Whisper transcription with speaker separation after Stop, known voices, AI notes and questions, bookmarks, search, playback, export and backup (shared format with the standalone Meeting Assistant). Speech models ship in the APK (`scripts/fetch-bundled-models.sh`).
- **Privacy**: Optional app lock (fingerprint / PIN) that also hides the app from screenshots and recent apps.
- **Proactive Assistant**: Autonomous background actions (context summarization, memory maintenance).
- **Meeting-to-Organization Bridge**: Extracts action items and proposes directives/ideas directly to the server's AI Council from transcripts.
- **Android Auto**: A dedicated, safety-optimized UI for hands-free interaction in the car.

## 📂 Project Structure

- `src/`: React + TypeScript frontend (State, UI, Orchestration).
- `android/`: Native Android project (Kotlin/Java).
- `plugins/`: Custom Capacitor plugins bridging Web view to Native C++/JNI.
- `lib/`: Shared native libraries and utilities.

---

## 🛠️ Quick Start

**Prerequisites:** Node.js, Android Studio (with NDK v26+).

1.  **Install dependencies**:
    ```bash
    npm install
    ```
    For Android builds, also put the bundled speech models in place (once): `./scripts/fetch-bundled-models.sh`.
2.  **Run development server**:
    ```bash
    npm run dev
    ```
