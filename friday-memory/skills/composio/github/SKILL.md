---
name: composio-github
category: composio-mcp
description: "Autonomous GitHub Developer Hub automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# GitHub Developer Hub Skill Guide

Autonomous repository management, PR reviews, issue creation, Gists, and GitHub Actions.

## Capabilities
- Multi-step tool discovery and execution on GitHub Developer Hub
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving GitHub Developer Hub:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "github"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "github"`
3. Execute the matched tool using `composio_execute_action` with required fields.
