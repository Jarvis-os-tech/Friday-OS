---
name: composio-googlecalendar
category: composio-mcp
description: "Autonomous Google Calendar automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Calendar Skill Guide

Intelligent meeting scheduling, event conflict checking, availability querying, and reminders.

## Capabilities
- Multi-step tool discovery and execution on Google Calendar
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Calendar:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googlecalendar"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googlecalendar"`
3. Execute the matched tool using `composio_execute_action` with required fields.
