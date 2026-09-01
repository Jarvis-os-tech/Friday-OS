use crate::types::MemoryNode;

pub struct SummaryPayload {
    pub title: String,
    pub summary: String,
    pub content: String,
    pub importance: f64,
}

pub struct Summarizer;

impl Summarizer {
    /// Deterministic structured summarizer for child nodes at target hierarchy level
    pub fn summarize_nodes(
        nodes: &[MemoryNode],
        target_level: i64,
        scope: &str,
    ) -> SummaryPayload {
        if nodes.is_empty() {
            return SummaryPayload {
                title: format!("L{} Empty Summary — {}", target_level, scope),
                summary: "No nodes available for summarization.".to_string(),
                content: "No items present.".to_string(),
                importance: 0.5,
            };
        }

        let level_label = match target_level {
            1 => "L1 Intermediate Session Summary",
            2 => "L2 Root Domain Synthesis",
            _ => "Hierarchical Memory Rollup",
        };

        let mut bullet_points: Vec<String> = Vec::new();
        let mut max_importance = 0.5f64;
        let mut total_chars = 0;

        for (idx, node) in nodes.iter().enumerate() {
            if node.importance > max_importance {
                max_importance = node.importance;
            }

            let first_line = node
                .summary
                .as_deref()
                .unwrap_or(&node.content)
                .lines()
                .next()
                .unwrap_or("Memory item")
                .trim();

            let clean_line = if first_line.len() > 100 {
                format!("{}...", &first_line[..97])
            } else {
                first_line.to_string()
            };

            bullet_points.push(format!(
                "{}. `[{}]` **{}**: {}",
                idx + 1,
                node.kind,
                &node.id[..node.id.len().min(8)],
                clean_line
            ));

            total_chars += node.content.len();
        }

        let title = format!("{} — {} ({} items)", level_label, scope, nodes.len());

        let summary = format!(
            "Consolidated {} memory items (total ~{} chars). Core focal items:\n{}",
            nodes.len(),
            total_chars,
            bullet_points.join("\n")
        );

        let mut content = format!(
            "# {}\n\n> [!NOTE] Hierarchy Level {}\n> Scope: `{}` | Aggregated items: {}\n\n## 📋 Itemized Synthesis\n\n",
            title, target_level, scope, nodes.len()
        );

        for point in &bullet_points {
            content.push_str(&format!("{}\n", point));
        }

        content.push_str("\n---\n\n## 🔍 Source Reference Nodes\n\n");
        for node in nodes {
            content.push_str(&format!("- [[{}]] *(Kind: {}, Level: {})*\n", node.id, node.kind, node.tree_level));
        }

        SummaryPayload {
            title,
            summary,
            content,
            importance: (max_importance * 0.98).clamp(0.5, 1.0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{NodeKind, Tier};

    #[test]
    fn test_summarizer_nodes() {
        let now = chrono::Utc::now().timestamp();
        let nodes = vec![
            MemoryNode {
                id: "n1".to_string(),
                kind: NodeKind::Fact,
                tier: Tier::Working,
                content: "Fact 1: Rust POSIX memory engine initialized".to_string(),
                summary: Some("Fact 1".to_string()),
                parent_id: None,
                tree_level: 0,
                importance: 0.85,
                superseded_by: None,
                agent_id: None,
                session_id: None,
                source: "user".to_string(),
                metadata_json: None,
                created_at: now,
                updated_at: now,
            },
            MemoryNode {
                id: "n2".to_string(),
                kind: NodeKind::Decision,
                tier: Tier::Working,
                content: "Decision 1: Adopt SQLite WAL mode for fast writes".to_string(),
                summary: Some("Decision 1".to_string()),
                parent_id: None,
                tree_level: 0,
                importance: 0.90,
                superseded_by: None,
                agent_id: None,
                session_id: None,
                source: "user".to_string(),
                metadata_json: None,
                created_at: now,
                updated_at: now,
            },
        ];

        let payload = Summarizer::summarize_nodes(&nodes, 1, "session:test");
        assert!(payload.title.contains("L1 Intermediate Session Summary"));
        assert!(payload.summary.contains("Fact 1"));
        assert!(payload.summary.contains("Decision 1"));
        assert!(payload.importance >= 0.85);
        assert!(payload.content.contains("[[n1]]"));
        assert!(payload.content.contains("[[n2]]"));
    }
}
