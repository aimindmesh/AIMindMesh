# Hermes Agent Docker Compose Setup

This directory contains a Docker Compose configuration and setup script for deploying Hermes Agent on your VPS.

## Overview

Hermes Agent is a self-improving AI agent built by Nous Research. This setup allows you to deploy it in a Docker container on your VPS alongside your existing services (WireHole, Gitea, Kasm, Neo4j, SearXNG, FreeLLMAPI, Ollama bridge).

## Files

- `docker-compose.yml`: Main Docker Compose configuration
- `setup-hermes.sh`: Setup script to initialize the Hermes Agent
- `check-ip.sh`: Script to verify IP availability in the wirehole_private network
- `README.md`: This file

## Directory Structure

```
/workspace/hermes/
├── docker-compose.yml      # Main Docker Compose configuration
├── setup-hermes.sh         # Setup script to initialize the service
├── check-ip.sh             # Script to verify IP availability
└── README.md               # This file
```

# Quick Start

1. **Navigate to the hermes directory:**
   ```bash
   cd /workspace/hermes
   ```

2. **Run the setup script:**
   ```bash
   chmod +x setup-hermes.sh
   ./setup-hermes.sh
   ```

2. **Follow the setup wizard** to configure your API keys and preferences.

3. **Start the service:**
   ```bash
   docker compose up -d
   ```

4. **Check the logs:**
   ```bash
   docker compose logs -f
   ```

## Configuration

### Environment Variables

The `docker-compose.yml` file includes various environment variables that are mapped from the main ecosystem's host `.env` file (`aimindmesh-server/.env`):

#### Required for Messaging
- `TELEGRAM_BOT_TOKEN`: Telegram bot token (required for Telegram messaging, shared via host `.env`).

#### LLM Provider Proxy Keys
- `OPENAI_API_KEY`: Maps to the FreeLLMAPI unified API key (`FREELLMAPI_API_KEY` on the host).
- `OPENAI_BASE_URL`: Maps to the FreeLLMAPI local proxy completions endpoint (`http://aimindmesh-server:3030/api/freellmapi-proxy/v1`).
- `GOOGLE_API_KEY`: Gemini API key.
- `GITEA_TOKEN`: Gitea webhook/auth token.
- `SEARXNG_URL`: SearXNG search engine instance URL.
- `OLLAMA_URL`: Ollama local model endpoint.
- `NEO4J_URI`: Neo4j graph database endpoint.

### Custom LLM Provider Setup (FreeLLMAPI Proxy)

To configure the Hermes agent to route requests through the FreeLLMAPI proxy, copy the configuration template [config.yaml.example](file:///home/andre/AntiGravity/AIMindMesh/aimindmesh-hermes/config.yaml.example) to `~/aimindmesh-server/hermes-data/config.yaml` on the host VPS.

The model block inside `config.yaml` should look like this:
```yaml
model:
  default: auto
  provider: custom
  base_url: http://aimindmesh-server:3030/api/freellmapi-proxy/v1
  api_key: '' # Leave blank to fallback to container's OPENAI_API_KEY env variable
```
This maps the custom model provider to the proxy endpoint and uses the container's environment variable `OPENAI_API_KEY` (populated by `FREELLMAPI_API_KEY`) for secure authentication without hardcoding keys inside the YAML.

### Network Configuration

The Hermes Agent container is configured to connect to the `wirehole_private` network with a static IP address of `HERMES_HOST_PLACEHOLDER`. This makes it accessible only within your private network alongside other services like aimindmesh-server.

### Ports

- **8642**: Hermes Agent API server (optional)
- **9119**: Web dashboard (optional)

### Volumes

- `~/.hermes`: Persistent data directory containing:
  - API keys and secrets
  - Agent configuration
  - Session history
  - Skills and memories
  - Logs

## Usage

### Starting the Service

```bash
docker compose up -d
```

### Stopping the Service

```bash
docker compose down
```

### Viewing Logs

```bash
# View all logs
docker compose logs -f

# View only gateway logs
docker compose logs -f hermes

# View only dashboard logs
docker compose logs -f hermes | grep dashboard
```

### Updating

```bash
# Pull the latest image
docker compose pull

# Recreate containers with new image
docker compose up -d
```

### Accessing the Dashboard

The web dashboard is available at `http://HERMES_HOST_PLACEHOLDER:9119` by default. For remote access:

1. **SSH tunnel (recommended for security):**
   ```bash
   ssh -L 9119:HERMES_HOST_PLACEHOLDER:9119 your-vps-ip
   ```
   Then access `http://localhost:9119` on your local machine.

2. **Access from within your network:**
   Direct access from other services in the wirehole_private network at `http://HERMES_HOST_PLACEHOLDER:9119`

3. **Reverse proxy (for production):**
   Configure nginx or similar to proxy `http://HERMES_HOST_PLACEHOLDER:9119` with authentication.

### Using Telegram

1. Get a bot token from [@BotFather](https://t.me/BotFather) on Telegram
2. Add it to your `~/.hermes/.env` file:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   ```
3. Restart the service:
   ```bash
   docker compose up -d
   ```
4. Start a chat with your bot on Telegram

## Security Considerations

1. **Dashboard Security**: The dashboard binds to 127.0.0.1 by default. Do not expose it directly to the internet without authentication.

2. **API Server**: If you enable the API server (port 8642), always set a strong API_SERVER_KEY.

3. **Environment Variables**: Store sensitive information (API keys) in `~/.hermes/.env` or use Docker secrets.

4. **Network Mode**: The default `network_mode: host` gives the container full network access. If needed, you can restrict this by using a custom network.

## Troubleshooting

### Common Issues

1. **Permission Issues**: The setup script handles setting the correct UID/GID, but if you encounter permission errors, ensure your user owns the `~/.hermes` directory.

2. **Container Not Starting**: Check the logs with `docker compose logs -f` for error messages.

3. **API Keys Not Working**: Verify your API keys are correctly set in `~/.hermes/.env`.

4. **Dashboard Not Accessible**: Ensure the dashboard is enabled (`HERMES_DASHBOARD=1`) and check if port 9119 is accessible.

### Useful Commands

```bash
# Check container status
docker ps

# Inspect a container
docker inspect hermes-agent

# Access the container shell
docker exec -it hermes-agent /bin/bash

# Check resource usage
docker stats hermes-agent
```

## Integration with Your Existing Services

This setup is designed to work alongside your existing VPS services:

- **SearXNG**: Hermes can use your local SearXNG for web search by setting `SEARXNG_URL` in the environment.
- **Ollama**: If you're running local models, set `OLLAMA_URL` to enable integration.
- **Neo4j**: For enhanced memory storage, you can configure Hermes to use your existing Neo4j instance.

## Advanced Usage

### Multiple Profiles

For running multiple independent Hermes instances, you can create multiple `docker-compose.yml` files or modify the service configuration:

```yaml
services:
  hermes-work:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-work
    restart: unless-stopped
    volumes:
      - ~/.hermes-work:/opt/data
    ports:
      - "8642:8642"
    command: ["gateway", "run"]
```

### Custom Configuration

For advanced configuration, you can create a custom `config.yaml` file in `~/.hermes` and mount it:

```yaml
services:
  hermes:
    image: nousresearch/hermes-agent:latest
    volumes:
      - ~/.hermes:/opt/data
      - ./custom-config.yaml:/opt/data/config.yaml
```

## Support

- [Hermes Agent Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Docker Documentation](https://docs.docker.com/)