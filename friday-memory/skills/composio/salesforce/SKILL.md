---
name: composio-salesforce
category: composio-mcp
description: "Autonomous Salesforce Enterprise CRM automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Salesforce Enterprise CRM Skill Guide

Leads, opportunities, enterprise accounts, contact management, and custom objects.

## Capabilities
- Multi-step tool discovery and execution on Salesforce Enterprise CRM
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Salesforce Enterprise CRM:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "salesforce"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "salesforce"`
3. Execute the matched tool using `composio_execute_action` with required fields.
