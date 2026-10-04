"""
w8a16 (int8 weights, int16 activations) build of the UberRealistic UNet (optionally text encoder) for one
Hexagon NPU, through AI Hub quantize jobs (qai_hub_models' recipe for w8a16: --range_scheme min_max).
Half the memory of the FP16 graphs: on the Z Fold5 (v73) the FP16 package leaves no room for Real-ESRGAN.

Calibration comes from CPU float32 runs of the app's own sampling loop (DiffusionScheduler: Euler,
trailing timesteps, CFG 7.5, v-prediction), so the int16 ranges cover what the phone feeds the UNet.
With --preview the quantized ONNX models also render a CPU image (onnxruntime) before compiling.

  python quantize_sd_w8a16.py --device "Samsung Galaxy S23 (Family)" \\
      --copy-from ../Models/sd2.1lora_v73 --out ../Models/sd2.1lora_v73_w8a16

Uses export_uberrealistic.py for loading and validation; venv: scripts/qai_venv314.
"""
import argparse
import glob
import json
import os
import shutil
import sys
import time
import zipfile

import numpy as np
import torch
from transformers import CLIPTokenizer

import export_uberrealistic as ex

PHOTO_SUFFIX = ", 8k uhd, dslr, high quality, soft lighting, photorealistic"
PHOTO_NEGATIVE = ("cartoon, anime, 3d render, illustration, drawing, painting, vector, low quality, "
                  "bad anatomy, deformed, oversaturated")
NEGATIVES = [PHOTO_NEGATIVE, "", "blurry, low quality, deformed, watermark"]
PROMPTS = [
    "a photo of a cat sitting on a red cushion",
    "portrait of an old fisherman with a white beard wearing a yellow raincoat",
    "a red sports car parked in front of a glass skyscraper at sunset",
    "a mountain lake at dawn with pine trees and mist",
    "a bowl of ramen with egg and green onions on a wooden table",
    "a young woman reading a book in a cozy cafe, window light",
    "a golden retriever running on a beach",
    "a medieval castle on a hill under a stormy sky",
    "a modern living room with large windows and plants",
    "close-up of a red rose with water drops",
    "a busy city street at night with neon signs in the rain",
    "an astronaut riding a horse on mars",
    "a child flying a kite in a green field",
    "a plate of colorful macarons on a marble counter",
    "a lighthouse on rocky cliffs with crashing waves",
    "a watercolor painting of a village in the alps",
]
CFG = 7.5


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ckpt", default=ex.DEFAULT_CKPT)
    p.add_argument("--device", default="Samsung Galaxy S23 (Family)")
    p.add_argument("--out", required=True)
    p.add_argument("--copy-from", required=True, help="package of the same device to take vae, vae_encoder, Real-ESRGAN from")
    p.add_argument("--components", default="unet", help="what to quantize (text_encoder,unet); the rest is copied "
                   "from --copy-from. The text encoder loses its accuracy with min_max ranges (cosine 0.31 on the "
                   "device): the causal attention mask needs Qualcomm's model adaptations first")
    p.add_argument("--te-onnx", default="mmrgg322q", help="AI Hub ONNX model of the text encoder (job jglwvox2p)")
    p.add_argument("--unet-onnx", default="mq8pv95gm", help="AI Hub ONNX model of the 512 px UNet (job jgnn6x3qg)")
    p.add_argument("--reuse-quantized", action="append", default=[], metavar="text_encoder|unet=MODEL_ID")
    p.add_argument("--reuse-compiled", action="append", default=[], metavar="text_encoder|unet=JOB_ID",
                   help="compile jobs of a previous run: skips calibration, quantization, compiling and the preview")
    p.add_argument("--trajectory-steps", type=int, default=10, help="steps of each calibration trajectory")
    p.add_argument("--qairt", default="2.45")
    p.add_argument("--min-cosine", type=float, default=0.95, help="on-device vs CPU float32 acceptance")
    p.add_argument("--preview", action="store_true", help="CPU image from the quantized ONNX models (downloads them: "
                   "QDQ keeps float weights, ~1.2 GB text encoder + ~3.4 GB UNet)")
    p.add_argument("--name", default="UberRealistic21")
    return p.parse_args()


