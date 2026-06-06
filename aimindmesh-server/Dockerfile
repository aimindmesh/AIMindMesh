FROM node:22-slim

# Install system dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    iproute2 \
    iptables \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (rebuilding for current arch)
RUN npm install && npm audit fix --force
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
