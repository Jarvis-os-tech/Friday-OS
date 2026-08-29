---
name: composio-gitlab
category: composio-mcp
description: "Autonomous GitLab DevOps Hub automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# GitLab DevOps Hub Skill Guide

Merge request automation, repository commits, pipeline triggers, and issue boards.

## Capabilities
- Multi-step tool discovery and execution on GitLab DevOps Hub
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving GitLab DevOps Hub:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "gitlab"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "gitlab"`
3. Execute the matched tool using `composio_execute_action` with required fields.
