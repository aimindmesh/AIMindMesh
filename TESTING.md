# 🧪 AIMindMesh — Testing Guide

> Describes the tests that **actually exist** and the manual checks still needed.
> Automated coverage today is server-side only; the apps are type-checked in CI and tested manually.

---

## 📋 Table of Contents
1. [Strategy](#1-strategy)
2. [Server — Automated Tests (Vitest)](#2-server--automated-tests-vitest)
3. [Shared API Contract](#3-shared-api-contract)
4. [Continuous Integration (Gitea Actions)](#4-continuous-integration-gitea-actions)
5. [Clean-Clone Check](#5-clean-clone-check)
6. [End-to-End Mesh Checks (Manual)](#6-end-to-end-mesh-checks-manual)
7. [Security Checks (Manual, on the VPS)](#7-security-checks-manual-on-the-vps)
8. [Manual Device Testing Checklist](#8-manual-device-testing-checklist)
9. [Gaps](#9-gaps)

---

## 1. Strategy

| Layer | How it is verified | Where |
|---|---|---|
| Server logic, security, auto-evolution guardrails | Vitest (automated) | `aimindmesh-server/test/` |
| Client ⇄ server contract | Shared types + `tsc` in all apps | `aimindmesh-server/src/types/api.ts` |
| Desktop, admin mobile apps | `tsc --noEmit` (automated), manual checklists | CI + §8 |
| Mobile app | `tsc --noEmit` + Vitest unit tests of pure logic (automated), JVM tests, manual device checklist | CI + §2 + §8 |
| Native Android / NPU / audio | Manual on a physical Snapdragon device | §8 |
| Deployment & network exposure | Manual checks on the VPS | §7 |

Tests never use real services: the server suite runs on an in-memory SQLite database, a test configuration (`test/fixtures/config.ts`, the real `config.json` is never read) and with all outgoing HTTP calls disabled.

---

## 2. Server — Automated Tests (Vitest)

```bash
cd aimindmesh-server
npm test                 # vitest run (~25 s, most of it the real tsc checks)
npm run typecheck:test   # type-checks src/ + test/ (tsconfig.test.json)
```

| File | Covers |
|---|---|
| `auth.test.ts` | API keys (global + per-node, constant-time), `authHook` on REST and WebSocket upgrades (401 without `?token=`), self-authenticated routes, `/dl/` installers, log redaction |
| `nodesWs.test.ts` | `/ws/nodes`: a worker can only stream/resolve the tasks dispatched to it |
| `giteaWebhooks.test.ts` | HMAC `X-Gitea-Signature` on both Gitea webhooks (missing secret, wrong signature, valid delivery), raw-body parser isolation |
| `configRedaction.test.ts` | `GET /api/admin/config` masking, `PATCH` ignoring masked values and prototype-polluting keys |
| `backup.test.ts` | Backup download/restore/delete reject path traversal |
| `restore.test.ts` | Backup content (snapshot, no live DB / Neo4j / FreeLLMAPI), staged restore applied at boot, stale `-wal` dropped, full rollback on error, 2-attempt cap, unsafe/old/newer archives |
| `migrations.test.ts` | Versioned schema: fresh DB, no-op re-run, production DB at version 0 (data kept, duplicates tolerated), failed migration leaves `user_version` untouched, newer DB refused |
| `sync.test.ts` | Sync push in one transaction, no segment loss on meeting updates, mobile thread format, namespaced message ids, memory ids for the KG, server-clock pull cursor, deletion tombstones (no resurrection) |
| `foreignKeys.test.ts` | Feed delete and insight merge with queued deliveries, conversation delete, insight text for contextual delivery |
| `logRetention.test.ts` | `system_logs`/`sync_logs`/`fcm_logs` pruning in batches, retention parsing |
| `chatCompletionWs.test.ts` | `/ws/chat?mode=completion`: ack/delta/thought/done/error with `requestId`, non-streaming providers, stateless |
| `kgLinks.test.ts` | Insight→Concept links by id, relation types sanitized, concept upsert never wipes embedding or enriched description |
| `lockTimeouts.test.ts` | Per-engine inference lock timeouts |
| `shellSafety.test.ts` | No shell injection via uploaded file names (`local-stt`, with a fake `whisper`), wiki commit messages, reverse-dependency grep |
| `evolutionPolicy.test.ts` | Auto-evolution path policy: normalization, secrets, protected baseline, `.noautoedit`, `protected_paths`, guards |
| `patchTypecheck.test.ts` | Real `tsc` on the patched sources: valid change passes, type errors (target, additional files, generated tests) are blocked, new dependencies only warn |
| `contextBuilder.test.ts` | Nothing secret or outside the checkout reaches an LLM prompt |
| `pipeline.test.ts` | Pipeline entry points: protected targets/outputs fail early, daily cap and path policy for chat requests; listener registered and stuck candidates recovered once |
| `council.test.ts` | The autonomous AI council needs a human before creating repositories (unless `organization.allowAutoRepoCreation`) |
| `contracts.test.ts` | Client/server contract fixes: `/api/chat` response + routing, empty JSON bodies, `DELETE /api/feed/:id`, `GET /api/ai-tasks/:id`, AI task provider routing, evolution process options, protected-paths insert, CI webhook registration |
| `contract-types.test.ts` | Compile-time: server internal types stay compatible with `src/types/api.ts` |

### Writing new tests
*   Put them in `aimindmesh-server/test/*.test.ts` (outside `src/`, so they never reach the build).
*   Mock modules with `vi.mock(...)`. Static imports and `await import()` are intercepted; **inline `require()` is not**, so tested code should use imports.
*   `src/config.ts` is automatically replaced by `test/fixtures/config.ts` (see `vitest.config.mts`); mutate `config` inside a test file if needed.
*   `fetch` and axios fail by default: stub them explicitly (`vi.spyOn(axios, 'get')`).
*   `aimindmesh-server/test/fcmDispatcher.test.ts` covers the data-only FCM control messages (`WAKE_FOR_INFERENCE`, `SYNC_REQUEST`).

### Mobile app — automated tests (Vitest)
```bash
cd aimindmesh-mobile && npm test        # vitest run: test/*.test.ts, pure logic only (Capacitor plugins mocked)
```
| Prefix | Covers |
|---|---|
| `chat-` | Context budgets per provider, history compression, stop-sequence buffering, tool catalogue (no duplicates, handlers executed, shell quoting), agent loop runs/confirmations, global document context |
| `voice-` | Provider id normalization and voice-chat routing, TTS stop/session tokens, Whisper live chunking, Vosk permission/start-stop races, wake-word state sync |
| `meeting-` | Rolling PCM buffer offsets, timeline and pauses, Voxtral slices, hybrid merge, speaker label alignment and AHC, save transaction, export cues, foreground service |
| `memory-` | Embedding codec and model tags, re-embedding runtime, self-match exclusion, page numbering, ids/categories, batched ingestion with cleanup |
| `agenda-` | Reminders, recurrence, rate limit, briefing window, Kanban index mapping, calendar sync ids, Android Auto payloads |
| `shell-` | Thread save, settings reset only on open, memory pressure levels, NDJSON/SSE parsing, download verification, NodeWorker idempotency, desktop persistence, setup |
| `native-` | LiteRT tool schemas and session tracking |
| `model-` | Model residency: one heavy model at a time, engine switches, image/meeting/voice sessions, pins, memory pressure, chat model preload, voice-call RAM guard |
| `image-` | Chat prompts for Stable Diffusion (LLM rewrite, cleanup, fallbacks), the image a tool call edits ("last"), tool pictures as chat attachments |

JVM unit tests (pure Kotlin/Java logic): `cd aimindmesh-mobile/android && ./gradlew :app:testDebugUnitTest` (`DeliveryClientTest`, `StopSequenceFilterTest`) and `./gradlew :sd-capacitor:testDebugUnitTest`: Stable Diffusion noise schedule and timesteps, Euler and DPM++ 2M converging on a Gaussian with the closed-form denoiser (epsilon and v), prediction-type probe, prompt weights, aspect crops and mirrored margins, CLIP tokenizer against reference ids.

The SD native tensor reader (`qnn_graph_io.cpp`) can be checked on a PC with the QAIRT SDK: compile it for x86_64 with a small harness and the SDK's `lib/x86_64-linux-clang/libQnnSystem.so`, then compare its output with `qnn-context-binary-utility --context_binary <file> --json_file <out>`.

---

## 3. Shared API Contract

`aimindmesh-server/src/types/api.ts` holds the HTTP contract (types only, no imports). The desktop, admin and mobile apps import it with `import type { … } from '@aimindmesh/api-types'` (path alias in each `tsconfig`). Changing a field there breaks `tsc` in every app that relies on it, which is the point.

---

## 4. Continuous Integration (Gitea Actions)

**File**: `.gitea/workflows/ci.yml` — runs on push to `master`, on pull requests and manually.

| Job | Steps |
|---|---|
| `server` | `cp src/config.ts.example src/config.ts` · `npm ci` · `tsc --noEmit` · `npm run typecheck:test` · `npm test` |
| `client` | `npm ci` · `tsc --noEmit` |
| `admin-mobile` | `npm ci --legacy-peer-deps` · `tsc -p tsconfig.app.json --noEmit` |
| `mobile` | `npm ci` · `tsc --noEmit` · `npm test` |

*   Branches written by the auto-evolution engine (`feature/auto-*`, `fail/*`) are **skipped**: running them would execute LLM-written code on the runner. Their patches are type-checked by the server before the PR is opened.
*   The runner must be registered on the VPS with the hardened configuration in `infrastructure/docker/services/gitea/act_runner/` (see `DEVELOPMENT_GUIDE.md`).

---

## 5. Clean-Clone Check

Local `node_modules` and untracked files can hide problems CI would hit. Before a release, run the CI commands on a copy that contains only versioned files:

```bash
mkdir -p /tmp/aimm-clean && git ls-files -co --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C /tmp/aimm-clean
```

Then run the steps of §4 in each project of `/tmp/aimm-clean`.

---

## 6. End-to-End Mesh Checks (Manual)

Run from a device connected to the WireGuard VPN (server at `10.2.0.1:3030`).

```bash
KEY=<server apiKey>
# Health
curl -H "x-api-key: $KEY" http://10.2.0.1:3030/api/health
# Node registration (as the PC client does)
curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
     -d '{"id":"test-node","type":"pc_client","name":"Test"}' http://10.2.0.1:3030/api/nodes/register
# Chat through the router (response has content, response, usedNode)
curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
     -d '{"messages":[{"role":"user","content":"ping"}]}' http://10.2.0.1:3030/api/chat
# Memory sync to the KG
curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
     -d '{"content":"test memory","category":"test","source":"manual"}' http://10.2.0.1:3030/api/kg/memories
```
*   **FCM**: `POST /api/admin/fcm/test` → notification on the device within a few seconds.
*   **Worker node**: enable "Participate as Worker" on the phone, route a chat with `options.routing = <device id>` and check the answer comes from the phone (`usedNode`).

---

## 7. Security Checks (Manual, on the VPS)

```bash
# Ports: 3030, 7474, 7687 bound only to 127.0.0.1 and 10.2.0.1
ss -tlnp | grep -E ':(3030|7474|7687)\b'
# WebSockets reject missing tokens (expect HTTP 401)
curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
     -H 'Sec-WebSocket-Key: dGVzdA==' http://127.0.0.1:3030/ws/chat
# Secrets are masked
curl -s -H "x-api-key: $KEY" http://127.0.0.1:3030/api/admin/config | grep -c '\*\*\*\*\*\*\*\*'
# LLM proxy refuses requests without their own key (expect 401)
curl -i -X POST http://127.0.0.1:3030/api/freellmapi-proxy/v1/chat/completions -d '{}' -H 'content-type: application/json'
# Gitea webhook without signature (expect 401)
curl -i -X POST http://127.0.0.1:3030/api/evolution/gitea/webhook -d '{}' -H 'content-type: application/json'
```
*   **Secrets not in git**: `git check-ignore -v aimindmesh-server/config.json aimindmesh-server/openclaw-config/openclaw.json` must match a rule.
*   **DNS privacy**: with the VPN up, `nslookup example.com` must answer from the PiHole on the WireGuard network, not from a public resolver.

---

## 8. Manual Device Testing Checklist

Use this checklist for every release build on a **physical Snapdragon device**.

### Hardware Inference
- [ ] LiteRT loads `.litertlm` model without crash
- [ ] NPU backend selected on Snapdragon 8 Gen 2/3/Elite (logcat: `Backend.NPU`)
- [ ] OpenCL detection runs without crash on unsupported devices (fallback to CPU)
- [ ] Genie (QNN) loads an NPU model and reports TTFT/TPS (`adb logcat -s GenieEngine GeniePlugin`)
- [ ] Stable Diffusion on NPU generates an image (`adb logcat -s SDPlugin SDEngine QnnSdEngineNative QnnGraphIO`): the log shows `tensors from binary` for every graph and the detected `prediction` (Qualcomm SD 2.1: `v_prediction`)
- [ ] The UberRealistic package (`sd2.1lora`, float tensors) loads and generates; compare the same prompt and seed with the Qualcomm package, Euler vs DPM++ 2M
- [ ] Edit a portrait photo from the gallery: upright, same proportions, low strength (40%) keeps the composition; a package without `vae_encoder.bin` shows an error instead of a random image
- [ ] 16:9 with 4x: 2048×1152, not stretched; with the seed's "reuse" button the same prompt gives the same picture
- [ ] `/image un gatto rosso su un divano` → the reply shows the English prompt used; `/edit` after it (no attachment) edits the generated picture; asking the assistant to "make it night" edits the last picture and shows it in the answer
- [ ] Open and close the image screen 5 times: RAM (System Monitor) goes back to the LLM-only level each time (SD contexts really freed)
- [ ] KV Cache saves to `cache/litert_cache/` after session ends and restores after app kill + reopen

### Voice & Audio
- [ ] VAD detects speech start/end correctly in noisy environment
- [ ] 3-pass diarization assigns correct speaker labels across 3+ speakers
- [ ] Durable recording survives 30+ minutes without memory exhaustion
- [ ] Audio routed correctly via earpiece in Call privacy mode
- [ ] Kokoro / Piper TTS speak in the selected language

### Android Auto
- [ ] App appears correctly in Android Auto launcher
- [ ] `GridTemplate` dashboard loads without crash
- [ ] Agenda and Kanban visible from the car head unit
- [ ] Privacy call mode routes audio to earpiece/car speakers

### Network & Sync
- [ ] Mobile connects to the server via WireGuard on app startup
- [ ] Node registers and shows ONLINE in the admin panel (WebSocket with `token`)
- [ ] Offline mode activates when WireGuard disconnects; sync resumes when it reconnects
- [ ] FCM notifications delivered within a few seconds of a server push
- [ ] Chat with provider *AIMindMesh Server* streams token by token and the final answer is still there after reopening the thread
- [ ] Server unreachable before answering: the fallback provider answers once (no duplicated text)
- [ ] Sync Now shows "Sync completed"; a chat written on device A appears in the same thread on device B, once
- [ ] Contextual delivery mode: an insight queued for the device arrives as a notification within 15-30 min with the app in background (`adb logcat -s ProactiveWorker DeliveryClient`)

### Native libraries
- [ ] Whisper transcription works, and a GGUF model runs through Genie (GenieX's `libggml*.so` are the only ones in the APK)
- [ ] `adb logcat -s NativeLibrarySelector` names a CPU-specific llama library on Snapdragon 8 Gen 2+ (not the universal one)

### Phase 5 fixes (to confirm on the device)
- [ ] New chat saved in the thread list; Settings edits survive switching app; Back closes overlays before leaving the app
- [ ] Meeting: record, edit a segment, Back → asks, saves; second recording does not touch the first; screen off for 2 min still records; Vosk tap-to-play at the right time; export Markdown/SRT/audio shares
- [ ] GGUF reply interrupted by dictation does not crash; a tool call followed by more text continues without "Generation already in progress"
- [ ] Stop on Piper/Kokoro voices stops at once; Whisper + Kokoro call stays offline (no Gemini Live)
- [ ] Mic permission prompt and file picker inside the WebView; Vosk/Voxtral ask for the microphone on first use
- [ ] After the update, memories/documents become searchable again once background re-embedding ends; `multilingual-e5-small` loads
- [ ] Task reminder 1 h before due date; proactive off cancels the WorkManager job; Android Auto shows data after killing the app
- [ ] Termux command runs (Termux `allow-external-apps=true`); assistant gesture opens voice mode
- [ ] Kill the app while recording a meeting, reopen Meeting mode: one "recovered" notice, audio and transcript present
- [ ] Delete a meeting on device A, sync both: it disappears on device B and does not come back after B syncs
- [ ] Long chat with Auto-Summarize on: the thread keeps every message after a summary
- [ ] RAM (System Monitor overlay): at launch only the chat LLM; open the image screen → LLM out, SD in; close it → SD out, LLM back; same with `/image` in chat
- [ ] Meeting with Voxtral: LLM out during the meeting, back after closing; a voice call with an on-device LLM + Voxtral shows the "do not fit in RAM" message

### Security
- [ ] After updating, the API keys still work after an app restart, and `localStorage` no longer contains them (WebView inspector, debug build)
- [ ] `adb shell am start -n com.aimindmesh.mobile/.MainActivity --es route "x'}));alert(1);//"` executes no JavaScript; the kanban / call / agenda shortcuts still work
- [ ] Release build is not listed in `chrome://inspect`
- [ ] Settings → Docs shows the current `TECHNICAL_SPECIFICATION.md`

---

## 9. Gaps

*   No automated tests for the desktop and admin apps yet (only type-checking); the mobile app has unit tests for pure logic only, not for React components or native plugins.
*   Android: JVM unit tests for pure logic only (proactive worker, Stable Diffusion scheduler/tokenizer/geometry); no instrumented tests, and the NPU graphs run only on the device.
*   No end-to-end test against a running server, Neo4j and Gitea.
