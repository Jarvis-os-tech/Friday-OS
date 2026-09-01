use crate::error::Result;
use crate::repository::{EdgeRepository, NodeRepository};
use crate::types::{EdgeKind, MemoryNode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrillDownNode {
    pub node: MemoryNode,
    pub children: Vec<DrillDownNode>,
}

pub struct TreeRetrieval {
    node_repo: NodeRepository,
    edge_repo: EdgeRepository,
}

impl TreeRetrieval {
    pub fn new(node_repo: NodeRepository, edge_repo: EdgeRepository) -> Self {
        Self {
            node_repo,
            edge_repo,
        }
    }

    /// Recursively drill down from a summary node down through its child chunks
    pub fn drill_down(&self, root_id: &str, max_depth: usize) -> Result<Option<DrillDownNode>> {
        let root = match self.node_repo.get_by_id(root_id)? {
            Some(r) => r,
            None => return Ok(None),
        };

        let result = self.drill_down_recursive(root, 0, max_depth)?;
        Ok(Some(result))
    }

    fn drill_down_recursive(
        &self,
        node: MemoryNode,
        current_depth: usize,
        max_depth: usize,
    ) -> Result<DrillDownNode> {
        let mut children = Vec::new();

        if current_depth < max_depth {
            let edges = self.edge_repo.get_outgoing(&node.id)?;
            for edge in edges {
                if edge.kind == EdgeKind::ParentChild {
                    if let Ok(Some(child_node)) = self.node_repo.get_by_id(&edge.target_id) {
                        let child_tree = self.drill_down_recursive(
                            child_node,
                            current_depth + 1,
                            max_depth,
                        )?;
                        children.push(child_tree);
                    }
                }
            }
        }

        Ok(DrillDownNode { node, children })
    }

    /// Render hierarchical drill down into an indented markdown context tree
    pub fn format_markdown(drill_tree: &DrillDownNode, indent_level: usize) -> String {
        let indent = "  ".repeat(indent_level);
        let node = &drill_tree.node;
        let title = node
            .summary
            .as_deref()
            .unwrap_or(&node.content)
            .lines()
            .next()
            .unwrap_or("Memory Node");

        let mut out = format!(
            "{}- `[L{}:{}]` **{}** (id: `{}`)\n",
            indent,
            node.tree_level,
            node.kind,
            title,
            &node.id[..node.id.len().min(8)]
        );

        for child in &drill_tree.children {
            out.push_str(&Self::format_markdown(child, indent_level + 1));
        }

        out
    }
}
