use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchProfile {
    Balanced,
    Semantic,
    Lexical,
    GraphFirst,
    Precise,
    Custom {
        vector_weight: f32,
        keyword_weight: f32,
        graph_weight: f32,
        recency_weight: f32,
    },
}

impl SearchProfile {
    pub fn weights(&self) -> (f32, f32, f32, f32) {
        match self {
            SearchProfile::Balanced => (0.35, 0.25, 0.20, 0.20),
            SearchProfile::Semantic => (0.55, 0.15, 0.15, 0.15),
            SearchProfile::Lexical => (0.15, 0.55, 0.15, 0.15),
            SearchProfile::GraphFirst => (0.15, 0.15, 0.55, 0.15),
            SearchProfile::Precise => (0.40, 0.40, 0.10, 0.10),
            SearchProfile::Custom {
                vector_weight,
                keyword_weight,
                graph_weight,
                recency_weight,
            } => {
                let sum = vector_weight + keyword_weight + graph_weight + recency_weight;
                if sum <= 0.0 {
                    (0.35, 0.25, 0.20, 0.20)
                } else {
                    (
                        vector_weight / sum,
                        keyword_weight / sum,
                        graph_weight / sum,
                        recency_weight / sum,
                    )
                }
            }
        }
    }
}

impl Default for SearchProfile {
    fn default() -> Self {
        SearchProfile::Balanced
    }
}
