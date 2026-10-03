# AIMindMesh - Development Guide

This document is the definitive reference for build, local development, VPS deployment configuration, and native debugging procedures.

---

## 1. Local Development Setup

The repository is a monorepo with five modules:

| Module | Stack | Role |
|---|---|---|
| `aimindmesh-server` | Node 22, Fastify 5, TypeScript, SQLite (better-sqlite3), Neo4j | API, inference routing, knowledge graph, auto-evolution, organization |
| `aimindmesh-client` | Tauri 2, React 19 | Desktop client and resource peer (Ollama bridge, admin panel) |
| `aimindmesh-mobile` | Capacitor 7, React 18, native Kotlin/C++ plugins | Android assistant (on-device LLM/STT/TTS, NPU) |
| `aimindmesh-admin-mobile` | Capacitor, React 18 | Server administration from the phone |
| `aimindmesh-hermes` | Docker (NousResearch Hermes agent) | Agent container, configured from `*.example` files |

### 1.1 Server (`aimindmesh-server`)
*   **Prerequisites**: Node.js 22 (the Docker image uses `node:22-slim`). SQLite is bundled with `better-sqlite3`.
*   **Configuration**:
    *   `config.json` (from `config.json.example`): runtime settings and secrets. Required keys: `server.apiKey` (clients send it as `x-api-key`, WebSockets as `?token=`), `autoEvolution.giteaWebhookSecret` (same value as the *Secret* field of the Gitea webhooks; without it every webhook is rejected).
    *   `src/config.ts` is **not versioned** (it holds deployment defaults). Create it from `src/config.ts.example`, which has the same interface.
*   **Launch Command**:
    ```bash
    npm run dev
    ```
*   **Database schema**: versioned migrations in `src/db/migrations.ts` (`PRAGMA user_version`; the original DDL is the v1 baseline in `src/db/schema/baseline.ts`). Pending migrations run at boot in one transaction, and an error stops the boot. Change the schema only by appending a migration (never edit an applied one), using `addColumnIfMissing` for columns. `system_logs`, `fcm_logs` and `sync_logs` are pruned after `logging.retentionDays` (default 14, optional key of `config.json`).

### 1.2 PC Client (`aimindmesh-client`)
Sleek desktop control center built with React and Tailwind CSS.
*   **Launch Command**:
    ```bash
    npm run dev
    ```
*   **API Configuration**: server URL and API key are stored in the Tauri config (default `http://10.2.0.1:3030`).

### 1.3 Mobile Application (`aimindmesh-mobile`)
Hybrid Capacitor app running on Android.
*   **Build & Sync**:
    ```bash
    npm run build
    npx cap sync android
    ```
*   **Launch Local Server**:
    ```bash
    npm run dev
    ```
*   **Gradle / JDK**: the Android project uses Gradle 8.9, which does not run on JDK 25. Build with JDK 17 or 21, e.g. `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug`.
*   **Release signing**: `assembleRelease` is signed only when `MYAPP_RELEASE_STORE_FILE`, `MYAPP_RELEASE_STORE_PASSWORD`, `MYAPP_RELEASE_KEY_ALIAS` and `MYAPP_RELEASE_KEY_PASSWORD` are defined (e.g. in `~/.gradle/gradle.properties`); elsewhere (CI, other machines) the release is unsigned and debug builds are unaffected.
*   **Native libraries**: `libggml*.so` come only from the GenieX SDK (whisper links its own ggml statically, so no `pickFirst` for them). llama.cpp ships one library per CPU level; `NativeLibrarySelector` loads the best one and the universal `libllama-cpp-arm64.so` (plain ARMv8-A) is only the fallback.
*   **In-app documentation**: Settings → Docs renders `TECHNICAL_SPECIFICATION.md`, bundled at build time through `src/data/DocumentationData.ts`. Spec changes need a new build to show up in the app.

