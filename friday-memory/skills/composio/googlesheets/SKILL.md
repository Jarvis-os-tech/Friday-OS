---
name: composio-googlesheets
category: composio-mcp
description: "Autonomous Google Sheets automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Google Sheets Skill Guide

Spreadsheet manipulation, formula insertion, tabular data logging, and row appending.

## Capabilities
- Multi-step tool discovery and execution on Google Sheets
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Google Sheets:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "googlesheets"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "googlesheets"`
3. Execute the matched tool using `composio_execute_action` with required fields.
