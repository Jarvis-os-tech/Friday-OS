pub mod bootstrap;
pub mod frontmatter;
pub mod writer;

pub use bootstrap::bootstrap_obsidian_vault;
pub use frontmatter::VaultFrontmatter;
pub use writer::VaultWriter;
