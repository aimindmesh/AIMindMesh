# 🧠 AIMindMesh: The Autonomous Distributed Intelligence Fabric

[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
[![Platform: Android/Linux/Web](https://img.shields.io/badge/Platform-Android%20|%20Linux%20|%20Web-orange.svg)](#)
[![Engine: llama.cpp | LiteRT](https://img.shields.io/badge/Engine-llama.cpp%20|%20LiteRT-green.svg)](#)

**AIMindMesh** is a privacy-first, local-first agentic ecosystem designed to orchestrate a mesh of heterogeneous nodes—Android devices, high-performance PC clients, and specialized server orchestrators—into a single, unified cognitive fabric. It is the first assistant capable of **autonomous self-evolution**, repairing and improving its own source code through a multi-path agentic loop.

---

## 🏛️ Core Architecture: The Native/Frontend Duality

AIMindMesh breaks the traditional "Wrapper" paradigm by implementing a strict **Native/Frontend Split**:

*   **Computational Bedrock (Native C++/Kotlin/Rust)**: Executes heavy-lift operations—LLM inference, NPU delegation, high-fidelity audio processing, and vector similarity—directly on bare metal.
*   **State Orchestration (React/TypeScript)**: Manages complex business logic, UI state, and real-time synchronization via a custom **Robust Proxy Pattern**.
*   **Distributed Mesh Topology**: Nodes (Mobile, PC, VPS) communicate via a secured **WireHole (WireGuard)** tunnel, sharing inference power, knowledge deltas, and task execution.

---

## 📱 1. AIMindMesh Mobile: Sovereign Edge Intelligence

The mobile node is not just a client; it's a high-performance inference powerhouse optimized for modern Snapdragon silicon that could also run standalone.

### 🧠 Hardware-Aware Inference Engineering
- **Adreno OpenCL & Vulkan**: Optimized GGUF inference using the Qualcomm-contributed OpenCL backend for Adreno GPUs, significantly outperforming generic Vulkan implementations.
- **Hexagon NPU Delegation**: Direct routing of LiteRT (`.litertlm`) models to the **Qualcomm Hexagon HTP** via QNN delegates, achieving studio-level tokens-per-second with minimal thermal impact.
- **Speculative Decoding (MTP)**: Implements Multi-Token Prediction (LiteRT 0.11.0) to predict and verify multiple tokens per forward pass.
- **Persistent KV Cache**: Disk-based serialization of conversation states to `cache/litert_cache/`, allowing instant resumption of context after app restarts or backgrounding.
- **VRAM Guardian**: Dynamic RAM-pressure scaling that monitors `onTrimMemory` to prevent OOM kills by proactively compressing history via local summarization.

### 🎙️ Audio Intelligence & Voice Biometrics
- **Offline TTS Engine (Kokoro & Piper)**: High-quality, real-time voice synthesis running entirely on-device without cloud dependencies.
  - **Kokoro TTS (v1.0)**: State-of-the-art multi-lingual voice model integrated via a statically-linked **Sherpa-ONNX** backend. Features dynamic runtime language switching (e.g. English, Italian) and seamless in-app bundle downloading or local `.tar.bz2` importing.
  - **Piper TTS**: Fast, private synthesis using raw ONNX models with dynamic voice management.
- **3-Pass Diarization**: 
    1. **Profiling**: Global clustering of ECAPA-TDNN voice embeddings.
    2. **Classification**: Segment assignment based on speaker centroid proximity.
    3. **HMM Smoothing**: Viterbi decoding to eliminate spurious speaker oscillations.
- **Voxtral Realtime**: 4B Multimodal STT (PCM → mel → CLIP → llama) for near-zero latency voice interaction.
- **Durable Recording**: Direct-to-disk PCM encoding ensures reliability for long sessions (>3h) without memory exhaustion.

### 🚗 Android Auto Integration
- **Driving-Optimized UI**: Custom `GridTemplate` dashboard for safe, hands-free interaction.
- **Seamless Sync**: Real-time access to your Agenda, Kanban, and Assistant Call directly from the car's head unit.
- **Privacy-First Call Mode**: Routes audio through the earpiece or car speakers with full VAD-based turn-taking.

---

## 🧠 2. AIMindMesh Server: The Orchestration Brain

The server acts as the "Central Nervous System", managing long-term memory and the ecosystem's autonomous growth.

### 🚦 Intelligent Inference Routing
- **Tiered Task Prioritization**: Dynamically routes tasks (Embeddings → Lightweight → Complex → Evolution) across the mesh based on node hardware capability, proximity, and quota. The routes are customizable via Client PC per task type (e.g. embed, lightweight, complex, evolution).
- **Neural Wiki & Knowledge Graph (Neo4j)**: Automatically synthesizes raw meeting data and memories into a structured Neo4j knowledge graph, creating a persistent, searchable "Neural Wiki" of your entire digital life.
- **FCM Proactive Push**: Real-time delivery of server-generated "Neural Insights" directly to mobile notification trays via Firebase.

### 🏛️ The AI Organization & Governance Layer
Orchestrates autonomous operations, team roles expansion, and automated verification:
- **AI Council Debate**: Live multi-agent sequential debate loop checking strategic viability and consensus, yielding synthetic review logs.
- **Gitea VCS Provisioning**: Automated Gitea repository creation and template-based CI/CD workflow generation and commits.
- **Kasm Sandbox Validation**: Automatically spins up headless development workspaces, executes smoke test validations, and shuts them down securely.
- **HR Recruitment Service**: Autonomous analysis of system signals to identify missing capabilities, creating and materializing new Agent roles.
- **Meeting-to-Organization Bridge**: Scans meeting transcripts on mobile nodes to extract goal/directive candidates, selectively routing them to the AI Council.

### 🧬 The Multi-Engine Evolution Loop
AIMindMesh actively improves its own source tree through three distinct generation paths:
1. **Server-Native Evolution**: Orchestrates multi-file contexts to ensure architecturally sound patches, delegating to **Gemini** or **Openrouter** for complex refactoring.
2. **Agentic OpenClaw Loop**: High-autonomy worker for tasks requiring external research and sandbox validation in **Kasm Workspaces**.
3. **On-Device Termux Scripting**: Local models generate and execute bash/python scripts via the native **Termux Bridge** for system-level Android optimizations.

---

## 💻 3. AIMindMesh Client: The Desktop Resource Peer

A lightweight Tauri-based client that bridges high-performance PC hardware into the mesh.
- **Ollama Bridge**: Lends local GPU power to mobile nodes for complex reasoning.
- **Telemetry Dashboard**: Real-time monitoring of CPU/RAM/Thermal states across the entire mesh.

---

## 🛡️ 4. Infrastructure & Privacy Stack

- **WireHole VPN**: WireGuard tunnel + PiHole (DNS privacy) + Unbound (Recursive DNS).
- **Gitea**: Self-hosted Git service for autonomous VCS and evolution patches.
- **SearXNG**: Private metasearch engine ensuring untracked web research.
- **FreeLLMAPI**: Private, self-hosted LLM gateway ensuring OpenAI-compatible model routing and credential isolation. (https://github.com/tashfeenahmed/freellmapi)
- **Kasm Workspaces**: Secure, containerized environments for agentic execution and shadow testing.
- **Neo4j Graph Database**: The containerized knowledge engine powering the "Neural Wiki."

---

## 🛠️ Deployment & Getting Started

### Setup Workflow
1. **Foundation**: Run `./deploy_infrastructure.sh` on your VPS. This sets up the networking, Gitea, SearXNG, and Kasm, while automatically disabling any native Neo4j services to prevent port conflicts.
2. **Brain**: Deploy `aimindmesh-server` using Docker Compose. Use `./deploy_to_cloud.sh --full` for a complete automated setup of the Server, Neo4j, and OpenClaw gateway.
3. **Nodes**: Configure Mobile and PC nodes to point to your VPS WireGuard internal IP.

### OpenClaw Agent Setup
The OpenClaw agent requires a configuration folder containing its skills and auth tokens.
1. Copy the template folder:
   `cp -r aimindmesh-server/openclaw-config.template aimindmesh-server/openclaw-config`
2. Open `aimindmesh-server/openclaw-config/openclaw.json` and insert your Telegram Bot Token and define a Gateway Auth Token.
3. The folder is automatically ignored by Git to protect your tokens.

### Automation Scripts
The repository includes `.example.sh` templates for rapid deployment (e.g., `deploy_to_cloud.sh`, `publish_android.sh`). Copy to `.sh`, configure, and run. 
- Use `./deploy_to_cloud.sh --full` to deploy and configure the entire server stack (Server, Neo4j, OpenClaw).
- These files are git-ignored to protect your private credentials.

---

## 📜 License & Governance

Licensed under the **PolyForm Noncommercial License 1.0.0**. 
- **Free** for personal, educational, and research use.
- **Commercial use** requires a separate, paid license agreement.

---
**Architect & Designer**: Andre ([@aimindmesh](https://github.com/aimindmesh/AIMindMesh))  
**Development Support**: Co-authored and implemented in collaboration with **Gemini** & **Claude**.

**Contact**: [aimindmesh@proton.me](mailto:aimindmesh@proton.me)  
**Philosophy**: *Privacy is a right, Autonomy is the goal. Designed by Human intelligence, evolved with Artificial Intelligence.*
