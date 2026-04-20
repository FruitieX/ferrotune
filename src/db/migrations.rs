//! Data migrations that run after schema migrations.
//!
//! These migrations require Rust logic that can't be expressed in SQL.

use sea_orm::{DatabaseConnection, FromQueryResult, Value};
use std::collections::HashMap;
use tracing::info;
use uuid::Uuid;

#[derive(FromQueryResult)]
struct OwnedPlaylistRow {
    id: String,
    name: String,
    owner_id: i64,
}

async fn sqlite_query_all<T: FromQueryResult>(
    db: &DatabaseConnection,
    sql: &str,
    values: impl IntoIterator<Item = Value>,
) -> crate::error::Result<Vec<T>> {
    crate::db::raw::query_all(db, sql, sql, values)
        .await
        .map_err(Into::into)
}

async fn sqlite_query_scalar<T>(
    db: &DatabaseConnection,
    sql: &str,
    values: impl IntoIterator<Item = Value>,
) -> crate::error::Result<Option<T>>
where
    T: sea_orm::TryGetable,
{
    crate::db::raw::query_scalar(db, sql, sql, values)
        .await
        .map_err(Into::into)
}

async fn sqlite_execute(
    db: &DatabaseConnection,
    sql: &str,
    values: impl IntoIterator<Item = Value>,
) -> crate::error::Result<()> {
    crate::db::raw::execute(db, sql, sql, values)
        .await
        .map(|_| ())
        .map_err(Into::into)
}

/// Run all data migrations.
/// This should be called after schema migrations complete.
pub async fn run_data_migrations(db: &DatabaseConnection) -> crate::error::Result<()> {
    migrate_virtual_folders(db).await
}

/// Migrate virtual folders (path-based playlist names) to proper folder entities.
///
/// This migration:
/// 1. Parses all existing playlist/smart playlist names for folder paths
/// 2. Creates folder entities for each unique path segment
/// 3. Updates playlists to reference folder entities via folder_id
/// 4. Strips folder path prefixes from playlist names
async fn migrate_virtual_folders(db: &DatabaseConnection) -> crate::error::Result<()> {
    // Check if migration already completed
    let migration_complete = sqlite_query_scalar::<String>(
        db,
        "SELECT value FROM server_config WHERE key = 'folder_migration_complete'",
        [],
    )
    .await?;

    if let Some(value) = migration_complete {
        if value == "true" {
            info!("Folder migration already completed, skipping");
            return Ok(());
        }
    }

    info!("Starting virtual folder migration...");

    // Get all playlists with paths (containing /)
    let playlists = sqlite_query_all::<OwnedPlaylistRow>(
        db,
        r#"
        SELECT id, name, owner_id 
        FROM playlists 
        WHERE name LIKE '%/%' AND folder_id IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
        [],
    )
    .await?;

    // Get all smart playlists with paths
    let smart_playlists = sqlite_query_all::<OwnedPlaylistRow>(
        db,
        r#"
        SELECT id, name, owner_id 
        FROM smart_playlists 
        WHERE name LIKE '%/%'
        ORDER BY name COLLATE NOCASE
        "#,
        [],
    )
    .await?;

    if playlists.is_empty() && smart_playlists.is_empty() {
        info!("No playlists with folder paths found, marking migration complete");
        sqlite_execute(
            db,
            "UPDATE server_config SET value = 'true' WHERE key = 'folder_migration_complete'",
            [],
        )
        .await?;
        return Ok(());
    }

    info!(
        "Found {} playlists and {} smart playlists with folder paths",
        playlists.len(),
        smart_playlists.len()
    );

    // Map: (owner_id, folder_path) -> folder_id
    let mut folder_map: HashMap<(i64, String), String> = HashMap::new();

    // Process playlists
    for playlist in &playlists {
        // Skip folder placeholder playlists (name ends with /) - these should be deleted
        // Note: root-level placeholders like "nodeplayer/" have empty folder_path after parsing
        if playlist.name.ends_with('/') {
            // Delete the placeholder playlist
            sqlite_execute(
                db,
                "DELETE FROM playlists WHERE id = ?",
                [Value::from(playlist.id.clone())],
            )
            .await?;
            info!("Deleted folder placeholder playlist: {}", playlist.name);
            continue;
        }

        let (folder_path, display_name) = parse_playlist_path(&playlist.name);

        if folder_path.is_empty() {
            continue;
        }

        // Create folder hierarchy if needed
        let folder_id =
            ensure_folder_hierarchy(db, &mut folder_map, playlist.owner_id, &folder_path).await?;

        // Update playlist: set folder_id and strip path from name
        sqlite_execute(
            db,
            "UPDATE playlists SET folder_id = ?, name = ? WHERE id = ?",
            [
                Value::from(folder_id.clone()),
                Value::from(display_name.clone()),
                Value::from(playlist.id.clone()),
            ],
        )
        .await?;

        info!(
            "Migrated playlist '{}' -> folder '{}', name '{}'",
            playlist.name, folder_path, display_name
        );
    }

    // Process smart playlists
    for playlist in &smart_playlists {
        let (folder_path, display_name) = parse_playlist_path(&playlist.name);

        if folder_path.is_empty() {
            continue;
        }

        // Create folder hierarchy if needed
        let folder_id =
            ensure_folder_hierarchy(db, &mut folder_map, playlist.owner_id, &folder_path).await?;

        // Update smart playlist: set folder_id and strip path from name
        sqlite_execute(
            db,
            "UPDATE smart_playlists SET folder_id = ?, name = ? WHERE id = ?",
            [
                Value::from(folder_id.clone()),
                Value::from(display_name.clone()),
                Value::from(playlist.id.clone()),
            ],
        )
        .await?;

        info!(
            "Migrated smart playlist '{}' -> folder '{}', name '{}'",
            playlist.name, folder_path, display_name
        );
    }

    // Mark migration complete
    sqlite_execute(
        db,
        "UPDATE server_config SET value = 'true' WHERE key = 'folder_migration_complete'",
        [],
    )
    .await?;

    info!("Virtual folder migration completed successfully");
    Ok(())
}

