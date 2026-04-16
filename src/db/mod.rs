pub mod migrations;
pub mod models;
pub mod queries;
pub mod retry;

use crate::config::{DatabaseBackend, DatabaseConfig};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePool, SqlitePoolOptions,
    SqliteSynchronous,
};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

static SQLITE_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/sqlite");
static POSTGRES_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

/// Transitional runtime database handle.
///
/// The broader codebase still executes SQLite queries directly, so this wrapper lets
/// startup and shared state become backend-aware before the query layer is fully split.
#[derive(Clone)]
pub enum Database {
    Sqlite(SqlitePool),
    Postgres(PgPool),
}

/// Transitional database boundary for runtime services.
///
/// The query layer still speaks SQLite directly, but higher-level modules can depend on this
/// interface instead of owning a `SqlitePool` in their public surface area.
pub trait DatabaseHandle {
    fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool>;

    fn postgres_pool(&self) -> crate::error::Result<&PgPool> {
        Err(postgres_only_runtime_error())
    }

    fn sqlite_pool_cloned(&self) -> crate::error::Result<SqlitePool> {
        self.sqlite_pool().cloned()
    }

    fn postgres_pool_cloned(&self) -> crate::error::Result<PgPool> {
        self.postgres_pool().cloned()
    }
}

fn sqlite_only_runtime_error() -> crate::error::Error {
    crate::error::Error::Internal(
        "This runtime path still requires a SQLite-backed database while the PostgreSQL query layer is being ported"
            .to_string(),
    )
}

fn postgres_only_runtime_error() -> crate::error::Error {
    crate::error::Error::Internal(
        "This runtime path requires a PostgreSQL-backed database".to_string(),
    )
}

impl Database {
    pub fn backend(&self) -> DatabaseBackend {
        match self {
            Self::Sqlite(_) => DatabaseBackend::Sqlite,
            Self::Postgres(_) => DatabaseBackend::Postgres,
        }
    }

    pub fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool> {
        match self {
            Self::Sqlite(pool) => Ok(pool),
            Self::Postgres(_) => Err(sqlite_only_runtime_error()),
        }
    }

    pub fn sqlite_pool_cloned(&self) -> crate::error::Result<SqlitePool> {
        self.sqlite_pool().cloned()
    }

    pub fn postgres_pool(&self) -> crate::error::Result<&PgPool> {
        match self {
            Self::Sqlite(_) => Err(postgres_only_runtime_error()),
            Self::Postgres(pool) => Ok(pool),
        }
    }

    pub fn postgres_pool_cloned(&self) -> crate::error::Result<PgPool> {
        self.postgres_pool().cloned()
    }

    pub async fn legacy_sqlite_pool_for_state(&self) -> crate::error::Result<SqlitePool> {
        match self {
            Self::Sqlite(pool) => Ok(pool.clone()),
            Self::Postgres(_) => SqlitePool::connect("sqlite::memory:")
                .await
                .map_err(|error| {
                    crate::error::Error::Internal(format!(
                        "Failed to create placeholder SQLite pool for transitional app state: {}",
                        error
                    ))
                }),
        }
    }
}

impl DatabaseHandle for Database {
    fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool> {
        Database::sqlite_pool(self)
    }

    fn postgres_pool(&self) -> crate::error::Result<&PgPool> {
        Database::postgres_pool(self)
    }
}

impl DatabaseHandle for SqlitePool {
    fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool> {
        Ok(self)
    }
}

impl DatabaseHandle for PgPool {
    fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool> {
        Err(sqlite_only_runtime_error())
    }

    fn postgres_pool(&self) -> crate::error::Result<&PgPool> {
        Ok(self)
    }
}

impl std::ops::Deref for Database {
    type Target = SqlitePool;

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Sqlite(pool) => pool,
            Self::Postgres(_) => panic!(
                "attempted to dereference a PostgreSQL-backed Database as SqlitePool; use explicit backend access instead"
            ),
        }
    }
}

// Environment variable names for SQLite configuration
const ENV_MAX_CONNECTIONS: &str = "FERROTUNE_DB_MAX_CONNECTIONS";
const ENV_JOURNAL_MODE: &str = "FERROTUNE_DB_JOURNAL_MODE";
const ENV_SYNCHRONOUS: &str = "FERROTUNE_DB_SYNCHRONOUS";
const ENV_LOCKING_MODE: &str = "FERROTUNE_DB_LOCKING_MODE";
const ENV_BUSY_TIMEOUT: &str = "FERROTUNE_DB_BUSY_TIMEOUT";

/// Parse journal mode from environment variable.
/// Valid values: delete, truncate, persist, memory, wal, off
/// Returns None if not set (uses sqlx default).
fn get_journal_mode() -> Option<SqliteJournalMode> {
    match std::env::var(ENV_JOURNAL_MODE)
        .ok()?
        .to_lowercase()
        .as_str()
    {
        "delete" => Some(SqliteJournalMode::Delete),
        "truncate" => Some(SqliteJournalMode::Truncate),
        "persist" => Some(SqliteJournalMode::Persist),
        "memory" => Some(SqliteJournalMode::Memory),
        "wal" => Some(SqliteJournalMode::Wal),
        "off" => Some(SqliteJournalMode::Off),
        _ => None,
    }
}