def app_timesteps(steps, top=999):
    """DiffusionScheduler.timesteps: trailing spacing from the calibrated maximum."""
    return [max(0, int(round(top - i * (top + 1.0) / steps))) for i in range(steps)]


def sigma_of(ac, t):
    return float(((1 - ac[t]) / ac[t]).sqrt())


def unet_calibration(unet, cond_of, args):
    """UNet inputs (NHWC latent, timestep, text embedding) along app-like trajectories, cond and uncond."""
    ac = ex.alphas_cumprod()
    data = {"latent": [], "timestep": [], "text_emb": []}
    plans = [(i, args.trajectory_steps, None) for i in range(len(PROMPTS))]
    plans += [(0, 50, slice(-6, None)), (5, 50, slice(-6, None))]  # low noise levels of long runs
    start = time.time()
    for n, (pi, steps, keep) in enumerate(plans):
        prompt = PROMPTS[pi] + (PHOTO_SUFFIX if pi % 2 == 0 else "")
        cond, uncond = cond_of(prompt), cond_of(NEGATIVES[pi % len(NEGATIVES)])
        ts = app_timesteps(steps)
        sigmas = [sigma_of(ac, t) for t in ts] + [0.0]
        g = torch.Generator().manual_seed(1000 + n)
        x = torch.randn(1, 4, 64, 64, generator=g) * (sigmas[0] ** 2 + 1) ** 0.5
        wanted = set(range(steps)[keep] if keep else range(steps))
        for j, t in enumerate(ts):
            s = sigmas[j]
            inp = x / (s * s + 1) ** 0.5
            with torch.no_grad():
                out = unet(torch.cat([inp, inp]), torch.tensor([t, t]), torch.cat([uncond, cond])).sample
            if j in wanted:
                for emb in (cond, uncond):
                    data["latent"].append(inp.permute(0, 2, 3, 1).numpy().copy())
                    data["timestep"].append(np.array([[t]], dtype=np.float32))
                    data["text_emb"].append(emb.numpy().copy())
            v = out[0:1] + CFG * (out[1:2] - out[0:1])
            denoised = x / (s * s + 1) - s / (s * s + 1) ** 0.5 * v
            x = x + (x - denoised) / s * (sigmas[j + 1] - s)
        print(f"   trajectory {n + 1}/{len(plans)} ({steps} steps) - {time.time() - start:.0f} s")
    return data


def text_encoder_calibration(tokenizer):
    texts = [p + s for p in PROMPTS for s in ("", PHOTO_SUFFIX)] + NEGATIVES
    tok = lambda t: tokenizer(t, padding="max_length", max_length=ex.SEQ_LEN, truncation=True,
                              return_tensors="np").input_ids.astype(np.int32)
    return {"tokens": [tok(t) for t in texts]}


def download_onnx(model, folder):
    """A quantized ONNX model from AI Hub (single file or folder with external weights) -> .onnx path."""
    path = model.download(folder)
    if zipfile.is_zipfile(path):  # ONNX with external weights comes as a zip
        target = path + ".dir"
        with zipfile.ZipFile(path) as z:
            z.extractall(target)
        os.remove(path)
        path = target
    if os.path.isdir(path):
        path = glob.glob(os.path.join(path, "**", "*.onnx"), recursive=True)[0]
    return path


