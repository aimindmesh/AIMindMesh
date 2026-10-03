# AIMindMesh Client (desktop)

Tauri 2 + React 19 desktop client of the AIMindMesh ecosystem:

- **Control center** for the AIMindMesh Server: chat, feed, knowledge graph and wiki, AI tasks, auto-evolution proposals, AI organization, Kasm, logs and the admin panel.
- **Resource peer**: registers the PC as a `pc_client` node (`src-tauri/src/node_agent.rs`) and lends the local Ollama instance to the mesh.

## Development

```bash
npm install
npm run tauri dev     # desktop app
npx tsc --noEmit      # type-check (also run in CI)
```

The server URL and API key are stored in the Tauri configuration (default server `http://10.2.0.1:3030`, reached over the WireGuard VPN).
HTTP types shared with the server come from `aimindmesh-server/src/types/api.ts` through the `@aimindmesh/api-types` path alias.

See the repository's `DEVELOPMENT_GUIDE.md` and `TESTING.md` for the full setup.
