---
name: composio-clickup
category: composio-mcp
description: "Autonomous ClickUp Workspace automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# ClickUp Workspace Skill Guide

Task hierarchy management, time tracking, custom statuses, and sprint folders.

## Capabilities
- Multi-step tool discovery and execution on ClickUp Workspace
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving ClickUp Workspace:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "clickup"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "clickup"`
3. Execute the matched tool using `composio_execute_action` with required fields.
