"""
Friday Memory System — SQLite Engine
Single database, single source of truth. Uses the existing memory.db schema.
All reads and writes go through this module.
"""

import sqlite3
import hashlib
from typing import List, Optional, Dict, Any

from .config import DB_PATH
from .types import (
    MemoryNode, ConversationTurn, Session,
    KnowledgeTriple, DiaryEntry, EventMesh,
    _now_ms, _new_id,
)


class MemoryEngine:
    """Core SQLite engine for the Friday memory system."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        return conn

    # ─── Schema Bootstrap ────────────────────────────────────────────────

    def _ensure_schema(self):
        """Create all tables if they don't exist. Idempotent."""
        conn = self._conn()
        with conn:
            conn.executescript(_SCHEMA_SQL)
        conn.close()

    # ═══════════════════════════════════════════════════════════════════════
    # Memory Nodes — the core storage unit
    # ═══════════════════════════════════════════════════════════════════════

    def store_node(self, node: MemoryNode) -> str:
        """Insert or replace a memory node. Returns the node ID."""
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO memory_nodes
                (id, kind, tier, content, summary, parent_id, tree_level,
                 importance, superseded_by, agent_id, session_id, source,
                 metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                node.id, node.kind, node.tier, node.content, node.summary,
                node.parent_id, node.tree_level, node.importance,
                node.superseded_by, node.agent_id, node.session_id,
                node.source, node.metadata_json, node.created_at, node.updated_at,
            ))
        conn.close()
        return node.id

    def get_node(self, node_id: str) -> Optional[MemoryNode]:
        conn = self._conn()
        row = conn.execute(
            "SELECT * FROM memory_nodes WHERE id = ?", (node_id,)
        ).fetchone()
        conn.close()
        return _row_to_node(row) if row else None

    def search_nodes(self, query: str, limit: int = 10) -> List[MemoryNode]:
        """Full-text search across memory nodes using FTS5."""
        conn = self._conn()
        rows = conn.execute("""
            SELECT mn.* FROM memory_nodes mn
            JOIN memory_nodes_fts fts ON mn.rowid = fts.rowid
            WHERE memory_nodes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """, (query, limit)).fetchall()
        conn.close()
        return [_row_to_node(r) for r in rows]

    def get_nodes_by_agent(self, agent_id: str, limit: int = 50) -> List[MemoryNode]:
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM memory_nodes WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
            (agent_id, limit)
        ).fetchall()
        conn.close()
        return [_row_to_node(r) for r in rows]

    def get_nodes_by_tier(self, tier: int, limit: int = 50) -> List[MemoryNode]:
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM memory_nodes WHERE tier >= ? ORDER BY importance DESC, created_at DESC LIMIT ?",
            (tier, limit)
        ).fetchall()
        conn.close()
        return [_row_to_node(r) for r in rows]

    def get_nodes_by_kind(self, kind: str, limit: int = 50) -> List[MemoryNode]:
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM memory_nodes WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
            (kind, limit)
        ).fetchall()
        conn.close()
        return [_row_to_node(r) for r in rows]

    def delete_node(self, node_id: str) -> bool:
        conn = self._conn()
        with conn:
            cursor = conn.execute("DELETE FROM memory_nodes WHERE id = ?", (node_id,))
        conn.close()
        return cursor.rowcount > 0

    def count_nodes(self, agent_id: Optional[str] = None) -> int:
        conn = self._conn()
        if agent_id:
            row = conn.execute(
                "SELECT COUNT(*) as c FROM memory_nodes WHERE agent_id = ?", (agent_id,)
            ).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) as c FROM memory_nodes").fetchone()
        conn.close()
        return row["c"] if row else 0

    def node_exists_by_hash(self, content_hash: str) -> bool:
        """Check if a node with this content hash already exists (for dedup)."""
        conn = self._conn()
        row = conn.execute(
            "SELECT 1 FROM memory_nodes WHERE id = ? LIMIT 1", (content_hash,)
        ).fetchone()
        conn.close()
        return row is not None

    # ═══════════════════════════════════════════════════════════════════════
    # Conversation Turns
    # ═══════════════════════════════════════════════════════════════════════

    def store_turn(self, turn: ConversationTurn) -> str:
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT OR IGNORE INTO conversation_turns
                (id, session_id, role, content, tool_name, tool_call_json,
                 turn_index, token_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                turn.id, turn.session_id, turn.role, turn.content,
                turn.tool_name, turn.tool_call_json, turn.turn_index,
                turn.token_count, turn.created_at,
            ))
        conn.close()
        return turn.id

    def get_turns_by_session(self, session_id: str, limit: int = 100) -> List[ConversationTurn]:
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_index ASC LIMIT ?",
            (session_id, limit)
        ).fetchall()
        conn.close()
        return [_row_to_turn(r) for r in rows]

    def search_turns(self, query: str, limit: int = 10) -> List[ConversationTurn]:
        conn = self._conn()
        rows = conn.execute("""
            SELECT ct.* FROM conversation_turns ct
            JOIN conversation_turns_fts fts ON ct.rowid = fts.rowid
            WHERE conversation_turns_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """, (query, limit)).fetchall()
        conn.close()
        return [_row_to_turn(r) for r in rows]

    # ═══════════════════════════════════════════════════════════════════════
    # Sessions
    # ═══════════════════════════════════════════════════════════════════════

    def store_session(self, session: Session) -> str:
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO sessions
                (id, agent_id, parent_session, total_tokens, total_turns,
                 total_tool_calls, summary, started_at, ended_at, consolidated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session.id, session.agent_id, session.parent_session,
                session.total_tokens, session.total_turns, session.total_tool_calls,
                session.summary, session.started_at, session.ended_at,
                1 if session.consolidated else 0,
            ))
        conn.close()
        return session.id

    def get_session(self, session_id: str) -> Optional[Session]:
        conn = self._conn()
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        conn.close()
        return _row_to_session(row) if row else None

    # ═══════════════════════════════════════════════════════════════════════
    # Knowledge Triples
    # ═══════════════════════════════════════════════════════════════════════

    def store_triple(self, triple: KnowledgeTriple) -> str:
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT OR IGNORE INTO knowledge_triples
                (id, subject, predicate, object, valid_from, valid_to,
                 confidence, source_node_id, source, agent_id,
                 metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                triple.id, triple.subject, triple.predicate, triple.object,
                triple.valid_from, triple.valid_to, triple.confidence,
                triple.source_node_id, triple.source, triple.agent_id,
                triple.metadata_json, triple.created_at,
            ))
        conn.close()
        return triple.id

    def search_triples(self, subject: Optional[str] = None,
                       predicate: Optional[str] = None,
                       limit: int = 20) -> List[KnowledgeTriple]:
        conn = self._conn()
        conditions, params = [], []
        if subject:
            conditions.append("subject LIKE ?")
            params.append(f"%{subject}%")
        if predicate:
            conditions.append("predicate LIKE ?")
            params.append(f"%{predicate}%")
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        rows = conn.execute(
            f"SELECT * FROM knowledge_triples {where} ORDER BY created_at DESC LIMIT ?",
            params + [limit]
        ).fetchall()
        conn.close()
        return [_row_to_triple(r) for r in rows]

    # ═══════════════════════════════════════════════════════════════════════
    # Diary Entries
    # ═══════════════════════════════════════════════════════════════════════

    def store_diary(self, entry: DiaryEntry) -> str:
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT OR IGNORE INTO diary_entries
                (id, agent_id, session_id, entry_type, content, tags_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                entry.id, entry.agent_id, entry.session_id,
                entry.entry_type, entry.content, entry.tags_json,
                entry.created_at,
            ))
        conn.close()
        return entry.id

    def get_diary(self, agent_id: Optional[str] = None, limit: int = 20) -> List[DiaryEntry]:
        conn = self._conn()
        if agent_id:
            rows = conn.execute(
                "SELECT * FROM diary_entries WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
                (agent_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        conn.close()
        return [_row_to_diary(r) for r in rows]

    # ═══════════════════════════════════════════════════════════════════════
    # Events Mesh
    # ═══════════════════════════════════════════════════════════════════════

    def emit_event(self, event: EventMesh) -> str:
        conn = self._conn()
        with conn:
            conn.execute("""
                INSERT INTO events_mesh
                (id, event_type, source_agent, target_agent, payload_json,
                 status, created_at, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event.id, event.event_type, event.source_agent,
                event.target_agent, event.payload_json, event.status,
                event.created_at, event.processed_at,
            ))
        conn.close()
        return event.id

    def get_pending_events(self, target_agent: Optional[str] = None,
                           limit: int = 20) -> List[EventMesh]:
        conn = self._conn()
        if target_agent:
            rows = conn.execute(
                "SELECT * FROM events_mesh WHERE status='pending' AND target_agent=? ORDER BY created_at ASC LIMIT ?",
                (target_agent, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM events_mesh WHERE status='pending' ORDER BY created_at ASC LIMIT ?",
                (limit,)
            ).fetchall()
        conn.close()
        return [_row_to_event(r) for r in rows]

    def ack_event(self, event_id: str):
        conn = self._conn()
        with conn:
            conn.execute(
                "UPDATE events_mesh SET status='processed', processed_at=? WHERE id=?",
                (_now_ms(), event_id)
            )
        conn.close()

    # ═══════════════════════════════════════════════════════════════════════
    # Status & Stats
    # ═══════════════════════════════════════════════════════════════════════

    def get_stats(self) -> Dict[str, Any]:
        conn = self._conn()
        stats = {}
        for table in ["memory_nodes", "conversation_turns", "sessions",
                       "knowledge_triples", "diary_entries", "events_mesh"]:
            row = conn.execute(f"SELECT COUNT(*) as c FROM {table}").fetchone()
            stats[table] = row["c"] if row else 0
        conn.close()
        stats["db_path"] = self.db_path
        return stats


# ═══════════════════════════════════════════════════════════════════════════
# Row → Dataclass Converters
# ═══════════════════════════════════════════════════════════════════════════

def _row_to_node(r: sqlite3.Row) -> MemoryNode:
    return MemoryNode(
        id=r["id"], kind=r["kind"], tier=r["tier"], content=r["content"],
        summary=r["summary"], parent_id=r["parent_id"],
        tree_level=r["tree_level"], importance=r["importance"],
        superseded_by=r["superseded_by"], agent_id=r["agent_id"],
        session_id=r["session_id"], source=r["source"],
        metadata_json=r["metadata_json"],
        created_at=r["created_at"], updated_at=r["updated_at"],
    )

def _row_to_turn(r: sqlite3.Row) -> ConversationTurn:
    return ConversationTurn(
        id=r["id"], session_id=r["session_id"], role=r["role"],
        content=r["content"], tool_name=r["tool_name"],
        tool_call_json=r["tool_call_json"], turn_index=r["turn_index"],
        token_count=r["token_count"], created_at=r["created_at"],
    )

def _row_to_session(r: sqlite3.Row) -> Session:
    return Session(
        id=r["id"], agent_id=r["agent_id"],
        parent_session=r["parent_session"],
        total_tokens=r["total_tokens"], total_turns=r["total_turns"],
        total_tool_calls=r["total_tool_calls"], summary=r["summary"],
        started_at=r["started_at"], ended_at=r["ended_at"],
        consolidated=bool(r["consolidated"]),
    )

def _row_to_triple(r: sqlite3.Row) -> KnowledgeTriple:
    return KnowledgeTriple(
        id=r["id"], subject=r["subject"], predicate=r["predicate"],
        object=r["object"], valid_from=r["valid_from"],
        valid_to=r["valid_to"], confidence=r["confidence"],
        source_node_id=r["source_node_id"], source=r["source"],
        agent_id=r["agent_id"], metadata_json=r["metadata_json"],
        created_at=r["created_at"],
    )

def _row_to_diary(r: sqlite3.Row) -> DiaryEntry:
    return DiaryEntry(
        id=r["id"], agent_id=r["agent_id"], session_id=r["session_id"],
        entry_type=r["entry_type"], content=r["content"],
        tags_json=r["tags_json"], created_at=r["created_at"],
    )

def _row_to_event(r: sqlite3.Row) -> EventMesh:
    return EventMesh(
        id=r["id"], event_type=r["event_type"],
        source_agent=r["source_agent"], target_agent=r["target_agent"],
        payload_json=r["payload_json"], status=r["status"],
        created_at=r["created_at"], processed_at=r["processed_at"],
    )


# ═══════════════════════════════════════════════════════════════════════════
# Schema SQL — matches the existing Rust memory_engine schema exactly
# ═══════════════════════════════════════════════════════════════════════════

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS memory_nodes (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    tier            INTEGER NOT NULL DEFAULT 0,
    content         TEXT NOT NULL,
    summary         TEXT,
    parent_id       TEXT REFERENCES memory_nodes(id) ON DELETE SET NULL,
    tree_level      INTEGER DEFAULT 0,
    importance      REAL NOT NULL DEFAULT 0.5,
    superseded_by   TEXT REFERENCES memory_nodes(id) ON DELETE SET NULL,
    agent_id        TEXT,
    session_id      TEXT,
    source          TEXT NOT NULL DEFAULT 'auto',
    metadata_json   TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_kind ON memory_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_tier ON memory_nodes(tier);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON memory_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_session ON memory_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_agent ON memory_nodes(agent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_importance ON memory_nodes(importance DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_created ON memory_nodes(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
    content, summary,
    content=memory_nodes, content_rowid=rowid,
    tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS memory_vectors (
    node_id     TEXT PRIMARY KEY REFERENCES memory_nodes(id) ON DELETE CASCADE,
    embedding   BLOB NOT NULL,
    model_name  TEXT NOT NULL,
    dimensions  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_edges (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    target_id       TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    weight          REAL DEFAULT 1.0,
    metadata_json   TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);

CREATE TABLE IF NOT EXISTS conversation_turns (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    tool_name       TEXT,
    tool_call_json  TEXT,
    turn_index      INTEGER DEFAULT 0,
    token_count     INTEGER,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_created ON conversation_turns(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
    content, tool_name,
    content=conversation_turns, content_rowid=rowid,
    tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    agent_id            TEXT,
    parent_session      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    total_tokens        INTEGER DEFAULT 0,
    total_turns         INTEGER DEFAULT 0,
    total_tool_calls    INTEGER DEFAULT 0,
    summary             TEXT,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    consolidated        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    mastery_score   REAL DEFAULT 0.0,
    metadata_json   TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kn_name_kind ON knowledge_nodes(name, kind);

CREATE TABLE IF NOT EXISTS knowledge_edges (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_id       TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    weight          REAL DEFAULT 1.0,
    created_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_unique ON knowledge_edges(source_id, target_id, kind);

CREATE TABLE IF NOT EXISTS knowledge_triples (
    id              TEXT PRIMARY KEY,
    subject         TEXT NOT NULL,
    predicate       TEXT NOT NULL,
    object          TEXT NOT NULL,
    valid_from      INTEGER NOT NULL,
    valid_to        INTEGER,
    confidence      REAL NOT NULL DEFAULT 0.8,
    source_node_id  TEXT REFERENCES memory_nodes(id) ON DELETE SET NULL,
    source          TEXT NOT NULL DEFAULT 'auto',
    agent_id        TEXT,
    metadata_json   TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kt_subject ON knowledge_triples(subject);
CREATE INDEX IF NOT EXISTS idx_kt_object ON knowledge_triples(object);
CREATE INDEX IF NOT EXISTS idx_kt_predicate ON knowledge_triples(predicate);

CREATE TABLE IF NOT EXISTS diary_entries (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL DEFAULT 'friday-prime',
    session_id  TEXT,
    entry_type  TEXT NOT NULL DEFAULT 'reflection',
    content     TEXT NOT NULL,
    tags_json   TEXT,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diary_agent ON diary_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_created ON diary_entries(created_at DESC);

CREATE TABLE IF NOT EXISTS events_mesh (
    id              TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    source_agent    TEXT NOT NULL,
    target_agent    TEXT,
    payload_json    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      INTEGER NOT NULL,
    processed_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events_mesh(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events_mesh(event_type);

CREATE TABLE IF NOT EXISTS tree_buffers (
    id              TEXT PRIMARY KEY,
    tree_scope      TEXT NOT NULL,
    tree_kind       TEXT NOT NULL,
    level           INTEGER NOT NULL DEFAULT 0,
    node_ids_json   TEXT NOT NULL,
    capacity        INTEGER NOT NULL DEFAULT 0,
    max_capacity    INTEGER NOT NULL DEFAULT 8,
    last_flush_at   INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buffers_scope ON tree_buffers(tree_scope, tree_kind);

CREATE TABLE IF NOT EXISTS schema_info (
    version         INTEGER PRIMARY KEY,
    engine_version  TEXT NOT NULL,
    initialized_at  INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    tables_count    INTEGER NOT NULL,
    status          TEXT NOT NULL
);
"""
