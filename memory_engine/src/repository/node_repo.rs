use crate::db::DatabasePool;
use crate::error::{MemoryError, Result};
use crate::types::{MemoryNode, MemoryVector, NodeKind, Tier};
use rusqlite::{params, Row};
use std::str::FromStr;

#[derive(Clone)]
pub struct NodeRepository {
    pool: DatabasePool,
}

impl NodeRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_node(row: &Row) -> rusqlite::Result<MemoryNode> {
        let kind_str: String = row.get("kind")?;
        let kind = NodeKind::from_str(&kind_str)
            .unwrap_or(NodeKind::Fact);
        let tier_val: i64 = row.get("tier")?;

        Ok(MemoryNode {
            id: row.get("id")?,
            kind,
            tier: Tier::from(tier_val),
            content: row.get("content")?,
            summary: row.get("summary")?,
            parent_id: row.get("parent_id")?,
            tree_level: row.get("tree_level")?,
            importance: row.get("importance")?,
            superseded_by: row.get("superseded_by")?,
            agent_id: row.get("agent_id")?,
            session_id: row.get("session_id")?,
            source: row.get("source")?,
            metadata_json: row.get("metadata_json")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn insert(&self, node: &MemoryNode) -> Result<()> {
        crate::security::SecretScanner::scan_and_enforce(&node.content)?;
        if let Some(s) = &node.summary {
            crate::security::SecretScanner::scan_and_enforce(s)?;
        }

        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO memory_nodes (
                    id, kind, tier, content, summary, parent_id, tree_level,
                    importance, superseded_by, agent_id, session_id, source,
                    metadata_json, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15);
                "#,
                params![
                    node.id,
                    node.kind.to_string(),
                    node.tier as i64,
                    node.content,
                    node.summary,
                    node.parent_id,
                    node.tree_level,
                    node.importance,
                    node.superseded_by,
                    node.agent_id,
                    node.session_id,
                    node.source,
                    node.metadata_json,
                    node.created_at,
                    node.updated_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_by_id(&self, id: &str) -> Result<Option<MemoryNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, parent_id, tree_level, \
                 importance, superseded_by, agent_id, session_id, source, \
                 metadata_json, created_at, updated_at FROM memory_nodes WHERE id = ?1;",
            )?;

            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(Self::row_to_node(row)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn update(&self, node: &MemoryNode) -> Result<()> {
        self.pool.with_conn(|conn| {
            let rows_affected = conn.execute(
                r#"
                UPDATE memory_nodes SET
                    kind = ?2,
                    tier = ?3,
                    content = ?4,
                    summary = ?5,
                    parent_id = ?6,
                    tree_level = ?7,
                    importance = ?8,
                    superseded_by = ?9,
                    agent_id = ?10,
                    session_id = ?11,
                    source = ?12,
                    metadata_json = ?13,
                    updated_at = ?14
                WHERE id = ?1;
                "#,
                params![
                    node.id,
                    node.kind.to_string(),
                    node.tier as i64,
                    node.content,
                    node.summary,
                    node.parent_id,
                    node.tree_level,
                    node.importance,
                    node.superseded_by,
                    node.agent_id,
                    node.session_id,
                    node.source,
                    node.metadata_json,
                    node.updated_at
                ],
            )?;

            if rows_affected == 0 {
                return Err(MemoryError::NotFound(format!("Node {} not found for update", node.id)));
            }
            Ok(())
        })
    }

    pub fn soft_delete(&self, id: &str, superseded_by: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            let rows = conn.execute(
                "UPDATE memory_nodes SET superseded_by = ?2, updated_at = ?3 WHERE id = ?1;",
                params![id, superseded_by, now],
            )?;
            if rows == 0 {
                return Err(MemoryError::NotFound(format!("Node {} not found for soft-delete", id)));
            }
            Ok(())
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        self.pool.with_conn(|conn| {
            let rows = conn.execute("DELETE FROM memory_nodes WHERE id = ?1;", params![id])?;
            Ok(rows > 0)
        })
    }

    pub fn list_active(&self, limit: usize) -> Result<Vec<MemoryNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, parent_id, tree_level, \
                 importance, superseded_by, agent_id, session_id, source, \
                 metadata_json, created_at, updated_at \
                 FROM memory_nodes \
                 WHERE superseded_by IS NULL \
                 ORDER BY importance DESC, created_at DESC \
                 LIMIT ?1;",
            )?;

            let node_iter = stmt.query_map(params![limit as i64], Self::row_to_node)?;
            let mut nodes = Vec::new();
            for node in node_iter {
                nodes.push(node?);
            }
            Ok(nodes)
        })
    }

