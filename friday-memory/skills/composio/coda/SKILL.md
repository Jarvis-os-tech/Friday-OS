---
name: composio-coda
category: composio-mcp
description: "Autonomous Coda All-in-One Doc automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Coda All-in-One Doc Skill Guide

Interactive canvas docs, embedded tables, formula triggers, and automation buttons.

## Capabilities
- Multi-step tool discovery and execution on Coda All-in-One Doc
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Coda All-in-One Doc:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "coda"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "coda"`
3. Execute the matched tool using `composio_execute_action` with required fields.
