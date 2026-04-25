pub mod dialect;
pub mod dto;
pub mod entity;
pub mod models;
pub mod ordering;
pub mod queries;
pub mod repo;
pub mod retry;

use crate::config::{DatabaseBackend, DatabaseConfig};
use sea_orm::{DatabaseConnection, SqlxPostgresConnector, SqlxSqliteConnector};
use sqlx::migrate::MigrateDatabase;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePool, SqlitePoolOptions,
    SqliteSynchronous,
};
use sqlx::Postgres;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

static SQLITE_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/sqlite");
// PostgreSQL migrations intentionally track the server-mode subset as it is ported.
static POSTGRES_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations/postgres");

/// Transitional runtime database handle.
///
/// Wraps both the legacy `sqlx` pool (still used by unported code in
/// `src/db/queries.rs` and across `src/api/**`) and a `sea_orm::DatabaseConnection`
/// built on top of the same underlying pool. New code should prefer
/// [`Database::conn`] and the [`repo`] module; old code continues to call
/// [`Database::sqlite_pool`] / [`Database::postgres_pool`] until it is
/// ported in Phase 4 of the SeaORM migration.
#[derive(Clone)]
pub enum Database {
    Sqlite {
        pool: SqlitePool,
        conn: DatabaseConnection,
    },
    Postgres {
        pool: PgPool,
        conn: DatabaseConnection,
    },
}

// Thin helpers on `Database` for accessing the underlying sqlx pool. New code should
// prefer the SeaORM connection via `Database::conn`.

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

fn sqlx_database_error(error: sqlx::Error) -> crate::error::Error {
    crate::error::Error::Database(error.to_string())
}

impl Database {
    pub fn backend(&self) -> DatabaseBackend {
        match self {
            Self::Sqlite { .. } => DatabaseBackend::Sqlite,
            Self::Postgres { .. } => DatabaseBackend::Postgres,
        }
    }

    pub fn is_sqlite(&self) -> bool {
        matches!(self, Self::Sqlite { .. })
    }

    pub fn is_postgres(&self) -> bool {
        matches!(self, Self::Postgres { .. })
    }

    /// SeaORM connection handle. Prefer this over [`Self::sqlite_pool`] /
    /// [`Self::postgres_pool`] for any new code.
    pub fn conn(&self) -> &DatabaseConnection {
        match self {
            Self::Sqlite { conn, .. } => conn,
            Self::Postgres { conn, .. } => conn,
        }
    }

    /// SeaORM backend discriminator, useful for dialect-aware SQL helpers.
    pub fn sea_backend(&self) -> sea_orm::DbBackend {
        match self {
            Self::Sqlite { .. } => sea_orm::DbBackend::Sqlite,
            Self::Postgres { .. } => sea_orm::DbBackend::Postgres,
        }
    }

    pub fn sqlite_pool(&self) -> crate::error::Result<&SqlitePool> {
        match self {
            Self::Sqlite { pool, .. } => Ok(pool),
            Self::Postgres { .. } => Err(sqlite_only_runtime_error()),
        }
    }

    pub fn sqlite_pool_cloned(&self) -> crate::error::Result<SqlitePool> {
        self.sqlite_pool().cloned()
    }

    pub fn postgres_pool(&self) -> crate::error::Result<&PgPool> {
        match self {
            Self::Sqlite { .. } => Err(postgres_only_runtime_error()),
            Self::Postgres { pool, .. } => Ok(pool),
        }
    }

    pub fn postgres_pool_cloned(&self) -> crate::error::Result<PgPool> {
        self.postgres_pool().cloned()
    }

    /// Construct an in-memory SQLite-backed `Database`, running the full
    /// production migrator against it. Intended for unit tests that need a
    /// schema identical to runtime without depending on a real file or
    /// PostgreSQL instance.
    #[cfg(test)]
    pub async fn new_sqlite_in_memory() -> crate::error::Result<Self> {
        let pool = SqlitePool::connect(":memory:")
            .await
            .map_err(sqlx_database_error)?;
        SQLITE_MIGRATOR
            .run(&pool)
            .await
            .map_err(|e| crate::error::Error::Migration(e.to_string()))?;
        let conn = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool.clone());
        Ok(Self::Sqlite { pool, conn })
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
        DatabaseBackend::Sqlite => {
            let pool = create_sqlite_pool(&database.path).await?;
            let conn = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool.clone());
            Ok(Database::Sqlite { pool, conn })
        }
        DatabaseBackend::Postgres => {
            let pool = create_postgres_pool(
                database
                    .url
                    .as_deref()
                    .expect("validated postgres config should always have a URL"),
            )
            .await?;
            let conn = SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
            Ok(Database::Postgres { pool, conn })
        }
    }
}

async fn create_postgres_pool(database_url: &str) -> crate::error::Result<PgPool> {
    let max_connections = get_max_connections();

    tracing::info!("PostgreSQL config: max_connections={:?}", max_connections);

    ensure_postgres_database_exists(database_url).await?;

    let mut pool_options = PgPoolOptions::new();
    if let Some(max) = max_connections {
        pool_options = pool_options.max_connections(max);
    }

    let pool = pool_options
        .connect(database_url)
        .await
        .map_err(sqlx_database_error)?;

    POSTGRES_MIGRATOR
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    Ok(pool)
}

async fn ensure_postgres_database_exists(database_url: &str) -> crate::error::Result<()> {
    if Postgres::database_exists(database_url)
        .await
        .map_err(sqlx_database_error)?
    {
        return Ok(());
    }

    tracing::info!("PostgreSQL database missing, creating it");

    if let Err(error) = Postgres::create_database(database_url).await {
        match Postgres::database_exists(database_url).await {
            Ok(true) => {
                tracing::info!("PostgreSQL database was created concurrently");
                return Ok(());
            }
            Ok(false) | Err(_) => return Err(sqlx_database_error(error)),
        }
    }

    Ok(())
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
        SqliteConnectOptions::from_str(&format!("sqlite:{}", database_path.display()))
            .map_err(sqlx_database_error)?
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

    let pool = pool_options
        .connect_with(options)
        .await
        .map_err(sqlx_database_error)?;

    SQLITE_MIGRATOR
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    // Let SQLite update query planner statistics if stale (best-effort)
    if let Err(e) = sqlx::query("PRAGMA optimize").execute(&pool).await {
        tracing::warn!("Failed to run PRAGMA optimize: {}", e);
    }

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::Database;
    use sqlx::sqlite::SqlitePool;

    #[tokio::test]
    async fn database_sqlite_pool_accessors_work() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite pool should connect");
        let conn = sea_orm::SqlxSqliteConnector::from_sqlx_sqlite_pool(pool.clone());
        let wrapped = Database::Sqlite {
            pool: pool.clone(),
            conn,
        };

        let wrapped_value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(wrapped.sqlite_pool().expect("wrapped pool should resolve"))
            .await
            .expect("wrapped pool query should succeed");
        assert_eq!(wrapped_value, 1);

        let cloned_pool = wrapped
            .sqlite_pool_cloned()
            .expect("wrapped pool should clone");
        let cloned_value: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&cloned_pool)
            .await
            .expect("cloned pool query should succeed");
        assert_eq!(cloned_value, 1);
    }
}