/// Parse a playlist name into (folder_path, display_name).
/// e.g. "Spotify/Favorites/Best Songs" -> ("Spotify/Favorites", "Best Songs")
fn parse_playlist_path(name: &str) -> (String, String) {
    // Handle folder placeholders (name ends with /)
    let name = name.trim_end_matches('/');

    match name.rfind('/') {
        Some(pos) => {
            let folder_path = name[..pos].to_string();
            let display_name = name[pos + 1..].to_string();
            (folder_path, display_name)
        }
        None => (String::new(), name.to_string()),
    }
}

/// Ensure all folders in a path exist, creating them if needed.
/// Returns the ID of the deepest folder.
async fn ensure_folder_hierarchy(
    db: &DatabaseConnection,
    folder_map: &mut HashMap<(i64, String), String>,
    owner_id: i64,
    folder_path: &str,
) -> crate::error::Result<String> {
    let segments: Vec<&str> = folder_path.split('/').collect();
    let mut parent_id: Option<String> = None;
    let mut current_path = String::new();

    for (i, segment) in segments.iter().enumerate() {
        if i == 0 {
            current_path = segment.to_string();
        } else {
            current_path = format!("{}/{}", current_path, segment);
        }

        let key = (owner_id, current_path.clone());

        if let Some(existing_id) = folder_map.get(&key) {
            parent_id = Some(existing_id.clone());
            continue;
        }

        // Check if folder already exists in database
        let existing = sqlite_query_scalar::<String>(
            db,
            r#"
            SELECT id FROM playlist_folders 
            WHERE owner_id = ? AND name = ? AND 
                  (parent_id IS NULL AND ? IS NULL OR parent_id = ?)
            "#,
            [
                Value::from(owner_id),
                Value::from(segment.to_string()),
                Value::from(parent_id.clone()),
                Value::from(parent_id.clone()),
            ],
        )
        .await?;

        let folder_id = if let Some(id) = existing {
            id
        } else {
            // Create new folder
            let new_id = format!("pf-{}", Uuid::new_v4());
            let position = i as i32;

            sqlite_execute(
                db,
                r#"
                INSERT INTO playlist_folders (id, name, parent_id, owner_id, position)
                VALUES (?, ?, ?, ?, ?)
                "#,
                [
                    Value::from(new_id.clone()),
                    Value::from(segment.to_string()),
                    Value::from(parent_id.clone()),
                    Value::from(owner_id),
                    Value::from(position),
                ],
            )
            .await?;

            info!("Created folder: {} (parent: {:?})", segment, parent_id);
            new_id
        };

        folder_map.insert(key, folder_id.clone());
        parent_id = Some(folder_id);
    }

    parent_id.ok_or_else(|| {
        crate::error::Error::Internal("Failed to create folder hierarchy".to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_playlist_path() {
        assert_eq!(
            parse_playlist_path("Spotify/Favorites/Best Songs"),
            ("Spotify/Favorites".to_string(), "Best Songs".to_string())
        );
        assert_eq!(
            parse_playlist_path("Spotify/Liked Songs"),
            ("Spotify".to_string(), "Liked Songs".to_string())
        );
        assert_eq!(
            parse_playlist_path("My Playlist"),
            (String::new(), "My Playlist".to_string())
        );
        // Folder placeholders like "Rock/" become ("", "Rock") after trimming
        // because "Rock" has no slashes
        assert_eq!(
            parse_playlist_path("Rock/"),
            (String::new(), "Rock".to_string())
        );
        // But nested folder placeholders like "Music/Rock/" become ("Music", "Rock")
        assert_eq!(
            parse_playlist_path("Music/Rock/"),
            ("Music".to_string(), "Rock".to_string())
        );
    }
}
