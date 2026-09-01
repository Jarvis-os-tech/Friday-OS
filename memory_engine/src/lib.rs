pub mod config;
pub mod db;
pub mod error;
pub mod mcp;
pub mod miners;
pub mod repository;
pub mod search;
pub mod security;
pub mod server;
pub mod tree;
pub mod types;
pub mod vault;
pub mod workers;

pub use config::Config;
pub use db::DatabasePool;
pub use error::{MemoryError, Result};
pub use mcp::{JsonRpcError, JsonRpcRequest, JsonRpcResponse, McpServer};
pub use miners::{MineReport, TranscriptMiner};
pub use repository::{
    ConversationRepository, DiaryRepository, EdgeRepository, GraphRepository,
    KnowledgeTripleRepository, NodeRepository,
};
pub use search::{
    Fts5SearchEngine, GraphSearchEngine, HybridRanker, QueryNormalizer, RecencyScorer,
    SearchProfile, SearchQuery, SearchResult, SignalScores, VectorCandidate, VectorSearchEngine,
};
pub use security::{SecretFinding, SecretScanner};
pub use server::{
    create_router, start_server, wakeup_handler, AppState, MemoryEvent, WakeUpQuery, WakeUpResponse,
};
pub use tree::{
    CascadeSealer, DrillDownNode, Summarizer, SummaryPayload, TreeBuffer,
    TreeBufferRepository, TreeEngine, TreeFlusher, TreeRetrieval,
};
pub use types::*;
pub use vault::{bootstrap_obsidian_vault, VaultFrontmatter, VaultWriter};
pub use workers::archivist::Archivist;
pub use workers::decay_worker::DecayWorker;
pub use workers::git_watcher::GitWatcher;
