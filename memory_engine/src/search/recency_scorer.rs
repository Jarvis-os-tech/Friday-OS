use crate::types::Tier;

pub struct RecencyScorer;

impl RecencyScorer {
    /// Compute the Ebbinghaus exponential decay score in [0.0, 1.0]
    /// based on the node updated_at timestamp, current timestamp, and Tier.
    pub fn score(updated_at: i64, now_timestamp: i64, tier: Tier) -> f32 {
        if tier == Tier::Knowledge {
            return 1.0;
        }

        let delta_seconds = (now_timestamp - updated_at).max(0);
        let delta_days = (delta_seconds as f64) / 86400.0;

        let lambda: f64 = match tier {
            Tier::Session => 0.5,      // ~1.4 days half-life
            Tier::Working => 0.05,     // ~14 days half-life
            Tier::Persistent => 0.001, // ~693 days half-life
            Tier::Knowledge => 0.0,    // Immortal
        };

        let decay = (-lambda * delta_days).exp();
        (decay as f32).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recency_scorer_tiers() {
        let now = 1750000000;
        let ten_days_ago = now - (10 * 86400);

        let s_session = RecencyScorer::score(ten_days_ago, now, Tier::Session);
        let s_working = RecencyScorer::score(ten_days_ago, now, Tier::Working);
        let s_persistent = RecencyScorer::score(ten_days_ago, now, Tier::Persistent);
        let s_knowledge = RecencyScorer::score(ten_days_ago, now, Tier::Knowledge);

        assert!(s_session < s_working);
        assert!(s_working < s_persistent);
        assert_eq!(s_knowledge, 1.0);
        assert!(s_session > 0.0);
    }
}
