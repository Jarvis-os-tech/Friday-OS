use crate::db::DatabasePool;
use crate::error::Result;
use crate::repository::{EdgeRepository, NodeRepository};
use crate::tree::buffer::{TreeBuffer, TreeBufferRepository};
use crate::tree::flush::TreeFlusher;
use crate::tree::retrieval::{DrillDownNode, TreeRetrieval};
use crate::tree::seal::CascadeSealer;
use crate::types::MemoryNode;
use crate::vault::VaultWriter;
use std::path::PathBuf;

pub struct TreeEngine {
    buffer_repo: TreeBufferRepository,
    node_repo: NodeRepository,
    edge_repo: EdgeRepository,
    vault_writer: Option<VaultWriter>,
}

impl TreeEngine {
    pub fn new(pool: DatabasePool, vault_dir: Option<PathBuf>) -> Self {
        let vault_writer = vault_dir.map(VaultWriter::new);
        Self {
            buffer_repo: TreeBufferRepository::new(pool.clone()),
            node_repo: NodeRepository::new(pool.clone()),
            edge_repo: EdgeRepository::new(pool),
            vault_writer,
        }
    }

    /// Ingest a newly created node into the level 0 leaf buffer for its scope.
    /// If capacity reaches max (8 items), automatically triggers cascade sealing.
    pub fn ingest_node(
        &self,
        node: &MemoryNode,
        tree_scope: &str,
    ) -> Result<Option<MemoryNode>> {
        let tree_kind = node.kind.to_string();
        let mut buffer = self.buffer_repo.get_or_create_buffer(
            tree_scope,
            &tree_kind,
            0,
            8,
        )?;

        if !buffer.node_ids.contains(&node.id) {
            buffer.node_ids.push(node.id.clone());
            buffer.capacity = buffer.node_ids.len();
            buffer.last_flush_at = chrono::Utc::now().timestamp();
        }

        if buffer.capacity >= buffer.max_capacity {
            let sealer = CascadeSealer::new(
                &self.buffer_repo,
                &self.node_repo,
                &self.edge_repo,
                self.vault_writer.as_ref(),
            );
            sealer.seal_buffer(&mut buffer)
        } else {
            self.buffer_repo.save_buffer(&buffer)?;
            Ok(None)
        }
    }

    /// Force seal a specific buffer on demand
    pub fn force_seal_buffer(
        &self,
        tree_scope: &str,
        tree_kind: &str,
        level: i64,
    ) -> Result<Option<MemoryNode>> {
        let mut buffer = self.buffer_repo.get_or_create_buffer(
            tree_scope,
            tree_kind,
            level,
            8,
        )?;

        if buffer.node_ids.is_empty() {
            return Ok(None);
        }

        let sealer = CascadeSealer::new(
            &self.buffer_repo,
            &self.node_repo,
            &self.edge_repo,
            self.vault_writer.as_ref(),
        );
        sealer.seal_buffer(&mut buffer)
    }

    /// Flush all stale buffers that have pending unsealed items past the threshold
    pub fn flush_stale_buffers(&self, stale_threshold_seconds: i64) -> Result<Vec<MemoryNode>> {
        let now = chrono::Utc::now().timestamp();
        let flusher = TreeFlusher::new(
            &self.buffer_repo,
            &self.node_repo,
            &self.edge_repo,
            self.vault_writer.as_ref(),
        );
        flusher.flush_stale_buffers(stale_threshold_seconds, now)
    }

    /// Recursively drill down through a summary note's child tree
    pub fn drill_down(&self, root_id: &str, max_depth: usize) -> Result<Option<DrillDownNode>> {
        let retrieval = TreeRetrieval::new(self.node_repo.clone(), self.edge_repo.clone());
        retrieval.drill_down(root_id, max_depth)
    }

    /// List all active buffers
    pub fn list_buffers(&self) -> Result<Vec<TreeBuffer>> {
        self.buffer_repo.list_all()
    }
}
