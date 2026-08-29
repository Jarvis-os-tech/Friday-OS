---
name: composio-telegram
category: composio-mcp
description: "Autonomous Telegram Bot & Channels automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Telegram Bot & Channels Skill Guide

Send encrypted messages, channel broadcasts, document attachments, and bot alerts.

## Capabilities
- Multi-step tool discovery and execution on Telegram Bot & Channels
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Telegram Bot & Channels:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "telegram"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "telegram"`
3. Execute the matched tool using `composio_execute_action` with required fields.