def render_qdq_preview(te_path, unet_path, vae, tokenizer, out_png):
    """The app's loop on the quantized ONNX models (onnxruntime, CPU), float32 VAE."""
    import onnxruntime as ort
    from PIL import Image
    te = ort.InferenceSession(te_path, providers=["CPUExecutionProvider"])
    un = ort.InferenceSession(unet_path, providers=["CPUExecutionProvider"])
    names = [i.name for i in un.get_inputs()]
    embed = lambda t: te.run(None, {"tokens": tokenizer(t, padding="max_length", max_length=ex.SEQ_LEN, return_tensors="np")
                                    .input_ids.astype(np.int32)})[0]
    cond, uncond = embed(ex.PREVIEW_PROMPT + PHOTO_SUFFIX), embed(PHOTO_NEGATIVE)
    ac = ex.alphas_cumprod()
    ts = app_timesteps(20)
    sigmas = [sigma_of(ac, t) for t in ts] + [0.0]
    x = torch.randn(1, 64, 64, 4, generator=torch.Generator().manual_seed(1167434745)).numpy() * (sigmas[0] ** 2 + 1) ** 0.5
    run = lambda inp, t, emb: un.run(None, dict(zip(names, [{"latent": inp, "timestep": np.array([[t]], np.float32),
                                                             "text_emb": emb}[n] for n in names])))[0]
    start = time.time()
    for j, t in enumerate(ts):
        s = sigmas[j]
        inp = (x / (s * s + 1) ** 0.5).astype(np.float32)
        c, u = run(inp, t, cond), run(inp, t, uncond)
        v = u + CFG * (c - u)
        denoised = x / (s * s + 1) - s / (s * s + 1) ** 0.5 * v
        x = x + (x - denoised) / s * (sigmas[j + 1] - s)
    with torch.no_grad():
        img = ex.VaeDecoderWrapper(vae)(torch.from_numpy(x.astype(np.float32)))[0].numpy()
    Image.fromarray((img * 255).round().clip(0, 255).astype(np.uint8)).save(out_png)
    print(f"   w8a16 CPU preview -> {out_png} ({time.time() - start:.0f} s)")


def main():
    args = parse_args()
    import qai_hub as hub

    os.makedirs(args.out, exist_ok=True)
    work = os.path.join(args.out, ".work")
    os.makedirs(work, exist_ok=True)
    device = hub.Device(args.device)
    qairt = f"--qairt_version {args.qairt}"
    reuse = dict(r.split("=", 1) for r in args.reuse_quantized)

    print(f"1. Loading {args.ckpt}")
    ckpt = ex.load_file(args.ckpt)
    tokenizer = CLIPTokenizer.from_pretrained(ex.HF_REPO, subfolder="tokenizer")
    models = {"text_encoder": ex.load_text_encoder(ckpt), "unet": ex.load_unet(ckpt, 512), "vae": ex.load_vae(ckpt)}
    del ckpt
    cond_of = lambda text: ex.encode(models["text_encoder"], tokenizer, text)

    compiled = dict(r.split("=", 1) for r in args.reuse_compiled)
    args.components = [c.strip() for c in args.components.split(",") if c.strip()]
    if set(compiled) >= set(args.components):
        compiles = {name: hub.get_job(compiled[name]) for name in args.components}
        quantized = {name: job.model for name, job in compiles.items()}
        print(f"Reusing compile jobs {compiled}")
    else:
        compiles, quantized = quantize_and_compile(args, hub, device, qairt, reuse, models, tokenizer, cond_of, work)
    link_validate_package(args, hub, device, qairt, models, tokenizer, compiles, quantized, work)


