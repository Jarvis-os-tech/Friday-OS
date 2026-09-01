use jarvis_memory_engine::db::DatabasePool;
use jarvis_memory_engine::repository::NodeRepository;
use jarvis_memory_engine::tree::{TreeBufferRepository, TreeEngine, TreeRetrieval};
use jarvis_memory_engine::types::{MemoryNode, NodeKind, Tier};

#[test]
fn test_tree_cascade_sealing() {
    let pool = DatabasePool::in_memory().unwrap();
    let node_repo = NodeRepository::new(pool.clone());
    let engine = TreeEngine::new(pool, None);

    let now = chrono::Utc::now().timestamp();
    let scope = "session:test-seal";

    let mut generated_l1: Option<MemoryNode> = None;

    // Ingest 8 nodes into the engine
    for i in 0..8 {
        let node = MemoryNode {
            id: format!("leaf-node-{}", i),
            kind: NodeKind::Fact,
            tier: Tier::Working,
            content: format!("Leaf fact number {} about Linux kernel memory", i),
            summary: Some(format!("Leaf Fact {}", i)),
            parent_id: None,
            tree_level: 0,
            importance: 0.8,
            superseded_by: None,
            agent_id: None,
            session_id: Some(scope.to_string()),
            source: "user".to_string(),
            metadata_json: None,
            created_at: now + i,
            updated_at: now + i,
        };

        node_repo.insert(&node).unwrap();
        let seal_res = engine.ingest_node(&node, scope).unwrap();

        if i < 7 {
            assert!(seal_res.is_none(), "Should not seal before 8 items");
        } else {
            assert!(seal_res.is_some(), "Should seal on 8th item");
            generated_l1 = seal_res;
        }
    }

    let l1_node = generated_l1.expect("L1 summary must have been created");
    assert_eq!(l1_node.tree_level, 1);
    assert_eq!(l1_node.kind, NodeKind::Chunk);
    assert!(l1_node.content.contains("Leaf Fact 0"));
    assert!(l1_node.content.contains("Leaf Fact 7"));

    // Verify all 8 children now point to the L1 summary as parent_id
    for i in 0..8 {
        let child = node_repo
            .get_by_id(&format!("leaf-node-{}", i))
            .unwrap()
            .expect("Child node must exist");
        assert_eq!(child.parent_id, Some(l1_node.id.clone()));
    }

    // Verify tree drill-down
    let drill_result = engine.drill_down(&l1_node.id, 2).unwrap().expect("Drilldown found");
    assert_eq!(drill_result.node.id, l1_node.id);
    assert_eq!(drill_result.children.len(), 8);

    let outline = TreeRetrieval::format_markdown(&drill_result, 0);
    assert!(outline.contains("L1:chunk"));
    assert!(outline.contains("leaf-nod"));
}

#[test]
fn test_tree_stale_flush() {
    let pool = DatabasePool::in_memory().unwrap();
    let node_repo = NodeRepository::new(pool.clone());
    let buffer_repo = TreeBufferRepository::new(pool.clone());
    let engine = TreeEngine::new(pool, None);

    let now = chrono::Utc::now().timestamp();
    let scope = "session:test-flush";

    // Ingest 3 nodes (less than capacity of 8)
    for i in 0..3 {
        let node = MemoryNode {
            id: format!("stale-node-{}", i),
            kind: NodeKind::Decision,
            tier: Tier::Working,
            content: format!("Decision {}: Choose standard library over dependencies", i),
            summary: Some(format!("Decision {}", i)),
            parent_id: None,
            tree_level: 0,
            importance: 0.85,
            superseded_by: None,
            agent_id: None,
            session_id: Some(scope.to_string()),
            source: "user".to_string(),
            metadata_json: None,
            created_at: now + i,
            updated_at: now + i,
        };

        node_repo.insert(&node).unwrap();
        let _ = engine.ingest_node(&node, scope).unwrap();
    }

    // Manually age the buffer's last_flush_at to 3600 seconds ago
    let mut buf = buffer_repo.get_or_create_buffer(scope, "decision", 0, 8).unwrap();
    buf.last_flush_at = now - 3600;
    buffer_repo.save_buffer(&buf).unwrap();

    // Trigger stale flush with 1800s threshold
    let flushed = engine.flush_stale_buffers(1800).unwrap();
    assert_eq!(flushed.len(), 1, "Should have flushed the stale buffer");
    assert_eq!(flushed[0].tree_level, 1);
    assert!(flushed[0].content.contains("Decision 0"));
    assert!(flushed[0].content.contains("Decision 2"));
}
