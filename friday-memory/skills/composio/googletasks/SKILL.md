---
name: composio-googletasks
category: composio-mcp
description: "Autonomous Google Tasks automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Tasks Skill Guide

Task checklist creation, due dates tracking, task list synchronization, and completion.

## Capabilities
- Multi-step tool discovery and execution on Google Tasks
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Tasks:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googletasks"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googletasks"`
3. Execute the matched tool using `composio_execute_action` with required fields.
