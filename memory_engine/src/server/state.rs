use crate::config::Config;
use crate::db::DatabasePool;
use crate::error::Result;
use crate::repository::{
    ConversationRepository, DiaryRepository, EdgeRepository, GraphRepository, KnowledgeTripleRepository, NodeRepository,
};
use crate::search::HybridRanker;
use crate::server::events::MemoryEvent;
use crate::tree::TreeEngine;
use crate::vault::VaultWriter;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub pool: DatabasePool,
    pub node_repo: NodeRepository,
    pub edge_repo: EdgeRepository,
    pub conv_repo: ConversationRepository,
    pub graph_repo: GraphRepository,
    pub diary_repo: DiaryRepository,
    pub triple_repo: KnowledgeTripleRepository,
    pub ranker: Arc<HybridRanker>,
    pub tree_engine: Arc<TreeEngine>,
    pub vault_writer: Option<Arc<VaultWriter>>,
    pub event_tx: broadcast::Sender<MemoryEvent>,
    pub started_at: i64,
}

impl AppState {
    pub fn new(config: Config, pool: DatabasePool) -> Result<Self> {
        let node_repo = NodeRepository::new(pool.clone());
        let edge_repo = EdgeRepository::new(pool.clone());
        let conv_repo = ConversationRepository::new(pool.clone());
        let graph_repo = GraphRepository::new(pool.clone());
        let diary_repo = DiaryRepository::new(pool.clone());
        let triple_repo = KnowledgeTripleRepository::new(pool.clone());
        let ranker = Arc::new(HybridRanker::new(pool.clone()));

        let vault_writer = Some(Arc::new(VaultWriter::new(config.vault_dir.clone())));
        let tree_engine = Arc::new(TreeEngine::new(
            pool.clone(),
            Some(config.vault_dir.clone()),
        ));

        let (event_tx, _) = broadcast::channel(512);
        let started_at = chrono::Utc::now().timestamp();

        Ok(Self {
            config,
            pool,
            node_repo,
            edge_repo,
            conv_repo,
            graph_repo,
            diary_repo,
            triple_repo,
            ranker,
            tree_engine,
            vault_writer,
            event_tx,
            started_at,
        })
    }
}
