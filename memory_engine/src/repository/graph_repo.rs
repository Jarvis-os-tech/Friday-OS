use crate::db::DatabasePool;
use crate::error::{MemoryError, Result};
use crate::types::{KnowledgeEdge, KnowledgeEdgeKind, KnowledgeKind, KnowledgeNode};
use rusqlite::{params, Row};
use std::collections::{HashSet, VecDeque};
use std::str::FromStr;

#[derive(Clone)]
pub struct GraphRepository {
    pool: DatabasePool,
}

impl GraphRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_node(row: &Row) -> rusqlite::Result<KnowledgeNode> {
        let kind_str: String = row.get("kind")?;
        let kind = KnowledgeKind::from_str(&kind_str).unwrap_or(KnowledgeKind::Concept);

        Ok(KnowledgeNode {
            id: row.get("id")?,
            kind,
            name: row.get("name")?,
            description: row.get("description")?,
            mastery_score: row.get("mastery_score")?,
            metadata_json: row.get("metadata_json")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    fn row_to_edge(row: &Row) -> rusqlite::Result<KnowledgeEdge> {
        let kind_str: String = row.get("kind")?;
        let kind = KnowledgeEdgeKind::from_str(&kind_str).unwrap_or(KnowledgeEdgeKind::RelatedTo);

        Ok(KnowledgeEdge {
            id: row.get("id")?,
            source_id: row.get("source_id")?,
            target_id: row.get("target_id")?,
            kind,
            weight: row.get("weight")?,
            created_at: row.get("created_at")?,
        })
    }

    pub fn insert_node(&self, node: &KnowledgeNode) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO knowledge_nodes (
                    id, kind, name, description, mastery_score, metadata_json, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(name, kind) DO UPDATE SET
                    description = excluded.description,
                    mastery_score = excluded.mastery_score,
                    metadata_json = excluded.metadata_json,
                    updated_at = excluded.updated_at;
                "#,
                params![
                    node.id,
                    node.kind.to_string(),
                    node.name,
                    node.description,
                    node.mastery_score,
                    node.metadata_json,
                    node.created_at,
                    node.updated_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_node_by_id(&self, id: &str) -> Result<Option<KnowledgeNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, name, description, mastery_score, metadata_json, created_at, updated_at \
                 FROM knowledge_nodes WHERE id = ?1;",
            )?;

            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(Self::row_to_node(row)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn get_node_by_name(&self, name: &str, kind: KnowledgeKind) -> Result<Option<KnowledgeNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, name, description, mastery_score, metadata_json, created_at, updated_at \
                 FROM knowledge_nodes WHERE name = ?1 AND kind = ?2;",
            )?;

            let mut rows = stmt.query(params![name, kind.to_string()])?;
            if let Some(row) = rows.next()? {
                Ok(Some(Self::row_to_node(row)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn update_mastery(&self, id: &str, score: f64) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            let rows = conn.execute(
                "UPDATE knowledge_nodes SET mastery_score = ?2, updated_at = ?3 WHERE id = ?1;",
                params![id, score.clamp(0.0, 1.0), now],
            )?;
            if rows == 0 {
                return Err(MemoryError::NotFound(format!("Knowledge node {} not found", id)));
            }
            Ok(())
        })
    }

    pub fn insert_edge(&self, edge: &KnowledgeEdge) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO knowledge_edges (
                    id, source_id, target_id, kind, weight, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(source_id, target_id, kind) DO UPDATE SET
                    weight = excluded.weight;
                "#,
                params![
                    edge.id,
                    edge.source_id,
                    edge.target_id,
                    edge.kind.to_string(),
                    edge.weight,
                    edge.created_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_outgoing_edges(&self, source_id: &str) -> Result<Vec<KnowledgeEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, created_at \
                 FROM knowledge_edges WHERE source_id = ?1;",
            )?;

            let edge_iter = stmt.query_map(params![source_id], Self::row_to_edge)?;
            let mut edges = Vec::new();
            for edge in edge_iter {
                edges.push(edge?);
            }
            Ok(edges)
        })
    }

    pub fn get_incoming_edges(&self, target_id: &str) -> Result<Vec<KnowledgeEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, created_at \
                 FROM knowledge_edges WHERE target_id = ?1;",
            )?;

            let edge_iter = stmt.query_map(params![target_id], Self::row_to_edge)?;
            let mut edges = Vec::new();
            for edge in edge_iter {
                edges.push(edge?);
            }
            Ok(edges)
        })
    }

    pub fn get_subgraph(
        &self,
        start_node_id: &str,
        max_depth: usize,
    ) -> Result<(Vec<KnowledgeNode>, Vec<KnowledgeEdge>)> {
        let mut visited_nodes: HashSet<String> = HashSet::new();
        let mut visited_edges: HashSet<String> = HashSet::new();
        let mut collected_edges: Vec<KnowledgeEdge> = Vec::new();
        let mut queue: VecDeque<(String, usize)> = VecDeque::new();

        queue.push_back((start_node_id.to_string(), 0));
        visited_nodes.insert(start_node_id.to_string());

        while let Some((curr_id, depth)) = queue.pop_front() {
            if depth >= max_depth {
                continue;
            }

            let outgoing = self.get_outgoing_edges(&curr_id)?;
            for edge in outgoing {
                if visited_edges.insert(edge.id.clone()) {
                    collected_edges.push(edge.clone());
                }
                if !visited_nodes.contains(&edge.target_id) {
                    visited_nodes.insert(edge.target_id.clone());
                    queue.push_back((edge.target_id.clone(), depth + 1));
                }
            }

            let incoming = self.get_incoming_edges(&curr_id)?;
            for edge in incoming {
                if visited_edges.insert(edge.id.clone()) {
                    collected_edges.push(edge.clone());
                }
                if !visited_nodes.contains(&edge.source_id) {
                    visited_nodes.insert(edge.source_id.clone());
                    queue.push_back((edge.source_id.clone(), depth + 1));
                }
            }
        }

        let mut collected_nodes: Vec<KnowledgeNode> = Vec::new();
        for node_id in &visited_nodes {
            if let Some(node) = self.get_node_by_id(node_id)? {
                collected_nodes.push(node);
            }
        }

        Ok((collected_nodes, collected_edges))
    }

    pub fn list_nodes_by_kind(&self, kind: KnowledgeKind) -> Result<Vec<KnowledgeNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, name, description, mastery_score, metadata_json, created_at, updated_at \
                 FROM knowledge_nodes WHERE kind = ?1 ORDER BY mastery_score DESC, name ASC;",
            )?;

            let node_iter = stmt.query_map(params![kind.to_string()], Self::row_to_node)?;
            let mut nodes = Vec::new();
            for node in node_iter {
                nodes.push(node?);
            }
            Ok(nodes)
        })
    }

    pub fn list_all_nodes(&self) -> Result<Vec<KnowledgeNode>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, name, description, mastery_score, metadata_json, created_at, updated_at \
                 FROM knowledge_nodes ORDER BY mastery_score DESC, name ASC;",
            )?;

            let node_iter = stmt.query_map([], Self::row_to_node)?;
            let mut nodes = Vec::new();
            for node in node_iter {
                nodes.push(node?);
            }
            Ok(nodes)
        })
    }

    pub fn list_all_edges(&self) -> Result<Vec<KnowledgeEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, created_at FROM knowledge_edges;",
            )?;

            let edge_iter = stmt.query_map([], Self::row_to_edge)?;
            let mut edges = Vec::new();
            for edge in edge_iter {
                edges.push(edge?);
            }
            Ok(edges)
        })
    }
}
