use crate::db::DatabasePool;
use crate::error::{MemoryError, Result};
use crate::types::{ConversationTurn, Session};
use rusqlite::{params, Row};

#[derive(Clone)]
pub struct ConversationRepository {
    pool: DatabasePool,
}

impl ConversationRepository {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    fn row_to_session(row: &Row) -> rusqlite::Result<Session> {
        let consolidated_val: i64 = row.get("consolidated")?;
        Ok(Session {
            id: row.get("id")?,
            agent_id: row.get("agent_id")?,
            parent_session: row.get("parent_session")?,
            total_tokens: row.get("total_tokens")?,
            total_turns: row.get("total_turns")?,
            total_tool_calls: row.get("total_tool_calls")?,
            summary: row.get("summary")?,
            started_at: row.get("started_at")?,
            ended_at: row.get("ended_at")?,
            consolidated: consolidated_val == 1,
        })
    }

    fn row_to_turn(row: &Row) -> rusqlite::Result<ConversationTurn> {
        Ok(ConversationTurn {
            id: row.get("id")?,
            session_id: row.get("session_id")?,
            role: row.get("role")?,
            content: row.get("content")?,
            tool_name: row.get("tool_name")?,
            tool_call_json: row.get("tool_call_json")?,
            turn_index: row.get("turn_index")?,
            token_count: row.get("token_count")?,
            created_at: row.get("created_at")?,
        })
    }

    pub fn create_session(&self, session: &Session) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO sessions (
                    id, agent_id, parent_session, total_tokens, total_turns,
                    total_tool_calls, summary, started_at, ended_at, consolidated
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);
                "#,
                params![
                    session.id,
                    session.agent_id,
                    session.parent_session,
                    session.total_tokens,
                    session.total_turns,
                    session.total_tool_calls,
                    session.summary,
                    session.started_at,
                    session.ended_at,
                    if session.consolidated { 1 } else { 0 }
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, agent_id, parent_session, total_tokens, total_turns, \
                 total_tool_calls, summary, started_at, ended_at, consolidated \
                 FROM sessions WHERE id = ?1;",
            )?;

            let mut rows = stmt.query(params![id])?;
            if let Some(row) = rows.next()? {
                Ok(Some(Self::row_to_session(row)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn update_session(&self, session: &Session) -> Result<()> {
        self.pool.with_conn(|conn| {
            let rows = conn.execute(
                r#"
                UPDATE sessions SET
                    agent_id = ?2,
                    parent_session = ?3,
                    total_tokens = ?4,
                    total_turns = ?5,
                    total_tool_calls = ?6,
                    summary = ?7,
                    ended_at = ?8,
                    consolidated = ?9
                WHERE id = ?1;
                "#,
                params![
                    session.id,
                    session.agent_id,
                    session.parent_session,
                    session.total_tokens,
                    session.total_turns,
                    session.total_tool_calls,
                    session.summary,
                    session.ended_at,
                    if session.consolidated { 1 } else { 0 }
                ],
            )?;

            if rows == 0 {
                return Err(MemoryError::NotFound(format!("Session {} not found for update", session.id)));
            }
            Ok(())
        })
    }

    pub fn append_turn(&self, turn: &ConversationTurn) -> Result<()> {
        crate::security::SecretScanner::scan_and_enforce(&turn.content)?;
        self.pool.with_conn(|conn| {
            conn.execute(
                r#"
                INSERT INTO conversation_turns (
                    id, session_id, role, content, tool_name, tool_call_json,
                    turn_index, token_count, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);
                "#,
                params![
                    turn.id,
                    turn.session_id,
                    turn.role,
                    turn.content,
                    turn.tool_name,
                    turn.tool_call_json,
                    turn.turn_index,
                    turn.token_count,
                    turn.created_at
                ],
            )?;

            // Increment session turn count and token count if token_count is present
            let token_delta = turn.token_count.unwrap_or(0);
            let tool_delta = if turn.tool_name.is_some() { 1 } else { 0 };
            conn.execute(
                r#"
                UPDATE sessions
                SET total_turns = total_turns + 1,
                    total_tokens = total_tokens + ?2,
                    total_tool_calls = total_tool_calls + ?3
                WHERE id = ?1;
                "#,
                params![turn.session_id, token_delta, tool_delta],
            )?;

            Ok(())
        })
    }

    pub fn list_turns(&self, session_id: &str, limit: usize) -> Result<Vec<ConversationTurn>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, session_id, role, content, tool_name, tool_call_json, \
                 turn_index, token_count, created_at \
                 FROM conversation_turns \
                 WHERE session_id = ?1 \
                 ORDER BY turn_index ASC \
                 LIMIT ?2;",
            )?;

            let turn_iter = stmt.query_map(params![session_id, limit as i64], Self::row_to_turn)?;
            let mut turns = Vec::new();
            for turn in turn_iter {
                turns.push(turn?);
            }
            Ok(turns)
        })
    }

    pub fn get_unconsolidated_sessions(&self) -> Result<Vec<Session>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, agent_id, parent_session, total_tokens, total_turns, \
                 total_tool_calls, summary, started_at, ended_at, consolidated \
                 FROM sessions \
                 WHERE consolidated = 0 AND total_turns >= 5 \
                 ORDER BY started_at ASC;",
            )?;

            let session_iter = stmt.query_map([], Self::row_to_session)?;
            let mut sessions = Vec::new();
            for sess in session_iter {
                sessions.push(sess?);
            }
            Ok(sessions)
        })
    }

    pub fn mark_session_consolidated(&self, session_id: &str) -> Result<()> {
        self.pool.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET consolidated = 1 WHERE id = ?1;",
                params![session_id],
            )?;
            Ok(())
        })
    }

    pub fn count_turns(&self, session_id: &str) -> Result<usize> {
        self.pool.with_conn(|conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM conversation_turns WHERE session_id = ?1;",
                params![session_id],
                |r| r.get(0),
            )?;
            Ok(count as usize)
        })
    }
}
