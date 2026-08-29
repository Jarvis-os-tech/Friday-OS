---
name: composio-linkedin
category: composio-mcp
description: "Autonomous LinkedIn Network automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# LinkedIn Network Skill Guide

Professional profile insights, network outreach, post creation, and job search.

## Capabilities
- Multi-step tool discovery and execution on LinkedIn Network
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving LinkedIn Network:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "linkedin"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "linkedin"`
3. Execute the matched tool using `composio_execute_action` with required fields.
