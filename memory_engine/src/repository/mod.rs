pub mod conversation_repo;
pub mod diary_repo;
pub mod edge_repo;
pub mod graph_repo;
pub mod knowledge_triple_repo;
pub mod node_repo;

pub use conversation_repo::ConversationRepository;
pub use diary_repo::DiaryRepository;
pub use edge_repo::EdgeRepository;
pub use graph_repo::GraphRepository;
pub use knowledge_triple_repo::KnowledgeTripleRepository;
pub use node_repo::NodeRepository;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabasePool;
    use crate::types::*;

    fn setup_test_db() -> DatabasePool {
        DatabasePool::in_memory().expect("Failed to initialize in-memory SQLite")
    }

    #[test]
    fn test_node_crud_and_soft_delete() {
        let pool = setup_test_db();
        let repo = NodeRepository::new(pool);

        let now = chrono::Utc::now().timestamp();
        let node = MemoryNode {
            id: "node-test-1".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "User preferred editor is Neovim".to_string(),
            summary: Some("Preferred editor: Neovim".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.9,
            superseded_by: None,
            agent_id: Some("agent-voice".to_string()),
            session_id: Some("sess-1".to_string()),
            source: "user".to_string(),
            metadata_json: Some(r#"{"category":"editor"}"#.to_string()),
            created_at: now,
            updated_at: now,
        };

        // Insert
        repo.insert(&node).expect("Failed to insert node");

        // Get by ID
        let fetched = repo.get_by_id("node-test-1").expect("Query failed").expect("Node not found");
        assert_eq!(fetched.id, "node-test-1");
        assert_eq!(fetched.kind, NodeKind::Fact);
        assert_eq!(fetched.tier, Tier::Persistent);
        assert_eq!(fetched.content, "User preferred editor is Neovim");
        assert_eq!(fetched.importance, 0.9);

        // List active
        let active = repo.list_active(10).expect("Failed to list active");
        assert_eq!(active.len(), 1);

        // List by tier
        let persistent = repo.list_by_tier(Tier::Persistent, 10).expect("Failed to list by tier");
        assert_eq!(persistent.len(), 1);

        // Insert replacement node
        let node2 = MemoryNode {
            id: "node-test-2".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "User preferred editor is Neovim with AstroNvim".to_string(),
            summary: Some("Preferred editor: AstroNvim".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.95,
            superseded_by: None,
            agent_id: Some("agent-voice".to_string()),
            session_id: Some("sess-1".to_string()),
            source: "user".to_string(),
            metadata_json: Some(r#"{"category":"editor"}"#.to_string()),
            created_at: now + 1,
            updated_at: now + 1,
        };
        repo.insert(&node2).expect("Failed to insert replacement node");

        // Soft delete
        repo.soft_delete("node-test-1", "node-test-2").expect("Failed to soft-delete");
        let active_after_delete = repo.list_active(10).expect("Failed to list active");
        assert_eq!(active_after_delete.len(), 1);
        assert_eq!(active_after_delete[0].id, "node-test-2");

        let fetched_superseded = repo.get_by_id("node-test-1").expect("Query failed").unwrap();
        assert_eq!(fetched_superseded.superseded_by, Some("node-test-2".to_string()));
    }

    #[test]
    fn test_vector_blob_storage() {
        let pool = setup_test_db();
        let node_repo = NodeRepository::new(pool.clone());

        let now = chrono::Utc::now().timestamp();
        let node = MemoryNode {
            id: "node-vec-1".to_string(),
            kind: NodeKind::Decision,
            tier: Tier::Persistent,
            content: "Architecture decision: Rust core with SQLite WAL".to_string(),
            summary: None,
            parent_id: None,
            tree_level: 0,
            importance: 0.95,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "agent".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };
        node_repo.insert(&node).expect("Failed to insert node");

        let fake_embedding: Vec<f32> = vec![0.123, -0.456, 0.789, 0.001, -0.999];
        let vector = MemoryVector {
            node_id: "node-vec-1".to_string(),
            embedding: fake_embedding.clone(),
            model_name: "gemini-embedding-2".to_string(),
            dimensions: 5,
            created_at: now,
        };

        node_repo.insert_vector(&vector).expect("Failed to insert vector");

        let retrieved = node_repo.get_vector("node-vec-1").expect("Query failed").expect("Vector missing");
        assert_eq!(retrieved.node_id, "node-vec-1");
        assert_eq!(retrieved.dimensions, 5);
        assert_eq!(retrieved.embedding.len(), 5);
        for (a, b) in retrieved.embedding.iter().zip(fake_embedding.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn test_edge_repo_and_neighbors() {
        let pool = setup_test_db();
        let node_repo = NodeRepository::new(pool.clone());
        let edge_repo = EdgeRepository::new(pool);

        let now = chrono::Utc::now().timestamp();
        let node_a = MemoryNode {
            id: "node-a".to_string(),
            kind: NodeKind::Entity,
            tier: Tier::Knowledge,
            content: "Rust Systems Programming".to_string(),
            summary: None,
            parent_id: None,
            tree_level: 0,
            importance: 0.8,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "auto".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };
        let node_b = MemoryNode {
            id: "node-b".to_string(),
            kind: NodeKind::Pattern,
            tier: Tier::Knowledge,
            content: "Memory Tree Cascade Pattern".to_string(),
            summary: None,
            parent_id: None,
            tree_level: 0,
            importance: 0.8,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "auto".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        node_repo.insert(&node_a).unwrap();
        node_repo.insert(&node_b).unwrap();

        let edge = MemoryEdge {
            id: "edge-1".to_string(),
            source_id: "node-a".to_string(),
            target_id: "node-b".to_string(),
            kind: EdgeKind::Uses,
            weight: 1.0,
            metadata_json: None,
            created_at: now,
        };

        edge_repo.insert(&edge).unwrap();

        let outgoing = edge_repo.get_outgoing("node-a").unwrap();
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].target_id, "node-b");

        let neighbors = edge_repo.get_neighbors("node-b").unwrap();
        assert_eq!(neighbors, vec!["node-a".to_string()]);
    }

    #[test]
    fn test_conversation_repo_and_turns() {
        let pool = setup_test_db();
        let conv_repo = ConversationRepository::new(pool);

        let now = chrono::Utc::now().timestamp();
        let session = Session {
            id: "sess-100".to_string(),
            agent_id: Some("jarvis-prime".to_string()),
            parent_session: None,
            total_tokens: 0,
            total_turns: 0,
            total_tool_calls: 0,
            summary: None,
            started_at: now,
            ended_at: None,
            consolidated: false,
        };

        conv_repo.create_session(&session).unwrap();

        let turn1 = ConversationTurn {
            id: "turn-1".to_string(),
            session_id: "sess-100".to_string(),
            role: "user".to_string(),
            content: "Hello Jarvis, what is our mission?".to_string(),
            tool_name: None,
            tool_call_json: None,
            turn_index: 0,
            token_count: Some(15),
            created_at: now,
        };
        let turn2 = ConversationTurn {
            id: "turn-2".to_string(),
            session_id: "sess-100".to_string(),
            role: "assistant".to_string(),
            content: "To build the ultimate autonomous assistant, sir.".to_string(),
            tool_name: None,
            tool_call_json: None,
            turn_index: 1,
            token_count: Some(20),
            created_at: now + 1,
        };

        conv_repo.append_turn(&turn1).unwrap();
        conv_repo.append_turn(&turn2).unwrap();

        let turns = conv_repo.list_turns("sess-100", 10).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[1].role, "assistant");

        let updated_sess = conv_repo.get_session("sess-100").unwrap().unwrap();
        assert_eq!(updated_sess.total_turns, 2);
        assert_eq!(updated_sess.total_tokens, 35);
    }

    #[test]
    fn test_knowledge_graph_and_subgraph_traversal() {
        let pool = setup_test_db();
        let graph_repo = GraphRepository::new(pool);

        let now = chrono::Utc::now().timestamp();
        let kn1 = KnowledgeNode {
            id: "kn-rust".to_string(),
            kind: KnowledgeKind::Technology,
            name: "Rust".to_string(),
            description: Some("Systems programming language".to_string()),
            mastery_score: 0.95,
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };
        let kn2 = KnowledgeNode {
            id: "kn-tokio".to_string(),
            kind: KnowledgeKind::Technology,
            name: "Tokio".to_string(),
            description: Some("Async runtime for Rust".to_string()),
            mastery_score: 0.90,
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };
        let kn3 = KnowledgeNode {
            id: "kn-axum".to_string(),
            kind: KnowledgeKind::Technology,
            name: "Axum".to_string(),
            description: Some("Web framework for Tokio".to_string()),
            mastery_score: 0.85,
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        graph_repo.insert_node(&kn1).unwrap();
        graph_repo.insert_node(&kn2).unwrap();
        graph_repo.insert_node(&kn3).unwrap();

        let edge1 = KnowledgeEdge {
            id: "ke-1".to_string(),
            source_id: "kn-tokio".to_string(),
            target_id: "kn-rust".to_string(),
            kind: KnowledgeEdgeKind::Uses,
            weight: 1.0,
            created_at: now,
        };
        let edge2 = KnowledgeEdge {
            id: "ke-2".to_string(),
            source_id: "kn-axum".to_string(),
            target_id: "kn-tokio".to_string(),
            kind: KnowledgeEdgeKind::DependsOn,
            weight: 1.0,
            created_at: now,
        };

        graph_repo.insert_edge(&edge1).unwrap();
        graph_repo.insert_edge(&edge2).unwrap();

        // Subgraph traversal with depth 2 from Axum should discover Tokio and Rust
        let (nodes, edges) = graph_repo.get_subgraph("kn-axum", 2).unwrap();
        assert_eq!(nodes.len(), 3);
        assert_eq!(edges.len(), 2);
    }
}
