---
name: composio-youtube
category: composio-mcp
description: "Autonomous YouTube Creator Suite automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# YouTube Creator Suite Skill Guide

Video metadata editing, playlist management, transcript extraction, and stats.

## Capabilities
- Multi-step tool discovery and execution on YouTube Creator Suite
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving YouTube Creator Suite:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "youtube"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "youtube"`
3. Execute the matched tool using `composio_execute_action` with required fields.
