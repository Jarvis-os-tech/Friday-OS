use crate::db::DatabasePool;
use crate::error::Result;
use crate::types::{EdgeKind, MemoryEdge};
use rusqlite::{params, Row};
use std::str::FromStr;

#[derive(Clone)]
pub struct EdgeRepository {
    pool: DatabasePool,
}

impl EdgeRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_edge(row: &Row) -> rusqlite::Result<MemoryEdge> {
        let kind_str: String = row.get("kind")?;
        let kind = EdgeKind::from_str(&kind_str).unwrap_or(EdgeKind::RelatedTo);

        Ok(MemoryEdge {
            id: row.get("id")?,
            source_id: row.get("source_id")?,
            target_id: row.get("target_id")?,
            kind,
            weight: row.get("weight")?,
            metadata_json: row.get("metadata_json")?,
            created_at: row.get("created_at")?,
        })
    }

    pub fn insert(&self, edge: &MemoryEdge) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO memory_edges (
                    id, source_id, target_id, kind, weight, metadata_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(source_id, target_id, kind) DO UPDATE SET
                    weight = excluded.weight,
                    metadata_json = excluded.metadata_json;
                "#,
                params![
                    edge.id,
                    edge.source_id,
                    edge.target_id,
                    edge.kind.to_string(),
                    edge.weight,
                    edge.metadata_json,
                    edge.created_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_by_id(&self, id: &str) -> Result<Option<MemoryEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, metadata_json, created_at \
                 FROM memory_edges WHERE id = ?1;",
            )?;

            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(Self::row_to_edge(row)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn get_outgoing(&self, source_id: &str) -> Result<Vec<MemoryEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, metadata_json, created_at \
                 FROM memory_edges WHERE source_id = ?1;",
            )?;

            let edge_iter = stmt.query_map(params![source_id], Self::row_to_edge)?;
            let mut edges = Vec::new();
            for edge in edge_iter {
                edges.push(edge?);
            }
            Ok(edges)
        })
    }

    pub fn get_incoming(&self, target_id: &str) -> Result<Vec<MemoryEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, metadata_json, created_at \
                 FROM memory_edges WHERE target_id = ?1;",
            )?;

            let edge_iter = stmt.query_map(params![target_id], Self::row_to_edge)?;
            let mut edges = Vec::new();
            for edge in edge_iter {
                edges.push(edge?);
            }
            Ok(edges)
        })
    }

    pub fn get_neighbors(&self, node_id: &str) -> Result<Vec<String>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT target_id FROM memory_edges WHERE source_id = ?1 \
                 UNION \
                 SELECT source_id FROM memory_edges WHERE target_id = ?1;",
            )?;

            let rows = stmt.query_map(params![node_id], |r| r.get(0))?;
            let mut neighbors = Vec::new();
            for n in rows {
                neighbors.push(n?);
            }
            Ok(neighbors)
        })
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        self.pool.with_conn(|conn| {
            let rows = conn.execute("DELETE FROM memory_edges WHERE id = ?1;", params![id])?;
            Ok(rows > 0)
        })
    }

    pub fn list_all(&self) -> Result<Vec<MemoryEdge>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, metadata_json, created_at FROM memory_edges;",
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
