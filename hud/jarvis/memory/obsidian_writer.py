"""
Obsidian Vault Writer — never-lose-data guarantee for continuous listening.
Reuses atomic_write_text pattern from hermes-agent/utils.py:279
"""

import os
import time
import json
import hashlib
import tempfile
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any

# Default vault matches SOUL.md:46
DEFAULT_VAULT = Path.home() / "Obsidian" / "Jarvis-Memory-Vault"
FALLBACK_VAULT = Path.home() / "Obsidian" / "Jarvis-Memory"

# Directories inside vault — mirrors existing structure
DIRS = [
    "Conversations",
    "Daily-Logs",
    "Core-Memory",
    "Episodic-Memory",
    "Semantic-Memory",
    "Procedural-Memory",
    "Working-Memory",
    "Backups",
]

_lock = threading.Lock()

def get_vault_path() -> Path:
    """Resolve vault path — prefers Jarvis-Memory-Vault, falls back to Jarvis-Memory."""
    env = os.getenv("JARVIS_VAULT")
    if env:
        return Path(env).expanduser()
    if DEFAULT_VAULT.exists():
        return DEFAULT_VAULT
    if FALLBACK_VAULT.exists():
        return FALLBACK_VAULT
    return DEFAULT_VAULT

def ensure_vault() -> Path:
    vault = get_vault_path()
    for d in DIRS:
        (vault / d).mkdir(parents=True, exist_ok=True)
    return vault

# ---- atomic helpers (copied from hermes-agent/utils.py to avoid import coupling) ----
def _atomic_append(path: Path, content: str) -> None:
    """Append atomically: read + atomic_write. Safe for continuous stream."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        existing = ""
        if path.exists():
            try:
                existing = path.read_text(encoding="utf-8")
            except Exception:
                existing = ""
        new_content = existing + content
        # atomic write via temp file
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(new_content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, str(path))
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

# ---- public API ----

def write_conversation(role: str, text: str, session_id: str = "continuous", meta: Optional[Dict[str, Any]] = None) -> Path:
    """
    Append one turn to Conversations/YYYY-MM-DD.md
    Called for EVERY transcript.final from Google AI Studio.
    Format is markdown + frontmatter for later grep/session_search.
    """
    vault = ensure_vault()
    now = datetime.now(timezone.utc).astimezone()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S %Z")
    ts_iso = now.isoformat()

    # daily file
    daily = vault / "Conversations" / f"{date_str}.md"
    # ensure header
    if not daily.exists():
        header = f"# Conversations — {date_str}\n\n> Continuous listening session `{session_id}` started {ts_iso}\n\n---\n\n"
        _atomic_write(daily, header)

    # optional hash for deduplication
    h = hashlib.sha256(f"{ts_iso}:{role}:{text}".encode()).hexdigest()[:8]

    entry = f"### {time_str} — {role} `#{h}`\n\n{text}\n\n"
    if meta:
        entry += f"<details><summary>meta</summary>\n\n```json\n{json.dumps(meta, indent=2, ensure_ascii=False)}\n```\n\n</details>\n\n"
    entry += "---\n\n"

    _atomic_append(daily, entry)

    # also append to Working-Memory stream buffer for crash recovery
    buffer = vault / "Working-Memory" / "live_stream_buffer.jsonl"
    record = {"ts": ts_iso, "role": role, "text": text, "session_id": session_id, "hash": h, "meta": meta or {}}
    _atomic_append(buffer, json.dumps(record, ensure_ascii=False) + "\n")

    return daily

def write_semantic_fact(fact: str, source: str = "continuous", tags: Optional[list] = None) -> Path:
    """Store durable fact in Semantic-Memory. Called async after extraction."""
    vault = ensure_vault()
    now = datetime.now(timezone.utc).astimezone()
    slug = hashlib.sha256(fact.encode()).hexdigest()[:10]
    fname = f"{now.strftime('%Y-%m-%d')}_{slug}.md"
    path = vault / "Semantic-Memory" / fname
    tags_str = " ".join(f"#{t}" for t in (tags or []))
    content = f"# Fact — {now.isoformat()}\n\n{fact}\n\n---\n\nSource: {source}\nTags: {tags_str}\n"
    _atomic_write(path, content)
    return path

def write_episodic(event: str, title: str = "Event") -> Path:
    vault = ensure_vault()
    now = datetime.now(timezone.utc).astimezone()
    slug = hashlib.sha256(f"{now.isoformat()}:{title}".encode()).hexdigest()[:8]
    path = vault / "Episodic-Memory" / f"{now.strftime('%Y-%m-%d')}_{slug}.md"
    content = f"# {title}\n\n*When:* {now.isoformat()}\n\n{event}\n"
    _atomic_write(path, content)
    return path

def update_daily_log(summary: str, date: Optional[str] = None) -> Path:
    vault = ensure_vault()
    now = datetime.now(timezone.utc).astimezone()
    d = date or now.strftime("%Y-%m-%d")
    path = vault / "Daily-Logs" / f"{d}.md"
    if not path.exists():
        header = f"# Daily Log — {d}\n\n> Auto-synthesized from continuous stream\n\n"
        _atomic_write(path, header)
    _atomic_append(path, f"\n## {now.strftime('%H:%M')} — Synthesis\n\n{summary}\n\n---\n")
    return path

def write_core_memory(key: str, value: str) -> Path:
    """User profile / preferences — mirrors hermes memories/USER.md but in vault."""
    vault = ensure_vault()
    path = vault / "Core-Memory" / f"{key}.md"
    content = f"# {key}\n\nUpdated: {datetime.now(timezone.utc).isoformat()}\n\n{value}\n"
    _atomic_write(path, content)
    return path

def git_commit_vault(message: Optional[str] = None) -> Dict[str, Any]:
    """Best-effort git commit for vault. Vault is plain markdown so git = perfect backup."""
    import subprocess
    vault = ensure_vault()
    if not (vault / ".git").exists():
        # init git repo in vault if not present
        try:
            subprocess.run(["git", "init"], cwd=str(vault), capture_output=True, timeout=5)
            subprocess.run(["git", "config", "user.email", "jarvis@local"], cwd=str(vault), capture_output=True, timeout=5)
            subprocess.run(["git", "config", "user.name", "JARVIS"], cwd=str(vault), capture_output=True, timeout=5)
        except Exception as e:
            return {"success": False, "error": str(e)}
    msg = message or f"vault: {datetime.now().isoformat()} auto-sync"
    try:
        subprocess.run(["git", "add", "-A"], cwd=str(vault), capture_output=True, timeout=10)
        # only commit if changes
        status = subprocess.run(["git", "status", "--porcelain"], cwd=str(vault), capture_output=True, text=True, timeout=10)
        if not status.stdout.strip():
            return {"success": True, "committed": False, "reason": "no changes"}
        r = subprocess.run(["git", "commit", "-m", msg], cwd=str(vault), capture_output=True, text=True, timeout=10)
        # optional push if remote configured
        # best-effort, never fail
        subprocess.run(["git", "push"], cwd=str(vault), capture_output=True, timeout=15)
        return {"success": True, "committed": True, "output": r.stdout[-500:]}
    except Exception as e:
        return {"success": False, "error": str(e)}
