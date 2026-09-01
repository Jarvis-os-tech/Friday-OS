use crate::error::Result;
use crate::repository::NodeRepository;
use crate::security::SecretScanner;
use crate::types::{MemoryNode, NodeKind, Tier};
use crate::vault::VaultWriter;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MineReport {
    pub files_processed: usize,
    pub total_lines_read: usize,
    pub nodes_created: usize,
    pub nodes_skipped: usize,
    pub secrets_blocked: usize,
    pub elapsed_ms: f64,
}

impl MineReport {
    pub fn merge(&mut self, other: &MineReport) {
        self.files_processed += other.files_processed;
        self.total_lines_read += other.total_lines_read;
        self.nodes_created += other.nodes_created;
        self.nodes_skipped += other.nodes_skipped;
        self.secrets_blocked += other.secrets_blocked;
        self.elapsed_ms += other.elapsed_ms;
    }
}

pub struct TranscriptMiner {
    node_repo: NodeRepository,
    vault_writer: Option<Arc<VaultWriter>>,
}

impl TranscriptMiner {
    pub fn new(node_repo: NodeRepository, vault_writer: Option<Arc<VaultWriter>>) -> Self {
        Self {
            node_repo,
            vault_writer,
        }
    }

    /// Mine a single `.jsonl` transcript file into memory nodes
    pub fn mine_file(&self, path: &Path) -> Result<MineReport> {
        let start = Instant::now();
        let mut report = MineReport::default();

        if !path.exists() || !path.is_file() {
            return Ok(report);
        }

        let file = File::open(path)?;
        let reader = BufReader::new(file);

        // Derive a session_id from parent dir or file stem
        let session_id = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("general_session")
            .to_string();

        report.files_processed = 1;

        let now = chrono::Utc::now().timestamp();

        for (line_idx, line_result) in reader.lines().enumerate() {
            let line = match line_result {
                Ok(l) => l,
                Err(_) => continue,
            };

            report.total_lines_read += 1;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Parse JSON line
            let val: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Extract content and metadata
            let (content, kind, role_tag) = Self::extract_content_and_kind(&val);

            // Minimum length check (ignore trivial heartbeats or single word acks)
            if content.trim().len() < 25 {
                report.nodes_skipped += 1;
                continue;
            }

            // Pre-write secret scanner security gate
            if SecretScanner::contains_secrets(&content) {
                report.secrets_blocked += 1;
                report.nodes_skipped += 1;
                continue;
            }

            // Compute deterministic SHA256 ID for idempotent re-mining
            let mut hasher = Sha256::new();
            hasher.update(session_id.as_bytes());
            hasher.update(line_idx.to_string().as_bytes());
            hasher.update(content.as_bytes());
            let hash_hex = format!("{:x}", hasher.finalize());
            let node_id = format!("mine-{}", &hash_hex[..16]);

            // Check if node already exists in database
            if let Ok(Some(_)) = self.node_repo.get_by_id(&node_id) {
                report.nodes_skipped += 1;
                continue;
            }

            let summary = Self::generate_summary(&content, &role_tag);

            let node = MemoryNode {
                id: node_id,
                kind,
                tier: Tier::Session,
                content,
                summary: Some(summary),
                parent_id: None,
                tree_level: 0,
                importance: 0.65,
                superseded_by: None,
                agent_id: Some(role_tag),
                session_id: Some(session_id.clone()),
                source: format!("mine:{}", path.file_name().and_then(|n| n.to_str()).unwrap_or("file")),
                metadata_json: Some(format!(
                    r#"{{"mined_from":"{}","line":{}}}"#,
                    path.display(),
                    line_idx + 1
                )),
                created_at: now,
                updated_at: now,
            };

            // Insert into SQLite database
            if self.node_repo.insert(&node).is_ok() {
                report.nodes_created += 1;

                // Sync to Obsidian Vault if configured
                if let Some(ref vw) = self.vault_writer {
                    let _ = vw.write_node(&node, &[]);
                }
            } else {
                report.nodes_skipped += 1;
            }
        }

        report.elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        Ok(report)
    }

