---
name: composio-discord
category: composio-mcp
description: "Autonomous Discord Community Hub automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Discord Community Hub Skill Guide

Server announcements, bot message triggers, guild management, and voice coordination.

## Capabilities
- Multi-step tool discovery and execution on Discord Community Hub
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Discord Community Hub:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "discord"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "discord"`
3. Execute the matched tool using `composio_execute_action` with required fields.