    pub fn list_by_tier(&self, tier: Tier, limit: usize) -> Result<Vec<MemoryNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, parent_id, tree_level, \
                 importance, superseded_by, agent_id, session_id, source, \
                 metadata_json, created_at, updated_at \
                 FROM memory_nodes \
                 WHERE tier = ?1 AND superseded_by IS NULL \
                 ORDER BY created_at DESC \
                 LIMIT ?2;",
            )?;

            let node_iter = stmt.query_map(params![tier as i64, limit as i64], Self::row_to_node)?;
            let mut nodes = Vec::new();
            for node in node_iter {
                nodes.push(node?);
            }
            Ok(nodes)
        })
    }

    pub fn list_by_kind(&self, kind: NodeKind, limit: usize) -> Result<Vec<MemoryNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, parent_id, tree_level, \
                 importance, superseded_by, agent_id, session_id, source, \
                 metadata_json, created_at, updated_at \
                 FROM memory_nodes \
                 WHERE kind = ?1 AND superseded_by IS NULL \
                 ORDER BY created_at DESC \
                 LIMIT ?2;",
            )?;

            let node_iter = stmt.query_map(params![kind.to_string(), limit as i64], Self::row_to_node)?;
            let mut nodes = Vec::new();
            for node in node_iter {
                nodes.push(node?);
            }
            Ok(nodes)
        })
    }

    pub fn insert_vector(&self, vector: &MemoryVector) -> Result<()> {
        let blob: Vec<u8> = vector
            .embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT OR REPLACE INTO memory_vectors (
                    node_id, embedding, model_name, dimensions, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5);
                "#,
                params![
                    vector.node_id,
                    blob,
                    vector.model_name,
                    vector.dimensions as i64,
                    vector.created_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_vector(&self, node_id: &str) -> Result<Option<MemoryVector>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT node_id, embedding, model_name, dimensions, created_at \
                 FROM memory_vectors WHERE node_id = ?1;",
            )?;

            let mut rows = stmt.query(params![node_id])?;
            if let Some(row) = rows.next()? {
                let blob: Vec<u8> = row.get("embedding")?;
                let dimensions: usize = row.get::<_, i64>("dimensions")? as usize;
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap_or_default()))
                    .collect();

                Ok(Some(MemoryVector {
                    node_id: row.get("node_id")?,
                    embedding,
                    model_name: row.get("model_name")?,
                    dimensions,
                    created_at: row.get("created_at")?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn get_all_vectors(&self) -> Result<Vec<MemoryVector>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT node_id, embedding, model_name, dimensions, created_at FROM memory_vectors;",
            )?;

            let mut rows = stmt.query([])?;
            let mut vectors = Vec::new();
            while let Some(row) = rows.next()? {
                let blob: Vec<u8> = row.get("embedding")?;
                let dimensions: usize = row.get::<_, i64>("dimensions")? as usize;
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap_or_default()))
                    .collect();

                vectors.push(MemoryVector {
                    node_id: row.get("node_id")?,
                    embedding,
                    model_name: row.get("model_name")?,
                    dimensions,
                    created_at: row.get("created_at")?,
                });
            }
            Ok(vectors)
        })
    }

    pub fn count(&self) -> Result<usize> {
        self.pool.with_conn(|conn| {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM memory_nodes;", [], |r| r.get(0))?;
            Ok(count as usize)
        })
    }

    pub fn decay_importance(&self, decay_rate: f64) -> Result<usize> {
        let now = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            let rows = conn.execute(
                r#"
                UPDATE memory_nodes
                SET importance = MAX(0.01, importance * (1.0 - ?1)),
                    updated_at = ?2
                WHERE tier < 2 AND superseded_by IS NULL;
                "#,
                params![decay_rate, now],
            )?;
            Ok(rows)
        })
    }
}
