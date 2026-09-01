use crate::db::DatabasePool;
use crate::error::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeBuffer {
    pub id: String,
    pub tree_scope: String,
    pub tree_kind: String,
    pub level: i64,
    pub node_ids: Vec<String>,
    pub capacity: usize,
    pub max_capacity: usize,
    pub last_flush_at: i64,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct TreeBufferRepository {
    pool: DatabasePool,
}

impl TreeBufferRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    pub fn get_or_create_buffer(
        &self,
        tree_scope: &str,
        tree_kind: &str,
        level: i64,
        max_capacity: usize,
    ) -> Result<TreeBuffer> {
        let now = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, tree_scope, tree_kind, level, node_ids_json, capacity, \
                 max_capacity, last_flush_at, created_at \
                 FROM tree_buffers \
                 WHERE tree_scope = ?1 AND tree_kind = ?2 AND level = ?3 \
                 LIMIT 1;",
            )?;

            let mut rows = stmt.query(params![tree_scope, tree_kind, level])?;
            if let Some(row) = rows.next()? {
                let node_ids_json: String = row.get(4)?;
                let node_ids: Vec<String> =
                    serde_json::from_str(&node_ids_json).unwrap_or_default();
                let capacity: i64 = row.get(5)?;
                let max_cap: i64 = row.get(6)?;

                Ok(TreeBuffer {
                    id: row.get(0)?,
                    tree_scope: row.get(1)?,
                    tree_kind: row.get(2)?,
                    level: row.get(3)?,
                    node_ids,
                    capacity: capacity as usize,
                    max_capacity: max_cap as usize,
                    last_flush_at: row.get(7)?,
                    created_at: row.get(8)?,
                })
            } else {
                let id = format!("buf-{}", Uuid::new_v4());
                let empty_ids = "[]";
                conn.execute(
                    r#"
                    INSERT INTO tree_buffers (
                        id, tree_scope, tree_kind, level, node_ids_json, capacity,
                        max_capacity, last_flush_at, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);
                    "#,
                    params![
                        id,
                        tree_scope,
                        tree_kind,
                        level,
                        empty_ids,
                        0i64,
                        max_capacity as i64,
                        now,
                        now
                    ],
                )?;

                Ok(TreeBuffer {
                    id,
                    tree_scope: tree_scope.to_string(),
                    tree_kind: tree_kind.to_string(),
                    level,
                    node_ids: Vec::new(),
                    capacity: 0,
                    max_capacity,
                    last_flush_at: now,
                    created_at: now,
                })
            }
        })
    }

    pub fn save_buffer(&self, buf: &TreeBuffer) -> Result<()> {
        let node_ids_json = serde_json::to_string(&buf.node_ids).unwrap_or_else(|_| "[]".into());
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                UPDATE tree_buffers SET
                    node_ids_json = ?2,
                    capacity = ?3,
                    max_capacity = ?4,
                    last_flush_at = ?5
                WHERE id = ?1;
                "#,
                params![
                    buf.id,
                    node_ids_json,
                    buf.node_ids.len() as i64,
                    buf.max_capacity as i64,
                    buf.last_flush_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn clear_buffer(&self, buffer_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                UPDATE tree_buffers SET
                    node_ids_json = '[]',
                    capacity = 0,
                    last_flush_at = ?2
                WHERE id = ?1;
                "#,
                params![buffer_id, now],
            )?;
            Ok(())
        })
    }

    pub fn list_stale_buffers(
        &self,
        stale_threshold_seconds: i64,
        now: i64,
    ) -> Result<Vec<TreeBuffer>> {
        self.pool.with_conn(|conn| {
            let cutoff = now - stale_threshold_seconds;
            let mut stmt = conn.prepare(
                "SELECT id, tree_scope, tree_kind, level, node_ids_json, capacity, \
                 max_capacity, last_flush_at, created_at \
                 FROM tree_buffers \
                 WHERE capacity > 0 AND last_flush_at <= ?1;",
            )?;

            let rows = stmt.query_map(params![cutoff], |row| {
                let node_ids_json: String = row.get(4)?;
                let node_ids: Vec<String> =
                    serde_json::from_str(&node_ids_json).unwrap_or_default();
                let capacity: i64 = row.get(5)?;
                let max_cap: i64 = row.get(6)?;

                Ok(TreeBuffer {
                    id: row.get(0)?,
                    tree_scope: row.get(1)?,
                    tree_kind: row.get(2)?,
                    level: row.get(3)?,
                    node_ids,
                    capacity: capacity as usize,
                    max_capacity: max_cap as usize,
                    last_flush_at: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?;

            let mut buffers = Vec::new();
            for r in rows {
                buffers.push(r?);
            }
            Ok(buffers)
        })
    }

    pub fn list_all(&self) -> Result<Vec<TreeBuffer>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, tree_scope, tree_kind, level, node_ids_json, capacity, \
                 max_capacity, last_flush_at, created_at \
                 FROM tree_buffers ORDER BY level ASC, tree_scope ASC;",
            )?;

            let rows = stmt.query_map([], |row| {
                let node_ids_json: String = row.get(4)?;
                let node_ids: Vec<String> =
                    serde_json::from_str(&node_ids_json).unwrap_or_default();
                let capacity: i64 = row.get(5)?;
                let max_cap: i64 = row.get(6)?;

                Ok(TreeBuffer {
                    id: row.get(0)?,
                    tree_scope: row.get(1)?,
                    tree_kind: row.get(2)?,
                    level: row.get(3)?,
                    node_ids,
                    capacity: capacity as usize,
                    max_capacity: max_cap as usize,
                    last_flush_at: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?;

            let mut buffers = Vec::new();
            for r in rows {
                buffers.push(r?);
            }
            Ok(buffers)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tree_buffer_lifecycle() {
        let pool = DatabasePool::in_memory().unwrap();
        let repo = TreeBufferRepository::new(pool);

        let mut buf = repo
            .get_or_create_buffer("session:test-1", "conversation", 0, 8)
            .unwrap();

        assert_eq!(buf.capacity, 0);
        assert_eq!(buf.level, 0);

        buf.node_ids.push("node-1".to_string());
        buf.node_ids.push("node-2".to_string());
        buf.capacity = 2;
        repo.save_buffer(&buf).unwrap();

        let fetched = repo
            .get_or_create_buffer("session:test-1", "conversation", 0, 8)
            .unwrap();
        assert_eq!(fetched.capacity, 2);
        assert_eq!(fetched.node_ids.len(), 2);

        repo.clear_buffer(&buf.id).unwrap();
        let cleared = repo
            .get_or_create_buffer("session:test-1", "conversation", 0, 8)
            .unwrap();
        assert_eq!(cleared.capacity, 0);
        assert_eq!(cleared.node_ids.len(), 0);
    }
}
