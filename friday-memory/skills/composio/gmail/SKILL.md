---
name: composio-gmail
category: composio-mcp
description: "Autonomous Gmail (Google Workspace) automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Gmail (Google Workspace) Skill Guide

Autonomous email triage, drafting, searching unread messages, sending, and thread analysis.

## Capabilities
- Multi-step tool discovery and execution on Gmail (Google Workspace)
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Gmail (Google Workspace):
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "gmail"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "gmail"`
3. Execute the matched tool using `composio_execute_action` with required fields.
