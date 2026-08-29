---
name: composio-notion
category: composio-mcp
description: "Autonomous Notion Workspace automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Notion Workspace Skill Guide

Autonomous database querying, block editing, rich documentation, and page creation.

## Capabilities
- Multi-step tool discovery and execution on Notion Workspace
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Notion Workspace:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "notion"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "notion"`
3. Execute the matched tool using `composio_execute_action` with required fields.
