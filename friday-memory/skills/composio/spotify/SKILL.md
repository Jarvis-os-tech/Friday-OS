---
name: composio-spotify
category: composio-mcp
description: "Autonomous Spotify Media Controller automation and multi-step action execution via Composio MCP."
author: J.A.R.V.I.S. Composio Hub
status: initiated
---

# Spotify Media Controller Skill Guide

Control music playback, search songs/albums, queue tracks, and playback playlists.

## Capabilities
- Multi-step tool discovery and execution on Spotify Media Controller
- Autonomous error handling and parameter resolution
- Zero-configuration OAuth token management via Composio MCP

## Execution Protocol
When the user requests an action involving Spotify Media Controller:
1. Use `composio_search_apps` with `use_case: "<intent>" toolkit: "spotify"`
2. Check if the toolkit is connected. If not, trigger `composio_connect_app` with `toolkit: "spotify"`
3. Execute the matched tool using `composio_execute_action` with required fields.
