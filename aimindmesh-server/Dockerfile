FROM node:22-slim

# Install system dependencies for native modules (better-sqlite3) and docker client CLI
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    iproute2 \
    iptables \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Add node user to docker group (GID 126 matches host docker socket GID)
RUN groupadd -g 126 docker-host 2>/dev/null || true \
    && usermod -aG docker-host node 2>/dev/null || true \
    && groupadd -g 999 docker-sock 2>/dev/null || true \
    && usermod -aG docker-sock node 2>/dev/null || true


WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install exactly the locked dependencies (reproducible builds).
# devDependencies stay: typescript is used at runtime by the auto-evolution type-check.
RUN npm ci
RUN npm rebuild better-sqlite3

# Copy source and config
COPY . .

# Build TypeScript
RUN npm run build

# Default environment
ENV NODE_ENV=production

# The port is already defined in config.json as 3030
EXPOSE 3030

# Launch via persistent entrypoint to ensure VPN routes are applied on startup
RUN chmod +x entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
