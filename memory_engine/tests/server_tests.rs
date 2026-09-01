use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use jarvis_memory_engine::config::Config;
use jarvis_memory_engine::db::DatabasePool;
use jarvis_memory_engine::mcp::{JsonRpcRequest, McpServer};
use jarvis_memory_engine::server::{create_router, AppState};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn test_rest_api_health() {
    let pool = DatabasePool::in_memory().unwrap();
    let config = Config::default();
    let state = AppState::new(config, pool).unwrap();
    let app = create_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(val["status"], "healthy");
}

#[tokio::test]
async fn test_rest_api_node_ingestion_and_search() {
    let pool = DatabasePool::in_memory().unwrap();
    let config = Config::default();
    let state = AppState::new(config, pool).unwrap();
    let app = create_router(state);

    // 1. Ingest clean node
    let payload = json!({
        "kind": "fact",
        "tier": "persistent",
        "content": "Axum Web Framework provides ergonomic async routing",
        "summary": "Axum Framework",
        "importance": 0.9
    });

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/memory/nodes")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let node_res: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let node_id = node_res["node"]["id"].as_str().unwrap();

    // 2. Secret Scanner blocks credential leakage via REST
    let secret_payload = json!({
        "kind": "fact",
        "tier": "persistent",
        "content": "My secret key is sk-proj-123456789012345678901234567890",
        "summary": "Secret Key"
    });

    let secret_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/memory/nodes")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&secret_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(secret_res.status(), StatusCode::BAD_REQUEST);

    // 3. Search for the ingested node
    let search_payload = json!({
        "text": "Axum async routing",
        "profile": "balanced",
        "limit": 5
    });

    let search_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/memory/search")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&search_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(search_res.status(), StatusCode::OK);
    let s_body = search_res.into_body().collect().await.unwrap().to_bytes();
    let s_val: serde_json::Value = serde_json::from_slice(&s_body).unwrap();
    let results = s_val["results"].as_array().unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0]["node"]["id"], node_id);
}

#[tokio::test]
async fn test_mcp_tools_execution() {
    let pool = DatabasePool::in_memory().unwrap();
    let config = Config::default();
    let state = AppState::new(config, pool).unwrap();
    let mcp = McpServer::new(state);

    // 1. Remember tool call
    let remember_req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "jarvis_remember",
            "arguments": {
                "content": "Hermes multi-agent routing uses sub-100ms intent classification",
                "kind": "decision",
                "tier": "persistent",
                "summary": "Hermes Intent Routing"
            }
        })),
    };

    let rem_resp = mcp.handle_request(remember_req).unwrap();
    let rem_text = rem_resp.result.unwrap()["content"][0]["text"].as_str().unwrap().to_string();
    assert!(rem_text.contains("Successfully stored memory node"));

    // 2. Recall tool call
    let recall_req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(2)),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "jarvis_recall",
            "arguments": {
                "query": "Hermes routing intent",
                "limit": 3
            }
        })),
    };

    let rec_resp = mcp.handle_request(recall_req).unwrap();
    let rec_text = rec_resp.result.unwrap()["content"][0]["text"].as_str().unwrap().to_string();
    assert!(rec_text.contains("Hermes Intent Routing"));

    // 3. Vault Status tool call
    let status_req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(3)),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "jarvis_vault_status",
            "arguments": {}
        })),
    };

    let stat_resp = mcp.handle_request(status_req).unwrap();
    let stat_text = stat_resp.result.unwrap()["content"][0]["text"].as_str().unwrap().to_string();
    assert!(stat_text.contains("Active Memory Nodes"));
    assert!(stat_text.contains("WAL Mode"));

    // 4. Wake Up MCP tool call
    let wakeup_req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(4)),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "jarvis_wake_up",
            "arguments": {
                "max_recent": 5,
                "max_decisions": 5
            }
        })),
    };

    let wake_resp = mcp.handle_request(wakeup_req).unwrap();
    let wake_text = wake_resp.result.unwrap()["content"][0]["text"].as_str().unwrap().to_string();
    assert!(wake_text.contains("J.A.R.V.I.S. Wake-Up Memory Context"));
    assert!(wake_text.contains("Hermes Intent Routing"));
}

#[tokio::test]
async fn test_rest_api_wakeup_endpoint() {
    let pool = DatabasePool::in_memory().unwrap();
    let config = Config::default();
    let state = AppState::new(config, pool).unwrap();
    let app = create_router(state);

    // Ingest a persistent fact
    let fact_payload = json!({
        "kind": "fact",
        "tier": "persistent",
        "content": "Operator Gopi prefers direct execution with zero fluff",
        "summary": "Operator Profile",
        "importance": 1.0
    });

    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/memory/nodes")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&fact_payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    // Call /api/memory/wake-up
    let wake_res = app
        .oneshot(
            Request::builder()
                .uri("/api/memory/wake-up")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(wake_res.status(), StatusCode::OK);
    let body = wake_res.into_body().collect().await.unwrap().to_bytes();
    let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(val["formatted_prompt"].as_str().unwrap().contains("Operator Profile"));
    assert_eq!(val["total_nodes"].as_u64().unwrap(), 1);
}
