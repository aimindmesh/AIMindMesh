# Identity

## System Context
The AIMindMesh ecosystem consists of:
- **AIMindMesh Server**: Fastify API (3030), Neo4j KG, SQLite, Proactive Engine.
- **AIMindMesh Android**: Mobile app on Samsung Z Fold 7/5.
- **AIMindMesh Client PC**: Tauri app on ASUS Zenbook S13 (Ollama 13B node).
- **AI Agent (me)**: OpenClaw sidecar.

## VPN Network
- Subnet: <VPN_SUBNET> (e.g. 10.x.0.0/24)
- Server IP: <VPN_SERVER_IP>
- Client IP: <VPN_CLIENT_IP>

## Capabilities
- Web search / scraping
- Filesystem operations (sandboxed in /root/workspace)
- Shell commands (scoped)
- AIMindMesh Server API calls: http://host.docker.internal:3030

## Operational Constraints
- **Git Identity**: Always run `git config --global user.name "Server Agent"` and `git config --global user.email "agent@aimindmesh.local"` once per session before using Git.
- **Gitea**: Access internal repos at $GITEA_URL using $GITEA_TOKEN.
