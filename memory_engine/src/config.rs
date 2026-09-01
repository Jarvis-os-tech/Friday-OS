use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub base_dir: PathBuf,
    pub db_path: PathBuf,
    pub vault_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub http_port: u16,
    pub max_buffer_capacity: usize,
    pub flush_interval_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/home/gopi"));
        
        // Priority 1: Explicit env var (FRIDAY_MEMORY_PATH or JARVIS_MEMORY_PATH)
        // Priority 2: Local ./friday-memory (or ./JARVIS-MEMORY) in current working directory
        // Priority 3: ~/.friday/memory or ~/.jarvis/memory
        let base_dir = if let Ok(custom) = std::env::var("FRIDAY_MEMORY_PATH").or_else(|_| std::env::var("JARVIS_MEMORY_PATH")) {
            PathBuf::from(custom)
        } else if std::path::Path::new("friday-memory").exists() {
            std::fs::canonicalize("friday-memory").unwrap_or_else(|_| PathBuf::from("friday-memory"))
        } else if std::path::Path::new("JARVIS-MEMORY").exists() {
            std::fs::canonicalize("JARVIS-MEMORY").unwrap_or_else(|_| PathBuf::from("JARVIS-MEMORY"))
        } else {
            home.join(".friday").join("memory")
        };

        let db_path = if let Ok(custom_db) = std::env::var("FRIDAY_MEMORY_DB").or_else(|_| std::env::var("JARVIS_MEMORY_DB")) {
            PathBuf::from(custom_db)
        } else {
            base_dir.join("memory.db")
        };

        let vault_dir = base_dir.clone();
        let cache_dir = base_dir.join(".cache");

        let http_port = std::env::var("FRIDAY_MEMORY_PORT")
            .or_else(|_| std::env::var("JARVIS_MEMORY_PORT"))
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(50051);

        Self {
            base_dir,
            db_path,
            vault_dir,
            cache_dir,
            http_port,
            max_buffer_capacity: 8,
            flush_interval_secs: 1800, // 30 mins
        }
    }
}

impl Config {
    pub fn with_db_path(db_path: PathBuf) -> Self {
        let base_dir = db_path.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
        let vault_dir = base_dir.join("vault");
        let cache_dir = base_dir.join("cache");

        Self {
            base_dir,
            db_path,
            vault_dir,
            cache_dir,
            http_port: 50051,
            max_buffer_capacity: 8,
            flush_interval_secs: 1800,
        }
    }

    pub fn for_testing() -> Self {
        let temp_dir = std::env::temp_dir().join(format!("jarvis_mem_test_{}", uuid::Uuid::new_v4()));
        let db_path = temp_dir.join("memory.db");
        let vault_dir = temp_dir.join("vault");
        let cache_dir = temp_dir.join("cache");

        Self {
            base_dir: temp_dir,
            db_path,
            vault_dir,
            cache_dir,
            http_port: 0,
            max_buffer_capacity: 4,
            flush_interval_secs: 60,
        }
    }

    pub fn ensure_directories(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.base_dir)?;
        std::fs::create_dir_all(&self.vault_dir)?;
        std::fs::create_dir_all(&self.cache_dir)?;
        std::fs::create_dir_all(self.vault_dir.join("facts"))?;
        std::fs::create_dir_all(self.vault_dir.join("conversations"))?;
        std::fs::create_dir_all(self.vault_dir.join("decisions"))?;
        std::fs::create_dir_all(self.vault_dir.join("lessons"))?;
        std::fs::create_dir_all(self.vault_dir.join("patterns"))?;
        std::fs::create_dir_all(self.vault_dir.join("knowledge"))?;
        std::fs::create_dir_all(self.vault_dir.join("summaries"))?;
        std::fs::create_dir_all(self.vault_dir.join(".obsidian"))?;
        Ok(())
    }
}
