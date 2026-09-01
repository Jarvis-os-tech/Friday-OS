"""
Dual-Store Memory Engine for F.R.I.D.A.Y. Python Core Engine.
Combines SQLite WAL structured facts with Obsidian Markdown Vault at friday-memory.
Manages long-term operational memory, auto-linking, facts, knowledge, skills,
and daily fresh conversation logging on system activation.
"""

import os
import glob
import sqlite3
import time
import json
import re
from typing import List, Dict, Any, Optional
from .security import security_guard

MEMORY_DIR = os.environ.get("FRIDAY_MEMORY_PATH", os.path.join(os.getcwd(), "friday-memory"))
MEMORY_MD_PATH = os.path.join(MEMORY_DIR, "MEMORY.md")
USER_MD_PATH = os.path.join(MEMORY_DIR, "USER.md")
INDEX_MD_PATH = os.path.join(MEMORY_DIR, "INDEX.md")
CONVERSATIONS_DIR = os.path.join(MEMORY_DIR, "conversations")
EXECUTION_DIR = os.path.join(MEMORY_DIR, "execution")
FACTS_DIR = os.path.join(MEMORY_DIR, "facts")
KNOWLEDGE_DIR = os.path.join(MEMORY_DIR, "knowledge")
SKILLS_DIR = os.path.join(MEMORY_DIR, "skills")
RESEARCH_DIR = os.path.join(MEMORY_DIR, "Research")
SUMMARIES_DIR = os.path.join(MEMORY_DIR, "summaries")
CONTEXT_DIR = os.path.join(MEMORY_DIR, "context")

DB_DIR = os.path.join(os.getcwd(), "data")
DB_PATH = os.path.join(DB_DIR, "friday.db")

MEMORY_CHAR_LIMIT = 12000
USER_CHAR_LIMIT = 6000
FACTS_CHAR_LIMIT = 8000


class DualStoreMemory:
    _instance = None

    @classmethod
    def get_instance(cls) -> "DualStoreMemory":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._init_dirs()
        self._init_sqlite()
        self._cached_snapshot: Optional[Dict[str, Any]] = None
        self.init_daily_session()

    def _init_dirs(self):
        os.makedirs(MEMORY_DIR, exist_ok=True)
        os.makedirs(CONVERSATIONS_DIR, exist_ok=True)
        os.makedirs(EXECUTION_DIR, exist_ok=True)
        os.makedirs(FACTS_DIR, exist_ok=True)
        os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
        os.makedirs(SKILLS_DIR, exist_ok=True)
        os.makedirs(RESEARCH_DIR, exist_ok=True)
        os.makedirs(SUMMARIES_DIR, exist_ok=True)
        os.makedirs(CONTEXT_DIR, exist_ok=True)
        os.makedirs(DB_DIR, exist_ok=True)

        if not os.path.exists(MEMORY_MD_PATH):
            initial_mem = """# J.A.R.V.I.S. Persistent Knowledge Base
- Operator: Gopi (BTech Engineer)
- AI Identity: JARVIS / FRIDAY sovereign single-persona intelligence
- Local-First Architecture: Ubuntu Linux with native C++ workers and Rust audio gateway
- Mission: 24/7 continuous autonomous agent operations, research, coding, and workflow automation
"""
            with open(MEMORY_MD_PATH, "w", encoding="utf-8") as f:
                f.write(initial_mem)

        if not os.path.exists(USER_MD_PATH):
            initial_user = """# User Profile: Gopi
- Name: Gopi
- Style: Direct, technical depth welcome, concise and proactive
- Persona preference: Telgish / Jarvis witty conversationalist, speaks WITH user
- Primary focus: Autonomous Linux systems, real-time live audio, multi-model AI
"""
            with open(USER_MD_PATH, "w", encoding="utf-8") as f:
                f.write(initial_user)

    def _init_sqlite(self):
        conn = sqlite3.connect(DB_PATH)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    source TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS conversation_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tool_executions (
                    id TEXT PRIMARY KEY,
                    tool_name TEXT NOT NULL,
                    args_json TEXT,
                    result_json TEXT,
                    duration_ms REAL,
                    created_at INTEGER NOT NULL
                );
            """)
        conn.close()

    # ════════════════════════════════════════════════════════════════════════
    # Daily Fresh Conversation & Execution Files Initialization
    # ════════════════════════════════════════════════════════════════════════

    def init_daily_session(self) -> str:
        """
        Ensures a fresh daily conversation log and execution log exist for today.
        Creates them with rich frontmatter and Obsidian auto-linking on activation.
        """
        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        iso_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # 1. Daily Conversation Log
        daily_conv_path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")
        if not os.path.exists(daily_conv_path):
            initial_conv_content = f"""---
