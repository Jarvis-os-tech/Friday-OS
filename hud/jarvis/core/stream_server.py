"""
Stream Server — WebSocket ingest for Google AI Studio continuous listening.
You build voice in Studio. This server receives EVERY final transcript + tool calls.

Protocol expected from Studio:
  { "type": "transcript.final", "text": "...", "session_id": "...", "ts": "..." }
  { "type": "transcript.partial", "text": "..." }  -> buffered, not persisted
  { "type": "tool_call", "name": "...", "arguments": {...}, "call_id": "..." }
  { "type": "session.start", "session_id": "..." }
  { "type": "session.end" }

Responses sent back:
  { "type": "tool_result", "call_id": "...", "result": {...} }
  { "type": "brain.thinking", "text": "..." }
  { "type": "memory.saved", "path": "..." }
  { "type": "error", "message": "..." }

Run: python -m core.stream_server --port 8001
Studio points WebSocket to ws://localhost:8001/ws
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

# FastAPI + uvicorn are lightweight; if not installed, fallback to stdlib http
try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
    from fastapi.responses import JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

# local imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from memory.obsidian_writer import write_conversation, git_commit_vault
from memory.memory_manager import search_memory, get_recent_context
from jarvis_tools.bridge import execute_tool, get_tool_schemas_for_gemini, get_tool_schemas_for_openai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jarvis.stream")

# ---- optional LLM reasoning (separate from Studio voice LLM) ----
# For cases where Studio forwards "need reasoning" -> we call local/cloud LLM
def _call_reasoning_llm(prompt: str, context: Optional[str] = None) -> str:
    """
    Calls reasoning LLM via omniroute (localhost:20128) or Gemini fallback.
    This is NOT the voice LLM — this is background reasoning.
    """
    # Try omniroute first (auto/offline)
    try:
        import requests
        # omniroute OpenAI-compatible endpoint
        base = os.getenv("JARVIS_REASONING_URL", "http://localhost:20128/v1")
        key = os.getenv("HERMES_CUSTOM_LOCALHOST_20128_API_KEY") or os.getenv("OPENAI_API_KEY") or "dummy"
        messages = []
        if context:
            messages.append({"role": "system", "content": f"Context from memory:\n{context[:6000]}"})
        messages.append({"role": "user", "content": prompt})
        r = requests.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": os.getenv("JARVIS_REASONING_MODEL", "auto/best-fast"), "messages": messages, "max_tokens": 1024},
            timeout=20,
        )
        if r.ok:
            return r.json()["choices"][0]["message"]["content"]
        else:
            logger.warning(f"reasoning LLM failed {r.status_code}: {r.text[:500]}")
    except Exception as e:
        logger.debug(f"reasoning LLM error: {e}")
    # Fallback: no LLM, return heuristic
    return f"[no reasoning LLM — you said: {prompt[:200]}]"

if HAS_FASTAPI:
    app = FastAPI(title="JARVIS Stream Server", version="1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "continuous": True, "vault": str(Path.home() / "Obsidian" / "Jarvis-Memory-Vault"), "time": datetime.now(timezone.utc).isoformat()}

    @app.get("/tools/schemas")
    async def tool_schemas(provider: str = "gemini"):
        if provider == "openai":
            return {"tools": get_tool_schemas_for_openai()}
        return {"functionDeclarations": get_tool_schemas_for_gemini()}

    @app.get("/memory/search")
    async def memory_search(q: str, limit: int = 10):
        return search_memory(q, limit=limit)

    @app.get("/memory/recent")
    async def recent(hours: int = 2, limit: int = 20):
        return {"results": get_recent_context(hours=hours, limit=limit)}

    @app.post("/ingest/transcript")
    async def ingest_transcript(request: Request):
        """REST fallback for Studio if WebSocket not used."""
        body = await request.json()
        text = body.get("text", "")
        role = body.get("role", "user")
        session_id = body.get("session_id", "rest")
        if not text:
            return JSONResponse({"error": "missing text"}, status_code=400)
        path = write_conversation(role, text, session_id=session_id, meta=body.get("meta"))
        return {"saved": True, "path": str(path)}

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        session_id = f"ws_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        logger.info(f"Studio connected: {session_id}")
        # notify UI if needed
        partial_buffer = ""
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    # plain text transcript
                    msg = {"type": "transcript.final", "text": raw, "role": "user", "session_id": session_id}
                mtype = msg.get("type", "transcript.final")

                if mtype == "session.start":
                    session_id = msg.get("session_id", session_id)
                    await ws.send_text(json.dumps({"type": "session.ack", "session_id": session_id}))
                    continue

                elif mtype == "transcript.partial":
                    # buffer but don't persist — keeps continuous feel without spam
                    partial_buffer = msg.get("text", "")
                    # optionally echo thinking
                    # await ws.send_text(json.dumps({"type": "partial.ack", "text": partial_buffer}))
                    continue

                elif mtype in ("transcript.final", "transcript", "user_message"):
                    text = msg.get("text") or msg.get("transcript") or msg.get("content") or ""
                    role = msg.get("role", "user")
                    if not text.strip():
                        continue
                    # 1. NEVER LOSE DATA — write immediately
                    try:
                        vault_path = write_conversation(role, text, session_id=session_id, meta={"raw_type": mtype})
                        await ws.send_text(json.dumps({"type": "memory.saved", "path": str(vault_path)}))
                    except Exception as e:
                        logger.error(f"vault write failed: {e}")
                        await ws.send_text(json.dumps({"type": "error", "message": f"vault write failed: {e}"}))

                    # 2. Optional: RAG + reasoning if message looks like a question/command
                    # We don't block the stream; we respond async
                    # Studio can decide to speak the result or ignore
                    lower = text.lower()
                    is_question = any(k in lower for k in ["?", "remember", "search", "find", "what", "who", "how", "jarvis", "can you", "do you"])
                    if is_question and len(text.split()) > 2:
                        # fetch memory context
                        try:
                            mem = search_memory(text, limit=5)
                            ctx = "\n".join(h["snippet"] for h in mem.get("vault_hits", [])[:3])
                        except Exception:
                            ctx = ""
                        # call reasoning LLM in background task so we don't block next transcript
                        asyncio.create_task(_handle_reasoning(ws, text, ctx, session_id))

                elif mtype == "tool_call":
                    name = msg.get("name") or msg.get("tool") or ""
                    args = msg.get("arguments") or msg.get("args") or {}
                    call_id = msg.get("call_id") or msg.get("id") or "unknown"
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {}
                    logger.info(f"tool_call {name} {args}")
                    result = execute_tool(name, args)
                    await ws.send_text(json.dumps({"type": "tool_result", "call_id": call_id, "name": name, "result": result}))
                    # also log tool result to vault
                    try:
                        write_conversation("tool", f"{name}({json.dumps(args)[:300]}) -> {json.dumps(result)[:800]}", session_id=session_id, meta={"tool": name})
                    except Exception:
                        pass

                elif mtype == "assistant_message":
                    # Studio's own TTS output — log it too so we have full history
                    text = msg.get("text") or msg.get("content") or ""
                    if text:
                        write_conversation("jarvis", text, session_id=session_id)

                elif mtype == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "ts": datetime.now(timezone.utc).isoformat()}))

                else:
                    logger.warning(f"unknown msg type: {mtype}: {msg}")
                    await ws.send_text(json.dumps({"type": "error", "message": f"unknown type {mtype}"}))

        except WebSocketDisconnect:
            logger.info(f"Studio disconnected: {session_id}")
            # commit vault on disconnect
            try:
                git_commit_vault(f"vault: session {session_id} ended")
            except Exception:
                pass
        except Exception as e:
            logger.exception(f"ws error: {e}")
            try:
                await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
            except Exception:
                pass

    async def _handle_reasoning(ws: WebSocket, text: str, ctx: str, session_id: str):
        try:
            await ws.send_text(json.dumps({"type": "brain.thinking", "for": text[:100]}))
            answer = await asyncio.to_thread(_call_reasoning_llm, text, ctx)
            await ws.send_text(json.dumps({"type": "brain.answer", "text": answer, "for": text[:100]}))
            # save assistant answer to vault as well
            write_conversation("jarvis", answer, session_id=session_id, meta={"reasoning_for": text[:200]})
        except Exception as e:
            logger.error(f"reasoning failed: {e}")

    def main():
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--port", type=int, default=8001)
        parser.add_argument("--host", type=str, default="0.0.0.0")
        args = parser.parse_args()
        logger.info(f"Starting JARVIS Stream Server on {args.host}:{args.port}")
        logger.info(f"Vault: {Path.home() / 'Obsidian' / 'Jarvis-Memory-Vault'}")
        logger.info(f"Tools: {len(get_tool_schemas_for_gemini())} schemas exposed at /tools/schemas")
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")

    if __name__ == "__main__":
        main()

else:
    # Fallback without FastAPI — simple explanation
    def main():
        print("FastAPI not installed. Install with: pip install fastapi uvicorn")
        print("Then run: python -m core.stream_server --port 8001")

    if __name__ == "__main__":
        main()
