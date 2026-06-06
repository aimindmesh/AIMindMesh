#!/bin/bash
set -e

echo "🦙 Installing Ollama..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
else
    echo "✅ Ollama is already installed."
fi

echo "🔄 Pulling models for AIMindMesh..."
# Note: Some models (like gemma4) might be custom and require the original GGUF/Modelfile
models=("gemma4" "nomic-embed-text" "qwen3.5-9b-q4km") 
for model in "${models[@]}"; do
    echo "📥 Pulling $model..."
    ollama pull "$model"
done

echo "✅ Ollama setup complete."
