"""
Friday Memory System — Memory Miner
Rule-based extraction of facts, decisions, and lessons from conversations.
No LLM dependency — pure pattern matching. Fast and deterministic.
"""

import re
import hashlib
import time
from typing import List, Optional

from .types import MemoryNode, KnowledgeTriple, _now_ms, _new_id
from .engine import MemoryEngine


# ─── Extraction Patterns ─────────────────────────────────────────────────
# Each pattern: (regex, kind, importance)

_FACT_PATTERNS = [
    # User preferences and corrections
    (r"(?:i prefer|i like|i want|i need|i use|i always)\s+(.{10,200})", "fact", 0.7),
    (r"(?:my name is|i am|i'm)\s+(.{3,100})", "entity", 0.8),
    (r"(?:remember that|note that|keep in mind)\s+(.{10,300})", "fact", 0.9),
    (r"(?:don't|do not|never|stop)\s+(.{10,200})", "lesson", 0.8),
    (r"(?:always|from now on|going forward)\s+(.{10,200})", "decision", 0.8),
]

_DECISION_PATTERNS = [
    (r"(?:let's go with|we'll use|decided to|choosing|picked)\s+(.{10,200})", "decision", 0.8),
    (r"(?:the plan is|strategy is|approach is)\s+(.{10,200})", "decision", 0.7),
]

_TRIPLE_PATTERNS = [
    # "X uses Y", "X depends on Y", "X is a Y"
    (r"(\w[\w\s]{2,30})\s+(?:uses|depends on|relies on)\s+(\w[\w\s]{2,30})", "uses"),
    (r"(\w[\w\s]{2,30})\s+(?:is a|is an|is the)\s+(\w[\w\s]{2,30})", "is_a"),
    (r"(\w[\w\s]{2,30})\s+(?:runs on|deployed on|hosted on)\s+(\w[\w\s]{2,30})", "runs_on"),
    (r"(\w[\w\s]{2,30})\s+(?:replaces|replaced|supersedes)\s+(\w[\w\s]{2,30})", "replaces"),
]


class MemoryMiner:
    """
    Extracts structured memory from raw text using rule-based patterns.

    Pipeline:
      1. extract_from_text()  — scan text for facts, decisions, lessons
      2. extract_triples()    — mine subject-predicate-object triples
      3. mine_conversation()  — process a full conversation turn pair
    """

    def __init__(self, engine: MemoryEngine):
        self.engine = engine

    # ─── Core Extraction ─────────────────────────────────────────────────

    def extract_from_text(self, text: str, agent_id: Optional[str] = None,
                          session_id: Optional[str] = None) -> List[MemoryNode]:
        """
        Scan text for extractable memories using pattern matching.
        Returns list of newly created memory nodes.
        """
        if not text or len(text) < 20:
            return []

        created = []
        all_patterns = _FACT_PATTERNS + _DECISION_PATTERNS

        for pattern, kind, importance in all_patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                content = match.group(1).strip() if match.lastindex else match.group(0).strip()
                if len(content) < 10:
                    continue

                # Deduplicate by content hash
                content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
                node_id = f"mined_{content_hash}"
                if self.engine.node_exists_by_hash(node_id):
                    continue

                node = MemoryNode(
                    id=node_id,
                    kind=kind,
                    tier=1,              # Working tier — needs promotion to persist
                    content=content,
                    importance=importance,
                    agent_id=agent_id,
                    session_id=session_id,
                    source="miner",
                )
                self.engine.store_node(node)
                created.append(node)

        return created

    def extract_triples(self, text: str, agent_id: Optional[str] = None) -> List[KnowledgeTriple]:
        """Extract subject-predicate-object triples from text."""
        if not text or len(text) < 15:
            return []

        created = []
        for pattern, predicate in _TRIPLE_PATTERNS:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                subject = match.group(1).strip()
                obj = match.group(2).strip()
                if len(subject) < 2 or len(obj) < 2:
                    continue

                triple = KnowledgeTriple(
                    subject=subject,
                    predicate=predicate,
                    object=obj,
                    confidence=0.6,
                    source="miner",
                    agent_id=agent_id,
                )
                self.engine.store_triple(triple)
                created.append(triple)

        return created

    # ─── Conversation Mining ─────────────────────────────────────────────

    def mine_conversation(self, user_text: str, assistant_text: str,
                          agent_id: str = "friday-prime",
                          session_id: Optional[str] = None) -> dict:
        """
        Mine a full conversation turn (user + assistant) for memories.
        Call this after each conversation exchange.

        Returns: {"nodes": [...], "triples": [...]}
        """
        nodes = []
        triples = []

        # Mine user message for preferences and facts
        nodes.extend(self.extract_from_text(
            user_text, agent_id=agent_id, session_id=session_id
        ))

        # Mine assistant message for decisions and patterns
        nodes.extend(self.extract_from_text(
            assistant_text, agent_id=agent_id, session_id=session_id
        ))

        # Extract triples from both
        combined = f"{user_text}\n{assistant_text}"
        triples.extend(self.extract_triples(combined, agent_id=agent_id))

        return {"nodes": nodes, "triples": triples}

    # ─── Tier Promotion (Periodic) ───────────────────────────────────────

    def auto_promote(self) -> int:
        """
        Promote working-tier nodes that have been around long enough.
        Call periodically (e.g., daily).

        Rule: Working tier (1) → Persistent (2) if older than 24 hours
              and importance >= 0.7.
        """
        promoted = 0
        cutoff = _now_ms() - (24 * 60 * 60 * 1000)  # 24 hours ago

        nodes = self.engine.get_nodes_by_tier(tier=1, limit=100)
        for node in nodes:
            if node.tier != 1:
                continue
            if node.created_at < cutoff and node.importance >= 0.7:
                node.tier = 2  # Promote to persistent
                node.updated_at = _now_ms()
                self.engine.store_node(node)
                promoted += 1

        return promoted
