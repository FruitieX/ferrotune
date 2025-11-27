pub mod models;
pub mod queries;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;

pub async fn create_pool(database_path: &Path) -> crate::error::Result<SqlitePool> {
    // Create parent directory if it doesn't exist
    if let Some(parent) = database_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", database_path.display()))?
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect_with(options)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await
        .map_err(|e| crate::error::Error::Migration(e.to_string()))?;

    Ok(pool)
}
