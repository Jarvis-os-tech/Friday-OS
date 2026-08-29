---
name: composio-asana
category: composio-mcp
description: "Autonomous Asana Project Management automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Asana Project Management Skill Guide

Project portfolios, task dependencies, milestone tracking, and team assignees.

## Capabilities
- Multi-step tool discovery and execution on Asana Project Management
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Asana Project Management:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "asana"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "asana"`
3. Execute the matched tool using `composio_execute_action` with required fields.
