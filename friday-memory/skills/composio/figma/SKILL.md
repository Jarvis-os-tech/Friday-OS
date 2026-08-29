---
name: composio-figma
category: composio-mcp
description: "Autonomous Figma Design Hub automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Figma Design Hub Skill Guide

Inspect design tokens, frame dimensions, component exports, and team comments.

## Capabilities
- Multi-step tool discovery and execution on Figma Design Hub
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Figma Design Hub:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "figma"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "figma"`
3. Execute the matched tool using `composio_execute_action` with required fields.
