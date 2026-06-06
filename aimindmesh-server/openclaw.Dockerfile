FROM ghcr.io/openclaw/openclaw:latest

USER root

# Install system packages (jq, ripgrep, ffmpeg, python, tools)
RUN apt-get update && apt-get install -y \
    jq \
    ripgrep \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    tmux \
    bzip2 \
    ffmpeg \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast Python package management and install whisper & nano-pdf
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && export UV_BREAK_SYSTEM_PACKAGES=1 \
    && uv pip install --system --extra-index-url https://download.pytorch.org/whl/cpu openai-whisper nano-pdf vosk

# Install global NPM packages required by OpenClaw skills
RUN npm install -g \
    @google/gemini-cli \
    mcporter \
    @steipete/summarize \
    @xdevplatform/xurl \
    clawhub

# Configure Git system-wide to use the GITEA_TOKEN environment variable for authentication
RUN git config --system credential.helper '!f() { echo username=token; echo password=$GITEA_TOKEN; }; f'

# Switch back to node user
USER node
WORKDIR /app

# Link Vosk model cache directory to persistent openclaw volume
RUN mkdir -p /home/node/.cache && ln -sf /home/node/.openclaw/vosk-models /home/node/.cache/vosk

