use crate::db::DatabasePool;
use crate::error::Result;
use crate::types::DiaryEntry;
use rusqlite::{params, Row};

#[derive(Clone)]
pub struct DiaryRepository {
    pool: DatabasePool,
}

impl DiaryRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_entry(row: &Row) -> std::result::Result<DiaryEntry, rusqlite::Error> {
        Ok(DiaryEntry {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            session_id: row.get(2)?,
            entry_type: row.get(3)?,
            content: row.get(4)?,
            tags_json: row.get(5)?,
            created_at: row.get(6)?,
        })
    }

    pub fn insert(&self, entry: &DiaryEntry) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                "INSERT INTO diary_entries (
                    id, agent_id, session_id, entry_type, content, tags_json, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.id,
                    entry.agent_id,
                    entry.session_id,
                    entry.entry_type,
                    entry.content,
                    entry.tags_json,
                    entry.created_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn read(&self, agent_id: Option<&str>, limit: usize) -> Result<Vec<DiaryEntry>> {
        self.pool.with_conn(|conn| {
            if let Some(agent) = agent_id {
                let mut stmt = conn.prepare(
                    "SELECT * FROM diary_entries WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![agent, limit], Self::row_to_entry)?;
                let mut entries = Vec::new();
                for row in rows {
                    entries.push(row?);
                }
                Ok(entries)
            } else {
                self.read_all(limit)
            }
        })
    }

    pub fn read_all(&self, limit: usize) -> Result<Vec<DiaryEntry>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], Self::row_to_entry)?;
            let mut entries = Vec::new();
            for row in rows {
                entries.push(row?);
            }
            Ok(entries)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabasePool;

    fn setup_test_db() -> DatabasePool {
        DatabasePool::in_memory().expect("Failed to initialize in-memory SQLite")
    }

    #[test]
    fn test_diary_repo() {
        let pool = setup_test_db();
        let repo = DiaryRepository::new(pool);
        let now = chrono::Utc::now().timestamp();

        let entry = DiaryEntry {
            id: "diary-1".to_string(),
            agent_id: "jarvis".to_string(),
            session_id: None,
            entry_type: "reflection".to_string(),
            content: "Learned a new pattern".to_string(),
            tags_json: None,
            created_at: now,
        };

        repo.insert(&entry).unwrap();

        let entries = repo.read(Some("jarvis"), 10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "Learned a new pattern");

        let all = repo.read_all(10).unwrap();
        assert_eq!(all.len(), 1);
    }
}
