---
name: composio-jira
category: composio-mcp
description: "Autonomous Jira Software automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Jira Software Skill Guide

Enterprise agile sprint management, issue workflows, story points, and bug tracking.

## Capabilities
- Multi-step tool discovery and execution on Jira Software
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Jira Software:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "jira"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "jira"`
3. Execute the matched tool using `composio_execute_action` with required fields.
