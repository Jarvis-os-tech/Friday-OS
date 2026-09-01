"""
Memory Vault — from hermes-agent/tools/memory_tool.py + utils.py:atomic_write_text + Obsidian ~/Obsidian/Jarvis-Memory-Vault
Never-lose-data guarantee: every transcript.final is atomic-appended before brain replies.

Origin:
  - memory_tool.py:16 ENTRY_DELIMITER="\\n§\\n", MEMORY.md/USER.md frozen snapshot
  - utils.py:279 atomic_write_text (temp+fsync+os.replace, preserves symlinks, cross-device fallback)
  - Obsidian vault structure: Conversations/Daily-Logs/Core-Memory/Semantic-Memory/Episodic-Memory/Working-Memory
  - SOUL.md:46 Semantic (Obsidian vault: ~/Obsidian/Jarvis-Memory-Vault/)

Present-dir standalone copy of memory/obsidian_writer.py logic — no hermes import required.
"""
import os, json, hashlib, tempfile, threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any

DEFAULT_VAULT = Path.home() / "Obsidian" / "Jarvis-Memory-Vault"
DIRS = ["Conversations","Daily-Logs","Core-Memory","Episodic-Memory","Semantic-Memory","Procedural-Memory","Working-Memory","Backups"]
_lock = threading.Lock()

def get_vault_path() -> Path:
    return Path(os.getenv("JARVIS_VAULT", str(DEFAULT_VAULT))).expanduser()

def ensure_vault() -> Path:
    v = get_vault_path()
    for d in DIRS: (v/d).mkdir(parents=True, exist_ok=True)
    return v

def _atomic_append(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        new = existing + content
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(new); f.flush(); os.fsync(f.fileno())
            os.replace(tmp, str(path))
        except BaseException:
            try: os.unlink(tmp)
            except: pass
            raise

def _atomic_write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(content); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, str(path))
    except BaseException:
        try: os.unlink(tmp)
        except: pass
        raise

def write_conversation(role: str, text: str, session_id: str="continuous", meta: Optional[Dict]=None) -> Path:
    v=ensure_vault(); now=datetime.now(timezone.utc).astimezone()
    date=now.strftime("%Y-%m-%d"); tstr=now.strftime("%H:%M:%S %Z"); iso=now.isoformat()
    daily=v/"Conversations"/f"{date}.md"
    if not daily.exists(): _atomic_write(daily, f"# Conversations — {date}\n\n> Continuous `{{session_id}}` {iso}\n\n---\n\n")
    h=hashlib.sha256(f"{iso}:{role}:{text}".encode()).hexdigest()[:8]
    entry=f"### {tstr} — {role} `#{h}`\n\n{text}\n\n"
    if meta: entry+=f"<details><summary>meta</summary>\n\n```json\n{json.dumps(meta,indent=2,ensure_ascii=False)}\n```\n\n</details>\n\n"
    entry+="---\n\n"
    _atomic_append(daily, entry)
    buf=v/"Working-Memory"/"live_stream_buffer.jsonl"
    _atomic_append(buf, json.dumps({"ts":iso,"role":role,"text":text,"session_id":session_id,"hash":h,"meta":meta or{}},ensure_ascii=False)+"\n")
    return daily

def git_commit_vault(msg: Optional[str]=None):
    import subprocess
    v=ensure_vault()
    if not (v/".git").exists():
        subprocess.run(["git","init"], cwd=str(v), capture_output=True, timeout=5)
        subprocess.run(["git","config","user.email","jarvis@local"], cwd=str(v), capture_output=True, timeout=5)
        subprocess.run(["git","config","user.name","JARVIS"], cwd=str(v), capture_output=True, timeout=5)
    m=msg or f"vault: {datetime.now().isoformat()} auto-sync"
    try:
        subprocess.run(["git","add","-A"], cwd=str(v), capture_output=True, timeout=10)
        s=subprocess.run(["git","status","--porcelain"], cwd=str(v), capture_output=True, text=True, timeout=10)
        if not s.stdout.strip(): return {"success":True,"committed":False,"reason":"no changes"}
        r=subprocess.run(["git","commit","-m",m], cwd=str(v), capture_output=True, text=True, timeout=10)
        subprocess.run(["git","push"], cwd=str(v), capture_output=True, timeout=15)
        return {"success":True,"committed":True,"output":r.stdout[-500:]}
    except Exception as e: return {"success":False,"error":str(e)}
