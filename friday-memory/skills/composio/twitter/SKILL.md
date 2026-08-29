---
name: composio-twitter
category: composio-mcp
description: "Autonomous X / Twitter automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# X / Twitter Skill Guide

Publish tweets, threads, monitor mentions, analyze engagement, and audience metrics.

## Capabilities
- Multi-step tool discovery and execution on X / Twitter
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving X / Twitter:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "twitter"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "twitter"`
3. Execute the matched tool using `composio_execute_action` with required fields.
