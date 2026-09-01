pub mod events;
pub mod routes;
pub mod state;
pub mod wakeup;

pub use events::MemoryEvent;
pub use routes::*;
pub use state::AppState;
pub use wakeup::*;

use axum::routing::{delete, get, post};
use axum::Router;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health_handler))
        .route("/api/memory/nodes", post(create_node_handler))
        .route("/api/memory/nodes/{id}", get(get_node_handler))
        .route("/api/memory/nodes/{id}", delete(delete_node_handler))
        .route("/api/memory/search", post(search_handler))
        .route("/api/memory/tree/drilldown/{root_id}", get(get_tree_drilldown_handler))
        .route("/api/memory/flush", post(flush_handler))
        .route("/api/memory/graph", get(get_graph_handler))
        .route("/api/memory/buffers", get(list_buffers_handler))
        .route("/ws/memory/stream", get(ws_handler))
        .route("/api/memory/kg/query", post(kg_query_handler))
        .route("/api/memory/kg/supersede", post(kg_supersede_handler))
        .route("/api/memory/diary/write", post(diary_write_handler))
        .route("/api/memory/diary/read", get(diary_read_handler))
        .route("/api/memory/context/snapshot", get(context_snapshot_handler))
        .route("/api/memory/wake-up", get(wakeup_handler))
        .route("/api/memory/wakeup", get(wakeup_handler))
        .layer(cors)
        .with_state(state)
}

pub async fn start_server(state: AppState, addr: SocketAddr) -> Result<(), Box<dyn std::error::Error>> {
    let app = create_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("🚀 J.A.R.V.I.S. Memory Server listening on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
