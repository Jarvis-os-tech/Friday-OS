use crate::server::state::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct WakeUpQuery {
    pub agent_id: Option<String>,
    pub max_recent: Option<usize>,
    pub max_decisions: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct WakeUpResponse {
    pub formatted_prompt: String,
    pub sections: HashMap<String, Vec<String>>,
    pub total_nodes: usize,
    pub timestamp: i64,
}

pub async fn wakeup_handler(
    State(state): State<AppState>,
    Query(query): Query<WakeUpQuery>,
) -> Result<Json<WakeUpResponse>, (StatusCode, String)> {
    let now = chrono::Utc::now().timestamp();
    let max_recent = query.max_recent.unwrap_or(8);
    let max_decisions = query.max_decisions.unwrap_or(6);

    let mut sections: HashMap<String, Vec<String>> = HashMap::new();
    let mut total_nodes = 0;

    // 1. Fetch Permanent Identity & Core Facts (Tier: Knowledge or Persistent Facts)
    let identity_nodes = state
        .pool
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, importance \
                 FROM memory_nodes \
                 WHERE (tier = 3 OR (tier = 2 AND kind = 'fact')) AND superseded_by IS NULL \
                 ORDER BY importance DESC, updated_at DESC LIMIT 15;",
            )?;
            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let content: String = row.get(3)?;
                let summary: Option<String> = row.get(4)?;
                Ok((id, summary.unwrap_or(content)))
            })?;
            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let identity_lines: Vec<String> = identity_nodes
        .into_iter()
        .map(|(_, text)| format!("- {}", text))
        .collect();
    total_nodes += identity_lines.len();
    sections.insert("identity_and_facts".to_string(), identity_lines.clone());

    // 2. Fetch Active Architectural Decisions & Lessons
    let decision_nodes = state
        .pool
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, importance \
                 FROM memory_nodes \
                 WHERE kind IN ('decision', 'lesson', 'pattern') AND superseded_by IS NULL \
                 ORDER BY importance DESC, updated_at DESC LIMIT ?1;",
            )?;
            let rows = stmt.query_map([max_decisions as i64], |row| {
                let kind_str: String = row.get(1)?;
                let content: String = row.get(3)?;
                let summary: Option<String> = row.get(4)?;
                Ok(format!("[{}] {}", kind_str.to_uppercase(), summary.unwrap_or(content)))
            })?;
            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let decision_lines: Vec<String> = decision_nodes
        .into_iter()
        .map(|text| format!("- {}", text))
        .collect();
    total_nodes += decision_lines.len();
    sections.insert("decisions_and_lessons".to_string(), decision_lines.clone());

    // 3. Fetch Recent Working & Session Memory (last 48 hours / active)
    let recent_nodes = state
        .pool
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, kind, tier, content, summary, updated_at \
                 FROM memory_nodes \
                 WHERE tier IN (0, 1) AND superseded_by IS NULL \
                 ORDER BY updated_at DESC LIMIT ?1;",
            )?;
            let rows = stmt.query_map([max_recent as i64], |row| {
                let kind_str: String = row.get(1)?;
                let content: String = row.get(3)?;
                let summary: Option<String> = row.get(4)?;
                Ok(format!("[{}] {}", kind_str, summary.unwrap_or(content)))
            })?;
            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let recent_lines: Vec<String> = recent_nodes
        .into_iter()
        .map(|text| format!("- {}", text))
        .collect();
    total_nodes += recent_lines.len();
    sections.insert("recent_activity".to_string(), recent_lines.clone());

    // 4. Fetch Hierarchical Summaries (L1 / L2 rollups)
    let summary_nodes = state
        .pool
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, content, tree_level, updated_at \
                 FROM memory_nodes \
                 WHERE kind = 'chunk' AND tree_level > 0 AND superseded_by IS NULL \
                 ORDER BY tree_level DESC, updated_at DESC LIMIT 3;",
            )?;
            let rows = stmt.query_map([], |row| {
                let level: i64 = row.get(2)?;
                let content: String = row.get(1)?;
                Ok(format!("(Level {} Rollup):\n{}", level, content))
            })?;
            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    total_nodes += summary_nodes.len();
    sections.insert("hierarchical_summaries".to_string(), summary_nodes.clone());

    // 5. Fetch Active Knowledge Triples
    let triples = state
        .triple_repo
        .query("", None, Some(now))
        .unwrap_or_default();

    let triple_lines: Vec<String> = triples
        .into_iter()
        .take(8)
        .map(|t| format!("- ({}) --[{}]--> ({}) [confidence: {:.2}]", t.subject, t.predicate, t.object, t.confidence))
        .collect();
    total_nodes += triple_lines.len();
    sections.insert("knowledge_triples".to_string(), triple_lines.clone());

    // 6. Assemble Markdown Prompt
    let mut prompt = String::from("# 🧠 J.A.R.V.I.S. Wake-Up Memory Context\n\n");

    if !identity_lines.is_empty() {
        prompt.push_str("## 👤 Operator Profile & Core Facts\n");
        for line in &identity_lines {
            prompt.push_str(line);
            prompt.push('\n');
        }
        prompt.push('\n');
    }

    if !decision_lines.is_empty() {
        prompt.push_str("## ⚡ Key Decisions, Lessons & Architecture\n");
        for line in &decision_lines {
            prompt.push_str(line);
            prompt.push('\n');
        }
        prompt.push('\n');
    }

    if !recent_lines.is_empty() {
        prompt.push_str("## 🕒 Recent Session Working Memory\n");
        for line in &recent_lines {
            prompt.push_str(line);
            prompt.push('\n');
        }
        prompt.push('\n');
    }

    if !summary_nodes.is_empty() {
        prompt.push_str("## 🌲 Consolidated Hierarchical Summaries\n");
        for s in &summary_nodes {
            prompt.push_str(s);
            prompt.push_str("\n\n");
        }
    }

    if !triple_lines.is_empty() {
        prompt.push_str("## 🕸️ Active Temporal Knowledge Triples\n");
        for line in &triple_lines {
            prompt.push_str(line);
            prompt.push('\n');
        }
        prompt.push('\n');
    }

    Ok(Json(WakeUpResponse {
        formatted_prompt: prompt,
        sections,
        total_nodes,
        timestamp: now,
    }))
}
