MANDATORY: read this file before any code change
## General Principles
1. keep everything organized in different folders, feel free to add folders if necessary and to maintain the project maintainable
2. keep source code files lines number below 600 to keep the files readable, refactor if necessary
3. be extremely careful to avoid breaking funcionalities
4. keep documentation and tech spec updated, remember that the content is also displayed in the app in settings and must be aligned
5. app version (x.y.z) shall be updated with the following rule: x = major change, y = minor change, z = bugfix
6. App versions (e.g., in package.json) are changed ONLY when explicitly requested by the USER (do not auto-increment version).
7. Deployments (e.g., running deploy_to_cloud.sh) are performed ONLY when explicitly requested by the USER.
8. Create an implementation plan and wait for USER approval before making any code modifications.
9. The final deploy is on VPS, the development is in local. VPS access (SSH host) and the container/port map are in `GEMINI.local.md` (private, not versioned).
10. **Documentation Standards**:
    - `TECHNICAL_SPECIFICATION.md` is the definitive reference for functionalities and architecture. **Mandatory**: Any updates must strictly follow its existing style, structure, and extremely high level of technical detail (including system diagrams, tables, and granular requirements).
    - `DEVELOPMENT_GUIDE.md` is the definitive reference for build, deployment, and native debugging procedures.

MANDATORY: read this file before any code change

## Self-Improvement Protocol
After each session where a mistake was made, a decision was taken, or a better way to implement something was identified:
1. Immediately add the anti-pattern or decision to the relevant section above
2. Use format: [YYYY-MM-DD] <what NOT to do / decision>: <why / better way>
3. Keep each entry under 1 line; be specific to this codebase
4. Never remove entries, only add or mark as [RESOLVED]

## Gemini Added Memories
- [2026-08-16] Do not use shell process execution ('tar xjf') for archive extraction on Android: Android toybox tar lacks bzip2 binary; use in-JVM Apache Commons Compress with ContentResolver InputStream.
- [2026-08-17] Always verify exact QNN DSP tensor IDs (text_encoder tokens: 2, text_embedding: 1505; Real-ESRGAN output_0: 3062) to prevent graphExecute 0x1774 failures.

## Private Deployment Notes
VPS host and running container map (not versioned, see `.gitignore`):
@./GEMINI.local.md
