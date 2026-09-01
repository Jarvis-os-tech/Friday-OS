use crate::types::{NodeKind, Tier};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFrontmatter {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub tier: String,
    pub importance: f64,
    pub created_at: String,
    pub updated_at: String,
    pub source: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl VaultFrontmatter {
    pub fn from_node(
        id: &str,
        kind: NodeKind,
        tier: Tier,
        importance: f64,
        created_at: i64,
        updated_at: i64,
        source: &str,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        title: &str,
        extra_tags: &[String],
        aliases: &[String],
    ) -> Self {
        let created_iso = chrono::DateTime::from_timestamp(created_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());
        let updated_iso = chrono::DateTime::from_timestamp(updated_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        let mut tags = vec![
            "jarvis".to_string(),
            "memory".to_string(),
            kind.to_string(),
            format!("tier-{}", tier.to_string().to_lowercase()),
        ];
        tags.extend_from_slice(extra_tags);

        Self {
            id: id.to_string(),
            title: title.to_string(),
            kind: kind.to_string(),
            tier: tier.to_string(),
            importance,
            created_at: created_iso,
            updated_at: updated_iso,
            source: source.to_string(),
            tags,
            aliases: aliases.to_vec(),
            agent_id: agent_id.map(String::from),
            session_id: session_id.map(String::from),
        }
    }

    pub fn to_yaml(&self) -> String {
        let mut out = String::from("---\n");
        out.push_str(&format!("id: \"{}\"\n", self.id));
        out.push_str(&format!("title: \"{}\"\n", self.title.replace('"', "\\\"")));
        out.push_str(&format!("kind: {}\n", self.kind));
        out.push_str(&format!("tier: {}\n", self.tier));
        out.push_str(&format!("importance: {:.2}\n", self.importance));
        out.push_str(&format!("created_at: \"{}\"\n", self.created_at));
        out.push_str(&format!("updated_at: \"{}\"\n", self.updated_at));
        out.push_str(&format!("source: \"{}\"\n", self.source));

        if let Some(agent) = &self.agent_id {
            out.push_str(&format!("agent_id: \"{}\"\n", agent));
        }
        if let Some(sess) = &self.session_id {
            out.push_str(&format!("session_id: \"{}\"\n", sess));
        }

        if !self.tags.is_empty() {
            out.push_str("tags:\n");
            for tag in &self.tags {
                out.push_str(&format!("  - {}\n", tag));
            }
        }

        if !self.aliases.is_empty() {
            out.push_str("aliases:\n");
            for alias in &self.aliases {
                out.push_str(&format!("  - \"{}\"\n", alias.replace('"', "\\\"")));
            }
        }

        out.push_str("---\n");
        out
    }
}
