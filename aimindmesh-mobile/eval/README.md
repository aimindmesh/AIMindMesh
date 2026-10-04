# Evaluation harness

Measures the on-device assistant (memory, tool choice, answer language and hygiene) with the app's
real code — prompt builder, memory context, providers, parsers — and the same GGUF models as the
phone, run by a local `llama-server`. Every change to prompts, memory or tools is judged against
these numbers, not by impression.

## Run
```bash
scripts/eval/build-llama-server.sh            # once: llama.cpp b9309 (same build as the GGUF plugin)
~/.cache/aimm-eval/llama.cpp/build/bin/llama-server \
  -m Models/GGUF/QAT/gemma-4-E2B_QAT_q4_0-it.gguf --jinja -c 8192 -np 1 -t 10 --port 8080
npm run eval                                   # all scenarios, 1 sample
EVAL_SMOKE=1 npm run eval                      # smoke subset
EVAL_FILTER=recall EVAL_SAMPLES=3 npm run eval # one category, 3 samples
```
Options: `EVAL_THINKING=on|off`, `EVAL_PERSONA=Atlas|Aria`, `EVAL_NCTX` (default 8192, the Fold7's auto
context; 4096 for the Fold5), `EVAL_NAME`, `LLAMA_URL`, `EVAL_GRAMMAR=off` (extraction without the GBNF), `EVAL_DUMP=1` (the prompt of each chat turn in the JSON report).
Reports go to `eval/results/` (git-ignored): a Markdown table per category and every failure with
the answer, plus the full JSON.

## How it works
- `harness/genieShim.ts` stands in for the `genie-capacitor` plugin: `formatChat` → `/apply-template`
  (the model's own chat template), `generateStream` → `/completion`.
- `harness/runners.ts` runs a chat turn through the app's agent runner (`services/agent/agentRunner.ts`)
  over `generateTextResponseStreamWithTools`, and an extraction through the consolidation steps (`runBackgroundTask`, `parseOps`, `validateOps`,
  `applyOps`); a "ricordati che…" turn (`expect.remembers`) is followed by that consolidation, since
  the chat itself writes no facts. Facts live in an in-memory fact store; past-conversation memories come from the
  scenario (`memories`).
- `harness/scoring.ts` is deterministic: tool name and arguments, saved facts (content, kind, due
  date), answer regexes, language (function-word ratio), tag leaks, memory denials.

## Scenarios (`scenarios/*.json`)
`recall`, `tools` (including "no tool" turns and "ricordati che…"), `extraction`, `hygiene`. Every
failure seen on the phone becomes a scenario. Data is invented; real conversations, if ever used,
go in `scenarios/private/` (git-ignored).

## On the phone
The same scenarios run on a phone, through the app's real code and engine (GenieX on the NPU),
driven from the PC through the WebView's DevTools:
```bash
VITE_AIMM_EVAL=1 npm run build && npx cap sync android    # test build: installs window.__aimmEval
(cd android && ./gradlew assembleDebug) && adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
EVAL_DEVICE=<serial> EVAL_MODEL=gemma-4-E2B_q4_0-it.gguf npm run eval:device
EVAL_DEVICE=<serial> npx vitest run --config vitest.eval.config.mts eval/calibrate.eval.ts   # memory thresholds
```
Options as above, plus `EVAL_PORT` (one DevTools port per phone when two run in parallel; default
9300) and `EVAL_NCTX` (default: the phone's auto context). Reports are named
`…-device-<npu arch>-<model>-<name>`.

Isolation (`src/services/eval/deviceEval.ts`): the scenario's facts live in an in-memory store
borrowed for the run (`factStore.useRepository`, never synced to the server, nested borrows
refused), past-conversation memories come from the scenario and workspace documents are off
(`evalHooks`), tools return canned results (nothing runs: no alarm, event, app or web request),
runs are serialized and stopped after 5 minutes. Before each scenario a hot phone (Android thermal status ≥ 3) waits until it is back to ≤ 2: an hour of NPU work brought the Fold7 to critical. A dropped USB connection is reconnected and the
call repeated once (`deviceCdp.ts`). Ship a normal build afterwards (without `VITE_AIMM_EVAL`).
