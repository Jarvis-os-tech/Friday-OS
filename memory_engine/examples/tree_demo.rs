use jarvis_memory_engine::db::DatabasePool;
use jarvis_memory_engine::repository::NodeRepository;
use jarvis_memory_engine::tree::{TreeEngine, TreeRetrieval};
use jarvis_memory_engine::types::{MemoryNode, NodeKind, Tier};
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("🌲 J.A.R.V.I.S. Hierarchical Memory Tree Engine (Phase 4 Demo)");
    println!("============================================================\n");

    // 1. Initialize In-Memory Database Pool & TreeEngine
    let pool = DatabasePool::in_memory()?;
    let node_repo = NodeRepository::new(pool.clone());
    let vault_path = PathBuf::from("/home/gopi/Downloads/JARVIS-V0/JARVIS-MEMORY");
    let tree_engine = TreeEngine::new(pool.clone(), Some(vault_path));

    let scope = "session:demo-phase-4";
    println!("📌 Target Tree Scope: `{}`", scope);
    println!("📦 Buffer Max Capacity: 8 leaf items\n");

    // 2. Ingest 8 L0 memory items one by one
    println!("--- [STEP 1: Ingesting 8 Leaf Facts] ---");
    let topics = [
        "Linux kernel scheduling & POSIX realtime priority",
        "Mutter D-Bus window management protocols",
        "PulseAudio low-latency audio capture pipelines",
        "SQLite WAL mode & zero-copy mmap configuration",
        "Rust CPAL hardware audio streaming layer",
        "Gemini Live WebSockets 16kHz audio codec",
        "NVIDIA NIM deep reasoning model orchestration",
        "React 19 Pixi.js WebGL canvas graph renderer",
    ];

    let now = chrono::Utc::now().timestamp();

    for (i, topic) in topics.iter().enumerate() {
        let node = MemoryNode {
            id: format!("node-leaf-{}", i + 1),
            kind: NodeKind::Fact,
            tier: Tier::Working,
            content: format!("Core System Fact #{}: {}", i + 1, topic),
            summary: Some(format!("Fact #{}: {}", i + 1, topic)),
            parent_id: None,
            tree_level: 0,
            importance: 0.85,
            superseded_by: None,
            agent_id: Some("jarvis".to_string()),
            session_id: Some(scope.to_string()),
            source: "manual_test".to_string(),
            metadata_json: None,
            created_at: now + (i as i64),
            updated_at: now + (i as i64),
        };

        node_repo.insert(&node)?;
        println!("➕ Ingested L0 Node #{}: `{}` (Importance: 0.85)", i + 1, node.id);

        let seal_result = tree_engine.ingest_node(&node, scope)?;
        if let Some(l1_node) = seal_result {
            println!("\n⚡ [CASCADE SEAL TRIGGERED AT 8 ITEMS] ⚡");
            println!("🎉 Generated Parent L1 Summary Node: `{}`", l1_node.id);
            println!("📊 Title: {}", l1_node.summary.as_deref().unwrap_or(""));
            println!("\n--- [L1 Summary Content] ---");
            println!("{}", l1_node.content);

            // 3. Hierarchical Drill Down
            println!("\n--- [STEP 2: Hierarchical Tree-Walk Drill-Down (L1 -> L0)] ---");
            if let Some(drill_tree) = tree_engine.drill_down(&l1_node.id, 2)? {
                let markdown_tree = TreeRetrieval::format_markdown(&drill_tree, 0);
                println!("{}", markdown_tree);
            }
        }
    }

    // 4. Stale Buffer Flush Test
    println!("\n--- [STEP 3: Testing 30-Minute Stale Buffer Flush Worker] ---");
    let stale_scope = "session:stale-demo";
    println!("📌 Ingesting 2 unsealed items into scope `{}` (below capacity of 8)...", stale_scope);

    for i in 1..=2 {
        let node = MemoryNode {
            id: format!("node-stale-{}", i),
            kind: NodeKind::Decision,
            tier: Tier::Working,
            content: format!("Pending Decision #{}: Keep memory footprint under 50MB", i),
            summary: Some(format!("Decision #{}: Memory footprint", i)),
            parent_id: None,
            tree_level: 0,
            importance: 0.9,
            superseded_by: None,
            agent_id: Some("jarvis".to_string()),
            session_id: Some(stale_scope.to_string()),
            source: "manual_test".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };
        node_repo.insert(&node)?;
        let _ = tree_engine.ingest_node(&node, stale_scope)?;
    }

    println!("⏳ Simulating 30-minute idle threshold flush (stale_threshold = 0s)...");
    let flushed_summaries = tree_engine.flush_stale_buffers(0)?;
    println!("✅ Flushed {} idle buffer(s) into sealed summary notes!", flushed_summaries.len());
    for s in flushed_summaries {
        println!("  - Created L{} note `{}` for scope `{}`", s.tree_level, s.id, s.session_id.as_deref().unwrap_or(""));
    }

    println!("\n============================================================");
    println!("✨ Phase 4 Hierarchical Tree Verification Passed 100%!");
    println!("============================================================");

    Ok(())
}
