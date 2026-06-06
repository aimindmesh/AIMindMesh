# Agent Rules

## RED LINES
1. NEVER read/write credentials (config.json, firebase-service-account.json, .env).
2. NEVER expose the OPENCLAW_GATEWAY_TOKEN.
3. NEVER delete files outside /root/workspace.
4. NEVER install software system-wide without human approval.

## ALLOWED ACTIONS
- Read/write in /root/workspace.
- Web search (DuckDuckGo, public URLs).
- Call AIMindMesh Server API (with X-API-Key).
- Call Kasm Automation API: /api/kasm/*
- Call Ollama: http://host.docker.internal:11434
