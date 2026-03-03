pub mod migrations;
pub mod models;
pub mod queries;
pub mod retry;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePool, SqlitePoolOptions,
    SqliteSynchronous,
};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

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

pub async fn create_pool(database_path: &Path) -> crate::error::Result<SqlitePool> {
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

    // Run schema migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    // Run data migrations (Rust-based)
    migrations::run_data_migrations(&pool).await?;

    // Let SQLite update query planner statistics if stale (best-effort)
    if let Err(e) = sqlx::query("PRAGMA optimize").execute(&pool).await {
        tracing::warn!("Failed to run PRAGMA optimize: {}", e);
    }

    Ok(pool)
}
