---
name: composio-slack
category: composio-mcp
description: "Autonomous Slack Messaging automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Slack Messaging Skill Guide

Channel broadcasting, direct DMs, thread replies, presence management, and alerts.

## Capabilities
- Multi-step tool discovery and execution on Slack Messaging
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Slack Messaging:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "slack"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "slack"`
3. Execute the matched tool using `composio_execute_action` with required fields.
