# Tools Configuration

## Web Search
OpenClaw uses this configuration to interface with search engines.

- **Provider**: searxng
- **Base URL**: http://10.2.0.52:8080
- **Categories**: general,news,science
- **Language**: it-IT
- **Safe Search**: Off (0)

## System Integration
When an agentic task requires real-time information, the Server Agent will autonomously invoke the `web_search` tool through this native integration.