### 1.4 Shared API types
`aimindmesh-server/src/types/api.ts` is the HTTP contract shared by all apps (types only, no imports). The clients import it with `import type { … } from '@aimindmesh/api-types'` (path alias in each `tsconfig`). Update it together with the server route and the client that uses it.

---

## 2. Compilation, Tests and Code Quality

Always verify compilation before committing changes or proposing builds:
```bash
# Every app (no-emit dry run); admin mobile: npx tsc -p tsconfig.app.json --noEmit
npx tsc --noEmit

# Server tests (Vitest) and test type-check
cd aimindmesh-server && npm test && npm run typecheck:test

# Mobile app unit tests (Vitest, pure logic; Capacitor plugins are mocked)
cd aimindmesh-mobile && npm test
```
See `TESTING.md` for what the tests cover and for the manual checklists.

*   **Guardrails**: Keep all component and service file sizes strictly **under 600 lines** for maintainability. Refactor large panels into isolated hooks or modular sub-components. Several older files still exceed the limit: do not let them grow.

### 2.1 Continuous Integration (Gitea Actions)
`.gitea/workflows/ci.yml` type-checks the four apps and runs the server and mobile tests on pushes to `master` and on pull requests. Branches of the auto-evolution engine (`feature/auto-*`, `fail/*`) are skipped on purpose (they would run LLM-written code on the runner).

**Runner registration (once, on the VPS):**
1.  Gitea → *Site Administration → Actions → Runners → Create new runner*: copy the registration token.
2.  In `infrastructure/docker/services/gitea/act_runner/` copy `docker-compose.yml.example` → `docker-compose.yml` and `config.yaml.example` → `config.yaml` (both git-ignored); set the token and the Gitea network name.
3.  `docker network create ci_jobs` (isolated network for the jobs), then `docker compose up -d`.
4.  Keep the hardened settings of `config.yaml`: `container.docker_host: "-"` (jobs must **not** get the Docker socket, which would mean root on the VPS), `privileged: false`, `valid_volumes: []`, `capacity: 1`, jobs off `wirehole_private_network`.

---

## 3. VPS Deployment & Docker Configurations

Deployments are performed on the VPS via SSH command structures and Docker.

*   **VPS Target**: `ssh <your-vps-host>` (configured via `VPS_HOST` environment variable)
*   **Deploy Script**: `deploy_to_cloud.sh` (run only when explicitly requested).

### 3.1 Container Layout & Port Mapping

The server stack (`aimindmesh-server/docker-compose.yml`) publishes its ports only on localhost and on the VPN address `10.2.0.1`; nothing is reachable from the public interface:

| Container Name | Ports / Bindings | Purpose |
| :--- | :--- | :--- |
| `aimindmesh-server` | `127.0.0.1:3030`, `10.2.0.1:3030` | Core Node API & orchestration router. API key on every route (`x-api-key`, `?token=` for WebSockets). |
| `aimindmesh-neo4j` | `127.0.0.1` / `10.2.0.1` : `7474`, `7687` | Knowledge Graph store. |
| `aimindmesh-openclaw-gateway` | `127.0.0.1:18789`, `10.2.0.1:18789` | OpenClaw agent gateway. |
| `hermes-agent` | `127.0.0.1` / `10.2.0.1` : `9119`, `8642` | NousResearch Hermes agent. |
| `aimindmesh-freellmapi` | internal only (`10.2.0.54:3001`, not published) | OpenAI-compatible LLM gateway, reached through the server proxy with the caller's own key. |
| `gitea` | `222->22`, `3001->3000` (see `infrastructure/docker/services/gitea`) | Local Git VCS hosting + Actions. |
| `kasm` | `3000`, `3031->8443` | Headless sandbox workspace manager. |
| `searxng` | `10.2.0.52:8080` (internal) | Privacy search engine for Venture Discovery. |
| `wireguard` | `51820/udp` | VPN transport tunnel. |
| `pihole` | `53`, `80`, `443` | Ad-blocking & internal DNS resolution. |

