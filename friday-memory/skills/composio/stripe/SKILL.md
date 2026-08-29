---
name: composio-stripe
category: composio-mcp
description: "Autonomous Stripe Payments automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Stripe Payments Skill Guide

Customer balance search, invoice creation, subscription tracking, and payment intents.

## Capabilities
- Multi-step tool discovery and execution on Stripe Payments
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Stripe Payments:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "stripe"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "stripe"`
3. Execute the matched tool using `composio_execute_action` with required fields.
