"""
Dual-Store Memory Engine for F.R.I.D.A.Y. Python Core Engine.

This module is a thin backward-compatible wrapper that delegates all
memory operations to the unified friday-memory package.

All actual logic lives in friday-memory/:
  config.py       — paths and constants
  types.py        — dataclasses
  engine.py       — SQLite engine
  vault.py        — Obsidian vault I/O
  hermes_bridge.py — Hermes memory sync
  agent_memory.py — per-agent namespaces
  miner.py        — rule-based extraction
  __init__.py     — public API
"""

import sys
import os
from typing import List, Dict, Any, Optional

# Add friday-memory to Python path so we can import it
_friday_memory_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "friday-memory")
if _friday_memory_path not in sys.path:
    sys.path.insert(0, os.path.dirname(_friday_memory_path))

# Import the unified memory system
# friday-memory/ is a sibling directory to core_engine/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# We need to import friday-memory as a package. Since the directory is named
# "friday-memory" (with a hyphen), we use importlib.
import importlib
_fm_spec = importlib.util.spec_from_file_location(
    "friday_memory",
    os.path.join(_friday_memory_path, "__init__.py"),
    submodule_search_locations=[_friday_memory_path]
)
_fm_module = importlib.util.module_from_spec(_fm_spec)
sys.modules["friday_memory"] = _fm_module

# Also register submodules so internal imports work
for submod in ["config", "types", "engine", "vault", "hermes_bridge", "agent_memory", "miner"]:
    sub_spec = importlib.util.spec_from_file_location(
        f"friday_memory.{submod}",
        os.path.join(_friday_memory_path, f"{submod}.py"),
        submodule_search_locations=[_friday_memory_path]
    )
    sub_module = importlib.util.module_from_spec(sub_spec)
    sys.modules[f"friday_memory.{submod}"] = sub_module
    sub_spec.loader.exec_module(sub_module)
    setattr(_fm_module, submod, sub_module)

_fm_spec.loader.exec_module(_fm_module)

from friday_memory import FridayMemory


class DualStoreMemory:
    """
    Backward-compatible wrapper around FridayMemory.
    All existing code (prompt_engine, server, gemini_live, actuator_dispatcher)
    imports `memory_engine` from this module. This wrapper ensures they keep working.
    """

    _instance = None

    @classmethod
    def get_instance(cls) -> "DualStoreMemory":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._fm = FridayMemory.get_instance()
        self._cached_snapshot: Optional[Dict[str, Any]] = None

    # ─── Delegated Properties ────────────────────────────────────────────

    @property
    def engine(self):
        return self._fm.engine

    @property
    def vault(self):
        return self._fm.vault

    @property
    def hermes(self):
        return self._fm.hermes

    @property
    def agents(self):
        return self._fm.agents

    @property
    def miner(self):
        return self._fm.miner

    # ─── Backward-Compatible API ─────────────────────────────────────────

    def init_daily_session(self) -> str:
        return self._fm.vault.init_daily_session()

    def log_conversation_turn(self, speaker: str, text: str, role: str = "user") -> None:
        self._fm.log_turn(speaker, text, role=role)

    def log_tool_execution(self, tool_name: str, args: Dict[str, Any],
                           result: Dict[str, Any], duration_ms: float = 0.0) -> None:
        self._fm.vault.log_execution(tool_name, args, result, duration_ms)

    def get_memory_notes(self) -> str:
        return self._fm.vault.get_memory()

    def get_user_profile(self) -> str:
        return self._fm.vault.get_user_profile()

    def get_vault_facts_content(self) -> str:
        return self._fm.vault.get_facts()

    def get_vault_knowledge_summary(self) -> str:
        return self._fm.vault.get_knowledge()

    def get_vault_skills_summary(self) -> str:
        # Skills scanning — inline simple version
        import re
        skills_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "friday-memory", "skills")
        if not os.path.exists(skills_dir):
            return ""
        skills = []
        for root, _, files in os.walk(skills_dir):
            for f in files:
                if f.lower() == "skill.md":
                    fpath = os.path.join(root, f)
                    parent = os.path.basename(root)
                    try:
                        with open(fpath, "r") as sf:
                            sc = sf.read()
                        dm = re.search(r"description:\s*[\"']?([^\"'\n]+)", sc, re.IGNORECASE)
                        desc = dm.group(1).strip() if dm else f"Skill: {parent}"
                        skills.append(f"- **{parent}**: {desc}")
                    except Exception:
                        skills.append(f"- **{parent}**: Skill module")
        return "\n".join(skills[:40])

    def get_recent_conversations_summary(self, max_days: int = 3) -> str:
        return self._fm.vault.get_recent_conversations(max_days=max_days)

    def get_sqlite_facts(self, limit: int = 20) -> List[Dict[str, Any]]:
        # Map new memory_nodes to old format for compatibility
        nodes = self._fm.engine.get_nodes_by_kind("fact", limit=limit)
        return [
            {
                "id": n.id,
                "category": n.kind,
                "key": n.content[:50],
                "value": n.content,
                "source": n.source,
                "updated_at": str(n.updated_at),
            }
            for n in nodes
        ]

    def save_memory_fact(self, key: str, value: str, category: str = "custom",
                         source: str = "user_added"):
        # Store in new engine
        from friday_memory.types import MemoryNode
        node = MemoryNode(
            kind="fact",
            tier=2,  # Persistent
            content=f"{key}: {value}",
            importance=0.7,
            source=source,
        )
        self._fm.engine.store_node(node)
        # Also write vault fact
        self._fm.vault.save_fact(key, value, category=category, source=source)
        self._cached_snapshot = None

    def search(self, query: str, limit: int = 8) -> List[Dict[str, Any]]:
        result = self._fm.search(query, limit=limit)
        return result.get("db", []) + result.get("vault", [])

    def get_frozen_snapshot(self, force_refresh: bool = False) -> Dict[str, Any]:
        if self._cached_snapshot is not None and not force_refresh:
            return self._cached_snapshot

        formatted_prompt = self._fm.get_context_for_prompt()

        self._cached_snapshot = {
            "user_content": self._fm.vault.get_user_profile(),
            "memory_content": self._fm.vault.get_memory(),
            "vault_facts": self._fm.vault.get_facts(),
            "vault_skills": self.get_vault_skills_summary(),
            "formatted_prompt": formatted_prompt,
            "timestamp": __import__("time").time(),
        }
        return self._cached_snapshot

    def get_vault_status(self) -> Dict[str, Any]:
        vault_st = self._fm.vault.get_status()
        today = vault_st.get("today", "")
        return {
            "vault_root": vault_st.get("vault_root", ""),
            "status": "connected",
            "today_conversation_file": f"conversations/{today}.md",
            "total_facts_indexed": vault_st.get("total_facts", 0),
            "total_skills_indexed": len(self.get_vault_skills_summary().splitlines()) if self.get_vault_skills_summary() else 0,
            "total_conversations_logged": vault_st.get("total_conversations", 0),
            **vault_st,
            "full_status": self._fm.status(),
        }


# ─── Singleton (backward-compatible export) ──────────────────────────────
memory_engine = DualStoreMemory.get_instance()
