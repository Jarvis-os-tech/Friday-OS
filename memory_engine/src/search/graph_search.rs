use crate::db::DatabasePool;
use crate::error::Result;
use rusqlite::params;
use std::collections::{HashMap, HashSet, VecDeque};

pub struct GraphSearchEngine {
    pool: DatabasePool,
}

impl GraphSearchEngine {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    /// Compute BFS graph proximity scores starting from a set of seed node IDs.
    /// Returns a map of node_id -> normalized graph score in [0.0, 1.0].
    pub fn expand_neighborhood(
        &self,
        seed_node_ids: &[String],
        max_hops: usize,
    ) -> Result<HashMap<String, f32>> {
        if seed_node_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut scores: HashMap<String, f32> = HashMap::new();
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<(String, usize, f32)> = VecDeque::new();

        for seed in seed_node_ids {
            scores.insert(seed.clone(), 1.0);
            visited.insert(seed.clone());
            queue.push_back((seed.clone(), 0, 1.0));
        }

        self.pool.with_conn(|conn| {
            let mut edge_stmt = conn.prepare(
                "SELECT target_id, weight FROM memory_edges WHERE source_id = ?1 \
                 UNION \
                 SELECT source_id, weight FROM memory_edges WHERE target_id = ?1;",
            )?;

            while let Some((curr_id, hop, curr_score)) = queue.pop_front() {
                if hop >= max_hops {
                    continue;
                }

                let mut rows = edge_stmt.query(params![curr_id])?;
                while let Some(row) = rows.next()? {
                    let neighbor_id: String = row.get(0)?;
                    let weight: f64 = row.get(1)?;

                    let hop_decay = match hop {
                        0 => 0.8f32,
                        1 => 0.4f32,
                        _ => 0.1f32,
                    };

                    let neighbor_score = (curr_score * (weight as f32) * hop_decay).clamp(0.0, 1.0);

                    if !visited.contains(&neighbor_id) {
                        visited.insert(neighbor_id.clone());
                        scores.insert(neighbor_id.clone(), neighbor_score);
                        queue.push_back((neighbor_id, hop + 1, neighbor_score));
                    } else if let Some(existing) = scores.get_mut(&neighbor_id) {
                        if neighbor_score > *existing {
                            *existing = neighbor_score;
                        }
                    }
                }
            }

            Ok(scores)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EdgeKind, MemoryEdge, MemoryNode, NodeKind, Tier};
    use crate::repository::{EdgeRepository, NodeRepository};

    #[test]
    fn test_graph_search_expansion() {
        let pool = DatabasePool::in_memory().unwrap();
        let node_repo = NodeRepository::new(pool.clone());
        let edge_repo = EdgeRepository::new(pool.clone());
        let graph_search = GraphSearchEngine::new(pool);

        let now = chrono::Utc::now().timestamp();

        for id in &["node-A", "node-B", "node-C"] {
            node_repo
                .insert(&MemoryNode {
                    id: id.to_string(),
                    kind: NodeKind::Fact,
                    tier: Tier::Persistent,
                    content: format!("Content for {}", id),
                    summary: None,
                    parent_id: None,
                    tree_level: 0,
                    importance: 0.8,
                    superseded_by: None,
                    agent_id: None,
                    session_id: None,
                    source: "test".to_string(),
                    metadata_json: None,
                    created_at: now,
                    updated_at: now,
                })
                .unwrap();
        }

        let e1 = MemoryEdge {
            id: "e1".to_string(),
            source_id: "node-A".to_string(),
            target_id: "node-B".to_string(),
            kind: EdgeKind::RelatedTo,
            weight: 1.0,
            metadata_json: None,
            created_at: now,
        };

        let e2 = MemoryEdge {
            id: "e2".to_string(),
            source_id: "node-B".to_string(),
            target_id: "node-C".to_string(),
            kind: EdgeKind::Uses,
            weight: 0.8,
            metadata_json: None,
            created_at: now,
        };

        edge_repo.insert(&e1).unwrap();
        edge_repo.insert(&e2).unwrap();

        let scores = graph_search.expand_neighborhood(&["node-A".to_string()], 2).unwrap();

        assert_eq!(*scores.get("node-A").unwrap(), 1.0);
        assert!(*scores.get("node-B").unwrap() >= 0.7);
        assert!(*scores.get("node-C").unwrap() > 0.0);
        assert!(scores.get("node-B").unwrap() > scores.get("node-C").unwrap());
    }
}
