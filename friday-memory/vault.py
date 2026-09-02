"""
Friday Memory System — Obsidian Vault Operations
Reads and writes Markdown files in the friday-memory/ Obsidian vault.
Handles daily logs, fact notes, and vault-wide search.
"""

import os
import re
import glob
import time
from typing import List, Dict, Any, Optional

from .config import (
    VAULT_ROOT, MEMORY_MD, USER_MD, INDEX_MD,
    CONVERSATIONS_DIR, EXECUTION_DIR, FACTS_DIR,
    KNOWLEDGE_DIR, SKILLS_DIR, AGENTS_DIR, ALL_DIRS,
    MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT, FACTS_CHAR_LIMIT,
    AGENT_IDS,
)


class VaultManager:
    """Manages the Obsidian Markdown vault for human-readable memory."""

    def __init__(self):
        self._bootstrap_dirs()

    # ─── Bootstrap ───────────────────────────────────────────────────────

    def _bootstrap_dirs(self):
        """Create all vault directories if they don't exist."""
        for d in ALL_DIRS:
            os.makedirs(d, exist_ok=True)
        # Per-agent subdirectories
        for agent_id in AGENT_IDS:
            os.makedirs(os.path.join(AGENTS_DIR, agent_id), exist_ok=True)

    # ─── Daily Session Files ─────────────────────────────────────────────

    def init_daily_session(self) -> str:
        """Ensure today's conversation and execution logs exist. Returns conversation path."""
        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        iso_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Conversation log
        conv_path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")
        if not os.path.exists(conv_path):
            content = f"""---
title: "Conversation Log: {today}"
type: conversation-log
date: "{today}"
operator: Gopi
created_at: "{iso_time}"
---

# 💬 F.R.I.D.A.Y. — {today}

- **Operator**: [[USER.md|Gopi]]
- **System**: [[MEMORY.md|F.R.I.D.A.Y.]]
- **Index**: [[INDEX.md|Memory Vault]]

---

### [{now_time}] [System]
⚡ Core Engine online. Dialog capture active.

"""
            self._write_file(conv_path, content)

        # Execution log
        exec_path = os.path.join(EXECUTION_DIR, f"{today}.md")
        if not os.path.exists(exec_path):
            content = f"""---
title: "Execution Log: {today}"
type: execution-telemetry
date: "{today}"
created_at: "{iso_time}"
---

# 🛠️ Tool Execution Telemetry — {today}

- **Operator**: [[USER.md|Gopi]]
- **Dialogue**: [[conversations/{today}|Today's Conversation]]

---

"""
            self._write_file(exec_path, content)

        return conv_path

    # ─── Conversation Logging ────────────────────────────────────────────

    def log_conversation(self, speaker: str, text: str):
        """Append a dialog turn to today's conversation log."""
        if not text or not text.strip():
            return
        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")
        if not os.path.exists(path):
            self.init_daily_session()
        entry = f"### [{now_time}] [{speaker}]\n{text.strip()}\n\n"
        self._append_file(path, entry)

    # ─── Tool Execution Logging ──────────────────────────────────────────

    def log_execution(self, tool_name: str, args: Dict, result: Dict,
                      duration_ms: float = 0.0):
        """Append a tool execution record to today's execution log."""
        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        path = os.path.join(EXECUTION_DIR, f"{today}.md")
        if not os.path.exists(path):
            self.init_daily_session()

        success = result.get("success", True) if isinstance(result, dict) else True
        summary = ""
        if isinstance(result, dict):
            summary = result.get("summary") or result.get("message") or result.get("error") or ""
        if not summary:
            import json
            summary = json.dumps(result)[:150]

        status = "✅ OK" if success else "❌ FAIL"
        entry = f"""### [{now_time}] ⚙️ `{tool_name}` — {status}
- **Duration**: `{round(duration_ms, 1)}ms`
- **Summary**: {summary}

"""
        self._append_file(path, entry)

    # ─── Read Core Files ─────────────────────────────────────────────────

    def get_memory(self) -> str:
        """Read MEMORY.md content (truncated to limit)."""
        return self._read_file(MEMORY_MD, MEMORY_CHAR_LIMIT)

    def get_user_profile(self) -> str:
        """Read USER.md content (truncated to limit)."""
        return self._read_file(USER_MD, USER_CHAR_LIMIT)

    def get_facts(self) -> str:
        """Read all fact notes from facts/ directory."""
        if not os.path.exists(FACTS_DIR):
            return ""
        collected = []
        for fpath in sorted(glob.glob(os.path.join(FACTS_DIR, "*.md"))):
            fname = os.path.basename(fpath).replace(".md", "")
            text = self._read_file(fpath)
            text = re.sub(r"^---[\s\S]*?---\n", "", text).strip()
            if text:
                collected.append(f"### [[facts/{fname}|{fname}]]\n{text[:1200]}")
        return "\n\n".join(collected)[:FACTS_CHAR_LIMIT]

    def get_knowledge(self) -> str:
        """Read knowledge/ directory summaries."""
        if not os.path.exists(KNOWLEDGE_DIR):
            return ""
        items = []
        for fpath in glob.glob(os.path.join(KNOWLEDGE_DIR, "*.md")):
            fname = os.path.basename(fpath).replace(".md", "")
            text = self._read_file(fpath)
            text = re.sub(r"^---[\s\S]*?---\n", "", text).strip()
            if text:
                items.append(f"- **[[knowledge/{fname}|{fname}]]**: {text[:400]}")
        return "\n".join(items)

    def get_recent_conversations(self, max_days: int = 3) -> str:
        """Summarize recent conversation logs."""
        if not os.path.exists(CONVERSATIONS_DIR):
            return ""
        files = sorted(glob.glob(os.path.join(CONVERSATIONS_DIR, "*.md")), reverse=True)
        parts = []
        for cf in files[:max_days]:
            day = os.path.basename(cf).replace(".md", "")
            content = self._read_file(cf)
            lines = [l for l in content.splitlines()
                     if l.startswith("### [") or (l.strip() and not l.startswith(("#", "-", "---")))]
            snippet = "\n".join(lines[-6:]) if lines else "No turns."
            parts.append(f"#### [[conversations/{day}|{day}]]\n{snippet[:400]}")
        return "\n\n".join(parts)

    # ─── Fact Notes CRUD ─────────────────────────────────────────────────

    def save_fact(self, key: str, value: str, category: str = "custom",
                  source: str = "user"):
        """Write a fact note to facts/ and append to MEMORY.md."""
        clean_key = re.sub(r'[^\w\s-]', '', key).strip().replace(" ", "_")
        if not clean_key:
            return
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        fact_path = os.path.join(FACTS_DIR, f"{clean_key}.md")
        note = f"""---
type: fact
category: {category}
source: {source}
updated_at: "{iso}"
---

# 📌 {key}

{value}
"""
        self._write_file(fact_path, note)
        # Append reference to MEMORY.md
        self._append_file(MEMORY_MD, f"\n- § [{category.upper()}] [[facts/{clean_key}|{key}]]: {value}")

    # ─── Agent Vault Operations ──────────────────────────────────────────

    def save_agent_note(self, agent_id: str, filename: str, content: str):
        """Write a note to an agent's vault directory."""
        agent_dir = os.path.join(AGENTS_DIR, agent_id)
        os.makedirs(agent_dir, exist_ok=True)
        self._write_file(os.path.join(agent_dir, filename), content)

    def get_agent_notes(self, agent_id: str) -> List[str]:
        """List all notes in an agent's vault directory."""
        agent_dir = os.path.join(AGENTS_DIR, agent_id)
        if not os.path.exists(agent_dir):
            return []
        return [f for f in os.listdir(agent_dir) if f.endswith(".md")]

    # ─── Vault Search ────────────────────────────────────────────────────

    def search_vault(self, query: str, limit: int = 10) -> List[Dict[str, str]]:
        """Simple keyword search across all vault markdown files."""
        tokens = [t.lower() for t in query.split() if len(t) > 2]
        if not tokens:
            return []

        results = []
        for root, _, files in os.walk(VAULT_ROOT):
            # Skip .obsidian, .cache, __pycache__
            if any(skip in root for skip in [".obsidian", ".cache", "__pycache__", "node_modules"]):
                continue
            for f in files:
                if not f.endswith(".md"):
                    continue
                fpath = os.path.join(root, f)
                try:
                    content = self._read_file(fpath).lower()
                    score = sum(1 for t in tokens if t in content)
                    if score > 0:
                        rel = os.path.relpath(fpath, VAULT_ROOT)
                        results.append({"path": rel, "score": score, "preview": content[:200]})
                except Exception:
                    continue

        results.sort(key=lambda x: -x["score"])
        return results[:limit]

    # ─── Status ──────────────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        today = time.strftime("%Y-%m-%d")
        conv_path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")
        return {
            "vault_root": VAULT_ROOT,
            "status": "connected",
            "today": today,
            "today_conversation_bytes": os.path.getsize(conv_path) if os.path.exists(conv_path) else 0,
            "total_conversations": len(glob.glob(os.path.join(CONVERSATIONS_DIR, "*.md"))),
            "total_execution_logs": len(glob.glob(os.path.join(EXECUTION_DIR, "*.md"))),
            "total_facts": len(glob.glob(os.path.join(FACTS_DIR, "*.md"))),
            "total_agent_dirs": len([d for d in os.listdir(AGENTS_DIR) if os.path.isdir(os.path.join(AGENTS_DIR, d))]) if os.path.exists(AGENTS_DIR) else 0,
        }

    # ─── File Helpers ────────────────────────────────────────────────────

    @staticmethod
    def _read_file(path: str, limit: int = 0) -> str:
        if not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return content[:limit] if limit else content
        except Exception:
            return ""

    @staticmethod
    def _write_file(path: str, content: str):
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            print(f"[Vault] Write error {path}: {e}")

    @staticmethod
    def _append_file(path: str, content: str):
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            print(f"[Vault] Append error {path}: {e}")
