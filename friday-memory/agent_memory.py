"""
Friday Memory System — Agent Memory Manager
Per-agent memory namespaces with shared knowledge tier.
Each agent has its own scoped view + access to shared knowledge.
"""

from typing import List, Dict, Any, Optional

from .config import AGENT_IDS
from .types import MemoryNode, DiaryEntry, KnowledgeTriple, _now_ms, _new_id
from .engine import MemoryEngine
from .vault import VaultManager


class AgentMemory:
    """
    Per-agent memory with namespace isolation.

    Each agent can:
      - Store private memories (scoped by agent_id)
      - Read shared knowledge (tier=3, any agent)
      - Promote private facts to shared knowledge
      - Get a context window (shared + private memories)
    """

    def __init__(self, engine: MemoryEngine, vault: VaultManager):
        self.engine = engine
        self.vault = vault

    # ─── Store Agent Memory ──────────────────────────────────────────────

    def store(self, agent_id: str, content: str, kind: str = "fact",
              tier: int = 1, importance: float = 0.5,
              session_id: Optional[str] = None) -> str:
        """Store a memory node scoped to a specific agent."""
        node = MemoryNode(
            kind=kind,
            tier=tier,
            content=content,
            importance=importance,
            agent_id=agent_id,
            session_id=session_id,
            source="agent",
        )
        node_id = self.engine.store_node(node)

        # Also write to agent's vault folder
        self.vault.save_agent_note(
            agent_id,
            f"{kind}_{node.id[-8:]}.md",
            f"---\ntype: {kind}\ntier: {tier}\nagent: {agent_id}\n---\n\n{content}\n"
        )
        return node_id

    # ─── Retrieve Agent Memory ───────────────────────────────────────────

    def get_private(self, agent_id: str, limit: int = 30) -> List[MemoryNode]:
        """Get agent's private memories (any tier)."""
        return self.engine.get_nodes_by_agent(agent_id, limit=limit)

    def get_shared_knowledge(self, limit: int = 30) -> List[MemoryNode]:
        """Get all knowledge-tier memories (shared across agents)."""
        return self.engine.get_nodes_by_tier(tier=3, limit=limit)

    # ─── Context Builder ─────────────────────────────────────────────────

    def build_context(self, agent_id: str, max_chars: int = 8000) -> str:
        """
        Build a context window for an agent:
          1. Shared knowledge (tier=3, all agents)
          2. Agent's persistent memories (tier≥2)
          3. Agent's recent working memories (tier=1)
        """
        parts = []

        # 1. Shared knowledge
        shared = self.get_shared_knowledge(limit=15)
        if shared:
            lines = [f"- {n.content[:300]}" for n in shared]
            parts.append("## Shared Knowledge\n" + "\n".join(lines))

        # 2. Agent persistent memories
        persistent = [n for n in self.get_private(agent_id, limit=20) if n.tier >= 2]
        if persistent:
            lines = [f"- [{n.kind}] {n.content[:300]}" for n in persistent]
            parts.append(f"## {agent_id} Persistent Memory\n" + "\n".join(lines))

        # 3. Recent working memories
        working = [n for n in self.get_private(agent_id, limit=10) if n.tier == 1]
        if working:
            lines = [f"- {n.content[:200]}" for n in working[:5]]
            parts.append(f"## {agent_id} Working Memory\n" + "\n".join(lines))

        context = "\n\n".join(parts)
        return context[:max_chars]

    # ─── Tier Promotion ──────────────────────────────────────────────────

    def promote_to_shared(self, node_id: str) -> bool:
        """Promote an agent-local memory to shared knowledge (tier=3)."""
        node = self.engine.get_node(node_id)
        if not node:
            return False
        node.tier = 3
        node.updated_at = _now_ms()
        self.engine.store_node(node)
        return True

    def promote_tier(self, node_id: str, new_tier: int) -> bool:
        """Move a memory node to a higher tier."""
        node = self.engine.get_node(node_id)
        if not node or new_tier <= node.tier:
            return False
        node.tier = new_tier
        node.updated_at = _now_ms()
        self.engine.store_node(node)
        return True

    # ─── Agent Diary ─────────────────────────────────────────────────────

    def write_diary(self, agent_id: str, content: str,
                    entry_type: str = "reflection",
                    session_id: Optional[str] = None) -> str:
        """Write a diary entry for an agent."""
        entry = DiaryEntry(
            agent_id=agent_id,
            session_id=session_id,
            entry_type=entry_type,
            content=content,
        )
        return self.engine.store_diary(entry)

    def get_diary(self, agent_id: str, limit: int = 10) -> List[DiaryEntry]:
        """Get diary entries for an agent."""
        return self.engine.get_diary(agent_id=agent_id, limit=limit)

    # ─── Stats ───────────────────────────────────────────────────────────

    def get_agent_stats(self) -> Dict[str, Any]:
        """Memory count per agent."""
        stats = {}
        for agent_id in AGENT_IDS:
            count = self.engine.count_nodes(agent_id=agent_id)
            notes = self.vault.get_agent_notes(agent_id)
            stats[agent_id] = {
                "db_nodes": count,
                "vault_notes": len(notes),
            }
        stats["shared_knowledge"] = len(self.engine.get_nodes_by_tier(tier=3, limit=1000))
        return stats