*   **Secrets at runtime**: `config.json`, `.env` and `firebase-service-account.json` are mounted as volumes and excluded from the image (`.dockerignore`). `firebase-service-account.json` must exist next to `docker-compose.yml` before `docker compose up`, otherwise Docker creates a directory in its place.
*   **Gitea webhooks**: the auto-evolution PR webhook (`/api/evolution/gitea/webhook`) and the project CI webhooks (`/api/organization/webhooks/gitea`) must use `autoEvolution.giteaWebhookSecret` as their *Secret*. CI webhooks created by the server set it automatically.
*   **Check after deploy**: `ss -tlnp | grep -E ':(3030|7474|7687)\b'` must show only `127.0.0.1` and `10.2.0.1`.

### 3.2 Backups and Restore
*   **Content**: `POST /api/admin/backups` archives a consistent SQLite snapshot (`VACUUM INTO`), `config.json`, `firebase-service-account.json`, the wiki and `openclaw-config/` (models excluded). **Neo4j is not included** (live store of another container, `data/neo4j`): back it up separately, e.g. `neo4j-admin database dump` into `./backups/neo4j`. FreeLLMAPI data and release downloads are excluded too.
*   **Restore = restart**: `POST /api/admin/backups/restore` only checks the archive (no links, absolute paths or `..`), extracts and validates it (`quick_check`, schema not newer than the server) into `backups/restore-staging/`. The server then exits with code 75 and Docker (`restart: always`) or pm2 starts it again; in `npm run dev` restart it by hand. At boot `src/db/restoreAtBoot.ts` (first import of `index.ts`) swaps the files in, keeps the previous ones (`data/.restore-rollback-*`, `backups/restore-rollback-*`), rolls everything back on error and gives up after 2 attempts.
*   **Outcome**: `GET /api/admin/backups/restore-status` (`backups/last-restore.json`), also shown in the PC client Recovery Hub. After restoring `openclaw-config`, restart the `openclaw-gateway` container.

---

## 4. Native Debugging Procedures

### 4.1 WebView Inspection
Since the mobile frontend runs in an Android WebView, you can inspect the application runtime directly from your PC. This works on **debug builds only**: `webContentsDebuggingEnabled` is left to Capacitor's default, which disables it in release APKs.
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

### 4.3 Qualcomm NPU / Hexagon HTP Native Debugging (`genie-capacitor` & `sd-capacitor`)
When testing NPU-accelerated models (Qwen 3.5, Gemma 2, Whisper NPU, Stable Diffusion) on Snapdragon 8 Elite (SM8750 / Hexagon HTP v79):

1. **Verify FastRPC / DSP Communication & TTFT/TPS Metrics**:
   ```bash
   adb logcat -s "GenieEngine" -s "GeniePlugin" -s "SDPlugin" -s "SDEngine" -s "ChatApp" -s "QNN_INTERNAL" -s "adsprpc"
   ```
   *Logs will display real-time TTFT (Time To First Token in ms) and TPS (Tokens Per Second) from Qualcomm's internal profiler.*

2. **Inspect QNN Driver & HTP Architecture**:
   Check if Hexagon HTP library (`libQnnHtp.so`) initializes correctly:
   ```bash
   adb shell "getprop ro.hardware.chipname"  # Should return SM8750 on Z Fold 7
   adb shell "ls -la /vendor/dsp/cdsp"       # Lists Hexagon CDSP libraries
   ```

3. **Verify HTP Backend JSON Configuration**:
   Inspect the automatically generated `htp_config.json` in app cache:
   ```bash
   adb shell "run-as com.aimindmesh.mobile cat /data/data/com.aimindmesh.mobile/cache/htp_config.json"
   ```

4. **Verify App Build & Native Sync**:
   ```bash
   cd aimindmesh-mobile
   npm run build
   npx cap sync android
   ```
