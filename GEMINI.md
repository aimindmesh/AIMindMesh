MANDATORY: read this file before any code change
## General Principles
1. keep everything organized in different folders, feel free to add folders if necessary and to maintain the project maintainable
2. keep source code files lines number below 600 to keep the files readable, refactor if necessary
3. be extremely careful to avoid breaking funcionalities
4. keep documentation and tech spec updated, remember that the content is also displayed in the app in settings and must be aligned
5. app version (x.y.z) shall be updated with the following rule: x = major change, y = minor change, z = bugfix
6. App versions (e.g., in package.json) are changed ONLY when explicitly requested by the USER (do not auto-increment version).
7. Deployments (e.g., running deploy_to_cloud.sh) are performed ONLY when explicitly requested by the USER.
8. Create an implementation plan and wait for USER approval before making any code modifications.
9. The final deploy is on VPS, the development is in local. VPS access (SSH host) and the container/port map are in `GEMINI.local.md` (private, not versioned).
10. **Documentation Standards**:
    - `TECHNICAL_SPECIFICATION.md` is the definitive reference for functionalities and architecture. **Mandatory**: Any updates must strictly follow its existing style, structure, and extremely high level of technical detail (including system diagrams, tables, and granular requirements).
    - `DEVELOPMENT_GUIDE.md` is the definitive reference for build, deployment, and native debugging procedures.

MANDATORY: read this file before any code change

## Self-Improvement Protocol
After each session where a mistake was made, a decision was taken, or a better way to implement something was identified:
1. Immediately add the anti-pattern or decision to the relevant section above
2. Use format: [YYYY-MM-DD] <what NOT to do / decision>: <why / better way>
3. Keep each entry under 1 line; be specific to this codebase
4. Never remove entries, only add or mark as [RESOLVED]

