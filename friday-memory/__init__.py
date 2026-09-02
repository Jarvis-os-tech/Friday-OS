"""
Friday Memory System — Public API
All memory operations go through this single entry point.

Usage:
    from friday_memory import memory
    # or: import sys; sys.path.insert(0, 'friday-memory'); from __init__ import memory

    memory.vault.get_memory()              # Read MEMORY.md
    memory.vault.log_conversation(...)     # Log dialog
    memory.engine.store_node(...)          # Store to SQLite
    memory.engine.search_nodes("query")    # FTS5 search
    memory.hermes.sync()                   # Import Hermes memory
    memory.agents.store("hermes", ...)     # Agent-scoped memory
    memory.agents.build_context("hermes")  # Build agent context
    memory.miner.mine_conversation(...)    # Extract memories
    memory.status()                        # Full system status
"""

from .engine import MemoryEngine
from .vault import VaultManager
from .hermes_bridge import HermesBridge
from .agent_memory import AgentMemory
from .miner import MemoryMiner
from .config import DB_PATH, VAULT_ROOT
from .types import (
    MemoryNode, ConversationTurn, Session,
    KnowledgeTriple, DiaryEntry, EventMesh,
)


class FridayMemory:
    """
    Unified memory system for Friday OS.

    Components:
      .engine  — SQLite database (structured storage)
      .vault   — Obsidian Markdown vault (human-readable)
      .hermes  — Read-only bridge from Hermes long-term memory
      .agents  — Per-agent memory namespaces
      .miner   — Rule-based memory extraction from conversations
    """

    _instance = None

    @classmethod
    def get_instance(cls) -> "FridayMemory":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        # Core components
        self.engine = MemoryEngine(DB_PATH)
        self.vault = VaultManager()
        self.hermes = HermesBridge(self.engine)
        self.agents = AgentMemory(self.engine, self.vault)
        self.miner = MemoryMiner(self.engine)

        # Bootstrap daily session
        self.vault.init_daily_session()

    # ─── Convenience Methods ─────────────────────────────────────────────

    def log_turn(self, speaker: str, text: str, role: str = "user",
                 agent_id: str = "friday-prime"):
        """
        Log a conversation turn to both vault (Markdown) and engine (SQLite).
        Also runs the memory miner on the text.
        """
        import time

        # 1. Log to Obsidian vault
        self.vault.log_conversation(speaker, text)

        # 2. Log to SQLite
        today = time.strftime("%Y-%m-%d")
        turn = ConversationTurn(
            session_id=f"session_{today}",
            role=role,
            content=text.strip(),
        )
        self.engine.store_turn(turn)

    def search(self, query: str, limit: int = 10):
        """Search across both SQLite FTS and vault files."""
        db_results = self.engine.search_nodes(query, limit=limit)
        vault_results = self.vault.search_vault(query, limit=limit)
        return {
            "db": [{"id": n.id, "kind": n.kind, "content": n.content[:300],
                     "tier": n.tier, "agent": n.agent_id} for n in db_results],
            "vault": vault_results,
        }

    def get_context_for_prompt(self, agent_id: str = "friday-prime") -> str:
        """
        Build the full memory context string for a system prompt.
        Combines: MEMORY.md + USER.md + facts + agent context + conversations.
        """
        parts = []

        # Core memory
        mem = self.vault.get_memory()
        if mem:
            parts.append(f"=== PERSISTENT KNOWLEDGE (MEMORY.md) ===\n{mem}")

        user = self.vault.get_user_profile()
        if user:
            parts.append(f"=== OPERATOR PROFILE (USER.md) ===\n{user}")

        facts = self.vault.get_facts()
        if facts:
            parts.append(f"=== VERIFIED FACTS ===\n{facts}")

        # Agent-specific context
        agent_ctx = self.agents.build_context(agent_id)
        if agent_ctx:
            parts.append(f"=== AGENT MEMORY ({agent_id}) ===\n{agent_ctx}")

        # Today's conversation reference
        import time
        today = time.strftime("%Y-%m-%d")
        parts.append(f"=== ACTIVE SESSION ===\n- Today: [[conversations/{today}|{today}]]")

        return "\n\n".join(parts)

    def status(self):
        """Full memory system status."""
        return {
            "engine": self.engine.get_stats(),
            "vault": self.vault.get_status(),
            "hermes": self.hermes.get_hermes_status(),
            "agents": self.agents.get_agent_stats(),
        }


# ─── Singleton Instance ─────────────────────────────────────────────────
memory = FridayMemory.get_instance()
