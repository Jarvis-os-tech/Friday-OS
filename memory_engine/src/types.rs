use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Fact,
    Conversation,
    Decision,
    Lesson,
    Pattern,
    Entity,
    Chunk,
}

impl std::fmt::Display for NodeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeKind::Fact => write!(f, "fact"),
            NodeKind::Conversation => write!(f, "conversation"),
            NodeKind::Decision => write!(f, "decision"),
            NodeKind::Lesson => write!(f, "lesson"),
            NodeKind::Pattern => write!(f, "pattern"),
            NodeKind::Entity => write!(f, "entity"),
            NodeKind::Chunk => write!(f, "chunk"),
        }
    }
}

impl std::str::FromStr for NodeKind {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "fact" => Ok(NodeKind::Fact),
            "conversation" => Ok(NodeKind::Conversation),
            "decision" => Ok(NodeKind::Decision),
            "lesson" => Ok(NodeKind::Lesson),
            "pattern" => Ok(NodeKind::Pattern),
            "entity" => Ok(NodeKind::Entity),
            "chunk" => Ok(NodeKind::Chunk),
            _ => Err(format!("Unknown NodeKind: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Session = 0,
    Working = 1,
    Persistent = 2,
    Knowledge = 3,
}

impl From<i64> for Tier {
    fn from(val: i64) -> Self {
        match val {
            0 => Tier::Session,
            1 => Tier::Working,
            2 => Tier::Persistent,
            3 => Tier::Knowledge,
            _ => Tier::Session,
        }
    }
}

impl From<Tier> for i64 {
    fn from(tier: Tier) -> Self {
        tier as i64
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Tier::Session => write!(f, "Session"),
            Tier::Working => write!(f, "Working"),
            Tier::Persistent => write!(f, "Persistent"),
            Tier::Knowledge => write!(f, "Knowledge"),
        }
    }
}

impl std::str::FromStr for Tier {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "session" | "0" => Ok(Tier::Session),
            "working" | "1" => Ok(Tier::Working),
            "persistent" | "2" => Ok(Tier::Persistent),
            "knowledge" | "3" => Ok(Tier::Knowledge),
            _ => Err(format!("Unknown Tier: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryNode {
    pub id: String,
    pub kind: NodeKind,
    pub tier: Tier,
    pub content: String,
    pub summary: Option<String>,
    pub parent_id: Option<String>,
    pub tree_level: i64,
    pub importance: f64,
    pub superseded_by: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub source: String,
    pub metadata_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryVector {
    pub node_id: String,
    pub embedding: Vec<f32>,
    pub model_name: String,
    pub dimensions: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    ParentChild,
    References,
    DerivedFrom,
    Mentions,
    RelatedTo,
    MasteryLink,
    Uses,
    Replaces,
}

impl std::fmt::Display for EdgeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EdgeKind::ParentChild => write!(f, "parent_child"),
            EdgeKind::References => write!(f, "references"),
            EdgeKind::DerivedFrom => write!(f, "derived_from"),
            EdgeKind::Mentions => write!(f, "mentions"),
            EdgeKind::RelatedTo => write!(f, "related_to"),
            EdgeKind::MasteryLink => write!(f, "mastery_link"),
            EdgeKind::Uses => write!(f, "uses"),
            EdgeKind::Replaces => write!(f, "replaces"),
        }
    }
}

impl std::str::FromStr for EdgeKind {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "parent_child" => Ok(EdgeKind::ParentChild),
            "references" => Ok(EdgeKind::References),
            "derived_from" => Ok(EdgeKind::DerivedFrom),
            "mentions" => Ok(EdgeKind::Mentions),
            "related_to" => Ok(EdgeKind::RelatedTo),
            "mastery_link" => Ok(EdgeKind::MasteryLink),
            "uses" => Ok(EdgeKind::Uses),
            "replaces" => Ok(EdgeKind::Replaces),
            _ => Err(format!("Unknown EdgeKind: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub kind: EdgeKind,
    pub weight: f64,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_call_json: Option<String>,
    pub turn_index: i64,
    pub token_count: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub agent_id: Option<String>,
    pub parent_session: Option<String>,
    pub total_tokens: i64,
    pub total_turns: i64,
    pub total_tool_calls: i64,
    pub summary: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub consolidated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeBuffer {
    pub id: String,
    pub tree_scope: String,
    pub tree_kind: String,
    pub level: i64,
    pub node_ids: Vec<String>,
    pub capacity: usize,
    pub max_capacity: usize,
    pub last_flush_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnowledgeKind {
    Pattern,
    Decision,
    Lesson,
    Technology,
    Contact,
    Project,
    Concept,
}

impl std::fmt::Display for KnowledgeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KnowledgeKind::Pattern => write!(f, "Pattern"),
            KnowledgeKind::Decision => write!(f, "Decision"),
            KnowledgeKind::Lesson => write!(f, "Lesson"),
            KnowledgeKind::Technology => write!(f, "Technology"),
            KnowledgeKind::Contact => write!(f, "Contact"),
            KnowledgeKind::Project => write!(f, "Project"),
            KnowledgeKind::Concept => write!(f, "Concept"),
        }
    }
}

impl std::str::FromStr for KnowledgeKind {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Pattern" => Ok(KnowledgeKind::Pattern),
            "Decision" => Ok(KnowledgeKind::Decision),
            "Lesson" => Ok(KnowledgeKind::Lesson),
            "Technology" => Ok(KnowledgeKind::Technology),
            "Contact" => Ok(KnowledgeKind::Contact),
            "Project" => Ok(KnowledgeKind::Project),
            "Concept" => Ok(KnowledgeKind::Concept),
            _ => Err(format!("Unknown KnowledgeKind: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    pub id: String,
    pub kind: KnowledgeKind,
    pub name: String,
    pub description: Option<String>,
    pub mastery_score: f64,
    pub metadata_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnowledgeEdgeKind {
    Uses,
    Replaces,
    Extends,
    AuthoredBy,
    AppliesTo,
    DependsOn,
    RelatedTo,
    MasteredVia,
}

impl std::fmt::Display for KnowledgeEdgeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KnowledgeEdgeKind::Uses => write!(f, "Uses"),
            KnowledgeEdgeKind::Replaces => write!(f, "Replaces"),
            KnowledgeEdgeKind::Extends => write!(f, "Extends"),
            KnowledgeEdgeKind::AuthoredBy => write!(f, "AuthoredBy"),
            KnowledgeEdgeKind::AppliesTo => write!(f, "AppliesTo"),
            KnowledgeEdgeKind::DependsOn => write!(f, "DependsOn"),
            KnowledgeEdgeKind::RelatedTo => write!(f, "RelatedTo"),
            KnowledgeEdgeKind::MasteredVia => write!(f, "MasteredVia"),
        }
    }
}

impl std::str::FromStr for KnowledgeEdgeKind {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Uses" => Ok(KnowledgeEdgeKind::Uses),
            "Replaces" => Ok(KnowledgeEdgeKind::Replaces),
            "Extends" => Ok(KnowledgeEdgeKind::Extends),
            "AuthoredBy" => Ok(KnowledgeEdgeKind::AuthoredBy),
            "AppliesTo" => Ok(KnowledgeEdgeKind::AppliesTo),
            "DependsOn" => Ok(KnowledgeEdgeKind::DependsOn),
            "RelatedTo" => Ok(KnowledgeEdgeKind::RelatedTo),
            "MasteredVia" => Ok(KnowledgeEdgeKind::MasteredVia),
            _ => Err(format!("Unknown KnowledgeEdgeKind: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub kind: KnowledgeEdgeKind,
    pub weight: f64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeTriple {
    pub id: String,
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub valid_from: i64,
    pub valid_to: Option<i64>,
    pub confidence: f64,
    pub source_node_id: Option<String>,
    pub source: String,
    pub agent_id: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiaryEntry {
    pub id: String,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub entry_type: String,
    pub content: String,
    pub tags_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMesh {
    pub id: String,
    pub event_type: String,
    pub source_agent: String,
    pub target_agent: Option<String>,
    pub payload_json: String,
    pub status: String,
    pub created_at: i64,
    pub processed_at: Option<i64>,
}
