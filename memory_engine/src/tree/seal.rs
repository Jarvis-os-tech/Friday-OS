use crate::error::Result;
use crate::repository::{EdgeRepository, NodeRepository};
use crate::tree::buffer::{TreeBuffer, TreeBufferRepository};
use crate::tree::summarizer::Summarizer;
use crate::types::{EdgeKind, MemoryEdge, MemoryNode, NodeKind, Tier};
use crate::vault::VaultWriter;
use uuid::Uuid;

pub struct CascadeSealer<'a> {
    buffer_repo: &'a TreeBufferRepository,
    node_repo: &'a NodeRepository,
    edge_repo: &'a EdgeRepository,
    vault_writer: Option<&'a VaultWriter>,
}

impl<'a> CascadeSealer<'a> {
    pub fn new(
        buffer_repo: &'a TreeBufferRepository,
        node_repo: &'a NodeRepository,
        edge_repo: &'a EdgeRepository,
        vault_writer: Option<&'a VaultWriter>,
    ) -> Self {
        Self {
            buffer_repo,
            node_repo,
            edge_repo,
            vault_writer,
        }
    }

    /// Seal an active buffer, creating a parent node at level + 1, linking children, and cascading up if needed.
    pub fn seal_buffer(&self, buffer: &mut TreeBuffer) -> Result<Option<MemoryNode>> {
        if buffer.node_ids.is_empty() {
            return Ok(None);
        }

        let now = chrono::Utc::now().timestamp();
        let target_level = buffer.level + 1;

        // 1. Fetch all child nodes
        let mut children: Vec<MemoryNode> = Vec::new();
        for id in &buffer.node_ids {
            if let Ok(Some(child)) = self.node_repo.get_by_id(id) {
                children.push(child);
            }
        }

        if children.is_empty() {
            self.buffer_repo.clear_buffer(&buffer.id)?;
            buffer.node_ids.clear();
            buffer.capacity = 0;
            return Ok(None);
        }

        // 2. Generate structured summary
        let summary_payload = Summarizer::summarize_nodes(&children, target_level, &buffer.tree_scope);

        let parent_id = format!("tree-L{}-{}", target_level, &Uuid::new_v4().to_string()[..8]);
        let parent_tier = if target_level >= 2 {
            Tier::Persistent
        } else {
            Tier::Working
        };

        let parent_node = MemoryNode {
            id: parent_id.clone(),
            kind: NodeKind::Chunk,
            tier: parent_tier,
            content: summary_payload.content,
            summary: Some(summary_payload.summary),
            parent_id: None,
            tree_level: target_level,
            importance: summary_payload.importance,
            superseded_by: None,
            agent_id: None,
            session_id: Some(buffer.tree_scope.clone()),
            source: format!("tree_seal_L{}", target_level),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        // 3. Save parent node
        self.node_repo.insert(&parent_node)?;

        // 4. Update child nodes & create ParentChild edges
        for mut child in children {
            child.parent_id = Some(parent_id.clone());
            let _ = self.node_repo.update(&child);

            let edge = MemoryEdge {
                id: format!("edge-pc-{}", Uuid::new_v4()),
                source_id: parent_id.clone(),
                target_id: child.id.clone(),
                kind: EdgeKind::ParentChild,
                weight: 1.0,
                metadata_json: None,
                created_at: now,
            };
            let _ = self.edge_repo.insert(&edge);
        }

        // 5. Clear current buffer
        self.buffer_repo.clear_buffer(&buffer.id)?;
        buffer.node_ids.clear();
        buffer.capacity = 0;

        // 6. Write to Obsidian Vault if writer is available
        if let Some(vw) = self.vault_writer {
            let _ = vw.write_node(&parent_node, &[]);
        }

        // 7. Cascade push to higher level buffer if target_level < 2 (L1 -> L2)
        if target_level < 2 {
            let mut higher_buf = self.buffer_repo.get_or_create_buffer(
                &buffer.tree_scope,
                &buffer.tree_kind,
                target_level,
                8,
            )?;

            higher_buf.node_ids.push(parent_id.clone());
            higher_buf.capacity = higher_buf.node_ids.len();
            higher_buf.last_flush_at = now;

            if higher_buf.capacity >= higher_buf.max_capacity {
                // Recursive cascade sealing into L2
                let _ = self.seal_buffer(&mut higher_buf)?;
            } else {
                self.buffer_repo.save_buffer(&higher_buf)?;
            }
        }

        Ok(Some(parent_node))
    }
}
