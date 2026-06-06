---
name: vosk-stt
version: 1.0.0
description: Local speech-to-text with Vosk (no API key).
trigger: explicit
metadata:
  openclaw:
    emoji: "🎤"
    requires:
      bins:
        - vosk-transcriber
    install:
      - id: vosk-pip
        kind: pip
        package: vosk
        bins:
          - vosk-transcriber
        label: Install Vosk STT via pip
---
# Vosk STT (CLI)

Use `vosk-transcriber` to transcribe audio files locally. Vosk is optimized for speed and works offline.

Quick start

- `vosk-transcriber -i audio.mp3 -o transcript.txt --lang it`
- `vosk-transcriber -i audio.m4a -o captions.srt --lang it --output-type srt`

Notes

- Models are stored in `~/.cache/vosk` (download models manually or use --model-name)
- Use `--lang it` for Italian (downloads model automatically)
- Italian model: `vosk-model-small-it-0.22` (~47MB, fast inference)
- For batch processing: specify multiple files with -i
- Use `--list-languages` to see available languages
