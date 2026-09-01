# JARVIS Backend — Continuous Listening (No Voice Layer)

Voice layer is built in **Google AI Studio (Gemini Live)**. This backend is the persistent brain that **never loses data**.

## Architecture

```
Google AI Studio (Gemini Live) -- continuous transcript / tool_call --> Stream Server (ws://localhost:8001/ws)
                                                                      -> Obsidian Vault (~/Obsidian/Jarvis-Memory-Vault)
                                                                      -> Memory Manager (search + synthesis)
                                                                      -> Tool Bridge (Hermes + OpenClaw tools)
                                                                      -> Brain (routing + delegation)
```

## Quick Start

```bash
pip install -r requirements.txt
python -m core.stream_server --port 8001
# Studio: connect WebSocket to ws://localhost:8001/ws
# Send: {"type":"transcript.final","text":"remember that my API key is xyz","role":"user"}
# Check: ~/Obsidian/Jarvis-Memory-Vault/Conversations/YYYY-MM-DD.md
```

## API

- `GET /health` — status
- `GET /tools/schemas?provider=gemini|openai` — function declarations for Studio
- `GET /memory/search?q=...` — vault grep
- `GET /memory/recent?hours=2&limit=20` — recent stream buffer
- `POST /ingest/transcript` — REST fallback `{"text","role","session_id"}`
- `WS /ws` — main continuous stream (see `core/stream_server.py` protocol)

## Vault — Never Lose Data

Every `transcript.final` is appended atomically to:
- `Conversations/YYYY-MM-DD.md` (human readable)
- `Working-Memory/live_stream_buffer.jsonl` (machine replay)

Git auto-commit every 5min via cron + on WS disconnect.

## Studio Integration

1. In Google AI Studio, add tool declarations: `GET http://localhost:8001/tools/schemas?provider=gemini`
2. On each turn, Studio forwards `transcript.final` to `ws://localhost:8001/ws`
3. When Studio emits `tool_call`, server executes via `tools/bridge.py` and returns `tool_result`
4. You paste new voice codes later — no changes needed here

## Hermes / OpenClaw Reuse

- `tools/bridge.py` reuses `~/.hermes/hermes-agent/tools/registry.py` + `~/.openclaw` gateway skills
- `orchestrator/brain.py` mirrors `~/.hermes/SOUL.md` orchestrator + `~/.hermes/config.yaml:123` voice.s2s config
- `memory/obsidian_writer.py` uses `hermes-agent/utils.py:atomic_write_text` pattern (fsync + os.replace)
- Cron jobs mirror `SOUL.md:107` schedule — install via `python -m orchestrator.cron_bridge`

## Next

Give your Studio voice layer codes when ready — paste the WebSocket client snippet, point it at `/ws`, and continuous listening will be end-to-end.
