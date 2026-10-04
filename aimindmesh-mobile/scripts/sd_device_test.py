#!/usr/bin/env python3
"""
Stable Diffusion test generations on a connected phone, through the app's own SD plugin over Chrome
DevTools on the debug WebView: no taps, no key events, no activity started (open the app first).
Every image is saved with its parameters and the SD log lines; report.html puts them side by side.

  python3 scripts/sd_device_test.py --serial RFCY703GF7B --model sd2.1lora --model sd2.1lora768 --out ~/sd_runs/fold7
  python3 scripts/sd_device_test.py --serial <fold5> --port 9334 --model sd2.1lora_v73 --out ~/sd_runs/fold5

It calls SD.loadModel directly, outside the app's model residency: run it while the chat is idle.
At the end the SD engine is put back as it was (the same model loaded, or none). Two phones can be
tested at the same time with two processes (different --serial and --port).
"""
import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

import websocket

APP_ID = "com.aimindmesh.mobile"
# src/components/modals/imageGenPresets.ts, preset 'photorealistic' (the image screen's default)
PHOTO_SUFFIX = ", 8k uhd, dslr, high quality, soft lighting, photorealistic"
PHOTO_NEGATIVE = ("cartoon, anime, 3d render, illustration, drawing, painting, vector, low quality, "
                  "bad anatomy, deformed, oversaturated")
DEFAULT_PROMPTS = [
    "a photo of a cat sitting on a red cushion",
    "a red sports car parked in front of a glass skyscraper at sunset",
    "portrait of an old fisherman with a white beard wearing a yellow raincoat",
]
LOG_TAGS = "SDPlugin SDEngine QnnSdEngineNative QnnGraphIO"
KEY_LINES = re.compile(r"Model ready|Text encoder check|looks untrained|Prediction|done in|NaN|failed|Error|error")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--serial", required=True, help="adb serial of the phone")
    p.add_argument("--port", type=int, default=9333, help="local port for DevTools (one per phone)")
    p.add_argument("--model", action="append", required=True, help="folder in files/sd-models (repeatable)")
    p.add_argument("--prompt", action="append", help="repeatable; default: three reference prompts")
    p.add_argument("--seed", action="append", type=int, help="repeatable; default: 1167434745 and 42")
    p.add_argument("--sampler", action="append", choices=("euler", "dpmpp_2m"), help="repeatable; default: euler")
    p.add_argument("--steps", type=int, default=25)
    p.add_argument("--cfg", type=float, default=7.5)
    p.add_argument("--aspect", default="1:1")
    p.add_argument("--upscale", type=int, default=1)
    p.add_argument("--preset", choices=("photo", "none"), default="photo",
                   help="photo: the image screen's default suffix and negative prompt")
    p.add_argument("--source", help="image on the PC to edit (img2img), sent as a data URL")
    p.add_argument("--strength", type=float, default=0.65, help="img2img strength")
    p.add_argument("--debug-steps", action="store_true", help="log per-step statistics (log.tag.SDEngine DEBUG)")
    p.add_argument("--out", required=True, help="output folder on the PC")
    args = p.parse_args()
    args.prompt = args.prompt or DEFAULT_PROMPTS
    args.seed = args.seed or [1167434745, 42]
    args.sampler = args.sampler or ["euler"]
    args.source_data_url = None
    if args.source:
        mime = "image/png" if args.source.lower().endswith(".png") else "image/jpeg"
        with open(args.source, "rb") as f:
            args.source_data_url = f"data:{mime};base64," + base64.b64encode(f.read()).decode()
    return args


def adb(serial, *args, check=True, timeout=120):
    r = subprocess.run(["adb", "-s", serial, *args], capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)}: {(r.stderr or r.stdout).strip()}")
    return r.stdout


def device_time(serial):
    return adb(serial, "shell", "date", "+%m-%d_%H:%M:%S.000").strip().replace("_", " ")


def log_since(serial, since):
    return adb(serial, "shell", f"logcat -d -v time -T '{since}' -s {LOG_TAGS}", check=False)


