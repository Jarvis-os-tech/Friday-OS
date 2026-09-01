use crate::db::DatabasePool;
use crate::error::Result;
use crate::types::KnowledgeTriple;
use rusqlite::{params, Row};
use uuid::Uuid;

#[derive(Clone)]
pub struct KnowledgeTripleRepository {
    pool: DatabasePool,
}

impl KnowledgeTripleRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_triple(row: &Row) -> std::result::Result<KnowledgeTriple, rusqlite::Error> {
        Ok(KnowledgeTriple {
            id: row.get(0)?,
            subject: row.get(1)?,
            predicate: row.get(2)?,
            object: row.get(3)?,
            valid_from: row.get(4)?,
            valid_to: row.get(5)?,
            confidence: row.get(6)?,
            source_node_id: row.get(7)?,
            source: row.get(8)?,
            agent_id: row.get(9)?,
            metadata_json: row.get(10)?,
            created_at: row.get(11)?,
        })
    }

    pub fn insert(&self, triple: &KnowledgeTriple) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                "INSERT INTO knowledge_triples (
                    id, subject, predicate, object, valid_from, valid_to, confidence,
                    source_node_id, source, agent_id, metadata_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    triple.id,
                    triple.subject,
                    triple.predicate,
                    triple.object,
                    triple.valid_from,
                    triple.valid_to,
                    triple.confidence,
                    triple.source_node_id,
                    triple.source,
                    triple.agent_id,
                    triple.metadata_json,
                    triple.created_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn query(&self, subject: &str, predicate: Option<&str>, as_of: Option<i64>) -> Result<Vec<KnowledgeTriple>> {
        self.pool.with_conn(|conn| {
            let mut query = String::from("SELECT * FROM knowledge_triples WHERE subject = ?1");
            let mut p: Vec<rusqlite::types::Value> = vec![subject.to_string().into()];

            if let Some(pred) = predicate {
                query.push_str(" AND predicate = ?2");
                p.push(pred.to_string().into());
            }

            if let Some(t) = as_of {
                if predicate.is_some() {
                    query.push_str(" AND valid_from <= ?3 AND (valid_to IS NULL OR valid_to > ?3)");
                } else {
                    query.push_str(" AND valid_from <= ?2 AND (valid_to IS NULL OR valid_to > ?2)");
                }
                p.push(t.into());
            }

            let mut stmt = conn.prepare(&query)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(p), Self::row_to_triple)?;
            let mut triples = Vec::new();
            for row in rows {
                triples.push(row?);
            }

            Ok(triples)
        })
    }

    pub fn query_object(&self, object: &str, as_of: Option<i64>) -> Result<Vec<KnowledgeTriple>> {
        self.pool.with_conn(|conn| {
            let mut query = String::from("SELECT * FROM knowledge_triples WHERE object = ?1");
            if as_of.is_some() {
                query.push_str(" AND valid_from <= ?2 AND (valid_to IS NULL OR valid_to > ?2)");
            }

            let mut stmt = conn.prepare(&query)?;
            let mut triples = Vec::new();

            if let Some(t) = as_of {
                let rows = stmt.query_map(params![object, t], Self::row_to_triple)?;
                for row in rows {
                    triples.push(row?);
                }
            } else {
                let rows = stmt.query_map(params![object], Self::row_to_triple)?;
                for row in rows {
                    triples.push(row?);
                }
            }

            Ok(triples)
        })
    }

    pub fn supersede(
        &self,
        subject: &str,
        predicate: &str,
        old_object: &str,
        new_object: &str,
    ) -> Result<KnowledgeTriple> {
        let at = chrono::Utc::now().timestamp();
        self.pool.with_conn(|conn| {
            // Close old triple
            conn.execute(
                "UPDATE knowledge_triples SET valid_to = ?1 WHERE subject = ?2 AND predicate = ?3 AND object = ?4 AND valid_to IS NULL",
                params![at, subject, predicate, old_object],
            )?;

            // Create new triple
            let id = Uuid::new_v4().to_string();
            let new_triple = KnowledgeTriple {
                id: id.clone(),
                subject: subject.to_string(),
                predicate: predicate.to_string(),
                object: new_object.to_string(),
                valid_from: at,
                valid_to: None,
                confidence: 1.0,
                source_node_id: None,
                source: "auto".to_string(),
                agent_id: None,
                metadata_json: None,
                created_at: at,
            };

            conn.execute(
                "INSERT INTO knowledge_triples (
                    id, subject, predicate, object, valid_from, valid_to, confidence,
                    source_node_id, source, agent_id, metadata_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    new_triple.id,
                    new_triple.subject,
                    new_triple.predicate,
                    new_triple.object,
                    new_triple.valid_from,
                    new_triple.valid_to,
                    new_triple.confidence,
                    new_triple.source_node_id,
                    new_triple.source,
                    new_triple.agent_id,
                    new_triple.metadata_json,
                    new_triple.created_at,
                ],
            )?;

            Ok(new_triple)
        })
    }

    pub fn timeline(&self, subject: &str, predicate: &str) -> Result<Vec<KnowledgeTriple>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM knowledge_triples WHERE subject = ?1 AND predicate = ?2 ORDER BY valid_from ASC",
            )?;
            let rows = stmt.query_map(params![subject, predicate], Self::row_to_triple)?;
            let mut triples = Vec::new();
            for row in rows {
                triples.push(row?);
            }
            Ok(triples)
        })
    }

    pub fn get_active(&self, limit: usize) -> Result<Vec<KnowledgeTriple>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM knowledge_triples WHERE valid_to IS NULL ORDER BY created_at DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], Self::row_to_triple)?;
            let mut triples = Vec::new();
            for row in rows {
                triples.push(row?);
            }
            Ok(triples)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabasePool;

    fn setup_test_db() -> DatabasePool {
        let pool = DatabasePool::in_memory().expect("Failed to initialize in-memory SQLite");
        pool
    }

    #[test]
    fn test_knowledge_triple_crud() {
        let pool = setup_test_db();
        let repo = KnowledgeTripleRepository::new(pool);
        let now = chrono::Utc::now().timestamp();

        let triple = KnowledgeTriple {
            id: "kt-1".to_string(),
            subject: "user".to_string(),
            predicate: "likes".to_string(),
            object: "rust".to_string(),
            valid_from: now,
            valid_to: None,
            confidence: 0.9,
            source_node_id: None,
            source: "auto".to_string(),
            agent_id: None,
            metadata_json: None,
            created_at: now,
        };

        repo.insert(&triple).unwrap();

        let subj_query = repo.query("user", None, None).unwrap();
        assert_eq!(subj_query.len(), 1);

        let as_of_query = repo.query("user", None, Some(now + 10)).unwrap();
        assert_eq!(as_of_query.len(), 1);

        let old_query = repo.query("user", None, Some(now - 10)).unwrap();
        assert_eq!(old_query.len(), 0);

        let new_triple = repo.supersede("user", "likes", "rust", "go").unwrap();
        assert_eq!(new_triple.object, "go");

        let active = repo.get_active(10).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].object, "go");

        let timeline = repo.timeline("user", "likes").unwrap();
        assert_eq!(timeline.len(), 2);
    }
}
