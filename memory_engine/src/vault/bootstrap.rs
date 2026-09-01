use crate::error::Result;
use std::fs;
use std::path::Path;

pub fn bootstrap_obsidian_vault(vault_dir: &Path) -> Result<()> {
    let obsidian_dir = vault_dir.join(".obsidian");
    fs::create_dir_all(&obsidian_dir)?;

    // Ensure 5 canonical category subdirectories exist
    let subdirs = [
        "conversations",
        "facts",
        "knowledge",
        "execution",
        "summaries",
    ];
    for sub in &subdirs {
        fs::create_dir_all(vault_dir.join(sub))?;
    }

    // 1. .obsidian/app.json
    let app_json_path = obsidian_dir.join("app.json");
    if !app_json_path.exists() {
        let app_json = r#"{
  "legacyEditor": false,
  "livePreview": true,
  "showLineNumber": true,
  "useTab": false,
  "tabSize": 2,
  "autoConvertHtml": true,
  "attachmentFolderPath": "attachments",
  "trashOption": "system"
}"#;
        fs::write(app_json_path, app_json)?;
    }

    // 2. .obsidian/graph.json (Color-coded node groups for Obsidian WebGL graph)
    let graph_json_path = obsidian_dir.join("graph.json");
    if !graph_json_path.exists() {
        let graph_json = r#"{
  "collapse-filter": false,
  "search": "",
  "showTags": true,
  "showAttachments": false,
  "hideUnresolved": false,
  "showOrphans": true,
  "colorGroups": [
    {
      "query": "path:conversations",
      "color": {"a":1,"rgb":3847423}
    },
    {
      "query": "path:facts",
      "color": {"a":1,"rgb":16753920}
    },
    {
      "query": "path:knowledge",
      "color": {"a":1,"rgb":4962650}
    },
    {
      "query": "path:execution",
      "color": {"a":1,"rgb":11756543}
    },
    {
      "query": "path:summaries",
      "color": {"a":1,"rgb":15658734}
    }
  ],
  "linkStrength": 1,
  "linkDistance": 250,
  "nodeSize": 1.2,
  "lineSize": 1,
  "repulsion": 300
}"#;
        fs::write(graph_json_path, graph_json)?;
    }

    // 3. Vault INDEX.md (Map of Content)
    let index_path = vault_dir.join("INDEX.md");
    if !index_path.exists() {
        let index_content = r#"---
title: "JARVIS Universal Memory Vault"
type: "map-of-content"
updated_at: "2026-08-16T00:00:00Z"
---

# 🧠 J.A.R.V.I.S. Universal Memory Vault & Knowledge Graph

Welcome to your unified personal AI second brain. Every memory stored by J.A.R.V.I.S. is dual-persisted across SQLite WAL and this Obsidian Markdown vault in real-time.

---

## 📁 Memory Domains

- **[[conversations/|💬 Dialogue History]]**: Synthesized session logs and multi-agent interaction traces ([User], [JARVIS], [Hermes], [Ultron]).
- **[[facts/|👤 Facts & User Profile]]**: Ground truth preferences, user facts, hardware profiles, and core identity specs.
- **[[knowledge/|📚 Knowledge & Instructions]]**: Typed ontological concepts, system rules, instructions, and multi-agent personas.
- **[[execution/|🛠️ Tool Executions]]**: Live tool invocation telemetry, parameters, duration, and outcomes.
- **[[summaries/|📊 Hierarchical Summaries]]**: Weekly and monthly compacted memory summaries.

---

## 🔗 Graph Exploration
Open Obsidian's Graph View (`Ctrl + G` / `Cmd + G`) to explore your color-coded interactive knowledge network.
"#;
        fs::write(&index_path, index_content)?;
    }

    let lowercase_index_path = vault_dir.join("index.md");
    if !lowercase_index_path.exists() {
        if let Ok(content) = fs::read_to_string(&index_path) {
            let _ = fs::write(lowercase_index_path, content);
        }
    }

    Ok(())
}
