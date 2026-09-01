pub mod fts5_search;
pub mod graph_search;
pub mod hybrid_ranker;
pub mod profiles;
pub mod query_normalizer;
pub mod recency_scorer;
pub mod vector_search;

use crate::types::{MemoryNode, NodeKind, Tier};
use serde::{Deserialize, Serialize};

pub use fts5_search::{Fts5SearchEngine, Fts5SearchResult};
pub use graph_search::GraphSearchEngine;
pub use hybrid_ranker::HybridRanker;
pub use profiles::SearchProfile;
pub use query_normalizer::QueryNormalizer;
pub use recency_scorer::RecencyScorer;
pub use vector_search::{VectorCandidate, VectorSearchEngine};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalScores {
    pub bm25: f32,
    pub vector: f32,
    pub graph: f32,
    pub recency: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub node: MemoryNode,
    pub combined_score: f32,
    pub signals: SignalScores,
    pub snippet: Option<String>,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub text: String,
    pub vector: Option<Vec<f32>>,
    pub profile: SearchProfile,
    pub limit: usize,
    pub tier_filter: Option<Vec<Tier>>,
    pub kind_filter: Option<Vec<NodeKind>>,
    pub include_superseded: bool,
    pub root_node_ids: Option<Vec<String>>,
    pub mmr_lambda: Option<f32>,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            text: String::new(),
            vector: None,
            profile: SearchProfile::Balanced,
            limit: 10,
            tier_filter: None,
            kind_filter: None,
            include_superseded: false,
            root_node_ids: None,
            mmr_lambda: Some(0.7),
        }
    }
}
