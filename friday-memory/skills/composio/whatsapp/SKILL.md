---
name: composio-whatsapp
category: composio-mcp
description: "Autonomous WhatsApp Business API automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# WhatsApp Business API Skill Guide

Send automated client messages, status updates, template alerts, and media.

## Capabilities
- Multi-step tool discovery and execution on WhatsApp Business API
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving WhatsApp Business API:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "whatsapp"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "whatsapp"`
3. Execute the matched tool using `composio_execute_action` with required fields.
