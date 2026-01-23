//! Data migrations that run after schema migrations.
//!
//! These migrations require Rust logic that can't be expressed in SQL.

use sqlx::SqlitePool;
use std::collections::HashMap;
use tracing::info;
use uuid::Uuid;

/// Run all data migrations.
/// This should be called after schema migrations complete.
pub async fn run_data_migrations(pool: &SqlitePool) -> crate::error::Result<()> {
    migrate_virtual_folders(pool).await?;
    Ok(())
}

/// Migrate virtual folders (path-based playlist names) to proper folder entities.
///
/// This migration:
/// 1. Parses all existing playlist/smart playlist names for folder paths
/// 2. Creates folder entities for each unique path segment
/// 3. Updates playlists to reference folder entities via folder_id
/// 4. Strips folder path prefixes from playlist names
async fn migrate_virtual_folders(pool: &SqlitePool) -> crate::error::Result<()> {
    // Check if migration already completed
    let migration_complete: Option<(String,)> =
        sqlx::query_as("SELECT value FROM server_config WHERE key = 'folder_migration_complete'")
            .fetch_optional(pool)
            .await?;

    if let Some((value,)) = migration_complete {
        if value == "true" {
            info!("Folder migration already completed, skipping");
            return Ok(());
        }
    }

    info!("Starting virtual folder migration...");

    // Get all playlists with paths (containing /)
    let playlists: Vec<(String, String, i64)> = sqlx::query_as(
        r#"
        SELECT id, name, owner_id 
        FROM playlists 
        WHERE name LIKE '%/%' AND folder_id IS NULL
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .fetch_all(pool)
    .await?;

    // Get all smart playlists with paths
    let smart_playlists: Vec<(String, String, i64)> = sqlx::query_as(
        r#"
        SELECT id, name, owner_id 
        FROM smart_playlists 
        WHERE name LIKE '%/%'
        ORDER BY name COLLATE NOCASE
        "#,
    )
    .fetch_all(pool)
    .await?;

    if playlists.is_empty() && smart_playlists.is_empty() {
        info!("No playlists with folder paths found, marking migration complete");
        sqlx::query(
            "UPDATE server_config SET value = 'true' WHERE key = 'folder_migration_complete'",
        )
        .execute(pool)
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
    for (playlist_id, name, owner_id) in &playlists {
        // Skip folder placeholder playlists (name ends with /) - these should be deleted
        // Note: root-level placeholders like "nodeplayer/" have empty folder_path after parsing
        if name.ends_with('/') {
            // Delete the placeholder playlist
            sqlx::query("DELETE FROM playlists WHERE id = ?")
                .bind(playlist_id)
                .execute(pool)
                .await?;
            info!("Deleted folder placeholder playlist: {}", name);
            continue;
        }

        let (folder_path, display_name) = parse_playlist_path(name);

        if folder_path.is_empty() {
            continue;
        }

        // Create folder hierarchy if needed
        let folder_id =
            ensure_folder_hierarchy(pool, &mut folder_map, *owner_id, &folder_path).await?;

        // Update playlist: set folder_id and strip path from name
        sqlx::query("UPDATE playlists SET folder_id = ?, name = ? WHERE id = ?")
            .bind(&folder_id)
            .bind(&display_name)
            .bind(playlist_id)
            .execute(pool)
            .await?;

        info!(
            "Migrated playlist '{}' -> folder '{}', name '{}'",
            name, folder_path, display_name
        );
    }

    // Process smart playlists
    for (playlist_id, name, owner_id) in &smart_playlists {
        let (folder_path, display_name) = parse_playlist_path(name);

        if folder_path.is_empty() {
            continue;
        }

        // Create folder hierarchy if needed
        let folder_id =
            ensure_folder_hierarchy(pool, &mut folder_map, *owner_id, &folder_path).await?;

        // Update smart playlist: set folder_id and strip path from name
        sqlx::query("UPDATE smart_playlists SET folder_id = ?, name = ? WHERE id = ?")
            .bind(&folder_id)
            .bind(&display_name)
            .bind(playlist_id)
            .execute(pool)
            .await?;

        info!(
            "Migrated smart playlist '{}' -> folder '{}', name '{}'",
            name, folder_path, display_name
        );
    }

    // Mark migration complete
    sqlx::query("UPDATE server_config SET value = 'true' WHERE key = 'folder_migration_complete'")
        .execute(pool)
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
    pool: &SqlitePool,
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
        let existing: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT id FROM playlist_folders 
            WHERE owner_id = ? AND name = ? AND 
                  (parent_id IS NULL AND ? IS NULL OR parent_id = ?)
            "#,
        )
        .bind(owner_id)
        .bind(segment)
        .bind(&parent_id)
        .bind(&parent_id)
        .fetch_optional(pool)
        .await?;

        let folder_id = if let Some((id,)) = existing {
            id
        } else {
            // Create new folder
            let new_id = format!("pf-{}", Uuid::new_v4());
            let position = i as i32;

            sqlx::query(
                r#"
                INSERT INTO playlist_folders (id, name, parent_id, owner_id, position)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(&new_id)
            .bind(segment)
            .bind(&parent_id)
            .bind(owner_id)
            .bind(position)
            .execute(pool)
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