/// Parse synchronous mode from environment variable.
/// Valid values: off, normal, full, extra
/// Returns None if not set (uses sqlx default).
fn get_synchronous_mode() -> Option<SqliteSynchronous> {
    match std::env::var(ENV_SYNCHRONOUS).ok()?.to_lowercase().as_str() {
        "off" => Some(SqliteSynchronous::Off),
        "normal" => Some(SqliteSynchronous::Normal),
        "full" => Some(SqliteSynchronous::Full),
        "extra" => Some(SqliteSynchronous::Extra),
        _ => None,
    }
}

/// Parse locking mode from environment variable.
/// Valid values: normal, exclusive
/// Returns None if not set (uses sqlx default).
fn get_locking_mode() -> Option<SqliteLockingMode> {
    match std::env::var(ENV_LOCKING_MODE)
        .ok()?
        .to_lowercase()
        .as_str()
    {
        "normal" => Some(SqliteLockingMode::Normal),
        "exclusive" => Some(SqliteLockingMode::Exclusive),
        _ => None,
    }
}

/// Get max pool connections from environment variable.
/// Returns None if not set (uses sqlx default).
fn get_max_connections() -> Option<u32> {
    std::env::var(ENV_MAX_CONNECTIONS)
        .ok()
        .and_then(|s| s.parse().ok())
}

/// Get busy timeout in seconds from environment variable.
/// Returns None if not set (uses sqlx default).
fn get_busy_timeout() -> Option<Duration> {
    std::env::var(ENV_BUSY_TIMEOUT)
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
}

pub async fn create_pool(database: &DatabaseConfig) -> crate::error::Result<Database> {
    database.validate()?;

    match database.backend {
        DatabaseBackend::Sqlite => create_sqlite_pool(&database.path)
            .await
            .map(Database::Sqlite),
        DatabaseBackend::Postgres => create_postgres_pool(
            database
                .url
                .as_deref()
                .expect("validated postgres config should always have a URL"),
        )
        .await
        .map(Database::Postgres),
    }
}

async fn create_postgres_pool(database_url: &str) -> crate::error::Result<PgPool> {
    let max_connections = get_max_connections();

    tracing::info!("PostgreSQL config: max_connections={:?}", max_connections);

    let mut pool_options = PgPoolOptions::new();
    if let Some(max) = max_connections {
        pool_options = pool_options.max_connections(max);
    }

    let pool = pool_options.connect(database_url).await?;

    POSTGRES_MIGRATOR
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    migrations::run_data_migrations(&pool).await?;

    Ok(pool)
}

async fn create_sqlite_pool(database_path: &Path) -> crate::error::Result<SqlitePool> {
    // Create parent directory if it doesn't exist
    if let Some(parent) = database_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let max_connections = get_max_connections();
    let journal_mode = get_journal_mode();
    let synchronous = get_synchronous_mode();
    let locking_mode = get_locking_mode();
    let busy_timeout = get_busy_timeout();

    tracing::info!(
        "SQLite config: max_connections={:?}, journal_mode={:?}, synchronous={:?}, locking_mode={:?}, busy_timeout={:?}",
        max_connections, journal_mode, synchronous, locking_mode, busy_timeout
    );

    let mut options =
        SqliteConnectOptions::from_str(&format!("sqlite:{}", database_path.display()))?
            .create_if_missing(true)
            .foreign_keys(true)
            // Performance PRAGMAs applied per-connection during setup
            .pragma("mmap_size", "268435456") // 256MB memory-mapped I/O
            .pragma("cache_size", "-64000") // 64MB page cache (default ~2MB)
            .pragma("temp_store", "memory");

    if let Some(timeout) = busy_timeout {
        options = options.busy_timeout(timeout);
    }
    if let Some(mode) = journal_mode {
        options = options.journal_mode(mode);
    }
    if let Some(mode) = synchronous {
        options = options.synchronous(mode);
    }
    if let Some(mode) = locking_mode {
        options = options.locking_mode(mode);
    }

    let mut pool_options = SqlitePoolOptions::new();
    if let Some(max) = max_connections {
        pool_options = pool_options.max_connections(max);
    }

    let pool = pool_options.connect_with(options).await?;

    SQLITE_MIGRATOR
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    migrations::run_data_migrations(&pool).await?;

    // Let SQLite update query planner statistics if stale (best-effort)
    if let Err(e) = sqlx::query("PRAGMA optimize").execute(&pool).await {
        tracing::warn!("Failed to run PRAGMA optimize: {}", e);
    }

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::{Database, DatabaseHandle};
    use sqlx::sqlite::SqlitePool;

    #[tokio::test]
    async fn database_handle_supports_raw_and_wrapped_sqlite_pools() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite pool should connect");
        let wrapped = Database::Sqlite(pool.clone());

        let raw_value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(DatabaseHandle::sqlite_pool(&pool).expect("raw pool should resolve"))
            .await
            .expect("raw pool query should succeed");
        assert_eq!(raw_value, 1);

        let wrapped_value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(DatabaseHandle::sqlite_pool(&wrapped).expect("wrapped pool should resolve"))
            .await
            .expect("wrapped pool query should succeed");
        assert_eq!(wrapped_value, 1);

        let cloned_pool =
            DatabaseHandle::sqlite_pool_cloned(&wrapped).expect("wrapped pool should clone");
        let cloned_value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&cloned_pool)
            .await
            .expect("cloned pool query should succeed");
        assert_eq!(cloned_value, 1);
    }
}
