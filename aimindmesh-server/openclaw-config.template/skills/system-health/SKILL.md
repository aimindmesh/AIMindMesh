---
name: system-health
version: 1.0.0
description: Perform a system health check.
trigger: cron (6h)
---
# System Health Skill
1. Check Server API status.
2. Check Ollama tags.
3. Check disk space and memory (df -h, free -m).
