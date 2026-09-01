use jarvis_memory_engine::db::DatabasePool;
use jarvis_memory_engine::repository::{EdgeRepository, NodeRepository};
use jarvis_memory_engine::search::{HybridRanker, SearchProfile, SearchQuery};
use jarvis_memory_engine::types::{EdgeKind, MemoryEdge, MemoryNode, MemoryVector, NodeKind, Tier};
use std::time::Instant;

#[test]
fn bench_hybrid_search_sub_50ms() {
    let pool = DatabasePool::in_memory().unwrap();
    let node_repo = NodeRepository::new(pool.clone());
    let edge_repo = EdgeRepository::new(pool.clone());
    let ranker = HybridRanker::new(pool);

    let now = chrono::Utc::now().timestamp();

    // Populate with 200 nodes, vectors, and graph edges
    for i in 0..200 {
        let node_id = format!("node-bench-{}", i);
        let node = MemoryNode {
            id: node_id.clone(),
            kind: match i % 5 {
                0 => NodeKind::Fact,
                1 => NodeKind::Decision,
                2 => NodeKind::Lesson,
                3 => NodeKind::Pattern,
                _ => NodeKind::Entity,
            },
            tier: Tier::from((i % 4) as i64),
            content: format!("Memory content for index {} focusing on Rust Linux POSIX kernel algorithms", i),
            summary: Some(format!("Summary of item {}", i)),
            parent_id: None,
            tree_level: 0,
            importance: 0.5 + ((i % 50) as f64 / 100.0),
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "bench".to_string(),
            metadata_json: None,
            created_at: now - (i as i64 * 3600),
            updated_at: now - (i as i64 * 3600),
        };
        node_repo.insert(&node).unwrap();

        // 64-dim dummy vector
        let vec_data: Vec<f32> = (0..64).map(|d| ((i + d) as f32).sin()).collect();
        node_repo.insert_vector(&MemoryVector {
            node_id: node_id.clone(),
            embedding: vec_data,
            model_name: "test-emb-64".to_string(),
            dimensions: 64,
            created_at: now,
        }).unwrap();

        if i > 0 && i % 3 == 0 {
            edge_repo.insert(&MemoryEdge {
                id: format!("edge-{}", i),
                source_id: format!("node-bench-{}", i - 1),
                target_id: node_id.clone(),
                kind: EdgeKind::RelatedTo,
                weight: 0.85,
                metadata_json: None,
                created_at: now,
            }).unwrap();
        }
    }

    let query_vector: Vec<f32> = (0..64).map(|d| (d as f32).sin()).collect();

    let query = SearchQuery {
        text: "Rust Linux POSIX".to_string(),
        vector: Some(query_vector),
        profile: SearchProfile::Balanced,
        limit: 10,
        tier_filter: None,
        kind_filter: None,
        include_superseded: false,
        root_node_ids: None,
        mmr_lambda: Some(0.7),
    };

    // Warm-up
    let _ = ranker.search(&query).unwrap();

    // Benchmark 20 iterations
    let start = Instant::now();
    for _ in 0..20 {
        let results = ranker.search(&query).unwrap();
        assert_eq!(results.len(), 10);
    }
    let total_elapsed = start.elapsed();
    let avg_latency = total_elapsed / 20;

    println!("⚡ 4-Signal Hybrid Search Average Latency across 200 nodes: {:?}", avg_latency);
    // Latency must be < 50ms (ordinarily < 5ms in in-memory / WAL SQLite)
    assert!(avg_latency.as_millis() < 50, "Latency exceeded 50ms requirement: {:?}", avg_latency);
}
