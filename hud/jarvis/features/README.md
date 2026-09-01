# JARVIS Features — Extracted from Hermes & OpenClaw

All modules in `features/` are isolated, reusable JARVIS capabilities taken directly from your existing stacks. Present-dir self-contained, no voice layer.

| Feature | Source | File | Purpose |
|---|---|---|---|
| **Proactive** | `~/.hermes/SOUL.md:107` + `hermes-agent/tools/cronjob_tools.py` | `proactive/scheduler.py` | Morning brief, vault commit, synthesis loops via Hermes cron |
| **Delegation** | `hermes-agent/tools/delegate_tool.py` + `async_delegation.py` | `delegation/delegate.py` | Spawn specialist agents (trading/research/content/dev) in isolated context |
| **Memory Vault** | `hermes-agent/tools/memory_tool.py` + `utils.py:atomic_write_text` + `hermes-agent/tools/session_search_tool.py` + `~/Obsidian/Jarvis-Memory-Vault` | `memory/vault.py` `memory/search.py` | Never-lose-data Obsidian writer + grep/FTS search |
| **Tools Bridge** | `hermes-agent/tools/registry.py` + `model_tools.py:get_tool_definitions` + `~/.openclaw/gateway` | `tools_bridge/bridge.py` | Expose 26+ Hermes/OpenClaw tools as Gemini Live functionDeclarations |
| **Orchestrator** | `hermes-agent/SOUL.md:20` Fleet + `orchestrator/brain.py` | `orchestrator/brain.py` | Intent routing (memory_write/search/delegate/tool) + proactive jobs |
| **System Gateway** | `~/.openclaw/openclaw.json:32` `gateway.mode:local` + `gateway/` + `hermes-agent/tools/terminal_tool.py` `file_tools.py` | `system/gateway.py` | Linux-native system control (file/terminal/computer_use/browser) |

Each file header cites exact origin path and lines, so you can diff against upstream.
All import from present dir — `from features.memory.vault import write_conversation` — no external hermes install required, but will delegate to hermes when available.
