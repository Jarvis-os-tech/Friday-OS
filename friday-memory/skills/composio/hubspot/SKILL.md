---
name: composio-hubspot
category: composio-mcp
description: "Autonomous HubSpot CRM automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# HubSpot CRM Skill Guide

Contact lifecycle tracking, deal pipeline stages, company records, and sales tasks.

## Capabilities
- Multi-step tool discovery and execution on HubSpot CRM
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving HubSpot CRM:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "hubspot"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "hubspot"`
3. Execute the matched tool using `composio_execute_action` with required fields.
