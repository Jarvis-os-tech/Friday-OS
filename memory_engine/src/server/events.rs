use crate::types::MemoryNode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum MemoryEvent {
    #[serde(rename = "node_created")]
    NodeCreated { node: MemoryNode },

    #[serde(rename = "node_updated")]
    NodeUpdated { node: MemoryNode },

    #[serde(rename = "node_deleted")]
    NodeDeleted { id: String },

    #[serde(rename = "cascade_sealed")]
    CascadeSealed {
        summary_node: MemoryNode,
        child_ids: Vec<String>,
    },

    #[serde(rename = "search_executed")]
    SearchExecuted {
        query: String,
        result_count: usize,
        elapsed_ms: f64,
    },

    #[serde(rename = "buffer_flushed")]
    BufferFlushed { flushed_count: usize },
}
