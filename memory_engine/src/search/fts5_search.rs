use crate::db::DatabasePool;
use crate::error::Result;
use crate::types::{MemoryNode, NodeKind, Tier};
use rusqlite::{params, Row};
use std::str::FromStr;

pub struct Fts5SearchResult {
    pub node: MemoryNode,
    pub bm25_score: f32,
    pub snippet: Option<String>,
}

pub struct Fts5SearchEngine {
    pool: DatabasePool,
}

impl Fts5SearchEngine {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    /// Clean query text for FTS5 boolean matching
    pub fn sanitize_fts_query(query: &str) -> String {
        let cleaned: String = query
            .chars()
            .map(|c| match c {
                '"' | '*' | '(' | ')' | '^' | ':' | '-' | '+' | '~' | '?' => ' ',
                _ => c,
            })
            .collect();

        let terms: Vec<&str> = cleaned
            .split_whitespace()
            .filter(|w| !w.is_empty())
            .collect();

        if terms.is_empty() {
            return String::new();
        }

        // Prefix match on each term for live-search feel: e.g. "rust* OR neovim*"
        terms
            .iter()
            .map(|t| format!("\"{}\"*", t))
            .collect::<Vec<_>>()
            .join(" OR ")
    }

    fn row_to_node(row: &Row) -> rusqlite::Result<MemoryNode> {
        let kind_str: String = row.get("kind")?;
        let kind = NodeKind::from_str(&kind_str).unwrap_or(NodeKind::Fact);
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

    /// Execute FTS5 BM25 search over memory_nodes_fts
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        include_superseded: bool,
    ) -> Result<Vec<Fts5SearchResult>> {
        let sanitized = Self::sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        self.pool.with_conn(|conn| {
            let sql = if include_superseded {
                r#"
                SELECT m.id, m.kind, m.tier, m.content, m.summary, m.parent_id,
                       m.tree_level, m.importance, m.superseded_by, m.agent_id,
                       m.session_id, m.source, m.metadata_json, m.created_at, m.updated_at,
                       bm25(memory_nodes_fts) AS bm25_rank,
                       snippet(memory_nodes_fts, 0, '<b>', '</b>', '...', 16) AS snip
                FROM memory_nodes_fts f
                JOIN memory_nodes m ON m.rowid = f.rowid
                WHERE memory_nodes_fts MATCH ?1
                ORDER BY bm25_rank ASC
                LIMIT ?2;
                "#
            } else {
                r#"
                SELECT m.id, m.kind, m.tier, m.content, m.summary, m.parent_id,
                       m.tree_level, m.importance, m.superseded_by, m.agent_id,
                       m.session_id, m.source, m.metadata_json, m.created_at, m.updated_at,
                       bm25(memory_nodes_fts) AS bm25_rank,
                       snippet(memory_nodes_fts, 0, '<b>', '</b>', '...', 16) AS snip
                FROM memory_nodes_fts f
                JOIN memory_nodes m ON m.rowid = f.rowid
                WHERE memory_nodes_fts MATCH ?1 AND m.superseded_by IS NULL
                ORDER BY bm25_rank ASC
                LIMIT ?2;
                "#
            };

            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![sanitized, limit as i64], |row| {
                let node = Self::row_to_node(row)?;
                let raw_rank: f64 = row.get("bm25_rank")?;
                let snip: Option<String> = row.get("snip")?;

                // BM25 rank in SQLite is negative where lower is better (e.g. -10.0 is better than -1.0)
                let abs_rank = (-raw_rank).max(0.0) as f32;
                let normalized_score = (abs_rank / (abs_rank + 1.0)).clamp(0.0, 1.0);

                Ok(Fts5SearchResult {
                    node,
                    bm25_score: normalized_score,
                    snippet: snip,
                })
            })?;

            let mut results = Vec::new();
            for r in rows {
                results.push(r?);
            }
            Ok(results)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repository::NodeRepository;

    #[test]
    fn test_fts5_search() {
        let pool = DatabasePool::in_memory().unwrap();
        let node_repo = NodeRepository::new(pool.clone());
        let fts = Fts5SearchEngine::new(pool);

        let now = chrono::Utc::now().timestamp();
        let n1 = MemoryNode {
            id: "node-search-1".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "User prefers Neovim with Lua for Rust development".to_string(),
            summary: Some("Editor Preference".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.9,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "user".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        let n2 = MemoryNode {
            id: "node-search-2".to_string(),
            kind: NodeKind::Decision,
            tier: Tier::Persistent,
            content: "We chose SQLite WAL mode for microsecond persistence".to_string(),
            summary: Some("Database Choice".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.85,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "system".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        node_repo.insert(&n1).unwrap();
        node_repo.insert(&n2).unwrap();

        let res = fts.search("Neovim Rust", 10, false).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].node.id, "node-search-1");
        assert!(res[0].bm25_score > 0.0);

        let res2 = fts.search("SQLite WAL", 10, false).unwrap();
        assert_eq!(res2.len(), 1);
        assert_eq!(res2[0].node.id, "node-search-2");
    }
}
