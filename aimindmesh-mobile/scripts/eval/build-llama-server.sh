#!/usr/bin/env bash
# Builds llama-server on the PC for the evaluation harness (eval/): the same llama.cpp build the
# GGUF plugin vendors (plugins/llama-cpp-capacitor/VENDORED.md), CPU only, outside the repo.
set -euo pipefail

TAG="${LLAMA_TAG:-b9309}"            # commit 6d57c26, as in cpp/common/build-info.cpp
DIR="${LLAMA_DIR:-$HOME/.cache/aimm-eval/llama.cpp}"

if [ ! -d "$DIR/.git" ]; then
    git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$DIR"
fi
cd "$DIR"
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DLLAMA_CURL=OFF \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build build --target llama-server -j "$(nproc)"
echo "llama-server: $DIR/build/bin/llama-server"
