use crate::error::Result;
use crate::repository::{GraphRepository, NodeRepository};
use crate::security::SecretScanner;
use crate::types::{KnowledgeNode, MemoryNode, NodeKind};
use crate::vault::bootstrap::bootstrap_obsidian_vault;
use crate::vault::frontmatter::VaultFrontmatter;
use std::fs;
use std::path::{Path, PathBuf};

pub struct VaultWriter {
    vault_dir: PathBuf,
}

impl VaultWriter {
    pub fn new(vault_dir: PathBuf) -> Self {
        let _ = bootstrap_obsidian_vault(&vault_dir);
        Self { vault_dir }
    }

    pub fn vault_dir(&self) -> &Path {
        &self.vault_dir
    }

    fn sanitize_filename(name: &str) -> String {
        let clean: String = name
            .chars()
            .map(|c| match c {
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                _ => c,
            })
            .collect();
        let trimmed = clean.trim().trim_matches('.');
        if trimmed.is_empty() {
            "untitled".to_string()
        } else if trimmed.len() > 80 {
            trimmed[..80].to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn folder_for_kind(kind: NodeKind) -> &'static str {
        match kind {
            NodeKind::Fact => "facts",
            NodeKind::Decision => "knowledge",
            NodeKind::Lesson => "knowledge",
            NodeKind::Pattern => "knowledge",
            NodeKind::Entity => "knowledge",
            NodeKind::Conversation => "conversations",
            NodeKind::Chunk => "summaries",
        }
    }

    /// Write a memory node to the vault with frontmatter and wikilinks
    pub fn write_node(
        &self,
        node: &MemoryNode,
        linked_titles: &[String],
    ) -> Result<PathBuf> {
        // 1. Security Gate: Validate payload
        SecretScanner::scan_and_enforce(&node.content)?;
        if let Some(s) = &node.summary {
            SecretScanner::scan_and_enforce(s)?;
        }

        let folder_name = Self::folder_for_kind(node.kind);
        let target_dir = self.vault_dir.join(folder_name);
        fs::create_dir_all(&target_dir)?;

        // Title: From summary or first 50 chars of content
        let raw_title = node.summary.as_deref().unwrap_or(&node.content);
        let title_line = raw_title.lines().next().unwrap_or("Memory Note");
        let safe_title = Self::sanitize_filename(title_line);

        let filename = format!("{}_{}.md", safe_title, &node.id[..node.id.len().min(8)]);
        let filepath = target_dir.join(&filename);

        let frontmatter = VaultFrontmatter::from_node(
            &node.id,
            node.kind,
            node.tier,
            node.importance,
            node.created_at,
            node.updated_at,
            &node.source,
            node.agent_id.as_deref(),
            node.session_id.as_deref(),
            title_line,
            &[],
            &[safe_title.clone()],
        );

        let mut content = frontmatter.to_yaml();
        content.push('\n');
        content.push_str(&format!("# {}\n\n", title_line));

        if let Some(summary) = &node.summary {
            content.push_str("> [!NOTE] Summary\n");
            content.push_str(&format!("> {}\n\n", summary.replace('\n', "\n> ")));
        }

        content.push_str("## 📝 Content\n\n");
        content.push_str(&node.content);
        content.push_str("\n\n");

        if !linked_titles.is_empty() {
            content.push_str("## 🔗 Linked Graph Memories\n\n");
            for link in linked_titles {
                content.push_str(&format!("- [[{}]]\n", link));
            }
            content.push('\n');
        }

        if let Some(parent) = &node.parent_id {
            content.push_str(&format!("- **Parent Tree Node**: [[{}]]\n", parent));
        }

        content.push_str(&format!("\n---\n*Node ID: `{}` | Tier: `{:?}` | Tree Level: `{}`*\n", node.id, node.tier, node.tree_level));

        fs::write(&filepath, content)?;
        Ok(filepath)
    }

    /// Write a knowledge graph ontological node with relations to vault
    pub fn write_knowledge_node(
        &self,
        node: &KnowledgeNode,
        relations: &[(String, String, String)], // (relation_kind, target_name, direction)
    ) -> Result<PathBuf> {
        SecretScanner::scan_and_enforce(&node.name)?;
        if let Some(desc) = &node.description {
            SecretScanner::scan_and_enforce(desc)?;
        }

        let kind_str = node.kind.to_string();
        let target_dir = self.vault_dir.join("knowledge").join(&kind_str);
        fs::create_dir_all(&target_dir)?;

        let safe_name = Self::sanitize_filename(&node.name);
        let filepath = target_dir.join(format!("{}.md", safe_name));

        let created_iso = chrono::DateTime::from_timestamp(node.created_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        let mut content = format!(
            r#"---
id: "{id}"
title: "{name}"
kind: "{kind}"
mastery_score: {mastery:.2}
created_at: "{created}"
tags:
  - jarvis
  - knowledge
  - {kind}
aliases:
  - "{name}"
---

# 🌐 {name}

> [!TIP] Ontological Concept
> **Category**: `{kind}` | **Mastery Score**: `{mastery_pct}%`

## 📖 Description
{desc}

## 🔗 Ontological Relations
"#,
            id = node.id,
            name = node.name.replace('"', "\\\""),
            kind = kind_str,
            mastery = node.mastery_score,
            mastery_pct = (node.mastery_score * 100.0).round() as i64,
            created = created_iso,
            desc = node.description.as_deref().unwrap_or("No detailed description recorded.")
        );

        if relations.is_empty() {
            content.push_str("*No direct ontological edges connected yet.*\n");
        } else {
            for (rel, target, dir) in relations {
                if dir == "outgoing" {
                    content.push_str(&format!("- **{}** ➔ [[{}]]\n", rel, target));
                } else {
                    content.push_str(&format!("- [[{}]] ➔ **{}**\n", target, rel));
                }
            }
        }

        content.push_str(&format!("\n---\n*Knowledge ID: `{}`*\n", node.id));

        fs::write(&filepath, content)?;
        Ok(filepath)
    }

    /// Delete a node from the vault
    pub fn delete_node(&self, kind: NodeKind, id: &str) -> Result<()> {
        let folder = Self::folder_for_kind(kind);
        let dir = self.vault_dir.join(folder);
        if !dir.exists() {
            return Ok(());
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                    let short_id = &id[..id.len().min(8)];
                    if fname.ends_with(&format!("{}.md", short_id)) || fname.contains(id) {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
        Ok(())
    }

    /// Full vault sync from SQLite repositories
    pub fn sync_all(
        &self,
        node_repo: &NodeRepository,
        graph_repo: &GraphRepository,
    ) -> Result<usize> {
        let active_nodes = node_repo.list_active(10000)?;
        let mut count = 0;

        for node in &active_nodes {
            let _ = self.write_node(node, &[]);
            count += 1;
        }

        let kn_nodes = graph_repo.list_all_nodes()?;
        for kn in &kn_nodes {
            let outgoing = graph_repo.get_outgoing_edges(&kn.id)?;
            let mut relations = Vec::new();
            for edge in outgoing {
                if let Ok(Some(target_node)) = graph_repo.get_node_by_id(&edge.target_id) {
                    relations.push((edge.kind.to_string(), target_node.name, "outgoing".to_string()));
                }
            }
            let _ = self.write_knowledge_node(kn, &relations);
            count += 1;
        }

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::MemoryError;
    use crate::types::Tier;

    struct TestVault {
        dir: PathBuf,
    }

    impl Drop for TestVault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn setup_test_vault() -> (TestVault, VaultWriter) {
        let temp = std::env::temp_dir().join(format!("jarvis_vault_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).expect("Failed to create test dir");
        let writer = VaultWriter::new(temp.clone());
        (TestVault { dir: temp }, writer)
    }

    #[test]
    fn test_vault_writer_creates_note_with_frontmatter() {
        let (_dir, writer) = setup_test_vault();
        let now = chrono::Utc::now().timestamp();

        let node = MemoryNode {
            id: "test-node-fact-1".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "User preferred shell is Fish with Starship prompt.".to_string(),
            summary: Some("Preferred shell: Fish".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.9,
            superseded_by: None,
            agent_id: Some("jarvis-core".to_string()),
            session_id: Some("sess-001".to_string()),
            source: "user".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        let path = writer.write_node(&node, &["Linux Environment".to_string()]).unwrap();
        assert!(path.exists());

        let content = fs::read_to_string(path).unwrap();
        assert!(content.starts_with("---"));
        assert!(content.contains("id: \"test-node-fact-1\""));
        assert!(content.contains("kind: fact"));
        assert!(content.contains("tier: Persistent"));
        assert!(content.contains("[[Linux Environment]]"));
        assert!(content.contains("User preferred shell is Fish"));
    }

    #[test]
    fn test_vault_writer_blocks_secrets() {
        let (_dir, writer) = setup_test_vault();
        let now = chrono::Utc::now().timestamp();

        let secret_node = MemoryNode {
            id: "secret-node-1".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "AWS key is AKIA1234567890ABCDEF".to_string(),
            summary: None,
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

        let result = writer.write_node(&secret_node, &[]);
        assert!(result.is_err());
        match result {
            Err(MemoryError::SecurityViolation(msg)) => {
                assert!(msg.contains("Secret detected"));
            }
            _ => panic!("Expected SecurityViolation error"),
        }
    }

    #[test]
    fn test_vault_writer_knowledge_node() {
        let (_dir, writer) = setup_test_vault();
        let now = chrono::Utc::now().timestamp();

        let kn = KnowledgeNode {
            id: "kn-rust-lang".to_string(),
            kind: crate::types::KnowledgeKind::Technology,
            name: "Rust".to_string(),
            description: Some("Memory safe systems programming language without garbage collection.".to_string()),
            mastery_score: 0.98,
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        let relations = vec![
            ("Uses".to_string(), "LLVM".to_string(), "outgoing".to_string()),
            ("Implements".to_string(), "RAII".to_string(), "outgoing".to_string()),
        ];

        let path = writer.write_knowledge_node(&kn, &relations).unwrap();
        assert!(path.exists());

        let content = fs::read_to_string(path).unwrap();
        assert!(content.contains("title: \"Rust\""));
        assert!(content.contains("mastery_score: 0.98"));
        assert!(content.contains("**Uses** ➔ [[LLVM]]"));
        assert!(content.contains("**Implements** ➔ [[RAII]]"));
    }
}
