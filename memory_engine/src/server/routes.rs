use crate::search::{SearchProfile, SearchQuery, SearchResult};
use crate::security::SecretScanner;
use crate::server::events::MemoryEvent;
use crate::server::state::AppState;
use crate::tree::{DrillDownNode, TreeBuffer};
use crate::types::{MemoryEdge, MemoryNode, MemoryVector, NodeKind, Tier};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime_seconds: i64,
    pub node_count: usize,
    pub edge_count: usize,
    pub vault_path: String,
    pub active_buffers: usize,
}

pub async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let now = chrono::Utc::now().timestamp();
    let uptime = now - state.started_at;

    let (node_count, edge_count) = state
        .pool
        .with_conn(|conn| {
            let nc: i64 = conn.query_row("SELECT COUNT(*) FROM memory_nodes WHERE superseded_by IS NULL;", [], |r| r.get(0)).unwrap_or(0);
            let ec: i64 = conn.query_row("SELECT COUNT(*) FROM memory_edges;", [], |r| r.get(0)).unwrap_or(0);
            Ok((nc as usize, ec as usize))
        })
        .unwrap_or((0, 0));

    let active_buffers = state
        .tree_engine
        .list_buffers()
        .map(|b| b.len())
        .unwrap_or(0);

    Json(HealthResponse {
        status: "healthy".to_string(),
        uptime_seconds: uptime,
        node_count,
        edge_count,
        vault_path: state.config.vault_dir.display().to_string(),
        active_buffers,
    })
}

#[derive(Debug, Deserialize)]
pub struct CreateNodeRequest {
    pub id: Option<String>,
    pub kind: Option<NodeKind>,
    pub tier: Option<Tier>,
    pub content: String,
    pub summary: Option<String>,
    pub importance: Option<f64>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub source: Option<String>,
    pub metadata_json: Option<String>,
    pub vector: Option<Vec<f32>>,
    pub tree_scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NodeResponse {
    pub node: MemoryNode,
    pub sealed_parent: Option<MemoryNode>,
}

pub async fn create_node_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateNodeRequest>,
) -> Result<Json<NodeResponse>, (StatusCode, String)> {
    // 1. Secret Scanning Gate
    if SecretScanner::contains_secrets(&payload.content) {
        let findings = SecretScanner::scan(&payload.content);
        let descriptions: Vec<String> = findings.iter().map(|f| f.pattern_name.to_string()).collect();
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Pre-write secret scanner rejected payload: {}", descriptions.join(", ")),
        ));
    }

    let now = chrono::Utc::now().timestamp();
    let node_id = payload.id.unwrap_or_else(|| format!("node-{}", Uuid::new_v4()));

    let node = MemoryNode {
        id: node_id.clone(),
        kind: payload.kind.unwrap_or(NodeKind::Fact),
        tier: payload.tier.unwrap_or(Tier::Persistent),
        content: payload.content,
        summary: payload.summary,
        parent_id: None,
        tree_level: 0,
        importance: payload.importance.unwrap_or(0.7),
        superseded_by: None,
        agent_id: payload.agent_id,
        session_id: payload.session_id.clone(),
        source: payload.source.unwrap_or_else(|| "api".to_string()),
        metadata_json: payload.metadata_json,
        created_at: now,
        updated_at: now,
    };

    // 2. Insert into SQLite
    state
        .node_repo
        .insert(&node)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 3. Insert Vector if provided
    if let Some(vec_data) = payload.vector {
        let mem_vec = MemoryVector {
            node_id: node.id.clone(),
            dimensions: vec_data.len(),
            embedding: vec_data,
            model_name: "default-model".to_string(),
            created_at: now,
        };
        let _ = state.node_repo.insert_vector(&mem_vec);
    }

    // 4. Project to Obsidian Markdown Vault
    if let Some(ref vw) = state.vault_writer {
        let _ = vw.write_node(&node, &[]);
    }

    // 5. Ingest into Hierarchical Tree Buffer
    let tree_scope = payload
        .tree_scope
        .or(payload.session_id)
        .unwrap_or_else(|| "global".to_string());

    let sealed_parent = state
        .tree_engine
        .ingest_node(&node, &tree_scope)
        .unwrap_or(None);

    // 6. Broadcast Event
    let _ = state.event_tx.send(MemoryEvent::NodeCreated {
        node: node.clone(),
    });

    if let Some(ref parent) = sealed_parent {
        let _ = state.event_tx.send(MemoryEvent::CascadeSealed {
            summary_node: parent.clone(),
            child_ids: vec![],
        });
    }

    Ok(Json(NodeResponse {
        node,
        sealed_parent,
    }))
}

