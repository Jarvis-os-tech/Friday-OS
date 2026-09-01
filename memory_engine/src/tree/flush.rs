use crate::error::Result;
use crate::repository::{EdgeRepository, NodeRepository};
use crate::tree::buffer::TreeBufferRepository;
use crate::tree::seal::CascadeSealer;
use crate::types::MemoryNode;
use crate::vault::VaultWriter;

pub struct TreeFlusher<'a> {
    buffer_repo: &'a TreeBufferRepository,
    sealer: CascadeSealer<'a>,
}

impl<'a> TreeFlusher<'a> {
    pub fn new(
        buffer_repo: &'a TreeBufferRepository,
        node_repo: &'a NodeRepository,
        edge_repo: &'a EdgeRepository,
        vault_writer: Option<&'a VaultWriter>,
    ) -> Self {
        Self {
            buffer_repo,
            sealer: CascadeSealer::new(buffer_repo, node_repo, edge_repo, vault_writer),
        }
    }

    /// Flush all stale buffers that have pending unsealed items past the threshold
    pub fn flush_stale_buffers(
        &self,
        stale_threshold_seconds: i64,
        now: i64,
    ) -> Result<Vec<MemoryNode>> {
        let mut stale_buffers = self
            .buffer_repo
            .list_stale_buffers(stale_threshold_seconds, now)?;

        let mut generated_summaries = Vec::new();

        for mut buf in stale_buffers.iter_mut() {
            if buf.node_ids.len() >= 2 {
                if let Some(summary_node) = self.sealer.seal_buffer(&mut buf)? {
                    generated_summaries.push(summary_node);
                }
            }
        }

        Ok(generated_summaries)
    }
}
