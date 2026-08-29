---
name: composio-linear
category: composio-mcp
description: "Autonomous Linear Issue Tracker automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Linear Issue Tracker Skill Guide

Issue creation, sprint tracking, cycle management, bug triage, and roadmap planning.

## Capabilities
- Multi-step tool discovery and execution on Linear Issue Tracker
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Linear Issue Tracker:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "linear"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "linear"`
3. Execute the matched tool using `composio_execute_action` with required fields.
