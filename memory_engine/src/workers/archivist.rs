use crate::db::DatabasePool;
use crate::error::Result;
use crate::repository::NodeRepository;
use crate::types::{MemoryNode, NodeKind, Tier};
use uuid::Uuid;

pub struct Archivist {
    pool: DatabasePool,
    node_repo: NodeRepository,
}

impl Archivist {
    pub fn new(pool: DatabasePool, node_repo: NodeRepository) -> Self {
        Self { pool, node_repo }
    }

    pub fn check_and_consolidate(&self, threshold_tokens: i64) -> Result<usize> {
        let session_ids: Vec<String> = self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM sessions WHERE total_tokens >= ?1 AND consolidated = 0;")?;
            let rows = stmt.query_map([threshold_tokens], |row| row.get(0))?;
            let mut ids = Vec::new();
            for r in rows {
                ids.push(r?);
            }
            Ok(ids)
        })?;

        let mut consolidated_count = 0;
        for session_id in session_ids {
            let summary_content = format!("Archived summary for session {}", session_id);
            
            let now = chrono::Utc::now().timestamp();
            let node = MemoryNode {
                id: format!("node-{}", Uuid::new_v4()),
                kind: NodeKind::Lesson,
                tier: Tier::Persistent,
                content: summary_content.clone(),
                summary: Some(summary_content),
                parent_id: None,
                tree_level: 0,
                importance: 0.8,
                superseded_by: None,
                agent_id: None,
                session_id: Some(session_id.clone()),
                source: "archivist".to_string(),
                metadata_json: None,
                created_at: now,
                updated_at: now,
            };

            self.node_repo.insert(&node)?;

            self.pool.with_conn(|conn| {
                conn.execute(
                    "UPDATE sessions SET consolidated = 1, summary = ?1 WHERE id = ?2;",
                    (&node.content, &session_id),
                )?;
                Ok(())
            })?;
            consolidated_count += 1;
        }

        Ok(consolidated_count)
    }
}
