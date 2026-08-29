---
name: composio-canva
category: composio-mcp
description: "Autonomous Canva Design Studio automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Canva Design Studio Skill Guide

Design generation, template search, graphic export, and visual asset workflows.

## Capabilities
- Multi-step tool discovery and execution on Canva Design Studio
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Canva Design Studio:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "canva"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "canva"`
3. Execute the matched tool using `composio_execute_action` with required fields.
