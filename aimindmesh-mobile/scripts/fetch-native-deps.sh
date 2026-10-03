#!/usr/bin/env bash
# Downloads the native Android dependencies that are not versioned in git
# (binaries too large for the repository), verifying their SHA-256.
# Usage: aimindmesh-mobile/scripts/fetch-native-deps.sh
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIBS_DIR="$MOBILE_DIR/android/app/libs"
mkdir -p "$LIBS_DIR"

# name|url|sha256
DEPS=(
  "sherpa-onnx-static-link-onnxruntime-1.13.2.aar|https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.2/sherpa-onnx-static-link-onnxruntime-1.13.2.aar|9b2a290b8c7f31bd0aba35abb4628e87fe8d0eb71796a98aa12f3acd089ceaed"
)

sha256() { sha256sum "$1" | cut -d' ' -f1; }

for dep in "${DEPS[@]}"; do
  IFS='|' read -r name url expected <<< "$dep"
  target="$LIBS_DIR/$name"

  if [[ -f "$target" && "$(sha256 "$target")" == "$expected" ]]; then
    echo "✓ $name already present"
    continue
  fi

  echo "↓ $name"
  tmp="$(mktemp "$LIBS_DIR/.download.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  curl -fSL --retry 3 -o "$tmp" "$url"
  actual="$(sha256 "$tmp")"
  if [[ "$actual" != "$expected" ]]; then
    echo "✗ $name: SHA-256 mismatch (expected $expected, got $actual)" >&2
    exit 1
  fi
  mv "$tmp" "$target"
  trap - EXIT
  echo "✓ $name"
done