title: "Daily Conversation Log: {today}"
type: "conversation-log"
date: "{today}"
session: "FRIDAY-SOVEREIGN-MK7"
operator: "Gopi"
status: "active"
created_at: "{iso_time}"
---

# 💬 F.R.I.D.A.Y. Operational Conversation Log — {today}

- **Operator**: [[USER.md|Gopi]]
- **System**: [[MEMORY.md|F.R.I.D.A.Y. Sovereign MK-VII]]
- **Date**: {today}
- **Master Vault**: [[INDEX.md|Friday Universal Memory Vault]]

---

## 📝 Real-Time Dialog Transcript

### [{now_time}] [System]
⚡ F.R.I.D.A.Y. Core Engine online. Real-time dialog capture active for {today}.

"""
            try:
                with open(daily_conv_path, "w", encoding="utf-8") as f:
                    f.write(initial_conv_content)
                print(f"[Memory] 🌟 Created fresh daily conversation log: conversations/{today}.md")
            except Exception as e:
                print(f"[Memory] Failed to create daily conversation log: {e}")

        # 2. Daily Tool Execution Log
        daily_exec_path = os.path.join(EXECUTION_DIR, f"{today}.md")
        if not os.path.exists(daily_exec_path):
            initial_exec_content = f"""---
title: "Daily Tool Execution Log: {today}"
type: "execution-telemetry"
date: "{today}"
operator: "Gopi"
created_at: "{iso_time}"
---

# 🛠️ F.R.I.D.A.Y. Daily Tool & Actuator Telemetry — {today}

