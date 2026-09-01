use crate::search::{SearchProfile, SearchQuery};
use crate::security::SecretScanner;
use crate::server::state::AppState;
use crate::tree::TreeRetrieval;
use crate::types::{NodeKind, Tier};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, BufRead, Write};

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub struct McpServer {
    state: AppState,
}

impl McpServer {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    pub fn run_stdio(&self) -> io::Result<()> {
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        let reader = stdin.lock();

        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(req) = serde_json::from_str::<JsonRpcRequest>(&line) {
                let resp = self.handle_request(req);
                if let Some(r) = resp {
                    let out = serde_json::to_string(&r)?;
                    writeln!(stdout, "{}", out)?;
                    stdout.flush()?;
                }
            }
        }
        Ok(())
    }

    pub fn handle_request(&self, req: JsonRpcRequest) -> Option<JsonRpcResponse> {
        let id = req.id.clone();
        match req.method.as_str() {
            "initialize" => Some(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {
                        "name": "jarvis-memory-engine",
                        "version": "0.1.0"
                    },
                    "capabilities": {
                        "tools": {}
                    }
                })),
                error: None,
            }),

            "notifications/initialized" => None,

            "ping" => Some(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(serde_json::json!({})),
                error: None,
            }),

            "tools/list" => Some(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: Some(serde_json::json!({
                    "tools": [
                        {
                            "name": "jarvis_remember",
                            "description": "Ingest and persist high-value facts, user preferences, architecture decisions, lessons, or patterns into SQLite + Obsidian Vault with pre-write secret scanning and hierarchical compaction.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "content": { "type": "string", "description": "The exact memory content or fact to persist." },
                                    "kind": { "type": "string", "enum": ["fact", "decision", "lesson", "pattern", "entity", "chunk"], "description": "Category of memory item." },
                                    "tier": { "type": "string", "enum": ["session", "working", "persistent", "knowledge"], "description": "Retention tier (default: persistent)." },
                                    "importance": { "type": "number", "description": "Importance score in [0.0, 1.0]." },
                                    "summary": { "type": "string", "description": "Optional one-line summary." }
                                },
                                "required": ["content", "kind"]
                            }
                        },
                        {
                            "name": "jarvis_recall",
                            "description": "Execute sub-50ms 4-Signal Zero-Hallucination Hybrid Search combining FTS5 BM25, Cosine Vectors, Knowledge Graph BFS, and Ebbinghaus Recency Decay.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string", "description": "Search query or question." },
                                    "profile": { "type": "string", "enum": ["balanced", "semantic", "lexical", "graph_first", "precise"], "description": "Search profile weights." },
                                    "limit": { "type": "integer", "description": "Maximum results to return (default: 5)." }
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "name": "jarvis_tree_drilldown",
                            "description": "Retrieve hierarchical memory drilldown (L2 -> L1 -> L0) from a summary note to assemble comprehensive context trees.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "root_id": { "type": "string", "description": "ID of the summary node to drill down into." }
                                },
                                "required": ["root_id"]
                            }
                        },
                        {
                            "name": "jarvis_graph_neighborhood",
                            "description": "Explore 1-hop and 2-hop connected graph concepts around specific seed node IDs.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "node_id": { "type": "string", "description": "Seed node ID." },
                                    "max_hops": { "type": "integer", "description": "Traversal depth (default: 2)." }
                                },
                                "required": ["node_id"]
                            }
                        },
                        {
                            "name": "jarvis_vault_status",
                            "description": "Inspect SQLite WAL memory database health, active nodes, edges, unsealed tree buffers, and Obsidian vault file counts.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "jarvis_flush_memory",
                            "description": "Manually flush pending unsealed memory buffers into consolidated markdown summaries.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "stale_seconds": { "type": "integer", "description": "Idle threshold in seconds (default: 0 for immediate flush)." }
                                }
                            }
                        },
                        {
                            "name": "jarvis_wake_up",
                            "description": "Auto-assemble rich session bootstrap context: operator profile, active architectural decisions, recent working memory, and temporal knowledge triples into a structured Markdown prompt.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "max_recent": { "type": "integer", "description": "Max recent working items (default: 8)." },
                                    "max_decisions": { "type": "integer", "description": "Max architecture decisions/lessons (default: 6)." }
                                }
                            }
                        }
                    ]
                })),
                error: None,
            }),

            "tools/call" => {
                let params = req.params.unwrap_or(Value::Null);
                let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(Value::Null);

                let result_text = self.execute_tool(tool_name, &args);
                Some(JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: Some(serde_json::json!({
                        "content": [
                            {
                                "type": "text",
                                "text": result_text
                            }
                        ]
                    })),
                    error: None,
                })
            }

            _ => Some(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                    data: None,
                }),
            }),
        }
    }

    fn execute_tool(&self, name: &str, args: &Value) -> String {
        match name {
            "jarvis_remember" => {
                let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
                let kind_str = args.get("kind").and_then(|k| k.as_str()).unwrap_or("fact");
                let tier_str = args.get("tier").and_then(|t| t.as_str()).unwrap_or("persistent");
                let importance = args.get("importance").and_then(|i| i.as_f64()).unwrap_or(0.8);
                let summary = args.get("summary").and_then(|s| s.as_str()).map(|s| s.to_string());

                if SecretScanner::contains_secrets(content) {
                    return "❌ Error: Pre-write secret scanner detected sensitive credentials in content. Ingestion aborted.".to_string();
                }

                let kind = match kind_str {
                    "decision" => NodeKind::Decision,
                    "lesson" => NodeKind::Lesson,
                    "pattern" => NodeKind::Pattern,
                    "entity" => NodeKind::Entity,
                    "chunk" => NodeKind::Chunk,
                    _ => NodeKind::Fact,
                };

                let tier = match tier_str {
                    "session" => Tier::Session,
                    "working" => Tier::Working,
                    "knowledge" => Tier::Knowledge,
                    _ => Tier::Persistent,
                };

                let now = chrono::Utc::now().timestamp();
                let node_id = format!("node-{}", &uuid::Uuid::new_v4().to_string()[..8]);

                let node = crate::types::MemoryNode {
                    id: node_id.clone(),
                    kind,
                    tier,
                    content: content.to_string(),
                    summary,
                    parent_id: None,
                    tree_level: 0,
                    importance,
                    superseded_by: None,
                    agent_id: Some("jarvis".to_string()),
                    session_id: Some("mcp".to_string()),
                    source: "mcp_tool".to_string(),
                    metadata_json: None,
                    created_at: now,
                    updated_at: now,
                };

                if let Err(e) = self.state.node_repo.insert(&node) {
                    return format!("❌ Database Error: {}", e);
                }

                if let Some(ref vw) = self.state.vault_writer {
                    let _ = vw.write_node(&node, &[]);
                }

                let sealed_parent = self.state.tree_engine.ingest_node(&node, "mcp").unwrap_or(None);

                let mut out = format!("✅ Successfully stored memory node `{}` (Kind: {}, Tier: {}).", node.id, node.kind, node.tier);
                if let Some(p) = sealed_parent {
                    out.push_str(&format!("\n🌲 Auto-sealed into L{} summary node `{}`.", p.tree_level, p.id));
                }
                out
            }

            "jarvis_recall" => {
                let query_str = args.get("query").and_then(|q| q.as_str()).unwrap_or("");
                let profile_str = args.get("profile").and_then(|p| p.as_str()).unwrap_or("balanced");
                let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(5) as usize;

                let profile = match profile_str {
                    "semantic" => SearchProfile::Semantic,
                    "lexical" => SearchProfile::Lexical,
                    "graph_first" => SearchProfile::GraphFirst,
                    "precise" => SearchProfile::Precise,
                    _ => SearchProfile::Balanced,
                };

                let query = SearchQuery {
                    text: query_str.to_string(),
                    vector: None,
                    profile,
                    limit,
                    tier_filter: None,
                    kind_filter: None,
                    include_superseded: false,
                    root_node_ids: None,
                    mmr_lambda: Some(0.7),
                };

                match self.state.ranker.search(&query) {
                    Ok(results) => {
                        if results.is_empty() {
                            return format!("🔍 No memory nodes found matching query: '{}'", query_str);
                        }

                        let mut lines = vec![format!("🧠 Found {} memory result(s) for '{}':\n", results.len(), query_str)];
                        for (idx, r) in results.iter().enumerate() {
                            lines.push(format!(
                                "{}. `[{}]` **{}** (Score: {:.2})\n   {}\n   *Signals: BM25={:.2}, Vector={:.2}, Graph={:.2}, Recency={:.2}*\n",
                                idx + 1,
                                r.node.kind,
                                r.node.summary.as_deref().unwrap_or(&r.node.id),
                                r.combined_score,
                                r.snippet.as_deref().unwrap_or(&r.node.content),
                                r.signals.bm25,
                                r.signals.vector,
                                r.signals.graph,
                                r.signals.recency
                            ));
                        }
                        lines.join("\n")
                    }
                    Err(e) => format!("❌ Search Error: {}", e),
                }
            }

            "jarvis_tree_drilldown" => {
                let root_id = args.get("root_id").and_then(|r| r.as_str()).unwrap_or("");
                match self.state.tree_engine.drill_down(root_id, 3) {
                    Ok(Some(drill_tree)) => {
                        let formatted = TreeRetrieval::format_markdown(&drill_tree, 0);
                        format!("🌲 Hierarchical Memory Drilldown for `{}`:\n\n{}", root_id, formatted)
                    }
                    Ok(None) => format!("❌ Root summary node `{}` not found.", root_id),
                    Err(e) => format!("❌ Drilldown Error: {}", e),
                }
            }

            "jarvis_graph_neighborhood" => {
                let node_id = args.get("node_id").and_then(|n| n.as_str()).unwrap_or("");
                let max_hops = args.get("max_hops").and_then(|h| h.as_u64()).unwrap_or(2) as usize;

                let graph_search = crate::search::GraphSearchEngine::new(self.state.pool.clone());
                match graph_search.expand_neighborhood(&[node_id.to_string()], max_hops) {
                    Ok(scores) => {
                        let mut lines = vec![format!("🕸️ Graph neighborhood around `{}` (max_hops: {}):", node_id, max_hops)];
                        for (id, score) in scores {
                            lines.push(format!("  - Node `{}`: Proximity Score = {:.2}", id, score));
                        }
                        lines.join("\n")
                    }
                    Err(e) => format!("❌ Graph Traversal Error: {}", e),
                }
            }

            "jarvis_vault_status" => {
                let (nodes, edges) = self.state.pool.with_conn(|conn| {
                    let nc: i64 = conn.query_row("SELECT COUNT(*) FROM memory_nodes WHERE superseded_by IS NULL;", [], |r| r.get(0)).unwrap_or(0);
                    let ec: i64 = conn.query_row("SELECT COUNT(*) FROM memory_edges;", [], |r| r.get(0)).unwrap_or(0);
                    Ok((nc, ec))
                }).unwrap_or((0, 0));

                let buffers = self.state.tree_engine.list_buffers().unwrap_or_default();

                format!(
                    "🏛️ **J.A.R.V.I.S. Universal Memory Vault Status**:\n\
                     - **Active Memory Nodes**: {}\n\
                     - **Connected Graph Edges**: {}\n\
                     - **Active Unsealed Buffers**: {}\n\
                     - **Obsidian Vault Directory**: `{}`\n\
                     - **SQLite Database**: WAL Mode (Synchronous = NORMAL)\n\
                     - **Uptime**: {} seconds",
                    nodes,
                    edges,
                    buffers.len(),
                    self.state.config.vault_dir.display(),
                    chrono::Utc::now().timestamp() - self.state.started_at
                )
            }

            "jarvis_flush_memory" => {
                let stale_sec = args.get("stale_seconds").and_then(|s| s.as_i64()).unwrap_or(0);
                match self.state.tree_engine.flush_stale_buffers(stale_sec) {
                    Ok(flushed) => {
                        format!("🧹 Flushed {} stale buffer(s) into sealed summary notes.", flushed.len())
                    }
                    Err(e) => format!("❌ Flush Error: {}", e),
                }
            }

            "jarvis_wake_up" => {
                let max_recent = args.get("max_recent").and_then(|r| r.as_u64()).unwrap_or(8) as usize;
                let max_decisions = args.get("max_decisions").and_then(|d| d.as_u64()).unwrap_or(6) as usize;

                let now = chrono::Utc::now().timestamp();

                // 1. Permanent Identity / Facts
                let identity_lines: Vec<String> = self
                    .state
                    .pool
                    .with_conn(|conn| {
                        let mut stmt = conn.prepare(
                            "SELECT content, summary FROM memory_nodes \
                             WHERE (tier = 3 OR (tier = 2 AND kind = 'fact')) AND superseded_by IS NULL \
                             ORDER BY importance DESC, updated_at DESC LIMIT 15;",
                        )?;
                        let rows = stmt.query_map([], |r| {
                            let content: String = r.get(0)?;
                            let summary: Option<String> = r.get(1)?;
                            Ok(format!("- {}", summary.unwrap_or(content)))
                        })?;
                        let mut list = Vec::new();
                        for item in rows {
                            list.push(item?);
                        }
                        Ok(list)
                    })
                    .unwrap_or_default();

                // 2. Decisions & Lessons
                let decision_lines: Vec<String> = self
                    .state
                    .pool
                    .with_conn(|conn| {
                        let mut stmt = conn.prepare(
                            "SELECT kind, content, summary FROM memory_nodes \
                             WHERE kind IN ('decision', 'lesson', 'pattern') AND superseded_by IS NULL \
                             ORDER BY importance DESC, updated_at DESC LIMIT ?1;",
                        )?;
                        let rows = stmt.query_map([max_decisions as i64], |r| {
                            let kind: String = r.get(0)?;
                            let content: String = r.get(1)?;
                            let summary: Option<String> = r.get(2)?;
                            Ok(format!("- [{}] {}", kind.to_uppercase(), summary.unwrap_or(content)))
                        })?;
                        let mut list = Vec::new();
                        for item in rows {
                            list.push(item?);
                        }
                        Ok(list)
                    })
                    .unwrap_or_default();

                // 3. Recent Working Memory
                let recent_lines: Vec<String> = self
                    .state
                    .pool
                    .with_conn(|conn| {
                        let mut stmt = conn.prepare(
                            "SELECT kind, content, summary FROM memory_nodes \
                             WHERE tier IN (0, 1) AND superseded_by IS NULL \
                             ORDER BY updated_at DESC LIMIT ?1;",
                        )?;
                        let rows = stmt.query_map([max_recent as i64], |r| {
                            let kind: String = r.get(0)?;
                            let content: String = r.get(1)?;
                            let summary: Option<String> = r.get(2)?;
                            Ok(format!("- [{}] {}", kind, summary.unwrap_or(content)))
                        })?;
                        let mut list = Vec::new();
                        for item in rows {
                            list.push(item?);
                        }
                        Ok(list)
                    })
                    .unwrap_or_default();

                // 4. Knowledge Triples
                let triples = self.state.triple_repo.query("", None, Some(now)).unwrap_or_default();
                let triple_lines: Vec<String> = triples
                    .into_iter()
                    .take(8)
                    .map(|t| format!("- ({}) --[{}]--> ({})", t.subject, t.predicate, t.object))
                    .collect();

                let mut out = String::from("🧠 **J.A.R.V.I.S. Wake-Up Memory Context**\n\n");
                if !identity_lines.is_empty() {
                    out.push_str("### 👤 Operator & Identity Facts\n");
                    out.push_str(&identity_lines.join("\n"));
                    out.push_str("\n\n");
                }
                if !decision_lines.is_empty() {
                    out.push_str("### ⚡ Active Architectural Decisions & Lessons\n");
                    out.push_str(&decision_lines.join("\n"));
                    out.push_str("\n\n");
                }
                if !recent_lines.is_empty() {
                    out.push_str("### 🕒 Recent Working Memory\n");
                    out.push_str(&recent_lines.join("\n"));
                    out.push_str("\n\n");
                }
                if !triple_lines.is_empty() {
                    out.push_str("### 🕸️ Knowledge Triples\n");
                    out.push_str(&triple_lines.join("\n"));
                    out.push_str("\n");
                }
                out
            }

            _ => format!("❌ Unknown tool: '{}'", name),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::db::DatabasePool;

    #[test]
    fn test_mcp_initialize_and_tools_list() {
        let pool = DatabasePool::in_memory().unwrap();
        let config = Config::default();
        let state = AppState::new(config, pool).unwrap();
        let server = McpServer::new(state);

        let init_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::json!(1)),
            method: "initialize".to_string(),
            params: None,
        };

        let init_resp = server.handle_request(init_req).unwrap();
        assert_eq!(init_resp.id, Some(serde_json::json!(1)));
        assert!(init_resp.result.is_some());

        let list_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::json!(2)),
            method: "tools/list".to_string(),
            params: None,
        };

        let list_resp = server.handle_request(list_req).unwrap();
        let tools = list_resp.result.unwrap();
        let arr = tools.get("tools").unwrap().as_array().unwrap();
        assert_eq!(arr.len(), 7);
    }
}
