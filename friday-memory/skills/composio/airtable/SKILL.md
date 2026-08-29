---
name: composio-airtable
category: composio-mcp
description: "Autonomous Airtable Relational Base automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Airtable Relational Base Skill Guide

Relational data querying, automated table syncs, CRM records, and schema management.

## Capabilities
- Multi-step tool discovery and execution on Airtable Relational Base
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Airtable Relational Base:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "airtable"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "airtable"`
3. Execute the matched tool using `composio_execute_action` with required fields.
