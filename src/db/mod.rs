pub mod models;
pub mod queries;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

pub async fn create_pool(database_path: &Path) -> crate::error::Result<SqlitePool> {
    // Create parent directory if it doesn't exist
    if let Some(parent) = database_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", database_path.display()))?
        .create_if_missing(true)
        .foreign_keys(true)
        // Set busy timeout to 30 seconds to handle concurrent writes during scanning
        // This prevents "database is locked" errors when multiple operations are happening
        .busy_timeout(Duration::from_secs(30))
        // Enable WAL mode for better concurrent read/write performance
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        // Use NORMAL synchronous mode for better performance with WAL
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect_with(options)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    Ok(pool)
}