def quantize_and_compile(args, hub, device, qairt, reuse, models, tokenizer, cond_of, work):
    print("2. Calibration data")
    calibration = {"text_encoder": text_encoder_calibration(tokenizer)}
    cache = os.path.join(work, "unet_calibration.npz")
    if "unet" not in args.components:
        calibration["unet"] = {"latent": []}
    elif os.path.isfile(cache):
        z = np.load(cache)
        calibration["unet"] = {k: [a[None] for a in z[k]] for k in ("latent", "timestep", "text_emb")}
    else:
        calibration["unet"] = unet_calibration(models["unet"], cond_of, args)
        np.savez(cache, **{k: np.concatenate(v) for k, v in calibration["unet"].items()})
    print(f"   text encoder {len(calibration['text_encoder']['tokens'])} samples, UNet {len(calibration['unet']['latent'])} samples")

    print("3. Quantize jobs (w8a16, min_max)")
    sources = {"text_encoder": args.te_onnx, "unet": args.unet_onnx}
    quantized = {}
    for name in args.components:
        if name in reuse:
            quantized[name] = hub.get_model(reuse[name])
            continue
        job = hub.submit_quantize_job(model=hub.get_model(sources[name]), calibration_data=calibration[name],
                                      weights_dtype=hub.QuantizeDtype.INT8, activations_dtype=hub.QuantizeDtype.INT16,
                                      options="--range_scheme min_max", name=f"{args.name}_{name}_w8a16")
        print(f"   {name}: quantize job {job.job_id} {job.url}")
        quantized[name] = job
    for name, q in list(quantized.items()):
        if not isinstance(q, hub.Model):
            quantized[name] = ex.target_of(q, f"{name} quantize")
        print(f"   {name}: quantized ONNX {quantized[name].model_id} (retry: --reuse-quantized {name}={quantized[name].model_id})")

    print(f"4. Compiling for {args.device}")
    compiles = {name: hub.submit_compile_job(model=q, device=device, options=f"--target_runtime qnn_dlc {qairt}",
                                             name=f"{args.name}_{name}_w8a16_dlc")
                for name, q in quantized.items()}
    for name, job in compiles.items():
        print(f"   {name}: compile job {job.job_id} {job.url}")

    if args.preview and set(args.components) >= {"text_encoder", "unet"}:
        print("5. CPU preview of the quantized models (while AI Hub compiles)")
        te_path = download_onnx(quantized["text_encoder"], os.path.join(work, "te_qdq"))
        unet_path = download_onnx(quantized["unet"], os.path.join(work, "unet_qdq"))
        render_qdq_preview(te_path, unet_path, models["vae"], tokenizer, os.path.join(args.out, "preview_w8a16_cpu.png"))

    return compiles, quantized


def link_validate_package(args, hub, device, qairt, models, tokenizer, compiles, quantized, work):
    print("6. Link, on-device check, download")
    files = {}
    for name, job in compiles.items():
        dlc = ex.target_of(job, f"{name} compile")
        link = hub.submit_link_job([dlc], device=device, name=f"{args.name}_{name}_w8a16_link", options=qairt)
        binary = ex.target_of(link, f"{name} link")
        wrapper, inputs, specs, _ = ex.component_specs(name, models, 512, tokenizer)
        with torch.no_grad():
            expected = wrapper.eval()(*inputs).numpy()
        sim = ex.validate_on_device(hub, device, binary, f"{args.name}_{name}_w8a16", inputs, specs, expected, args.min_cosine)
        final = os.path.join(args.out, f"{name}.bin")
        os.replace(binary.download(os.path.join(work, f"{name}.download.bin")), final)
        print(f"   {final} ({os.path.getsize(final)} bytes)")
        files[f"{name}.bin"] = {"precision": "w8a16", "qairt": args.qairt, "device_vs_cpu_cosine": round(sim, 5),
                                "ai_hub_jobs": {"quantized_onnx": quantized[name].model_id, "compile": job.job_id,
                                                "link": link.job_id}}

    print("7. Package")
    source_meta = json.load(open(os.path.join(args.copy_from, "metadata.json")))
    for f in ("text_encoder.bin", "unet.bin", "vae.bin", "vae_encoder.bin", "realesrgan_x4plus.bin"):
        if f in files:
            continue
        if os.path.isfile(os.path.join(args.copy_from, f)):
            shutil.copy2(os.path.join(args.copy_from, f), os.path.join(args.out, f))
            files[f] = source_meta.get("model_files", {}).get(f, {"precision": "float16"})
    meta = {k: v for k, v in source_meta.items() if k != "model_files"}
    meta.update({"model_name": f"{source_meta.get('model_name', 'SD')} (w8a16 {', '.join(args.components)})",
                 "precision": f"w8a16 {', '.join(args.components)}, the rest as in {os.path.basename(os.path.normpath(args.copy_from))}",
                 "exported_at": time.strftime("%Y-%m-%d"), "model_files": files})
    with open(os.path.join(args.out, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=4)
    shutil.rmtree(os.path.join(work, "te_qdq"), ignore_errors=True)
    shutil.rmtree(os.path.join(work, "unet_qdq"), ignore_errors=True)
    print(f"Done: {args.out} (hexagon {meta.get('hexagon')})")


if __name__ == "__main__":
    sys.exit(main())
