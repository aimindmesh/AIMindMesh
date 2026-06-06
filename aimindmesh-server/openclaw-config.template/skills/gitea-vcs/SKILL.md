---
name: gitea-vcs
version: 1.1.0
description: Read-only access to Gitea repositories, files, and documentation.
trigger: explicit
---
# Gitea VCS Skill (READ-ONLY)

Use this skill to access the user's projects on Gitea for research and context. **This skill is strictly READ-ONLY.**

## Capabilities
1. **List Repositories**: Get a list of all accessible repositories.
   - Endpoint: `GET /api/v1/user/repos`
2. **Search Files**: Search for files in a specific repository.
   - Endpoint: `GET /api/v1/repos/{owner}/{repo}/search`
3. **Read File Content**: Get the raw content of a file or documentation.
   - Endpoint: `GET /api/v1/repos/{owner}/{repo}/raw/{filepath}`

## Ingestion Rules
- When the mesh is using **Gemini (Cloud)**: Content access is limited to `README.md` and the `docs/` folder.
- When the mesh is using **Ollama (Server Local)**: Full repository access is available for deep context extraction.

## Environment Requirements
- `GITEA_URL`: Base URL of the Gitea instance (e.g., http://<gitea-host>:3000).
- `GITEA_TOKEN`: API Access Token.

## Usage Patterns
- "Quali progetti ho su Gitea?"
- "Leggi il README del progetto AIMindMesh."
- "Cerca nel repo AIMindMesh la documentazione tecnica."
