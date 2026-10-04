#!/usr/bin/env bash
# Puts the speech models bundled in the APK into android/app/src/main/assets/bundled_models/
# (not versioned: ~330 MB), verifying their SHA-256. ModelAssetManager unpacks them on the phone
# at first launch. Files are copied from $MODELS_SRC when it has them (default: the
# MeetingAssistant checkout's Models/ folder), otherwise downloaded.
# Usage: aimindmesh-mobile/scripts/fetch-bundled-models.sh
# A build without them still works: the app then downloads the models from Settings.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$MOBILE_DIR/android/app/src/main/assets/bundled_models"
MODELS_SRC="${MODELS_SRC:-/home/andre/AntiGravity/MeetingAssistant/Models}"
mkdir -p "$DEST"

# name|path under $MODELS_SRC|url|sha256
MODELS=(
  "vosk-model-small-it-0.22.zip|Vosk/vosk-model-small-it-0.22.zip|https://alphacephei.com/vosk/models/vosk-model-small-it-0.22.zip|9ec65e75861d1c6c2e457cccd932705340dcdf233f5b239f00733b4de0bf3267"
  "vosk-model-small-en-us-0.15.zip|Vosk/vosk-model-small-en-us-0.15.zip|https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip|30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
  "vosk-model-en-us-0.22-lgraph.zip|Vosk/vosk-model-en-us-0.22-lgraph.zip|https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip|47dd64fcd23ef9cd66e24a9700a4d662eb1e3c4d323b8ccff08fd8abf95634fa"
  "vosk-model-spk-0.4.zip|Vosk/vosk-model-spk-0.4.zip|https://alphacephei.com/vosk/models/vosk-model-spk-0.4.zip|a74d8f51144484813e16af689bb0f916b7a111e2347f467c4933c1166097b5a7"
  "silero_vad.onnx|VAD/silero_vad.onnx|https://raw.githubusercontent.com/snakers4/silero-vad/v6.2/src/silero_vad/data/silero_vad.onnx|1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
  "voxceleb_ECAPA512.onnx|SpeakerID/voxceleb_ECAPA512.onnx|https://huggingface.co/Wespeaker/wespeaker-voxceleb-ecapa-tdnn512/resolve/main/voxceleb_ECAPA512.onnx|f901ae3571912bad4e11e157744cb8b7d77a0b46923b83c410bdbb6c77d69736"
  "ggml-base-q8_0.bin|Whisper/ggml-base-q8_0.bin|https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin|c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9"
)

sha256() { sha256sum "$1" | cut -d' ' -f1; }

for model in "${MODELS[@]}"; do
  IFS='|' read -r name local_path url expected <<< "$model"
  target="$DEST/$name"

  if [[ -f "$target" && "$(sha256 "$target")" == "$expected" ]]; then
    echo "✓ $name already present"
    continue
  fi

  tmp="$(mktemp "$DEST/.fetch.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  if [[ -f "$MODELS_SRC/$local_path" ]]; then
    echo "⇢ $name (from $MODELS_SRC)"
    cp "$MODELS_SRC/$local_path" "$tmp"
  else
    echo "↓ $name"
    curl -fSL --retry 3 -o "$tmp" "$url"
  fi
  actual="$(sha256 "$tmp")"
  if [[ "$actual" != "$expected" ]]; then
    echo "✗ $name: SHA-256 mismatch (expected $expected, got $actual)" >&2
    exit 1
  fi
  chmod 644 "$tmp"  # mktemp creates it 0600
  mv "$tmp" "$target"
  trap - EXIT
  echo "✓ $name"
done
