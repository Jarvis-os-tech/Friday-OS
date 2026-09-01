use crate::db::DatabasePool;
use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorCandidate {
    pub node_id: String,
    pub embedding: Vec<f32>,
    pub similarity: f32,
}

pub struct VectorSearchEngine {
    pool: DatabasePool,
}

impl VectorSearchEngine {
    pub fn new(pool: DatabasePool) -> Self {
        Self { pool }
    }

    /// Compute cosine similarity between two float slices
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let mut dot = 0.0f32;
        let mut norm_a = 0.0f32;
        let mut norm_b = 0.0f32;

        for (x, y) in a.iter().zip(b.iter()) {
            dot += x * y;
            norm_a += x * x;
            norm_b += y * y;
        }

        if norm_a <= 0.0 || norm_b <= 0.0 {
            return 0.0;
        }

        (dot / (norm_a.sqrt() * norm_b.sqrt())).clamp(-1.0, 1.0)
    }

    /// Convert raw BLOB from SQLite into Vec<f32>
    pub fn blob_to_f32(blob: &[u8]) -> Vec<f32> {
        blob.chunks_exact(4)
            .map(|chunk| {
                let bytes: [u8; 4] = chunk.try_into().unwrap_or([0, 0, 0, 0]);
                f32::from_le_bytes(bytes)
            })
            .collect()
    }

    /// Load all vectors and compute raw cosine similarity with query
    pub fn search_raw(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<VectorCandidate>> {
        self.pool.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT node_id, embedding FROM memory_vectors;",
            )?;

            let mut candidates = Vec::new();
            let mut rows = stmt.query([])?;

            while let Some(row) = rows.next()? {
                let node_id: String = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                let embedding = Self::blob_to_f32(&blob);
                let similarity = Self::cosine_similarity(query_vector, &embedding);

                candidates.push(VectorCandidate {
                    node_id,
                    embedding,
                    similarity,
                });
            }

            candidates.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
            if candidates.len() > limit {
                candidates.truncate(limit);
            }

            Ok(candidates)
        })
    }

    /// Maximal Marginal Relevance (MMR) reranking to maximize diversity
    /// lambda in [0.0, 1.0]: 1.0 is pure relevance, 0.0 is pure diversity.
    pub fn mmr_rerank(
        _query_vector: &[f32],
        mut candidates: Vec<VectorCandidate>,
        top_k: usize,
        lambda: f32,
    ) -> Vec<VectorCandidate> {
        if candidates.is_empty() || top_k == 0 {
            return Vec::new();
        }

        let mut selected: Vec<VectorCandidate> = Vec::with_capacity(top_k);

        while selected.len() < top_k && !candidates.is_empty() {
            let mut best_score = -f32::INFINITY;
            let mut best_idx = 0;

            for (idx, candidate) in candidates.iter().enumerate() {
                let sim_to_query = candidate.similarity;

                // Max similarity to already selected items
                let mut max_sim_to_selected = 0.0f32;
                for s in &selected {
                    let sim = Self::cosine_similarity(&candidate.embedding, &s.embedding);
                    if sim > max_sim_to_selected {
                        max_sim_to_selected = sim;
                    }
                }

                let mmr_score = lambda * sim_to_query - (1.0 - lambda) * max_sim_to_selected;
                if mmr_score > best_score {
                    best_score = mmr_score;
                    best_idx = idx;
                }
            }

            let chosen = candidates.swap_remove(best_idx);
            selected.push(chosen);
        }

        selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![1.0, 0.0, 0.0];
        let v3 = vec![0.0, 1.0, 0.0];

        assert!((VectorSearchEngine::cosine_similarity(&v1, &v2) - 1.0).abs() < 1e-6);
        assert!((VectorSearchEngine::cosine_similarity(&v1, &v3) - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_mmr_rerank() {
        let q = vec![1.0, 0.0, 0.0];
        let c1 = VectorCandidate {
            node_id: "1".to_string(),
            embedding: vec![0.99, 0.01, 0.0],
            similarity: 0.99,
        };
        let c2 = VectorCandidate {
            node_id: "2".to_string(),
            embedding: vec![0.98, 0.02, 0.0], // highly redundant with c1
            similarity: 0.98,
        };
        let c3 = VectorCandidate {
            node_id: "3".to_string(),
            embedding: vec![0.80, 0.60, 0.0], // distinct angle
            similarity: 0.80,
        };

        // When lambda is low (e.g. 0.3), MMR strongly penalizes redundancy with c1, selecting c3 next
        let reranked = VectorSearchEngine::mmr_rerank(&q, vec![c1, c2, c3], 2, 0.3);
        assert_eq!(reranked.len(), 2);
        assert_eq!(reranked[0].node_id, "1");
        assert_eq!(reranked[1].node_id, "3");
    }
}
