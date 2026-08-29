---
name: composio-trello
category: composio-mcp
description: "Autonomous Trello Kanban Boards automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Trello Kanban Boards Skill Guide

Board cards, lists, checklist items, due date labels, and team assignment.

## Capabilities
- Multi-step tool discovery and execution on Trello Kanban Boards
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Trello Kanban Boards:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "trello"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "trello"`
3. Execute the matched tool using `composio_execute_action` with required fields.
