"""
Friday Memory System — Hermes Memory Bridge
Read-only sync: imports Hermes long-term memory into Friday's memory vault.
Parses ~/.hermes/memories/MEMORY.md and USER.md (§-delimited entries).
"""

import os
import hashlib
import time
from typing import List, Dict, Optional

from .config import HERMES_HOME, HERMES_MEMORIES_DIR
from .types import MemoryNode, _now_ms
from .engine import MemoryEngine


class HermesBridge:
    """
    Read-only bridge from Hermes long-term memory → Friday memory.

    Hermes stores memory as §-delimited text blocks in:
      - ~/.hermes/memories/MEMORY.md  (system knowledge)
      - ~/.hermes/memories/USER.md    (operator profile)

    This bridge parses those blocks and imports them as knowledge-tier
    memory nodes, deduplicated by content hash.
    """

    def __init__(self, engine: MemoryEngine):
        self.engine = engine
        self.memory_path = os.path.join(HERMES_MEMORIES_DIR, "MEMORY.md")
        self.user_path = os.path.join(HERMES_MEMORIES_DIR, "USER.md")

    # ─── Public API ──────────────────────────────────────────────────────

    def sync(self) -> Dict[str, int]:
        """
        Read Hermes memory files and import new entries into Friday.
        Returns counts: {"imported": N, "skipped": M, "total": T}
        """
        imported, skipped = 0, 0

        # Import MEMORY.md entries
        memory_entries = self._parse_hermes_file(self.memory_path)
        for entry in memory_entries:
            if self._import_entry(entry, kind="fact", source_file="MEMORY.md"):
                imported += 1
            else:
                skipped += 1

        # Import USER.md entries
        user_entries = self._parse_hermes_file(self.user_path)
        for entry in user_entries:
            if self._import_entry(entry, kind="entity", source_file="USER.md"):
                imported += 1
            else:
                skipped += 1

        total = len(memory_entries) + len(user_entries)
        return {"imported": imported, "skipped": skipped, "total": total}

    def get_hermes_status(self) -> Dict[str, any]:
        """Check Hermes memory availability and stats."""
        return {
            "hermes_home": HERMES_HOME,
            "hermes_available": os.path.exists(HERMES_HOME),
            "memory_md_exists": os.path.exists(self.memory_path),
            "user_md_exists": os.path.exists(self.user_path),
            "memory_md_size": os.path.getsize(self.memory_path) if os.path.exists(self.memory_path) else 0,
            "user_md_size": os.path.getsize(self.user_path) if os.path.exists(self.user_path) else 0,
            "memory_entries": len(self._parse_hermes_file(self.memory_path)),
            "user_entries": len(self._parse_hermes_file(self.user_path)),
        }

    def get_raw_memory(self) -> str:
        """Read raw Hermes MEMORY.md content."""
        return self._read_file(self.memory_path)

    def get_raw_user(self) -> str:
        """Read raw Hermes USER.md content."""
        return self._read_file(self.user_path)

    # ─── Internal ────────────────────────────────────────────────────────

    def _parse_hermes_file(self, path: str) -> List[str]:
        """
        Parse a Hermes memory file into individual entries.
        Hermes uses § as a delimiter between memory blocks.
        """
        content = self._read_file(path)
        if not content:
            return []

        # Split on § delimiter
        blocks = content.split("§")
        entries = []
        for block in blocks:
            text = block.strip()
            if text and len(text) > 10:  # Skip tiny fragments
                entries.append(text)
        return entries

    def _import_entry(self, text: str, kind: str = "fact",
                      source_file: str = "MEMORY.md") -> bool:
        """
        Import a single Hermes entry as a memory node.
        Returns True if imported, False if already exists (deduplicated).
        """
        # Content-hash for dedup
        content_hash = self._hash(text)
        node_id = f"hermes_{content_hash}"

        # Skip if already imported
        if self.engine.node_exists_by_hash(node_id):
            return False

        node = MemoryNode(
            id=node_id,
            kind=kind,
            tier=3,                  # Knowledge tier (permanent)
            content=text,
            summary=text[:200] if len(text) > 200 else None,
            importance=0.8,
            agent_id="hermes",
            source="hermes",
            metadata_json=f'{{"source_file": "{source_file}"}}',
        )
        self.engine.store_node(node)
        return True

    @staticmethod
    def _hash(text: str) -> str:
        """SHA-256 hash of content for deduplication."""
        return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _read_file(path: str) -> str:
        if not os.path.exists(path):
            return ""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return ""
