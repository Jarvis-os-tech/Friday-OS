use crate::db::DatabasePool;
use crate::error::Result;
use crate::repository::NodeRepository;

pub struct DecayWorker {
    pool: DatabasePool,
    _node_repo: NodeRepository,
}

impl DecayWorker {
    pub fn new(pool: DatabasePool, node_repo: NodeRepository) -> Self {
        Self { pool, _node_repo: node_repo }
    }

    pub fn apply_decay(&self, half_life_days: f64) -> Result<usize> {
        let half_life_sec = (half_life_days * 86400.0) as i64;
        let now = chrono::Utc::now().timestamp();
        let cutoff = now - half_life_sec;

        let affected = self.pool.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE memory_nodes \
                 SET importance = importance * 0.5 \
                 WHERE importance < 0.95 AND updated_at < ?1 AND superseded_by IS NULL;",
                [cutoff],
            )?;
            Ok(count)
        })?;

        let archived = self.pool.with_conn(|conn| {
            let count = conn.execute(
                "UPDATE memory_nodes \
                 SET superseded_by = 'archived' \
                 WHERE tier = 0 AND updated_at < ?1 AND superseded_by IS NULL;",
                [cutoff],
            )?;
            Ok(count)
        })?;

        Ok(affected + archived)
    }
}