- **Operator**: [[USER.md|Gopi]]
- **Active Dialogue**: [[conversations/{today}|Today's Dialogue]]
- **Session Index**: [[INDEX.md|Universal Index]]

---

## ⏱️ Execution Timeline

"""
            try:
                with open(daily_exec_path, "w", encoding="utf-8") as f:
                    f.write(initial_exec_content)
                print(f"[Memory] 🛠️ Created fresh daily execution log: execution/{today}.md")
            except Exception as e:
                print(f"[Memory] Failed to create daily execution log: {e}")

        return daily_conv_path

    def log_conversation_turn(self, speaker: str, text: str, role: str = "user") -> None:
        """
        Logs a user or assistant dialog turn into today's Markdown conversation file
        and dual-persists into SQLite WAL conversation_messages.
        """
        if not text or not text.strip():
            return

        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        timestamp_ms = int(time.time() * 1000)
        daily_conv_path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")

        # Ensure file exists
        if not os.path.exists(daily_conv_path):
            self.init_daily_session()

        # Format turn
        clean_text = text.strip()
        md_entry = f"### [{now_time}] [{speaker}]\n{clean_text}\n\n"

        # 1. Append to Markdown Vault
        try:
            with open(daily_conv_path, "a", encoding="utf-8") as f:
                f.write(md_entry)
        except Exception as e:
            print(f"[Memory] Conversation file write error: {e}")

        # 2. Dual-Persist to SQLite
        try:
            msg_id = f"msg_{timestamp_ms}_{role[:3]}"
            conn = sqlite3.connect(DB_PATH)
            with conn:
                conn.execute(
                    "INSERT INTO conversation_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                    (msg_id, f"session_{today}", role, clean_text, timestamp_ms)
                )
            conn.close()
        except Exception as e:
            print(f"[Memory] SQLite conversation log error: {e}")

    def log_tool_execution(self, tool_name: str, args: Dict[str, Any], result: Dict[str, Any], duration_ms: float = 0.0) -> None:
        """
        Logs tool dispatch telemetry to today's execution log file.
        """
        today = time.strftime("%Y-%m-%d")
        now_time = time.strftime("%H:%M:%S")
        timestamp_ms = int(time.time() * 1000)
        daily_exec_path = os.path.join(EXECUTION_DIR, f"{today}.md")

        if not os.path.exists(daily_exec_path):
            self.init_daily_session()

        success = result.get("success", True) if isinstance(result, dict) else True
        summary = ""
        if isinstance(result, dict):
            summary = result.get("summary") or result.get("message") or result.get("error") or ""
        if not summary:
            summary = json.dumps(result)[:150]

        args_str = json.dumps(args, ensure_ascii=False) if args else "{}"
        status_tag = "✅ SUCCESS" if success else "❌ FAILED"

        md_entry = f"""### [{now_time}] ⚙️ `{tool_name}` — {status_tag}
- **Duration**: `{round(duration_ms, 1)}ms`
- **Arguments**: `{args_str}`
- **Summary**: {summary}

"""
        # 1. Append to Markdown Vault
        try:
            with open(daily_exec_path, "a", encoding="utf-8") as f:
                f.write(md_entry)
        except Exception as e:
            print(f"[Memory] Execution file write error: {e}")

        # 2. Dual-Persist to SQLite
        try:
            exec_id = f"exec_{timestamp_ms}_{tool_name[:10]}"
            conn = sqlite3.connect(DB_PATH)
            with conn:
                conn.execute(
                    "INSERT INTO tool_executions (id, tool_name, args_json, result_json, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (exec_id, tool_name, args_str, json.dumps(result, ensure_ascii=False), duration_ms, timestamp_ms)
                )
            conn.close()
        except Exception as e:
            print(f"[Memory] SQLite tool execution log error: {e}")

    # ════════════════════════════════════════════════════════════════════════
    # Obsidian Vault Ingestion & Domain Retrieval
    # ════════════════════════════════════════════════════════════════════════

    def get_memory_notes(self) -> str:
        if not os.path.exists(MEMORY_MD_PATH):
            return ""
        try:
            with open(MEMORY_MD_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            safe, _ = security_guard.scan_prompt_injection(content)
            if not safe:
                content = content.replace("<", "").replace(">", "")
            return content[:MEMORY_CHAR_LIMIT]
        except Exception:
            return ""

    def get_user_profile(self) -> str:
        if not os.path.exists(USER_MD_PATH):
            return ""
        try:
            with open(USER_MD_PATH, "r", encoding="utf-8") as f:
                content = f.read()
            safe, _ = security_guard.scan_prompt_injection(content)
            if not safe:
                content = content.replace("<", "").replace(">", "")
            return content[:USER_CHAR_LIMIT]
        except Exception:
            return ""

    def get_vault_facts_content(self) -> str:
        """
        Reads and extracts key structured facts from all files in facts/ directory.
        """
        if not os.path.exists(FACTS_DIR):
            return ""

        collected = []
        try:
            fact_files = glob.glob(os.path.join(FACTS_DIR, "*.md"))
            for fpath in fact_files:
                fname = os.path.basename(fpath)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        text = f.read()
                    # Strip frontmatter if present
                    text_no_fm = re.sub(r"^---[\s\S]*?---\n", "", text).strip()
                    if text_no_fm:
                        collected.append(f"### 📄 [[facts/{fname}|{fname.replace('.md', '')}]]\n{text_no_fm[:1200]}")
                except Exception:
                    continue
        except Exception:
            pass

        facts_block = "\n\n".join(collected)
        return facts_block[:FACTS_CHAR_LIMIT]

    def get_vault_knowledge_summary(self) -> str:
        """
        Reads knowledge/ directory instructions and persona definitions.
        """
        if not os.path.exists(KNOWLEDGE_DIR):
            return ""

        collected = []
        try:
            k_files = glob.glob(os.path.join(KNOWLEDGE_DIR, "*.md"))
            for fpath in k_files:
                fname = os.path.basename(fpath)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        text = f.read()
                    text_no_fm = re.sub(r"^---[\s\S]*?---\n", "", text).strip()
                    if text_no_fm:
                        collected.append(f"- **[[knowledge/{fname}|{fname.replace('.md', '')}]]**: {text_no_fm[:400]}")
                except Exception:
                    continue
        except Exception:
            pass

        return "\n".join(collected)

    def get_vault_skills_summary(self) -> str:
        """
        Scans all SKILL.md definition files across skills/ subdirectories.
        """
        if not os.path.exists(SKILLS_DIR):
            return ""

        skills = []
        try:
            for root, _, files in os.walk(SKILLS_DIR):
                for f in files:
                    if f.lower() == "skill.md":
                        full_path = os.path.join(root, f)
                        rel_path = os.path.relpath(full_path, MEMORY_DIR)
                        parent_name = os.path.basename(root)
                        try:
                            with open(full_path, "r", encoding="utf-8") as sf:
                                scontent = sf.read()
                            # Extract description from frontmatter or first lines
                            desc_match = re.search(r"description:\s*[\"']?([^\"'\n]+)", scontent, re.IGNORECASE)
                            desc = desc_match.group(1).strip() if desc_match else f"Skill module for {parent_name}"
                            skills.append(f"- **[[{rel_path}|{parent_name}]]**: {desc}")
                        except Exception:
                            skills.append(f"- **[[{rel_path}|{parent_name}]]**: Operational skill module")
        except Exception:
            pass

        return "\n".join(skills[:40])

    def get_recent_conversations_summary(self, max_days: int = 3) -> str:
        """
        Summarizes the most recent conversation logs from conversations/.
        """
        if not os.path.exists(CONVERSATIONS_DIR):
            return ""

        conv_files = sorted(glob.glob(os.path.join(CONVERSATIONS_DIR, "*.md")), reverse=True)
        summaries = []
        for cf in conv_files[:max_days]:
            day = os.path.basename(cf).replace(".md", "")
            try:
                with open(cf, "r", encoding="utf-8") as f:
                    content = f.read()
                lines = [l for l in content.splitlines() if l.startswith("### [") or (l and not l.startswith("#") and not l.startswith("-") and not l.startswith("---"))]
                snippet = "\n".join(lines[-6:]) if lines else "No turns recorded."
                summaries.append(f"#### 📅 [[conversations/{day}|{day}]]\n{snippet[:400]}")
            except Exception:
                continue

        return "\n\n".join(summaries)

    def get_sqlite_facts(self, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT id, category, key, value, source, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?", (limit,))
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows
        except Exception:
            return []

    def save_memory_fact(self, key: str, value: str, category: str = "custom", source: str = "user_added"):
        fact_id = f"mem_{int(time.time() * 1000)}"
        updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # 1. Save to SQLite
        try:
            conn = sqlite3.connect(DB_PATH)
            with conn:
                conn.execute(
                    "INSERT OR REPLACE INTO memories (id, category, key, value, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (fact_id, category, key, value, source, updated_at)
                )
            conn.close()
        except Exception as e:
            print(f"[Memory] SQLite error: {e}")

        # 2. Save into facts/ directory as dedicated Obsidian Fact Note
        clean_key = re.sub(r'[^\w\s-]', '', key).strip().replace(" ", "_")
        fact_file = os.path.join(FACTS_DIR, f"{clean_key}.md") if clean_key else None
        if fact_file:
            try:
                fact_content = f"""---
type: fact
category: {category}
source: {source}
updated_at: {updated_at}
---

# 📌 Fact: {key}

- **Value**: {value}
- **Category**: `{category}`
- **Source**: `{source}`
- **Linked Context**: [[INDEX.md|Universal Memory Index]] | [[USER.md|Operator Profile]]

"""
                with open(fact_file, "w", encoding="utf-8") as f:
                    f.write(fact_content)
            except Exception as e:
                print(f"[Memory] Fact note write error: {e}")

        # 3. Append to MEMORY.md
        try:
            with open(MEMORY_MD_PATH, "a", encoding="utf-8") as f:
                f.write(f"\n- § [{category.upper()}] [[facts/{clean_key}|{key}]]: {value}")
        except Exception as e:
            print(f"[Memory] MEMORY.md write error: {e}")

        self._cached_snapshot = None

    def search(self, query: str, limit: int = 8) -> List[Dict[str, Any]]:
        tokens = [t.lower() for t in query.split() if len(t) > 2]
        facts = self.get_sqlite_facts(limit=100)
        
        matches = []
        for f in facts:
            text = f"{f.get('key', '')} {f.get('value', '')}".lower()
            score = sum(1 for tok in tokens if tok in text) if tokens else 1
            if score > 0:
                matches.append((score, f))

        # Also search in facts/ markdown notes
        try:
            fact_files = glob.glob(os.path.join(FACTS_DIR, "*.md"))
            for fpath in fact_files:
                fname = os.path.basename(fpath).replace(".md", "")
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read().lower()
                score = sum(1 for tok in tokens if tok in content) if tokens else 0
                if score > 0:
                    matches.append((score, {
                        "category": "vault_fact",
                        "key": fname,
                        "value": content[:200],
                        "source": f"facts/{fname}.md",
                        "updated_at": time.strftime("%Y-%m-%d")
                    }))
        except Exception:
            pass

        matches.sort(key=lambda x: -x[0])
        return [m[1] for m in matches[:limit]]

    def get_frozen_snapshot(self, force_refresh: bool = False) -> Dict[str, Any]:
        if self._cached_snapshot is not None and not force_refresh:
            return self._cached_snapshot

        user_content = self.get_user_profile()
        memory_content = self.get_memory_notes()
        vault_facts = self.get_vault_facts_content()
        vault_skills = self.get_vault_skills_summary()
        db_facts = self.get_sqlite_facts(limit=15)

        db_facts_str = "\n".join([f"- [{f['category'].upper()}] {f['key']}: {f['value']}" for f in db_facts])
        db_facts_section = f"=== STRUCTURED FACTS (SQLite) ===\n{db_facts_str}" if db_facts_str else ""

        skills_section = f"=== OBSIDIAN SKILLS REGISTRY (friday-memory/skills) ===\n{vault_skills}" if vault_skills else ""
        facts_section = f"=== VAULT FACTS & PROFILES (friday-memory/facts) ===\n{vault_facts}" if vault_facts else ""

        today = time.strftime("%Y-%m-%d")
        daily_conv_link = f"=== ACTIVE DAILY CONVERSATION LOG ===\n- Today's Fresh Log: [[conversations/{today}|{today}.md]] (Active Dialogue Session)\n"

        formatted_prompt = f"""
[PERSISTENT LONG-TERM MEMORY & USER PROFILE]
=== OPERATOR PROFILE (USER.md) ===
{user_content}

=== PERSISTENT KNOWLEDGE (MEMORY.md) ===
{memory_content}

{daily_conv_link}
{facts_section}

{skills_section}

{db_facts_section}
""".strip()

        self._cached_snapshot = {
            "user_content": user_content,
            "memory_content": memory_content,
            "vault_facts": vault_facts,
            "vault_skills": vault_skills,
            "formatted_prompt": formatted_prompt,
            "timestamp": time.time()
        }
        return self._cached_snapshot

    def get_vault_status(self) -> Dict[str, Any]:
        today = time.strftime("%Y-%m-%d")
        today_conv_path = os.path.join(CONVERSATIONS_DIR, f"{today}.md")
        today_size = os.path.getsize(today_conv_path) if os.path.exists(today_conv_path) else 0

        conv_count = len(glob.glob(os.path.join(CONVERSATIONS_DIR, "*.md")))
        exec_count = len(glob.glob(os.path.join(EXECUTION_DIR, "*.md")))
        facts_count = len(glob.glob(os.path.join(FACTS_DIR, "*.md")))
        skills_count = len(glob.glob(os.path.join(SKILLS_DIR, "**", "SKILL.md"), recursive=True))

        return {
            "vault_root": MEMORY_DIR,
            "status": "connected",
            "today": today,
            "today_conversation_file": f"conversations/{today}.md",
            "today_conversation_bytes": today_size,
            "total_conversations_logged": conv_count,
            "total_execution_logs": exec_count,
            "total_facts_indexed": facts_count,
            "total_skills_indexed": skills_count,
            "dual_store": "SQLite WAL (data/friday.db) + Obsidian Markdown Vault"
        }


memory_engine = DualStoreMemory.get_instance()
