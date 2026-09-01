use crate::error::Result;
use crate::repository::NodeRepository;
use crate::types::{MemoryNode, NodeKind, Tier};
use std::process::Command;
use uuid::Uuid;

pub struct GitWatcher {
    repo: NodeRepository,
}

impl GitWatcher {
    pub fn new(repo: NodeRepository) -> Self {
        Self { repo }
    }

    pub fn handle_commit(&self, commit_sha: &str) -> Result<()> {
        let output = Command::new("git")
            .args(&["log", "-1", "--format=%s|%an|%ae|%ci", commit_sha])
            .output()
            .map_err(|e| crate::error::MemoryError::Internal(e.to_string()))?;
        
        let content = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let now = chrono::Utc::now().timestamp();
        let node = MemoryNode {
            id: format!("node-{}", Uuid::new_v4()),
            kind: NodeKind::Decision,
            tier: Tier::Working,
            content: format!("Commit {}: {}", commit_sha, content),
            summary: Some(format!("Git commit {}", commit_sha)),
            parent_id: None,
            tree_level: 0,
            importance: 0.8,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "git_auto_ingest".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        self.repo.insert(&node)?;
        Ok(())
    }
}