pub async fn get_node_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<MemoryNode>, (StatusCode, String)> {
    match state.node_repo.get_by_id(&id) {
        Ok(Some(node)) => Ok(Json(node)),
        Ok(None) => Err((StatusCode::NOT_FOUND, "Node not found".to_string())),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

pub async fn delete_node_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    state
        .node_repo
        .delete(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = state.event_tx.send(MemoryEvent::NodeDeleted { id: id.clone() });

    Ok(Json(serde_json::json!({
        "status": "deleted",
        "id": id
    })))
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub text: Option<String>,
    pub vector: Option<Vec<f32>>,
    pub profile: Option<SearchProfile>,
    pub limit: Option<usize>,
    pub tier_filter: Option<Vec<Tier>>,
    pub kind_filter: Option<Vec<NodeKind>>,
    pub include_superseded: Option<bool>,
    pub root_node_ids: Option<Vec<String>>,
    pub mmr_lambda: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub total: usize,
    pub elapsed_ms: f64,
}

pub async fn search_handler(
    State(state): State<AppState>,
    Json(payload): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, (StatusCode, String)> {
    let start = Instant::now();

    let query = SearchQuery {
        text: payload.text.unwrap_or_default(),
        vector: payload.vector,
        profile: payload.profile.unwrap_or(SearchProfile::Balanced),
        limit: payload.limit.unwrap_or(10),
        tier_filter: payload.tier_filter,
        kind_filter: payload.kind_filter,
        include_superseded: payload.include_superseded.unwrap_or(false),
        root_node_ids: payload.root_node_ids,
        mmr_lambda: payload.mmr_lambda,
    };

    let results = state
        .ranker
        .search(&query)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    let total = results.len();

    let _ = state.event_tx.send(MemoryEvent::SearchExecuted {
        query: query.text,
        result_count: total,
        elapsed_ms: elapsed,
    });

    Ok(Json(SearchResponse {
        results,
        total,
        elapsed_ms: elapsed,
    }))
}

pub async fn get_tree_drilldown_handler(
    State(state): State<AppState>,
    Path(root_id): Path<String>,
) -> Result<Json<Option<DrillDownNode>>, (StatusCode, String)> {
    state
        .tree_engine
        .drill_down(&root_id, 3)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct FlushRequest {
    pub stale_seconds: Option<i64>,
}

pub async fn flush_handler(
    State(state): State<AppState>,
    Json(payload): Json<FlushRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let stale_sec = payload.stale_seconds.unwrap_or(1800);
    let flushed = state
        .tree_engine
        .flush_stale_buffers(stale_sec)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = state.event_tx.send(MemoryEvent::BufferFlushed {
        flushed_count: flushed.len(),
    });

    Ok(Json(serde_json::json!({
        "status": "flushed",
        "flushed_count": flushed.len(),
        "sealed_summaries": flushed
    })))
}

#[derive(Debug, Deserialize)]
pub struct GraphQuery {
    pub max_nodes: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct GraphResponse {
    pub nodes: Vec<MemoryNode>,
    pub edges: Vec<MemoryEdge>,
}

pub async fn get_graph_handler(
    State(state): State<AppState>,
    Query(query): Query<GraphQuery>,
) -> Result<Json<GraphResponse>, (StatusCode, String)> {
    let limit = query.max_nodes.unwrap_or(300);
    let nodes = state
        .node_repo
        .list_active(limit)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let edges = state
        .pool
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, source_id, target_id, kind, weight, metadata_json, created_at \
                 FROM memory_edges LIMIT 1000;",
            )?;
            let rows = stmt.query_map([], |row| {
                let kind_str: String = row.get(3)?;
                let kind = std::str::FromStr::from_str(&kind_str).unwrap_or(crate::types::EdgeKind::RelatedTo);
                Ok(MemoryEdge {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    target_id: row.get(2)?,
                    kind,
                    weight: row.get(4)?,
                    metadata_json: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?;
            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(GraphResponse { nodes, edges }))
}

pub async fn list_buffers_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<TreeBuffer>>, (StatusCode, String)> {
    state
        .tree_engine
        .list_buffers()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.event_tx.subscribe();

    // Spawn outbound broadcast pump
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&event) {
                if sender.send(Message::Text(json_str.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle inbound pings or client requests
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}

#[derive(Debug, Deserialize)]
pub struct KgQueryRequest {
    pub subject: String,
    pub predicate: Option<String>,
    pub as_of: Option<i64>,
}

pub async fn kg_query_handler(
    State(state): State<AppState>,
    Json(payload): Json<KgQueryRequest>,
) -> Result<Json<Vec<crate::types::KnowledgeTriple>>, (StatusCode, String)> {
    state
        .triple_repo
        .query(&payload.subject, payload.predicate.as_deref(), payload.as_of)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct KgSupersedeRequest {
    pub subject: String,
    pub predicate: String,
    pub old_object: String,
    pub new_object: String,
}

pub async fn kg_supersede_handler(
    State(state): State<AppState>,
    Json(payload): Json<KgSupersedeRequest>,
) -> Result<Json<crate::types::KnowledgeTriple>, (StatusCode, String)> {
    state
        .triple_repo
        .supersede(
            &payload.subject,
            &payload.predicate,
            &payload.old_object,
            &payload.new_object,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct DiaryWriteRequest {
    pub agent_id: Option<String>,
    pub content: String,
    pub entry_type: Option<String>,
    pub tags: Option<Vec<String>>,
}

pub async fn diary_write_handler(
    State(state): State<AppState>,
    Json(payload): Json<DiaryWriteRequest>,
) -> Result<Json<crate::types::DiaryEntry>, (StatusCode, String)> {
    let now = chrono::Utc::now().timestamp();
    let entry = crate::types::DiaryEntry {
        id: format!("diary-{}", Uuid::new_v4()),
        agent_id: payload.agent_id.unwrap_or_else(|| "system".to_string()),
        session_id: None,
        entry_type: payload.entry_type.unwrap_or_else(|| "general".to_string()),
        content: payload.content,
        tags_json: payload.tags.map(|t| serde_json::to_string(&t).unwrap_or_default()),
        created_at: now,
    };
    state
        .diary_repo
        .insert(&entry)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(entry))
}

#[derive(Debug, Deserialize)]
pub struct DiaryReadQuery {
    pub agent_id: Option<String>,
    pub limit: Option<usize>,
}

pub async fn diary_read_handler(
    State(state): State<AppState>,
    Query(query): Query<DiaryReadQuery>,
) -> Result<Json<Vec<crate::types::DiaryEntry>>, (StatusCode, String)> {
    state
        .diary_repo
        .read(query.agent_id.as_deref(), query.limit.unwrap_or(50))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        .map(Json)
}

#[derive(Debug, Serialize)]
pub struct ContextSnapshotResponse {
    pub snapshot: String,
    pub node_count: usize,
    pub timestamp: i64,
}

pub async fn context_snapshot_handler(
    State(state): State<AppState>,
) -> Result<Json<ContextSnapshotResponse>, (StatusCode, String)> {
    let nodes = state
        .node_repo
        .list_active(1000)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let persistent_nodes: Vec<_> = nodes.into_iter().filter(|n| n.tier == Tier::Persistent).collect();
    let mut snapshot = String::from("## Context Snapshot\n\n");
    for n in &persistent_nodes {
        snapshot.push_str(&format!("- {}: {}\n", n.kind, n.content));
    }
    
    Ok(Json(ContextSnapshotResponse {
        snapshot,
        node_count: persistent_nodes.len(),
        timestamp: chrono::Utc::now().timestamp(),
    }))
}
