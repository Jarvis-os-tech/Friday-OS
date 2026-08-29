---
name: composio-googlemeet
category: composio-mcp
description: "Autonomous Google Meet automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Meet Skill Guide

Instant meeting creation, conference space provisioning, and video link generation.

## Capabilities
- Multi-step tool discovery and execution on Google Meet
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Meet:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googlemeet"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googlemeet"`
3. Execute the matched tool using `composio_execute_action` with required fields.
