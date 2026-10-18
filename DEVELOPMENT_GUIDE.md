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
    *   `claude` (optional, see `config.json.example`): the Anthropic API key of the Console organization linked to the Max plan (`claude.apiKey`, editable from the admin apps, masked in the API), models and effort per category, `monthlyBudgetUsd`, `billingCycleDay` (the plan's renewal day), batches and agents. It is read and defaulted by `src/services/inference/claude/claudeSettings.ts`, so `src/config.ts` needs no change. Without a key Claude is simply skipped. Also set a spend limit on the Console workspace of that key: it is the only hard cap.
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
    ./scripts/fetch-bundled-models.sh   # meeting models shipped in the APK (once; SHA-256 checked)
    npm run build
    npx cap sync android
    ```
*   **Bundled models**: `scripts/fetch-bundled-models.sh` fills `android/app/src/main/assets/bundled_models/` (git-ignored) from `MODELS_SRC` (default: the standalone Meeting Assistant's `Models/` folder) or the official URLs. Without it the build still works and the app downloads those models as before. The APK grows to about 530 MB.
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
| `aimindmesh-openclaw-gateway` | `127.0.0.1:18789`, `10.2.0.1:18789` | OpenClaw agent gateway. No `env_file`, no `GITEA_TOKEN`, no git credential helper: the agent shell sees only the variables listed in the compose file. |
| `hermes-agent` | `127.0.0.1` / `10.2.0.1` : `9119`, `8642` | NousResearch Hermes agent. No `GITEA_TOKEN`, no CORS: only the server calls its API. |
| `aimindmesh-freellmapi` | internal only (`10.2.0.54:3001`, not published) | OpenAI-compatible LLM gateway, reached through the server proxy with the caller's own key; it answers the agents when Claude cannot. |
| `gitea` | `222->22`, `3001->3000` (see `infrastructure/docker/services/gitea`) | Local Git VCS hosting + Actions. |
| `kasm` | `3000`, `3031->8443` | Headless sandbox workspace manager. |
| `searxng` | `10.2.0.52:8080` (internal) | Privacy search engine for Venture Discovery. |
| `wireguard` | `51820/udp` | VPN transport tunnel. |
| `pihole` | `53`, `80`, `443` | Ad-blocking & internal DNS resolution. |

*   **Secrets at runtime**: `config.json`, `.env` and `firebase-service-account.json` are mounted as volumes and excluded from the image (`.dockerignore`). `firebase-service-account.json` must exist next to `docker-compose.yml` before `docker compose up`, otherwise Docker creates a directory in its place.
*   **Gitea webhooks**: the auto-evolution PR webhook (`/api/evolution/gitea/webhook`) and the project CI webhooks (`/api/organization/webhooks/gitea`) must use `autoEvolution.giteaWebhookSecret` as their *Secret*. CI webhooks created by the server set it automatically.
*   **Check after deploy**: `ss -tlnp | grep -E ':(3030|7474|7687)\b'` must show only `127.0.0.1` and `10.2.0.1`.
*   **Agents on Claude**: OpenClaw, Hermes and venture builds keep calling `/api/freellmapi-proxy/...` with their FreeLLMAPI key; the server answers with Claude when `claude.agents.enabled` is on, the key equals `freellmapi.apiKey` (or is listed in `claude.agents.proxyKeys`) and Claude is available, else it forwards to FreeLLMAPI as before. The Anthropic key never reaches the agent containers. To run venture builds on a Claude model, set the build settings model to a `claude-*` id and list it in the `aimindmesh-builder` provider below.
*   **Agent secrets**: never add `env_file` or a token to `openclaw-gateway`/`hermes`. Venture repositories are pushed by the server; builds are off until enabled in the organization build settings (`PATCH /api/organization/build-config`). After upgrading from a version that put the Gitea token in agent prompts, rotate `GITEA_TOKEN` and run once `docker exec aimindmesh-server node dist/scripts/purgeVentureSessions.js` to delete the old `develop-*` transcripts.
*   **Venture builds** (§4.11.5 of the technical specification):
    *   `./venture-workspaces` is mounted in the server (`/app/venture-workspaces`) and in OpenClaw (`/home/node/.openclaw/workspace/ventures`): work trees only. Git dirs stay in `./data/ventures` (server only). Override with `VENTURE_WORKSPACES_DIR`, `VENTURE_GIT_DIR`, `VENTURE_AGENT_UID`/`GID` (default 1000, the OpenClaw `node` user).
    *   Validation runs sibling containers through the Docker socket of the server: the image (`node:22-bookworm-slim` by default, pin a digest in the build settings for reproducibility) is pulled on first use. Leftovers carry the label `aimindmesh.venture=1` and are removed at boot.
    *   A build model (build settings `model`) needs an OpenClaw provider named `aimindmesh-builder` in `openclaw-config/openclaw.json` (`models.providers`): copy the existing FreeLLMAPI provider entry, set `baseUrl` to `http://aimindmesh-server:3030/api/freellmapi-proxy/builder/v1` and list the model id in its `models`. With `model` empty the agent's default model is used and no provider is needed.
    *   `ghcr.io/openclaw/openclaw:latest` is unpinned and recent versions require `agents.entries` instead of `agents.list` (`openclaw doctor --fix`): pin the tag once a working version is found.
    *   Scaffold templates live in `aimindmesh-server/templates/ventures/<template>/` (`node-library`, `node-api`); `test/ventureSpec.test.ts` builds and tests each one with the server's own TypeScript and vitest. They are protected from auto-evolution.
    *   **Residual risk**: the development agent shares the OpenClaw `main` agent, which can read `openclaw.json` (gateway token with admin scope, Telegram token) and use every skill. Recommended hardening, not applied automatically: a separate OpenClaw container (or agent entry) for venture builds with `skills: []`, no channel tokens and only the FreeLLMAPI provider, or OpenClaw's per-agent sandbox (`sandbox.mode: "all"`, which needs the Docker socket in the OpenClaw container).

### 3.2 Backups and Restore
*   **Content**: `POST /api/admin/backups` archives a consistent SQLite snapshot (`VACUUM INTO`), `config.json` (with its API keys, `claude.apiKey` included), `firebase-service-account.json`, the wiki and `openclaw-config/` (models excluded). **Neo4j is not included** (live store of another container, `data/neo4j`): back it up separately, e.g. `neo4j-admin database dump` into `./backups/neo4j`. FreeLLMAPI data and release downloads are excluded too.
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

5. **Stable Diffusion: images that ignore the prompt**:
   *   At load `SDEngine` logs `Text encoder check: empty prompt mean … std …`; `text_encoder.bin looks untrained` means the binary was compiled without its weights (every token normalized to mean 0 / std 1).
   *   Per-step statistics (latent, denoised estimate, `cond-uncond rms` = how much the prompt moves the UNet):
       ```bash
       adb shell setprop log.tag.SDEngine DEBUG
       adb logcat -s SDEngine QnnSdEngineNative QnnGraphIO
       ```
   *   I/O of a context binary on the PC (QAIRT x86 tools need the NDK `libc++.so.1`):
       ```bash
       export LD_LIBRARY_PATH=$ANDROID_SDK/ndk/28.2.13676358/toolchains/llvm/prebuilt/linux-x86_64/lib:/opt/qcom/aistack/qairt/2.31.0.250130/lib/x86_64-linux-clang
       /opt/qcom/aistack/qairt/2.31.0.250130/bin/x86_64-linux-clang/qnn-context-binary-utility --context_binary unet.bin --json_file unet.json
       ```
   *   Custom checkpoints (local, not versioned): `aimindmesh-mobile/scripts/export_uberrealistic.py` in the `scripts/qai_venv314` venv. `--check-only --reference --preview out.png` loads the checkpoint strictly, compares the text encoder with SD 2.1's, measures the prediction type and renders a CPU image before anything is sent to AI Hub; the export uploads each component as a torch.export program (`.pt2`; AI Hub's TorchScript path fails on the >2 GB UNet), compiles it to a QNN DLC and links it into a context binary (`--qairt 2.45` by default: never newer than the QNN libs in the APK), validates the text encoder and UNet on an AI Hub device against the CPU output and writes `metadata.json` (with `prediction_type`). `--reuse component=ID` retries without uploading again, or links an existing DLC for another `--device` (e.g. `--device "Samsung Galaxy S23 (Family)"` for the Fold5's Hexagon v73).
   *   w8a16 builds (half the memory, for the v73 NPU of the Z Fold5): `scripts/quantize_sd_w8a16.py --device "Samsung Galaxy S23 (Family)" --copy-from Models/sd2.1lora_v73 --out Models/sd2.1lora_v73_w8a16` calibrates on CPU with the app's own sampling loop (Euler, trailing timesteps, CFG 7.5), runs AI Hub quantize jobs (int8 weights, int16 activations, `--range_scheme min_max`), optionally (`--preview`) renders a CPU image with the quantized ONNX models (onnxruntime; GBs to download) and compiles, links and validates them like the FP16 export.
   *   Other NPUs in the APK: GenieX ships the QNN HTP runtime for V79/V81 only. `aimindmesh-mobile/scripts/fetch-qnn-htp-libs.sh <QAIRT SDK zip or folder> [v73 ...]` copies the stub/skel of other versions into the SD plugin's `jniLibs` (not versioned), after checking they come from the same QAIRT build as GenieX's `libQnnHtp.so`; rebuild the APK afterwards.
   *   Device tests without touching the phone: `scripts/push-sd-package.sh [-s serial] Models/<package>` copies a package into the app (md5-verified), `python3 scripts/sd_device_test.py --serial <serial> --model <package> --out <dir>` generates through the SD plugin over DevTools on the debug WebView (the app must be open; two phones in parallel with different `--port`) and writes `report.html`.
