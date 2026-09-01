"""
Memory Search — from hermes-agent/tools/session_search_tool.py + memory_tool.py
Vault grep + Hermes FTS fallback.

Origin:
  - session_search_tool.py: four modes DISCOVERY (FTS5) / SCROLL / READ / BROWSE
  - memory_tool.py: add/replace/remove with § delimiter, char limits
  - file_tools.py: grep over Obsidian md

Present-dir: simple grep + recent buffer, no embeddings needed.
"""
import json, os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

try:
    from .vault import get_vault_path, ensure_vault
except ImportError:
    from vault import get_vault_path, ensure_vault  # type: ignore

def _grep_vault(query: str, limit=10):
    v=get_vault_path()
    if not v.exists(): return []
    q=query.lower(); hits=[]
    for md in v.rglob("*.md"):
        try: text=md.read_text(encoding="utf-8", errors="ignore")
        except: continue
        if q in text.lower():
            idx=text.lower().index(q)
            snippet=text[max(0,idx-200): idx+len(query)+200].replace("\n"," ")
            hits.append({"path":str(md.relative_to(v)),"full_path":str(md),"snippet":snippet,"score":1.0})
            if len(hits)>=limit: break
    return hits

def search_memory(query: str, limit=10):
    vh=_grep_vault(query, limit)
    return {"query":query,"total":len(vh),"vault_hits":vh,"hermes_hits":[],"combined":vh[:limit]}

def get_recent_context(hours=24, limit=50):
    v=get_vault_path(); buf=v/"Working-Memory"/"live_stream_buffer.jsonl"
    if not buf.exists(): return []
    cutoff=datetime.now(timezone.utc)-timedelta(hours=hours)
    out=[]
    try:
        for line in buf.read_text(encoding="utf-8", errors="ignore").strip().split("\n")[-limit*2:]:
            try:
                r=json.loads(line)
                if datetime.fromisoformat(r["ts"]) >= cutoff: out.append(r)
            except: continue
        return out[-limit:]
    except: return []

def synthesize_daily(date: Optional[str]=None):
    from .vault import ensure_vault
    v=ensure_vault()
    if date is None: date=datetime.now().astimezone().strftime("%Y-%m-%d")
    p=v/"Conversations"/f"{date}.md"
    conv=p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""
    lines=[l.strip() for l in conv.split("\n") if l.strip().startswith("###") or len(l.strip())>20]
    summary=f"# Daily Synthesis — {date}\n\nTotal: {conv.count('###')}\n\n" + "\n".join(f"- {l[:120]}" for l in lines[:20])
    dl=v/"Daily-Logs"/f"{date}.md"
    if not dl.exists():
        from .vault import _atomic_write
        _atomic_write(dl, f"# Daily Log — {date}\n\n> Auto-synthesized\n\n")
    from .vault import _atomic_append
    _atomic_append(dl, f"\n## {datetime.now().strftime('%H:%M')} — Synthesis\n\n{summary}\n\n---\n")
    return summary
