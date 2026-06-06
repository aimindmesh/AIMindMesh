---
name: kasm-automation
version: 1.2.0
description: Autonomous interaction with Kasm Workspaces including GUI automation and Gitea integration.
trigger: explicit
---
# Kasm Automation Skill (v1.2.0)

## Overview
Control Kasm Workspaces via HTTP requests. Now supports GUI interaction via `xdotool` and full Gitea development loop.

## Target API
- **Base URL**: `http://host.docker.internal:3030/api/kasm`
- **Auth**: Header `-H "X-API-Key: $AI_COMPANION_API_KEY"`

## Operational Commands

### 1. GUI Interaction (xdotool)
Use `exec` to send mouse/keyboard commands to the remote desktop:
```bash
# Click at coordinates
curl -s -X POST http://host.docker.internal:3030/api/kasm/exec \
  -d '{"kasmId": "ID", "cmd": "DISPLAY=:1 xdotool mousemove 500 500 click 1"}'
# Type text
curl -s -X POST http://host.docker.internal:3030/api/kasm/exec \
  -d '{"kasmId": "ID", "cmd": "DISPLAY=:1 xdotool type --delay 100 \"Hello World\""}'
```

### 2. Autonomous Development Loop (Gitea Sync)
To work on code from Gitea inside a Kasm container:
1. **Clone**: `git clone http://user:$GITEA_TOKEN@$(echo $GITEA_URL | sed 's|http://||')/user/repo.git`
2. **Modify**: Use `sed` or `echo` via `exec` to change files.
3. **Commit & Push**:
```bash
curl -s -X POST http://host.docker.internal:3030/api/kasm/exec \
  -d '{"kasmId": "ID", "cmd": "cd repo && git config user.name \"Server Agent\" && git config user.email \"agent@aimindmesh.local\" && git add . && git commit -m \"Commit message\" && git push"}'
```

## Strategy: Autonomous Developer
When asked to develop code:
1. Find a suitable image (e.g., `ubuntu-focal-desktop`).
2. Spawn the session.
3. Clone the Gitea repository into the `/tmp` or `$HOME` directory of the container.
4. Execute the required code changes or tests.
5. Push the changes back to Gitea.
6. Report the commit URL or status to the user.
7. Capture a screenshot of the IDE/Desktop to show progress.
