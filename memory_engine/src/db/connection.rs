use crate::config::Config;
use crate::db::schema::initialize_schema;
use crate::error::{MemoryError, Result};
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::info;

#[derive(Clone)]
pub struct DatabasePool {
    conn: Arc<Mutex<Connection>>,
}

impl DatabasePool {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Self::open_connection(path.as_ref())?;
        initialize_schema(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn from_config(config: &Config) -> Result<Self> {
        config.ensure_directories().map_err(MemoryError::Io)?;
        Self::new(&config.db_path)
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::apply_pragmas(&conn)?;
        initialize_schema(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn open_connection(path: &Path) -> Result<Connection> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(MemoryError::Io)?;
        }
        let conn = Connection::open(path)?;
        Self::apply_pragmas(&conn)?;
        info!("Opened SQLite database at {}", path.display());
        Ok(conn)
    }

    fn apply_pragmas(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 15000;
            "#,
        )?;
        Ok(())
    }

    pub fn with_conn<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&Connection) -> Result<R>,
    {
        let lock = self.conn.lock().map_err(|e| {
            MemoryError::Internal(format!("Database mutex poisoned: {}", e))
        })?;
        f(&lock)
    }

    pub fn with_conn_mut<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&mut Connection) -> Result<R>,
    {
        let mut lock = self.conn.lock().map_err(|e| {
            MemoryError::Internal(format!("Database mutex poisoned: {}", e))
        })?;
        f(&mut lock)
    }
}
