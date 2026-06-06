# AIMindMesh - Development Guide

This document is the definitive reference for build, local development, VPS deployment configuration, and native debugging procedures.

---

## 1. Local Development Setup

The system consists of three primary modules that work together:

### 1.1 Server (`aimindmesh-server`)
Runs the backend API, sqlite database, agent personas lifecycle manager, and organization integrations (Gitea, Kasm, Council debate).
*   **Prerequisites**: Node.js v18+, SQLite3.
*   **Launch Command**:
    ```bash
    npm run dev
    ```
*   **Environment Config**: Configured via `config.json` (see `config.json.example`).

### 1.2 PC Client (`aimindmesh-client`)
Sleek desktop control center built with React and Tailwind CSS.
*   **Launch Command**:
    ```bash
    npm run dev
    ```
*   **API Configuration**: Configured to proxy backend requests to the server (default `http://localhost:3030`).

### 1.3 Mobile Application (`aimindmesh-mobile`)
Hybrid Capacitor app running on Android.
*   **Build & Sync**:
    ```bash
    npm run build
    npx cap sync
    ```
*   **Launch Local Server**:
    ```bash
    npm run dev
    ```

---

## 2. Compilation and Code Quality

Always verify compilation before committing changes or proposing builds:
```bash
# Verify TypeScript compilations (no-emit dry run)
npx tsc --noEmit
```

*   **Guardrails**: Keep all component and service file sizes strictly **under 600 lines** for maintainability. Refactor large panels into isolated hooks or modular sub-components.

---

## 3. VPS Deployment & Docker Configurations

Deployments are performed on the VPS via SSH command structures and Docker.

*   **VPS Target**: `ssh <your-vps-host>` (configured via `VPS_HOST` environment variable)
*   **Deploy Script**: `deploy_to_cloud.sh` (run only when explicitly requested).

### 3.1 Container Layout & Port Mapping

The production environment consists of the following Docker containers:

| Container Name | Ports / Bindings | Purpose |
| :--- | :--- | :--- |
| `aimindmesh-server` | `3030->3030/tcp` | Core Node API & Orchestration router. |
| `aimindmesh-openclaw-gateway` | `18789->18789/tcp` | OpenClaw agent proxy gateway. |
| `hermes-agent` | `9119`, `8642` | NousResearch Hermes agent process execution. |
| `aimindmesh-freellmapi` | `3001/tcp` | Local LLM inference wrapper. |
| `aimindmesh-neo4j` | `7474`, `7687` | Knowledge Graph graph store database. |
| `gitea` | `222->22`, `3001->3000` | Local Git VCS hosting. |
| `kasm` | `3000`, `3031->8443` | Headless sandbox streaming workspace manager. |
| `searxng` | `8080/tcp` (local) | Privacy search query engine for Venture Discovery. |
| `wireguard` | `51820/udp` | VPN secure transport tunnel. |
| `pihole` | `53`, `80`, `443` | Ad-blocking & internal DNS resolution. |

---

## 4. Native Debugging Procedures

### 4.1 WebView Inspection
Since the mobile frontend runs in an Android WebView, you can inspect the application runtime directly from your PC:
1.  Connect your Android device via USB and enable **USB Debugging** in Developer Settings.
2.  Open Chrome on your development machine and navigate to:
    ```
    chrome://inspect
    ```
3.  Locate `AIMindMesh` under remote devices and click **Inspect** to access the Console, Elements, and Network panels.

### 4.2 Native Logs (`adb logcat`)
To inspect Java/Kotlin plugin exceptions, Android Auto templates, or Vulkan model load logs:
```bash
# Filter specifically for AIMindMesh messages
adb logcat -s "AI Mind Mesh" -s "Capacitor" -s "LlamaCppPlugin"
```