class DevTools:
    """Runtime.evaluate on the app's WebView page."""

    def __init__(self, serial, port):
        pid = adb(serial, "shell", "pidof", APP_ID, check=False).split()
        if not pid:
            sys.exit(f"{APP_ID} is not running on {serial}: open the app (this script never starts it)")
        socket = f"webview_devtools_remote_{pid[0]}"
        if socket not in adb(serial, "shell", "cat", "/proc/net/unix"):
            sys.exit(f"No DevTools socket {socket} on {serial}: is the debug build installed?")
        adb(serial, "forward", f"tcp:{port}", f"localabstract:{socket}")
        self.serial, self.port, self.next_id = serial, port, 0
        pages = json.load(urllib.request.urlopen(f"http://localhost:{port}/json", timeout=10))
        url = next(p["webSocketDebuggerUrl"] for p in pages if p["type"] == "page")
        self.ws = websocket.create_connection(url, timeout=900, suppress_origin=True)

    def eval(self, expression):
        self.next_id += 1
        self.ws.send(json.dumps({"id": self.next_id, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.next_id:
                break
        result = msg.get("result", {})
        if "exceptionDetails" in result:
            d = result["exceptionDetails"]
            raise RuntimeError(d.get("exception", {}).get("description") or d.get("text") or "JS exception")
        return result.get("result", {}).get("value")

    def sd(self, method, payload=None):
        return self.eval(f"Capacitor.Plugins.SD.{method}({json.dumps(payload or {})})")

    def close(self):
        self.ws.close()
        adb(self.serial, "forward", "--remove", f"tcp:{self.port}", check=False)


def key_lines(log):
    return [line[line.find(": ") + 2:] if ": " in line else line for line in log.splitlines() if KEY_LINES.search(line)]


def load_model(dt, serial, model):
    since = device_time(serial)
    dt.sd("unloadModel")
    start = time.time()
    try:
        result = dt.sd("loadModel", {"modelPath": model, "backend": "npu"})
    except RuntimeError as e:
        result = {"error": str(e)}
    entry = {"model": model, "seconds": round(time.time() - start, 1), "result": result,
             "log": key_lines(log_since(serial, since))}
    print(f"[{serial}] load {model}: {'FAILED ' + result['error'] if 'error' in result else 'ok'} "
          f"({entry['seconds']} s)")
    for line in entry["log"]:
        print(f"    {line}")
    return entry


def generate(dt, serial, args, model, prompt_index, prompt, seed, sampler):
    request = {
        "prompt": prompt + (PHOTO_SUFFIX if args.preset == "photo" else ""),
        "negativePrompt": PHOTO_NEGATIVE if args.preset == "photo" else "",
        "steps": args.steps, "cfgScale": args.cfg, "seed": seed, "sampler": sampler,
        "aspectRatio": args.aspect, "upscale": args.upscale,
    }
    if args.source:
        request.update(sourceImage=args.source_data_url, strength=args.strength)
    since = device_time(serial)
    start = time.time()
    try:
        result = dt.sd("generateImage", request)
    except RuntimeError as e:
        result = {"error": str(e)}
    run = {"model": model, "prompt_index": prompt_index, "prompt": prompt, "seed": seed, "sampler": sampler,
           "seconds": round(time.time() - start, 1), "request": request}
    data_url = result.pop("base64Image", None)
    run["result"] = result
    if data_url:
        header, b64 = data_url.split(",", 1)
        ext = "png" if "png" in header else "jpg"
        run["image"] = f"{model}_{sampler}_p{prompt_index}_s{seed}.{ext}"
        with open(os.path.join(args.out, run["image"]), "wb") as f:
            f.write(base64.b64decode(b64))
    run["log"] = key_lines(log_since(serial, since))
    status = f"FAILED {result['error']}" if "error" in result else f"{run['seconds']} s, {result.get('width')}x{result.get('height')}"
    print(f"[{serial}] {model} {sampler} p{prompt_index} seed {seed}: {status}")
    return run


def write_report(args, loads, runs):
    with open(os.path.join(args.out, "report.json"), "w") as f:
        json.dump({"serial": args.serial, "loads": loads, "runs": runs}, f, indent=2)
    columns = [(m, s) for m in args.model for s in args.sampler]
    rows = []
    for pi, prompt in enumerate(args.prompt):
        for seed in args.seed:
            cells = []
            for model, sampler in columns:
                run = next((r for r in runs if r["model"] == model and r["sampler"] == sampler
                            and r["prompt_index"] == pi and r["seed"] == seed), None)
                if run is None:
                    cells.append("<td>—</td>")
                elif "image" in run:
                    cells.append(f'<td><a href="{run["image"]}"><img src="{run["image"]}"></a>'
                                 f'<div>{run["seconds"]} s</div></td>')
                else:
                    cells.append(f'<td class="err">{html.escape(run["result"].get("error", "?"))}</td>')
            rows.append(f"<tr><th>{html.escape(prompt)}<div>seed {seed}</div></th>{''.join(cells)}</tr>")
    head = "".join(f"<th>{html.escape(m)}<div>{s}</div></th>" for m, s in columns)
    load_info = "".join(
        f"<h3>{html.escape(l['model'])} ({l['seconds']} s)</h3><pre>{html.escape(chr(10).join(l['log']) or json.dumps(l['result']))}</pre>"
        for l in loads)
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>SD test {html.escape(args.serial)}</title>
<style>body{{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#111}}
@media (prefers-color-scheme:dark){{body{{background:#111;color:#eee}}}}
table{{border-collapse:collapse}}td,th{{border:1px solid #8884;padding:6px;vertical-align:top;text-align:left}}
img{{width:256px;height:auto;display:block}}th div,td div{{font-weight:normal;font-size:12px;opacity:.7}}
.err{{color:#c33;max-width:256px}}pre{{white-space:pre-wrap;font-size:12px}}</style></head><body>
<h1>Stable Diffusion, {html.escape(args.serial)}</h1>
<p>{args.steps} steps, CFG {args.cfg}, preset {args.preset}, {args.aspect}, upscale {args.upscale}x{f", edit of {html.escape(os.path.basename(args.source))} at strength {args.strength}" if args.source else ""}</p>
<table><tr><th></th>{head}</tr>{''.join(rows)}</table><h2>Model loads</h2>{load_info}</body></html>"""
    with open(os.path.join(args.out, "report.html"), "w") as f:
        f.write(page)


def main():
    sys.stdout.reconfigure(line_buffering=True)  # progress shows up when the output goes to a file
    args = parse_args()
    args.out = os.path.expanduser(args.out)
    os.makedirs(args.out, exist_ok=True)
    if adb(args.serial, "get-state", check=False).strip() != "device":
        sys.exit(f"Phone {args.serial} not connected")
    if "mWakefulness=Awake" not in adb(args.serial, "shell", "dumpsys", "power"):
        print(f"[{args.serial}] warning: the screen is off, the WebView may be throttled")
    dt = DevTools(args.serial, args.port)
    if not dt.eval("!!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.SD)"):
        sys.exit("The SD plugin is not available in this build")
    before = dt.sd("isLoaded") or {}
    if args.debug_steps:
        adb(args.serial, "shell", "setprop", "log.tag.SDEngine", "DEBUG")
    loads, runs = [], []
    try:
        for model in args.model:
            loads.append(load_model(dt, args.serial, model))
            if "error" in loads[-1]["result"]:
                continue
            for pi, prompt in enumerate(args.prompt):
                for seed in args.seed:
                    for sampler in args.sampler:
                        runs.append(generate(dt, args.serial, args, model, pi, prompt, seed, sampler))
                        write_report(args, loads, runs)
    finally:
        if args.debug_steps:
            adb(args.serial, "shell", "setprop", "log.tag.SDEngine", "INFO", check=False)
        try:  # leave the engine as the app left it
            dt.sd("unloadModel")
            if before.get("loaded") and before.get("modelPath"):
                dt.sd("loadModel", {"modelPath": before["modelPath"], "backend": "npu"})
        finally:
            dt.close()
        write_report(args, loads, runs)
    print(f"Report: {os.path.join(args.out, 'report.html')}")


if __name__ == "__main__":
    main()
