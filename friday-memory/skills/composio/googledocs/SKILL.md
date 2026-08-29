---
name: composio-googledocs
category: composio-mcp
description: "Autonomous Google Docs automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Docs Skill Guide

Autonomous document creation, structured formatting, text insertion, and summary exporting.

## Capabilities
- Multi-step tool discovery and execution on Google Docs
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Docs:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googledocs"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googledocs"`
3. Execute the matched tool using `composio_execute_action` with required fields.