## Gemini Added Memories
- [2026-08-16] Do not use shell process execution ('tar xjf') for archive extraction on Android: Android toybox tar lacks bzip2 binary; use in-JVM Apache Commons Compress with ContentResolver InputStream.
- [2026-08-17] Always verify exact QNN DSP tensor IDs (text_encoder tokens: 2, text_embedding: 1505; Real-ESRGAN output_0: 3062) to prevent graphExecute 0x1774 failures.
- [2026-10-03] Quiet hours and focus mode hold back only user-facing proactive actions (informative/suggestive/interactive): silent/autonomous work (memory maintenance, summaries) must run at night, when the phone is idle and charging.
- [2026-10-03] Never generate with an on-device engine outside llmArbiter/runBackgroundTask: GGUF/LiteRT/Genie hold one conversation; background work must yield to the chat (yieldToChat) and use the model only if already loaded and the chat is quiet >= 3 min.
- [2026-10-03] Do not merge or summarize facts (memory_facts): a change supersedes the fact and keeps history; only episodic rows are deduplicated (same role, >= 0.95) or summarized per conversation and day.
- [2026-10-03] Phones send lowercase ANDROID_IDs while server node ids are uppercase: normalize with normalizeDeviceId at every server lookup (never compare raw ids).
- [2026-10-03] Mark LLMConfig copies of internal/background tasks with taskFlags (symbol keys), never with LLMConfig fields: 'llm-config' is persisted and a field would leak into the saved settings.
- [2026-10-04] Never put a credential in an agent prompt, clone URL or agent container env (no env_file on openclaw-gateway/hermes): prompts reach LLM providers and transcripts; the server fetches and pushes venture repos itself.
- [2026-10-04] Do not resume venture agent runs from InferenceRouter boot recovery, admin retry or route plugins: VentureScheduler is the only owner, behind the organization.build kill switch and attempt budget.
- [2026-10-04] Do not change OpenClawBridge.runAgentTask semantics (chat, AI tasks and evolution rely on resolve-with-text): venture code uses openclaw/agentRun.runStrict with explicit outcomes, gateway timeout and chat.abort.
- [2026-10-04] Never run git as root on an agent-writable directory with its own .git: venture git dirs live in data/ventures, git runs with hooks/fsmonitor/system config disabled and refuses a work tree that resolves outside its root.
- [2026-10-04] Never put a concrete example product in an LLM generation prompt (discovery copied "TradeSimX" verbatim): describe the schema only and reject unparsable output instead of saving a fallback.
- [2026-10-04] Read JSON arrays from an LLM with Parser.parseLLMJsonArray, never parseLLMJson ("first { to last }" turns a one-element array into its object).
- [2026-10-04] Do not feed auto-evolution with LLM insights about the user's notes: candidates come from runtime evidence (system_logs errors, failed inference tasks); insights are opt-in (autoEvolution.sources.insights).
- [2026-10-04] Never compile a model component without a strict weight load and a CPU check of its output: diffusers' convert_* helpers return state dicts (the dropped result shipped a random-init text_encoder.bin in sd2.1lora) and convert_open_clip_checkpoint mis-splits q/k/v when the checkpoint has no text_projection; use scripts/export_uberrealistic.py.
- [2026-10-04] AI Hub no longer accepts `--target_runtime qnn_context_binary`: compile to `qnn_dlc`, then `hub.submit_link_job` for the context binary, both with `--qairt_version 2.45` (never newer than the QNN libs in the APK), from a torch.export `.pt2` (TorchScript fails over 2 GB: "upgrade to opset 21"); see export() in scripts/export_uberrealistic.py.
- [2026-10-04] QNN context binaries are per Hexagon version: build one SD package per NPU (`--device` of export_uberrealistic.py, `"hexagon"` in metadata.json) and ship that version's stub/skel from the exact QAIRT build of GenieX's libQnnHtp.so (scripts/fetch-qnn-htp-libs.sh); never mix SDK builds (2.31 V73 libs with GenieX 2.45).
- [2026-10-04] On Hexagon v73 (Z Fold5) the FP16 UberRealistic graphs (TE 0.69 GB + UNet 1.74 GB) nearly fill the NPU address space: Real-ESRGAN no longer loads (0x3ea) and AI Hub cannot profile the UNet; do not add resident graphs on v73 without w8a16 quantization.
- [2026-10-04] Do not quantize the SD text encoder with AI Hub's plain w8a16 min_max (on-device cosine 0.31: the CLIP causal mask/outliers wreck the int16 ranges); quantize only the UNet (scripts/quantize_sd_w8a16.py, calibrated on the app's sampling loop: cosine 0.9972, 163 ms/call on v73) and keep the text encoder FP16.
- [2026-10-04] Never run QNN graphs without an HTP performance vote: the default DCVS policy made the Fold5 UNet ~2.8x slower (27.4 s vs 9.7 s per image); vote burst only around the work (QnnSdEngine::setBurst in a finally) so the NPU does not stay at max clocks when idle.
- [2026-10-04] In vitest, never write `beforeEach(() => mock.mockReset())`: the returned mock is taken as a cleanup hook and called with no arguments; use a block body.
- [2026-10-03] LLMs on the NPU of both phones: use GGUF Q4_0 (or Q4_1/IQ4_NL/MXFP4/Q8_0) files on GenieX's llama_cpp runtime (Hexagon v68+, Fold5 v73 included); QAIRT/AI Hub bundles only run on v79/v81 (Fold7). K-quants (Q4_K_M) do not run on the NPU. Choose defaults from the in-app benchmark, not from assumptions.
- [2026-10-04] Never store a model-written fact unchecked (factQuality): small on-device models tag questions, notes to themselves and "tomorrow" plans as facts. And do not rely on the model to look things up for questions about the user: recall questions get the facts and the instruction in the turn context (recallQuestion).
- [2026-10-04] Chat attachments live inline in localStorage (~5 MB for the app): shrink images (attachmentImage, 1024 px JPEG) and save threads without image data rather than not at all.
- [2026-10-04] GenieX 0.3.5 llama_cpp breaks its prefix cache after a partial rollback ("Context length exceeded" on every later call): reset it (LlmWrapper.reset) unless the prompt continues the last completed one; never rely on GenieX rollback when chat and background tasks alternate. Gemma 4 QAIRT bundles (vision) need GenieX >= 0.8.0 (0.3.5 has no gemma_4 factory); the cache guard stays, the bug was not re-checked on 0.8.0.
- [2026-10-04] Never give on-device models (Genie, GGUF, LiteRT) the long English companion prompt: use prompt/onDevicePrompt (compact, in the assistant's language, language rule last); measure prompt and loop changes with the eval harness (`npm run eval`, eval/README.md) before and after, not by impression.
- [2026-10-04] Never read nCtx/contextSize directly for an on-device engine: use onDeviceContextSize (auto per phone unless contextMode is 'manual'; QAIRT bundles keep their exported context) and budgetFor for trimming and generation alike.
- [2026-10-04] Keep the agent loop in services/agent/agentRunner (no React): useAgenticLoop and the eval harness are adapters; on-device runs stop after 3 tool steps, never repeat an identical call and end with a tool-free answer step.
- [2026-10-04] Every fact writer goes through factGate (quality, grounding in the user's own messages, dates from dateResolver, kind/importance rules, near duplicates): never trust a model's date arithmetic or a fact without the user's words behind it; never auto-delete old junk (status 'review', the user decides).
- [2026-10-04] Do not store raw chat messages as episodic memories nor inject rows under the similarity threshold (graph neighbours, recency fallbacks): store conversation summaries (episodeSummary) and use per-model thresholds (memoryThresholds).
- [2026-10-04] Give Gemma 4 / Qwen 3 their tools in the native template format (formatChat/getFormattedChat with tools and tool turns via Message.toolMeta), never ReAct with off-topic examples; route 0–4 tools per turn (toolRouter) and check arguments (toolArgs) before running a call. llama.cpp common_chat defaults enable_thinking to true: always pass the user's setting.
- [2026-10-04] Never put rules about how to answer ("rispondi in breve", "rispondi in modo diretto", "rispondi sempre in italiano") in an on-device system prompt with tools: Gemma 4 E2B then answers instead of calling (5/12 vs 12/12 calls); frame tool use positively ("chiama lo strumento giusto"), write "Scrivi in italiano", bound the length with the token budget. Test prompt lines one by one on llama-server (EVAL_DUMP=1) before blaming the model.
- [2026-10-04] Never pick an embedding model's prefixes or thresholds from its folder name only: imported models ("memories3") are E5 by their config.json `_name_or_path` (modelSources.ts); give a changed pipeline its own vector key so old vectors are re-embedded.
- [2026-10-04] Never show a model's reasoning as its answer: when the reasoning used the whole budget, repeat the step without it (agentRunner); on-device the fallback is a localized "couldn't answer".
- [2026-10-04] Measure prompts on the phone without rebuilding the APK: EVAL_PHONE=<serial> npm run eval runs the PC code with GenieX on the phone (eval/harness/phoneShim.ts); the full on-device run is npm run eval:device on a VITE_AIMM_EVAL=1 build.
- [2026-10-04] Never anchor a streaming parser's patterns with ^ on its buffer: the buffer start is not a line start (thinkingParser cut Gemma 4's thought at "**Formulate the Answer:**"); test parsers with 1-, 3- and 7-character chunks.
- [2026-10-04] Never run long NPU test series on a phone without watching its thermal status: an hour of back-to-back generations brought the Fold7 to critical (status 4, 47 °C skin) and halved the decode speed; device evals pause at status ≥ 3 (waitUntilCool).
- [2026-10-03] Never reset the GGUF native context between chat turns: the native layer reuses the longest common token prefix (LLMInference.cpp); send the whole conversation every turn and keep the system prompt stable. Reset only for prompts with images.
- [2026-10-03] Never put what the model must read in ToolResult.data: the agent loop forwards only `message` (data feeds UI/images); read_web_page and analyze_web gave the model only "Read content successfully".
- [2026-10-03] Read settings outside React with readSetting('<real localStorage key>') (e.g. 'aimindmesh-server-settings'), never an invented key ('appSettings' was never written, so web delegation never ran) — API keys live in the Keystore.
- [2026-10-03] Do not strip HTML with `<[^>]+>` nor pair separate title/snippet lists: quoted attributes contain '>' (Wikipedia data-mw) and ads shift lists; use src/services/web/ (quote-aware scanner, per-result parsing) and test parsers on real saved pages.
- [2026-10-03] Tools fed by web content (read_web_page) stay GET-only and refuse local/private addresses (phone urlSafety.ts, server utils/safeHttp.ts): a page can carry prompt injection that would exfiltrate memories or hit the VPN.

## Private Deployment Notes
VPS host and running container map (not versioned, see `.gitignore`):
@./GEMINI.local.md
