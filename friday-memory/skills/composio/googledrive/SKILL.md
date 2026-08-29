---
name: composio-googledrive
category: composio-mcp
description: "Autonomous Google Drive automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Drive Skill Guide

File search, document uploads, shared folder organization, and cloud storage management.

## Capabilities
- Multi-step tool discovery and execution on Google Drive
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Drive:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googledrive"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googledrive"`
3. Execute the matched tool using `composio_execute_action` with required fields.
