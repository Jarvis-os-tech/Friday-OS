use crate::error::Result;
use rusqlite::Connection;
use tracing::info;

pub const CURRENT_SCHEMA_VERSION: i64 = 1;

pub fn initialize_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- 1. Schema Version Tracking
        CREATE TABLE IF NOT EXISTS schema_version (
            version     INTEGER PRIMARY KEY,
            applied_at  INTEGER NOT NULL
        );

        -- 2. Core Memory Nodes
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
        CREATE INDEX IF NOT EXISTS idx_nodes_importance ON memory_nodes(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_nodes_created ON memory_nodes(created_at DESC);

        -- 3. Memory Nodes Full-Text Search (FTS5)
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
            content,
            summary,
            content=memory_nodes,
            content_rowid=rowid,
            tokenize='porter unicode61'
        );

        -- 4. Memory Nodes FTS Synchronization Triggers
        CREATE TRIGGER IF NOT EXISTS trg_memory_nodes_ai AFTER INSERT ON memory_nodes BEGIN
            INSERT INTO memory_nodes_fts(rowid, content, summary)
            VALUES (new.rowid, new.content, new.summary);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_memory_nodes_ad AFTER DELETE ON memory_nodes BEGIN
            INSERT INTO memory_nodes_fts(memory_nodes_fts, rowid, content, summary)
            VALUES ('delete', old.rowid, old.content, old.summary);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_memory_nodes_au AFTER UPDATE ON memory_nodes BEGIN
            INSERT INTO memory_nodes_fts(memory_nodes_fts, rowid, content, summary)
            VALUES ('delete', old.rowid, old.content, old.summary);
            INSERT INTO memory_nodes_fts(rowid, content, summary)
            VALUES (new.rowid, new.content, new.summary);
        END;

        -- 5. Vector Embeddings (Raw IEEE 754 float32 BLOBs)
        CREATE TABLE IF NOT EXISTS memory_vectors (
            node_id         TEXT PRIMARY KEY REFERENCES memory_nodes(id) ON DELETE CASCADE,
            embedding       BLOB NOT NULL,
            model_name      TEXT NOT NULL,
            dimensions      INTEGER NOT NULL,
            created_at      INTEGER NOT NULL
        );

        -- 6. Graph Edges
        CREATE TABLE IF NOT EXISTS memory_edges (
            id              TEXT PRIMARY KEY,
            source_id       TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
            target_id       TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL,
            weight          REAL NOT NULL DEFAULT 1.0,
            metadata_json   TEXT,
            created_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_edges_kind ON memory_edges(kind);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON memory_edges(source_id, target_id, kind);

        -- 7. Conversation Turns
        CREATE TABLE IF NOT EXISTS conversation_turns (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            tool_name       TEXT,
            tool_call_json  TEXT,
            turn_index      INTEGER NOT NULL,
            token_count     INTEGER,
            created_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id, turn_index);

        -- 8. Conversation Turns Full-Text Search (FTS5)
        CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
            content,
            tool_name,
            content=conversation_turns,
            content_rowid=rowid,
            tokenize='porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS trg_turns_ai AFTER INSERT ON conversation_turns BEGIN
            INSERT INTO conversation_turns_fts(rowid, content, tool_name)
            VALUES (new.rowid, new.content, new.tool_name);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_turns_ad AFTER DELETE ON conversation_turns BEGIN
            INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content, tool_name)
            VALUES ('delete', old.rowid, old.content, old.tool_name);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_turns_au AFTER UPDATE ON conversation_turns BEGIN
            INSERT INTO conversation_turns_fts(conversation_turns_fts, rowid, content, tool_name)
            VALUES ('delete', old.rowid, old.content, old.tool_name);
            INSERT INTO conversation_turns_fts(rowid, content, tool_name)
            VALUES (new.rowid, new.content, new.tool_name);
        END;

        -- 9. Sessions Metadata
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

        -- 10. Memory Tree Buffers
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

        -- 11. Typed Knowledge Graph Nodes
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

        CREATE INDEX IF NOT EXISTS idx_kn_kind ON knowledge_nodes(kind);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kn_name_kind ON knowledge_nodes(name, kind);

        -- 12. Typed Knowledge Graph Edges
        CREATE TABLE IF NOT EXISTS knowledge_edges (
            id              TEXT PRIMARY KEY,
            source_id       TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
            target_id       TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
            kind            TEXT NOT NULL,
            weight          REAL DEFAULT 1.0,
            created_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_unique ON knowledge_edges(source_id, target_id, kind);
        
        -- 13. System Schema Info & Health Status
        CREATE TABLE IF NOT EXISTS schema_info (
            version         INTEGER PRIMARY KEY,
            engine_version  TEXT NOT NULL,
            initialized_at  INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL,
            tables_count    INTEGER NOT NULL,
            status          TEXT NOT NULL
        );

        -- 14. Temporal Knowledge Graph
        CREATE TABLE IF NOT EXISTS knowledge_triples (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object TEXT NOT NULL,
            valid_from INTEGER NOT NULL,
            valid_to INTEGER,
            confidence REAL NOT NULL DEFAULT 0.8,
            source_node_id TEXT REFERENCES memory_nodes(id) ON DELETE SET NULL,
            source TEXT NOT NULL DEFAULT 'auto',
            agent_id TEXT,
            metadata_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_kt_subject ON knowledge_triples(subject);
        CREATE INDEX IF NOT EXISTS idx_kt_object ON knowledge_triples(object);
        CREATE INDEX IF NOT EXISTS idx_kt_predicate ON knowledge_triples(predicate);
        CREATE INDEX IF NOT EXISTS idx_kt_valid ON knowledge_triples(valid_from, valid_to);

        -- 15. Agent reflection logs
        CREATE TABLE IF NOT EXISTS diary_entries (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL DEFAULT 'jarvis',
            session_id TEXT,
            entry_type TEXT NOT NULL DEFAULT 'reflection',
            content TEXT NOT NULL,
            tags_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_diary_agent ON diary_entries(agent_id);
        CREATE INDEX IF NOT EXISTS idx_diary_created ON diary_entries(created_at DESC);

        -- 16. Agent coordination queue
        CREATE TABLE IF NOT EXISTS events_mesh (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            source_agent TEXT NOT NULL,
            target_agent TEXT,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL,
            processed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_events_status ON events_mesh(status);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events_mesh(event_type);
        "#,
    )?;

    // Record schema version and system info
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?1, ?2);",
        rusqlite::params![CURRENT_SCHEMA_VERSION, now],
    )?;

    conn.execute(
        r#"
        INSERT INTO schema_info (version, engine_version, initialized_at, updated_at, tables_count, status)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(version) DO UPDATE SET
            updated_at = excluded.updated_at,
            tables_count = excluded.tables_count,
            status = excluded.status;
        "#,
        rusqlite::params![CURRENT_SCHEMA_VERSION, "0.1.0", now, now, 16, "healthy"],
    )?;

    info!("Database schema initialized (version {})", CURRENT_SCHEMA_VERSION);
    Ok(())
}