    /// Recursively mine all `.jsonl` transcript files in a target directory
    pub fn mine_directory(&self, dir: &Path, recursive: bool) -> Result<MineReport> {
        let start = Instant::now();
        let mut overall_report = MineReport::default();

        if !dir.exists() || !dir.is_dir() {
            return Ok(overall_report);
        }

        let mut entries_to_visit = vec![dir.to_path_buf()];

        while let Some(current_dir) = entries_to_visit.pop() {
            if let Ok(read_dir) = std::fs::read_dir(&current_dir) {
                for entry in read_dir.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension() {
                            if ext == "jsonl" || ext == "log" {
                                if let Ok(rep) = self.mine_file(&path) {
                                    overall_report.merge(&rep);
                                }
                            }
                        }
                    } else if path.is_dir() && recursive {
                        // Skip hidden or system folders like .git, node_modules, target
                        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if !name.starts_with(".git") && name != "node_modules" && name != "target" {
                            entries_to_visit.push(path);
                        }
                    }
                }
            }
        }

        overall_report.elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        Ok(overall_report)
    }

    /// Extract text content and determine NodeKind from JSON payload
    fn extract_content_and_kind(val: &serde_json::Value) -> (String, NodeKind, String) {
        // 1. Antigravity / Gemini CLI transcript schema
        if let Some(step_type) = val.get("type").and_then(|t| t.as_str()) {
            let content = val.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let source = val.get("source").and_then(|s| s.as_str()).unwrap_or("agent");

            let kind = match step_type {
                "USER_INPUT" => NodeKind::Conversation,
                "PLANNER_RESPONSE" => {
                    if content.contains("decision") || content.contains("chose") || content.contains("architecture") {
                        NodeKind::Decision
                    } else if content.contains("lesson") || content.contains("fix") || content.contains("error") {
                        NodeKind::Lesson
                    } else {
                        NodeKind::Conversation
                    }
                }
                _ => NodeKind::Chunk,
            };

            return (content.to_string(), kind, source.to_string());
        }

        // 2. Generic chat schema (role + content)
        if let Some(role) = val.get("role").and_then(|r| r.as_str()) {
            let content = val.get("content").and_then(|c| c.as_str()).unwrap_or("");
            return (content.to_string(), NodeKind::Conversation, role.to_string());
        }

        // 3. Fallback text extraction
        let text = val.get("text").or_else(|| val.get("message")).and_then(|m| m.as_str()).unwrap_or("");
        (text.to_string(), NodeKind::Conversation, "system".to_string())
    }

    /// Generate clean one-line summary
    fn generate_summary(content: &str, role: &str) -> String {
        let first_line = content.lines().next().unwrap_or(content);
        let trimmed = first_line.trim_start_matches('#').trim();
        let snippet: String = trimmed.chars().take(80).collect();
        format!("[{}] {}", role, snippet)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabasePool;
    use std::io::Write;

    #[test]
    fn test_transcript_miner_file_ingestion_and_dedup() {
        let pool = DatabasePool::in_memory().unwrap();
        let node_repo = NodeRepository::new(pool);
        let miner = TranscriptMiner::new(node_repo.clone(), None);

        let temp_dir = std::env::temp_dir().join(format!("jarvis_miner_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("transcript.jsonl");

        let mut f = File::create(&file_path).unwrap();
        writeln!(
            f,
            r#"{{"type":"USER_INPUT","source":"USER_EXPLICIT","content":"Please make sure the Rust memory engine persists to SQLite WAL."}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"PLANNER_RESPONSE","source":"MODEL","content":"We have configured SQLite WAL journal mode and FTS5 triggers for all 16 tables."}}"#
        )
        .unwrap();
        // Secret that should be rejected
        writeln!(
            f,
            r#"{{"type":"USER_INPUT","source":"USER_EXPLICIT","content":"My secret token is ghp_123456789012345678901234567890123456 for testing."}}"#
        )
        .unwrap();

        // 1st Mine pass
        let report = miner.mine_file(&file_path).unwrap();
        assert_eq!(report.files_processed, 1);
        assert_eq!(report.total_lines_read, 3);
        assert_eq!(report.nodes_created, 2);
        assert_eq!(report.secrets_blocked, 1);
        assert_eq!(report.nodes_skipped, 1);

        // 2nd Mine pass (Idempotency test - should skip existing)
        let report2 = miner.mine_file(&file_path).unwrap();
        assert_eq!(report2.nodes_created, 0);
        assert_eq!(report2.nodes_skipped, 3); // 2 existing skipped + 1 secret skipped

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
