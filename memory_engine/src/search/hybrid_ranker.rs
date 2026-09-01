use crate::db::DatabasePool;
use crate::error::Result;
use crate::repository::NodeRepository;
use crate::search::fts5_search::Fts5SearchEngine;
use crate::search::graph_search::GraphSearchEngine;
use crate::search::query_normalizer::QueryNormalizer;
use crate::search::recency_scorer::RecencyScorer;
use crate::search::vector_search::{VectorCandidate, VectorSearchEngine};
use crate::search::{SearchQuery, SearchResult, SignalScores};
use crate::types::MemoryNode;
use std::collections::HashMap;

pub struct HybridRanker {
    node_repo: NodeRepository,
    fts_engine: Fts5SearchEngine,
    vector_engine: VectorSearchEngine,
    graph_engine: GraphSearchEngine,
}

impl HybridRanker {
    pub fn new(pool: DatabasePool) -> Self {
        Self {
            node_repo: NodeRepository::new(pool.clone()),
            fts_engine: Fts5SearchEngine::new(pool.clone()),
            vector_engine: VectorSearchEngine::new(pool.clone()),
            graph_engine: GraphSearchEngine::new(pool),
        }
    }

    /// Execute the unified 4-signal hybrid search pipeline
    pub fn search(&self, query: &SearchQuery) -> Result<Vec<SearchResult>> {
        let now_timestamp = chrono::Utc::now().timestamp();
        let (w_vector, w_keyword, w_graph, w_recency) = query.profile.weights();

        let mut node_cache: HashMap<String, MemoryNode> = HashMap::new();
        let mut bm25_scores: HashMap<String, f32> = HashMap::new();
        let mut snippets: HashMap<String, String> = HashMap::new();
        let mut vector_scores: HashMap<String, f32> = HashMap::new();
        let mut vector_candidates_map: HashMap<String, VectorCandidate> = HashMap::new();

        // 1. Lexical Signal: Pre-process with QueryNormalizer & FTS5 BM25
        let normalized_text = QueryNormalizer::normalize(&query.text);
        let search_text = if !normalized_text.is_empty() {
            &normalized_text
        } else {
            query.text.trim()
        };

        if !search_text.is_empty() {
            let fts_limit = (query.limit * 3).max(20);
            let fts_results = self
                .fts_engine
                .search(search_text, fts_limit, query.include_superseded)?;

            for res in fts_results {
                let id = res.node.id.clone();
                bm25_scores.insert(id.clone(), res.bm25_score);
                if let Some(snip) = res.snippet {
                    snippets.insert(id.clone(), snip);
                }
                node_cache.insert(id, res.node);
            }
        }

        // 2. Vector Signal: Float32 Cosine Similarity
        if let Some(ref q_vec) = query.vector {
            let vec_limit = (query.limit * 3).max(20);
            let vec_results = self.vector_engine.search_raw(q_vec, vec_limit)?;

            for cand in vec_results {
                let id = cand.node_id.clone();
                // Normalize cosine [-1.0, 1.0] -> [0.0, 1.0]
                let norm_sim = ((cand.similarity + 1.0) / 2.0).clamp(0.0, 1.0);
                vector_scores.insert(id.clone(), norm_sim);
                vector_candidates_map.insert(id, cand);
            }
        }

        // 3. Graph Signal: BFS Neighborhood Expansion
        let mut seed_ids: Vec<String> = Vec::new();
        if let Some(ref roots) = query.root_node_ids {
            seed_ids.extend(roots.clone());
        }

        // Add top 3 BM25 and Vector candidates as seed nodes if no explicit roots
        if seed_ids.is_empty() {
            let mut top_fts: Vec<_> = bm25_scores.iter().collect();
            top_fts.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
            for (id, _) in top_fts.iter().take(3) {
                seed_ids.push((*id).clone());
            }

            let mut top_vec: Vec<_> = vector_scores.iter().collect();
            top_vec.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
            for (id, _) in top_vec.iter().take(3) {
                if !seed_ids.contains(id) {
                    seed_ids.push((*id).clone());
                }
            }
        }

        let graph_scores = self
            .graph_engine
            .expand_neighborhood(&seed_ids, 2)?;

        // 4. Candidate Pool Aggregation & Lazy Node Loading
        let mut candidate_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        candidate_ids.extend(bm25_scores.keys().cloned());
        candidate_ids.extend(vector_scores.keys().cloned());
        candidate_ids.extend(graph_scores.keys().cloned());

        // If no signals yielded candidates and query is blank, fetch active nodes
        if candidate_ids.is_empty() && query.text.trim().is_empty() && query.vector.is_none() {
            let active = self.node_repo.list_active(query.limit)?;
            for node in active {
                candidate_ids.insert(node.id.clone());
                node_cache.insert(node.id.clone(), node);
            }
        }

        // Load missing nodes into node_cache
        for id in &candidate_ids {
            if !node_cache.contains_key(id) {
                if let Ok(Some(node)) = self.node_repo.get_by_id(id) {
                    node_cache.insert(id.clone(), node);
                }
            }
        }

        // 5. 4-Signal Fusion Scoring and Filtering
        let mut scored_results: Vec<SearchResult> = Vec::new();

        for (id, node) in node_cache {
            // Apply Filters
            if !query.include_superseded && node.superseded_by.is_some() {
                continue;
            }
            if let Some(ref tiers) = query.tier_filter {
                if !tiers.contains(&node.tier) {
                    continue;
                }
            }
            if let Some(ref kinds) = query.kind_filter {
                if !kinds.contains(&node.kind) {
                    continue;
                }
            }

            let s_bm25 = *bm25_scores.get(&id).unwrap_or(&0.0);
            let s_vector = *vector_scores.get(&id).unwrap_or(&0.0);
            let s_graph = *graph_scores.get(&id).unwrap_or(&0.0);
            let s_recency = RecencyScorer::score(node.updated_at, now_timestamp, node.tier);

            let combined_score = (w_vector * s_vector)
                + (w_keyword * s_bm25)
                + (w_graph * s_graph)
                + (w_recency * s_recency);

            let explanation = format!(
                "Vector: {:.2} (w={:.2}) | BM25: {:.2} (w={:.2}) | Graph: {:.2} (w={:.2}) | Recency: {:.2} (w={:.2})",
                s_vector, w_vector, s_bm25, w_keyword, s_graph, w_graph, s_recency, w_recency
            );

            scored_results.push(SearchResult {
                node,
                combined_score,
                signals: SignalScores {
                    bm25: s_bm25,
                    vector: s_vector,
                    graph: s_graph,
                    recency: s_recency,
                },
                snippet: snippets.get(&id).cloned(),
                explanation,
            });
        }

        // Sort by combined score descending
        scored_results.sort_by(|a, b| {
            b.combined_score
                .partial_cmp(&a.combined_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // 6. Optional MMR Diversity Reranking
        if let (Some(q_vec), Some(lambda)) = (&query.vector, query.mmr_lambda) {
            if !vector_candidates_map.is_empty() && scored_results.len() > 1 {
                let candidates: Vec<VectorCandidate> = scored_results
                    .iter()
                    .filter_map(|r| vector_candidates_map.get(&r.node.id).cloned())
                    .collect();

                let reranked = VectorSearchEngine::mmr_rerank(
                    q_vec,
                    candidates,
                    query.limit,
                    lambda,
                );

                let id_to_rank: HashMap<String, usize> = reranked
                    .into_iter()
                    .enumerate()
                    .map(|(rank, cand)| (cand.node_id, rank))
                    .collect();

                scored_results.sort_by_key(|r| {
                    id_to_rank.get(&r.node.id).copied().unwrap_or(usize::MAX)
                });
            }
        }

        if scored_results.len() > query.limit {
            scored_results.truncate(query.limit);
        }

        Ok(scored_results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EdgeKind, MemoryEdge, MemoryNode, MemoryVector, NodeKind, Tier};
    use crate::repository::{EdgeRepository, NodeRepository};

    #[test]
    fn test_hybrid_ranker_4_signals() {
        let pool = DatabasePool::in_memory().unwrap();
        let node_repo = NodeRepository::new(pool.clone());
        let edge_repo = EdgeRepository::new(pool.clone());
        let ranker = HybridRanker::new(pool);

        let now = chrono::Utc::now().timestamp();

        // Node 1: Matches BM25 + Vector
        let n1 = MemoryNode {
            id: "node-1".to_string(),
            kind: NodeKind::Fact,
            tier: Tier::Persistent,
            content: "Rust provides memory safety without garbage collection".to_string(),
            summary: Some("Rust Safety".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.9,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "user".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        // Node 2: Connected via Graph
        let n2 = MemoryNode {
            id: "node-2".to_string(),
            kind: NodeKind::Pattern,
            tier: Tier::Persistent,
            content: "Zero cost abstractions in modern systems programming".to_string(),
            summary: Some("Zero Cost".to_string()),
            parent_id: None,
            tree_level: 0,
            importance: 0.8,
            superseded_by: None,
            agent_id: None,
            session_id: None,
            source: "user".to_string(),
            metadata_json: None,
            created_at: now,
            updated_at: now,
        };

        node_repo.insert(&n1).unwrap();
        node_repo.insert(&n2).unwrap();

        // Vector for node-1: [1.0, 0.0, 0.0]
        let v1 = MemoryVector {
            node_id: "node-1".to_string(),
            embedding: vec![1.0, 0.0, 0.0],
            model_name: "test-model".to_string(),
            dimensions: 3,
            created_at: now,
        };
        node_repo.insert_vector(&v1).unwrap();

        // Edge between node-1 and node-2
        let edge = MemoryEdge {
            id: "edge-1-2".to_string(),
            source_id: "node-1".to_string(),
            target_id: "node-2".to_string(),
            kind: EdgeKind::RelatedTo,
            weight: 1.0,
            metadata_json: None,
            created_at: now,
        };
        edge_repo.insert(&edge).unwrap();

        // Search with text "memory safety" and vector [1.0, 0.0, 0.0]
        let q = SearchQuery {
            text: "memory safety".to_string(),
            vector: Some(vec![1.0, 0.0, 0.0]),
            profile: crate::search::SearchProfile::Balanced,
            limit: 5,
            tier_filter: None,
            kind_filter: None,
            include_superseded: false,
            root_node_ids: None,
            mmr_lambda: Some(0.7),
        };

        let results = ranker.search(&q).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].node.id, "node-1");
        assert!(results[0].signals.bm25 > 0.0);
        assert!(results[0].signals.vector > 0.9);
        assert!(results[0].signals.recency > 0.9);

        // Node 2 should be in results due to graph expansion
        let n2_res = results.iter().find(|r| r.node.id == "node-2");
        assert!(n2_res.is_some());
        assert!(n2_res.unwrap().signals.graph > 0.0);
    }
}
