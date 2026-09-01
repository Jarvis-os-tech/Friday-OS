"""
Memory Manager — unified search + synthesis over Obsidian vault + Hermes state.
For continuous listening: every final transcript is already in Conversations/*.md via obsidian_writer.
This module provides retrieval for the brain.
"""

import os
import re
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

from .obsidian_writer import get_vault_path, ensure_vault

# reuse hermes home resolution if available
try:
    from hermes_constants import get_hermes_home
    HERMES_HOME = get_hermes_home()
except ImportError:
    HERMES_HOME = Path.home() / ".hermes"

def _grep_vault(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Simple grep over vault markdown files — no embeddings needed initially."""
    vault = get_vault_path()
    if not vault.exists():
        return []
    # naive case-insensitive search
    q = query.lower()
    hits = []
    for md in vault.rglob("*.md"):
        try:
            text = md.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if q in text.lower():
            # extract snippet around match
            idx = text.lower().index(q)
            start = max(0, idx - 200)
            end = min(len(text), idx + len(query) + 200)
            snippet = text[start:end].replace("\n", " ")
            hits.append({
                "path": str(md.relative_to(vault)),
                "full_path": str(md),
                "snippet": snippet,
                "score": 1.0,
            })
            if len(hits) >= limit:
                break
    return hits

def _search_hermes_sessions(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Try hermes session_search SQLite if available."""
    # hermes_state uses sqlite at HERMES_HOME/state.db etc.
    # We attempt FTS if possible, else skip gracefully
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from hermes_state import get_db
        db = get_db()
        # This is best-effort; hermes_state API may vary
        # fallback to simple LIKE over messages table
        cur = db.execute("SELECT session_id, role, content FROM messages WHERE content LIKE ? LIMIT ?", (f"%{query}%", limit))
        rows = cur.fetchall()
        return [{"session_id": r[0], "role": r[1], "snippet": r[2][:300], "source": "hermes_state"} for r in rows]
    except Exception:
        return []

def search_memory(query: str, limit: int = 10) -> Dict[str, Any]:
    """
    Unified search: vault grep + hermes sessions.
    Used by Brain when user asks 'remember when we...' or for RAG before answering.
    """
    vault_hits = _grep_vault(query, limit=limit)
    hermes_hits = _search_hermes_sessions(query, limit=5)
    combined = vault_hits + hermes_hits
    return {
        "query": query,
        "total": len(combined),
        "vault_hits": vault_hits,
        "hermes_hits": hermes_hits,
        "combined": combined[:limit],
    }

def get_recent_context(hours: int = 24, limit: int = 50) -> List[Dict[str, Any]]:
    """Load recent entries from Working-Memory buffer for context window."""
    vault = get_vault_path()
    buffer = vault / "Working-Memory" / "live_stream_buffer.jsonl"
    if not buffer.exists():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    results = []
    try:
        lines = buffer.read_text(encoding="utf-8", errors="ignore").strip().split("\n")
        for line in lines[-limit*2:]:  # scan last N
            try:
                rec = json.loads(line)
                ts = datetime.fromisoformat(rec["ts"])
                if ts >= cutoff:
                    results.append(rec)
            except Exception:
                continue
        return results[-limit:]
    except Exception:
        return []

def get_conversation_history(date: Optional[str] = None) -> str:
    vault = get_vault_path()
    if date is None:
        date = datetime.now().astimezone().strftime("%Y-%m-%d")
    path = vault / "Conversations" / f"{date}.md"
    if not path.exists():
        return f"No conversations for {date}"
    return path.read_text(encoding="utf-8", errors="ignore")

def synthesize_daily(date: Optional[str] = None) -> str:
    """Create daily synthesis from today's conversations — called by cron at 22:00."""
    vault = ensure_vault()
    if date is None:
        date = datetime.now().astimezone().strftime("%Y-%m-%d")
    conv = get_conversation_history(date)
    # naive synthesis: extract bullet points for now
    # In production, this would call LLM via omniroute
    lines = [l.strip() for l in conv.split("\n") if l.strip().startswith("###") or len(l.strip())>20]
    summary = f"# Daily Synthesis — {date}\n\nTotal entries: {conv.count('###')}\n\n"
    summary += "Key moments:\n" + "\n".join(f"- {l[:120]}" for l in lines[:20])
    # write to Daily-Logs
    from .obsidian_writer import update_daily_log
    update_daily_log(summary, date)
    return summary

def add_memory_entry(content: str, target: str = "memory") -> Dict[str, Any]:
    """
    Mirror hermes memory_tool: add to vault + hermes memories/ if available.
    target: 'memory' (agent notes) or 'user' (user profile)
    """
    # vault
    from .obsidian_writer import write_core_memory
    key = f"auto_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{target}"
    write_core_memory(key, content)
    # also try hermes memory store
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.memory_tool import MemoryStore
        store = MemoryStore()
        # MemoryStore works via tool; we directly append to file for simplicity
        mem_dir = HERMES_HOME / "memories"
        mem_file = mem_dir / ("MEMORY.md" if target == "memory" else "USER.md")
        existing = mem_file.read_text(encoding="utf-8") if mem_file.exists() else ""
        # § delimiter per memory_tool.py:16
        new_content = existing + ("\n§\n" + content if existing else content)
        mem_file.parent.mkdir(parents=True, exist_ok=True)
        mem_file.write_text(new_content, encoding="utf-8")
        return {"success": True, "vault_key": key, "hermes": str(mem_file)}
    except Exception as e:
        return {"success": True, "vault_key": key, "hermes_error": str(e)}
