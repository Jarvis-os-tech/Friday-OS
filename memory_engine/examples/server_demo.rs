use jarvis_memory_engine::config::Config;
use jarvis_memory_engine::db::DatabasePool;
use jarvis_memory_engine::server::{start_server, AppState};
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("⚡ J.A.R.V.I.S. High-Performance Memory Server (Phase 5 Demo)");
    println!("============================================================\n");

    let pool = DatabasePool::in_memory()?;
    let config = Config::default();
    let state = AppState::new(config, pool)?;

    let port = 50051;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    println!("🌐 Starting Axum REST & WebSocket Server on http://{}", addr);
    println!("📋 Available Endpoints:");
    println!("  - GET  http://127.0.0.1:{}/health", port);
    println!("  - POST http://127.0.0.1:{}/api/memory/nodes", port);
    println!("  - POST http://127.0.0.1:{}/api/memory/search", port);
    println!("  - GET  http://127.0.0.1:{}/api/memory/graph", port);
    println!("  - GET  http://127.0.0.1:{}/api/memory/buffers", port);
    println!("  - POST http://127.0.0.1:{}/api/memory/flush", port);
    println!("  - WS   ws://127.0.0.1:{}/ws/memory/stream\n", port);

    println!("💡 Testing Tips:");
    println!("  1. Health check:");
    println!("     curl -s http://127.0.0.1:{}/health | jq\n", port);
    println!("  2. Store a memory fact:");
    println!("     curl -s -X POST http://127.0.0.1:{}/api/memory/nodes \\", port);
    println!("       -H 'Content-Type: application/json' \\");
    println!("       -d '{{\"kind\":\"fact\",\"content\":\"PulseAudio direct latency is 1.2ms\",\"summary\":\"PulseAudio Latency\"}}' | jq\n");
    println!("  3. Run 4-signal hybrid search:");
    println!("     curl -s -X POST http://127.0.0.1:{}/api/memory/search \\", port);
    println!("       -H 'Content-Type: application/json' \\");
    println!("       -d '{{\"text\":\"PulseAudio latency\",\"profile\":\"balanced\"}}' | jq\n");

    start_server(state, addr).await?;
    Ok(())
}
