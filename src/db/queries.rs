// Some query functions are defined for completeness and future use
#![allow(dead_code)]

use crate::db::models::*;
use crate::db::{raw, Database};
use sea_orm::{ConnectionTrait, TransactionTrait, Value};
use uuid::Uuid;

/// Generate `$N, $N+1, ...` placeholder list for Postgres dynamic IN-clauses.
fn postgres_placeholders(start_index: usize, count: usize) -> String {
    (0..count)
        .map(|i| format!("${}", start_index + i))
        .collect::<Vec<_>>()
        .join(", ")
}

// ============================================================================
// Song Query Constants
// ============================================================================
// These constants eliminate duplication across the many song query functions.
// All song queries filter out songs marked for deletion (recycle bin).

/// Base song query with artist and album joins (for simple lookups)
/// Filters out songs in the recycle bin (marked_for_deletion_at IS NOT NULL)
pub const SONG_BASE_QUERY: &str = r#"
    SELECT s.*, ar.name as artist_name, al.name as album_name
    FROM songs s
    INNER JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    WHERE s.marked_for_deletion_at IS NULL
"#;

/// Song query with scrobble statistics (play count, last played)
/// Filters out songs in the recycle bin (marked_for_deletion_at IS NOT NULL)
pub const SONG_BASE_QUERY_WITH_SCROBBLES: &str = r#"
    SELECT s.*, ar.name as artist_name, al.name as album_name,
           pc.play_count, pc.last_played, NULL as starred_at
    FROM songs s
    INNER JOIN artists ar ON s.artist_id = ar.id
    LEFT JOIN albums al ON s.album_id = al.id
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
    WHERE s.marked_for_deletion_at IS NULL
"#;

/// Standalone scrobble statistics JOIN clause for composing with custom queries.
/// Use this when building dynamic queries that need play count and last played info.
/// Expects the songs table to be aliased as `s`.
/// NOTE: This aggregates across ALL users. For per-user stats, use `scrobble_stats_join_for_user()`.
pub const SCROBBLE_STATS_JOIN: &str = r#"
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
"#;

/// Scrobble statistics JOIN clause scoped to a specific user.
/// Returns a SQL fragment with one `?` placeholder for the `user_id` bind parameter.
/// Expects the songs table to be aliased as `s`.
pub fn scrobble_stats_join_for_user() -> &'static str {
    r#"
    LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
               FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
"#
}

/// Standard WHERE clause for filtering out songs marked for deletion.
/// Use this in custom queries that don't use SONG_BASE_QUERY constants.
pub const SONG_NOT_DELETED_FILTER: &str = "s.marked_for_deletion_at IS NULL";

// ============================================================================
// User queries
// ============================================================================

// Artist queries
// Playlist queries

/// Get all playlists visible to a user (their own + public playlists)
pub async fn get_playlists_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<Playlist>> {
    Ok(raw::query_all::<Playlist>(
        database.conn(),
        "SELECT * FROM playlists 
         WHERE owner_id = ? OR is_public = 1
            OR id IN (SELECT playlist_id FROM playlist_shares WHERE shared_with_user_id = ?)
         ORDER BY name COLLATE NOCASE",
        "SELECT * FROM playlists 
         WHERE owner_id = $1 OR is_public
            OR id IN (SELECT playlist_id FROM playlist_shares WHERE shared_with_user_id = $2)
         ORDER BY LOWER(name)",
        [Value::from(user_id), Value::from(user_id)],
    )
    .await?)
}

/// Get a playlist by ID
pub async fn get_playlist_by_id(
    database: &Database,
    id: &str,
) -> crate::error::Result<Option<Playlist>> {
    Ok(raw::query_one::<Playlist>(
        database.conn(),
        "SELECT * FROM playlists WHERE id = ?",
        "SELECT * FROM playlists WHERE id = $1",
        [Value::from(id.to_string())],
    )
    .await?)
}

/// Get songs in a playlist, ordered by position (includes play stats for sorting)
pub async fn get_playlist_songs(
    database: &Database,
    playlist_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    Ok(raw::query_all::<Song>(
        database.conn(),
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = ?
         ORDER BY ps.position",
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL::timestamptz as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = $2
         ORDER BY ps.position",
        [Value::from(user_id), Value::from(playlist_id.to_string())],
    )
    .await?)
}

/// Get songs in a playlist with their original positions (for queue materialization)
/// Returns tuples of (position, entry_id, song) where position is the original playlist position
/// and entry_id is the stable playlist entry identifier.
/// This is needed to correctly map start_index when playlists have missing entries,
/// and to track the original playlist entry for "now playing" indicators.
pub async fn get_playlist_songs_with_positions(
    database: &Database,
    playlist_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<(i64, String, Song)>> {
    use sea_orm::FromQueryResult;

    #[derive(sea_orm::FromQueryResult)]
    struct PositionRow {
        position: i64,
        playlist_entry_id: Option<String>,
    }

    let conn = database.conn();
    let sqlite_sql = "SELECT ps.position, ps.entry_id as playlist_entry_id, s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = ? AND ps.song_id IS NOT NULL
         ORDER BY ps.position";
    let postgres_sql = "SELECT ps.position, ps.entry_id as playlist_entry_id, s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL::timestamptz as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, SUM(play_count)::BIGINT as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = $2 AND ps.song_id IS NOT NULL
         ORDER BY ps.position";

    let rows = raw::query_rows(
        conn,
        sqlite_sql,
        postgres_sql,
        [Value::from(user_id), Value::from(playlist_id.to_string())],
    )
    .await?;

    rows.into_iter()
        .map(|row| -> Result<(i64, String, Song), sea_orm::DbErr> {
            let pos = PositionRow::from_query_result(&row, "")?;
            let song = Song::from_query_result(&row, "")?;
            Ok((
                pos.position,
                pos.playlist_entry_id.unwrap_or_default(),
                song,
            ))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

/// Get unique album IDs from the first N songs in a playlist (for cover art)
pub async fn get_playlist_album_ids(
    database: &Database,
    playlist_id: &str,
    limit: i32,
) -> crate::error::Result<Vec<String>> {
    #[derive(sea_orm::FromQueryResult)]
    struct IdRow {
        album_id: String,
    }

    let rows = raw::query_all::<IdRow>(
        database.conn(),
        "SELECT DISTINCT s.album_id as album_id
         FROM songs s
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         WHERE ps.playlist_id = ? AND s.album_id IS NOT NULL
         ORDER BY ps.position
         LIMIT ?",
        "SELECT album_id
         FROM (
             SELECT s.album_id, MIN(ps.position) as first_position
             FROM songs s
             INNER JOIN playlist_songs ps ON s.id = ps.song_id
             WHERE ps.playlist_id = $1 AND s.album_id IS NOT NULL
             GROUP BY s.album_id
         ) album_positions
         ORDER BY first_position
         LIMIT $2",
        [
            Value::from(playlist_id.to_string()),
            Value::from(limit as i64),
        ],
    )
    .await?;

    Ok(rows.into_iter().map(|r| r.album_id).collect())
}

/// Create a new playlist
pub async fn create_playlist(
    database: &Database,
    id: &str,
    name: &str,
    owner_id: i64,
    comment: Option<&str>,
    is_public: bool,
    folder_id: Option<&str>,
) -> crate::error::Result<()> {
    raw::execute(
        database.conn(),
        "INSERT INTO playlists (id, name, comment, owner_id, is_public, folder_id, song_count, duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))",
        "INSERT INTO playlists (id, name, comment, owner_id, is_public, folder_id, song_count, duration, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [
            Value::from(id.to_string()),
            Value::from(name.to_string()),
            Value::from(comment.map(|s| s.to_string())),
            Value::from(owner_id),
            Value::from(is_public),
            Value::from(folder_id.map(|s| s.to_string())),
        ],
    )
    .await?;
    Ok(())
}

/// Update playlist metadata
pub async fn update_playlist_metadata(
    database: &Database,
    id: &str,
    name: Option<&str>,
    comment: Option<&str>,
    is_public: Option<bool>,
) -> crate::error::Result<()> {
    let is_postgres = matches!(
        database.conn().get_database_backend(),
        sea_orm::DbBackend::Postgres
    );

    let now_expr = if is_postgres {
        "CURRENT_TIMESTAMP"
    } else {
        "datetime('now')"
    };
    let mut updates = vec![format!("updated_at = {}", now_expr)];
    let mut values: Vec<Value> = Vec::new();
    let mut bind_index = 1usize;

    if let Some(n) = name {
        if is_postgres {
            updates.push(format!("name = ${}", bind_index));
            bind_index += 1;
        } else {
            updates.push("name = ?".to_string());
        }
        values.push(Value::from(n.to_string()));
    }
    if let Some(c) = comment {
        if is_postgres {
            updates.push(format!("comment = ${}", bind_index));
            bind_index += 1;
        } else {
            updates.push("comment = ?".to_string());
        }
        values.push(Value::from(c.to_string()));
    }
    if let Some(p) = is_public {
        if is_postgres {
            updates.push(format!("is_public = ${}", bind_index));
            bind_index += 1;
        } else {
            updates.push("is_public = ?".to_string());
        }
        values.push(Value::from(p));
    }

    let where_clause = if is_postgres {
        format!("id = ${}", bind_index)
    } else {
        "id = ?".to_string()
    };
    values.push(Value::from(id.to_string()));

    let sql = format!(
        "UPDATE playlists SET {} WHERE {}",
        updates.join(", "),
        where_clause
    );

    raw::execute(database.conn(), &sql, &sql, values).await?;
    Ok(())
}

/// Add songs to end of playlist
pub async fn add_songs_to_playlist(
    database: &Database,
    playlist_id: &str,
    song_ids: &[String],
) -> crate::error::Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    let max_pos = raw::query_scalar::<i64>(
        database.conn(),
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?",
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = $1",
        [Value::from(playlist_id.to_string())],
    )
    .await?
    .unwrap_or(-1);

    let mut position = max_pos + 1;

    for song_id in song_ids {
        let entry_id = Uuid::new_v4().to_string();
        raw::execute(
            database.conn(),
            "INSERT INTO playlist_songs (playlist_id, song_id, position, added_at, entry_id) VALUES (?, ?, ?, datetime('now'), ?)",
            "INSERT INTO playlist_songs (playlist_id, song_id, position, added_at, entry_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)",
            [
                Value::from(playlist_id.to_string()),
                Value::from(song_id.clone()),
                Value::from(position),
                Value::from(entry_id),
            ],
        )
        .await?;
        position += 1;
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Playlist entry that can be either a matched song or a missing entry
pub struct PlaylistEntry {
    pub song_id: Option<String>,
    pub missing_entry_data: Option<MissingEntryData>,
    /// Denormalized search text for filtering missing entries
    pub missing_search_text: Option<String>,
}

/// Add entries to end of playlist (supports both matched songs and missing entries)
pub async fn add_entries_to_playlist(
    database: &Database,
    playlist_id: &str,
    entries: &[PlaylistEntry],
) -> crate::error::Result<()> {
    if entries.is_empty() {
        return Ok(());
    }

    let max_pos = raw::query_scalar::<i64>(
        database.conn(),
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?",
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = $1",
        [Value::from(playlist_id.to_string())],
    )
    .await?
    .unwrap_or(-1);

    let mut position = max_pos + 1;

    for entry in entries {
        let missing_json = entry
            .missing_entry_data
            .as_ref()
            .map(|data| serde_json::to_string(data).unwrap_or_default());
        let entry_id = Uuid::new_v4().to_string();
        raw::execute(
            database.conn(),
            "INSERT INTO playlist_songs (playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)",
            "INSERT INTO playlist_songs (playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)",
            [
                Value::from(playlist_id.to_string()),
                Value::from(entry.song_id.clone()),
                Value::from(position),
                Value::from(missing_json),
                Value::from(entry.missing_search_text.clone()),
                Value::from(entry_id),
            ],
        )
        .await?;
        position += 1;
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Get all playlist entries including missing entries
pub async fn get_playlist_entries(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<Vec<PlaylistSong>> {
    Ok(raw::query_all::<PlaylistSong>(
        database.conn(),
        "SELECT playlist_id, song_id, position, missing_entry_data, entry_id 
         FROM playlist_songs 
         WHERE playlist_id = ? 
         ORDER BY position",
        "SELECT playlist_id, song_id, position, missing_entry_data, entry_id 
         FROM playlist_songs 
         WHERE playlist_id = $1 
         ORDER BY position",
        [Value::from(playlist_id.to_string())],
    )
    .await?)
}

/// Update a missing entry to link it to a matched song
pub async fn match_missing_entry(
    database: &Database,
    playlist_id: &str,
    position: i32,
    song_id: &str,
) -> crate::error::Result<()> {
    raw::execute(
        database.conn(),
        "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND position = ?",
        "UPDATE playlist_songs SET song_id = $1, missing_search_text = NULL WHERE playlist_id = $2 AND position = $3",
        [
            Value::from(song_id.to_string()),
            Value::from(playlist_id.to_string()),
            Value::from(position as i64),
        ],
    )
    .await?;
    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

/// Unmatch a previously matched entry - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry(
    database: &Database,
    playlist_id: &str,
    position: i32,
) -> crate::error::Result<()> {
    use crate::db::models::MissingEntryData;

    #[derive(sea_orm::FromQueryResult)]
    struct Row {
        missing_entry_data: Option<String>,
    }

    let row = raw::query_one::<Row>(
        database.conn(),
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = ? AND position = ?",
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = $1 AND position = $2",
        [
            Value::from(playlist_id.to_string()),
            Value::from(position as i64),
        ],
    )
    .await?;

    let missing_json = row.and_then(|r| r.missing_entry_data);

    let search_text = missing_json
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| build_missing_search_text(&data));

    raw::execute(
        database.conn(),
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = ? WHERE playlist_id = ? AND position = ?",
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = $1 WHERE playlist_id = $2 AND position = $3",
        [
            Value::from(search_text),
            Value::from(playlist_id.to_string()),
            Value::from(position as i64),
        ],
    )
    .await?;
    update_playlist_totals(database, playlist_id).await?;
    Ok(())
}

fn build_missing_search_text(data: &MissingEntryData) -> String {
    let mut parts = Vec::new();
    if let Some(a) = &data.artist {
        if !a.is_empty() {
            parts.push(a.as_str());
        }
    }
    if let Some(a) = &data.album {
        if !a.is_empty() {
            parts.push(a.as_str());
        }
    }
    if let Some(t) = &data.title {
        if !t.is_empty() {
            parts.push(t.as_str());
        }
    }
    if parts.is_empty() {
        data.raw.clone()
    } else {
        parts.join(" - ")
    }
}

/// Update a missing entry to link it to a matched song, using entry_id for identification
pub async fn match_missing_entry_by_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
    song_id: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND entry_id = ?",
        "UPDATE playlist_songs SET song_id = $1, missing_search_text = NULL WHERE playlist_id = $2 AND entry_id = $3",
        [
            Value::from(song_id.to_string()),
            Value::from(playlist_id.to_string()),
            Value::from(entry_id.to_string()),
        ],
    )
    .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(true)
}

/// Batch match multiple missing entries to songs
/// Returns the number of successfully matched entries
pub async fn batch_match_entries(
    database: &Database,
    playlist_id: &str,
    matches: &[(String, String)], // Vec of (entry_id, song_id)
) -> crate::error::Result<usize> {
    if matches.is_empty() {
        return Ok(0);
    }

    let mut success_count = 0;
    for (entry_id, song_id) in matches {
        let result = raw::execute(
            database.conn(),
            "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND entry_id = ?",
            "UPDATE playlist_songs SET song_id = $1, missing_search_text = NULL WHERE playlist_id = $2 AND entry_id = $3",
            [
                Value::from(song_id.clone()),
                Value::from(playlist_id.to_string()),
                Value::from(entry_id.clone()),
            ],
        )
        .await?;
        if result.rows_affected() > 0 {
            success_count += 1;
        }
    }

    update_playlist_totals(database, playlist_id).await?;
    Ok(success_count)
}

/// Unmatch a previously matched entry by entry_id - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry_by_id(
    database: &Database,
    playlist_id: &str,
    entry_id: &str,
) -> crate::error::Result<bool> {
    use crate::db::models::MissingEntryData;

    #[derive(sea_orm::FromQueryResult)]
    struct Row {
        missing_entry_data: Option<String>,
    }

    let row = raw::query_one::<Row>(
        database.conn(),
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = ? AND entry_id = ?",
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = $1 AND entry_id = $2",
        [
            Value::from(playlist_id.to_string()),
            Value::from(entry_id.to_string()),
        ],
    )
    .await?;

    let Some(row) = row else {
        return Ok(false);
    };

    let search_text = row
        .missing_entry_data
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| build_missing_search_text(&data));

    raw::execute(
        database.conn(),
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = ? WHERE playlist_id = ? AND entry_id = ?",
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = $1 WHERE playlist_id = $2 AND entry_id = $3",
        [
            Value::from(search_text),
            Value::from(playlist_id.to_string()),
            Value::from(entry_id.to_string()),
        ],
    )
    .await?;

    update_playlist_totals(database, playlist_id).await?;
    Ok(true)
}

/// Remove songs from playlist by position indices
pub async fn remove_songs_by_position(
    database: &Database,
    playlist_id: &str,
    positions: &[u32],
) -> crate::error::Result<()> {
    if positions.is_empty() {
        return Ok(());
    }

    for pos in positions {
        raw::execute(
            database.conn(),
            "DELETE FROM playlist_songs WHERE playlist_id = ? AND position = ?",
            "DELETE FROM playlist_songs WHERE playlist_id = $1 AND position = $2",
            [
                Value::from(playlist_id.to_string()),
                Value::from(*pos as i64),
            ],
        )
        .await?;
    }

    reindex_playlist_positions(database, playlist_id).await?;
    update_playlist_totals(database, playlist_id).await?;

    Ok(())
}

/// Reindex playlist positions to be sequential (0, 1, 2, ...)
async fn reindex_playlist_positions(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<()> {
    #[derive(sea_orm::FromQueryResult)]
    struct PosRow {
        position: i64,
    }

    let entries = raw::query_all::<PosRow>(
        database.conn(),
        "SELECT position FROM playlist_songs WHERE playlist_id = ? ORDER BY position",
        "SELECT position FROM playlist_songs WHERE playlist_id = $1 ORDER BY position",
        [Value::from(playlist_id.to_string())],
    )
    .await?;

    for (new_pos, row) in entries.iter().enumerate() {
        if new_pos as i64 != row.position {
            raw::execute(
                database.conn(),
                "UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND position = ?",
                "UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND position = $3",
                [
                    Value::from(new_pos as i64),
                    Value::from(playlist_id.to_string()),
                    Value::from(row.position),
                ],
            )
            .await?;
        }
    }

    Ok(())
}

/// Update playlist song_count and duration from its songs
async fn update_playlist_totals(
    database: &Database,
    playlist_id: &str,
) -> crate::error::Result<()> {
    raw::execute(
        database.conn(),
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = ?),
            updated_at = datetime('now')
         WHERE id = ?",
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = $1),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = $2),
            updated_at = CURRENT_TIMESTAMP
         WHERE id = $3",
        [
            Value::from(playlist_id.to_string()),
            Value::from(playlist_id.to_string()),
            Value::from(playlist_id.to_string()),
        ],
    )
    .await?;
    Ok(())
}

/// Delete a playlist (cascade deletes playlist_songs)
pub async fn delete_playlist(database: &Database, id: &str) -> crate::error::Result<()> {
    raw::execute(
        database.conn(),
        "DELETE FROM playlists WHERE id = ?",
        "DELETE FROM playlists WHERE id = $1",
        [Value::from(id.to_string())],
    )
    .await?;
    Ok(())
}

/// Delete a song from the database
///
/// This function:
/// - Converts playlist entries referencing this song to "missing" entries (preserves metadata)
/// - Deletes scrobbles for the song (CASCADE)
/// - Deletes starred entries for the song
/// - Cleans up FTS entries via trigger
/// - Updates album song_count
/// - Updates affected playlist totals
///
/// Playlist entries are NOT deleted - they become "missing" entries with the song's
/// metadata preserved, allowing them to be re-matched if the song is added again later.
pub async fn delete_song(database: &Database, id: &str) -> crate::error::Result<bool> {
    #[derive(sea_orm::FromQueryResult)]
    struct SongMeta {
        title: String,
        artist_name: Option<String>,
        album_name: Option<String>,
        duration: i64,
    }

    let meta = raw::query_one::<SongMeta>(
        database.conn(),
        "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = ?",
        "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = $1",
        [Value::from(id.to_string())],
    )
    .await?;

    let Some(SongMeta {
        title,
        artist_name,
        album_name,
        duration,
    }) = meta
    else {
        return Ok(false);
    };

    #[derive(sea_orm::FromQueryResult)]
    struct AlbumIdRow {
        album_id: Option<String>,
    }

    let album_id_row = raw::query_one::<AlbumIdRow>(
        database.conn(),
        "SELECT album_id FROM songs WHERE id = ?",
        "SELECT album_id FROM songs WHERE id = $1",
        [Value::from(id.to_string())],
    )
    .await?;
    let album_id = album_id_row.and_then(|r| r.album_id);

    let missing_data = serde_json::json!({
        "title": title,
        "artist": artist_name,
        "album": album_name,
        "duration": duration as i32,
        "raw": format!("{} - {}", artist_name.as_deref().unwrap_or("Unknown Artist"), title)
    });
    let missing_json = serde_json::to_string(&missing_data).unwrap_or_default();

    let mut parts = Vec::new();
    if let Some(ref a) = artist_name {
        parts.push(a.as_str());
    }
    if let Some(ref al) = album_name {
        parts.push(al.as_str());
    }
    parts.push(title.as_str());
    let search_text = parts.join(" - ");

    let tx = database.conn().begin().await?;

    #[derive(sea_orm::FromQueryResult)]
    struct PidRow {
        playlist_id: String,
    }
    let affected = raw::query_all::<PidRow>(
        &tx,
        "SELECT DISTINCT playlist_id FROM playlist_songs WHERE song_id = ?",
        "SELECT DISTINCT playlist_id FROM playlist_songs WHERE song_id = $1",
        [Value::from(id.to_string())],
    )
    .await?;
    let affected_playlist_ids: Vec<String> = affected.into_iter().map(|r| r.playlist_id).collect();

    raw::execute(
        &tx,
        "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = ?, missing_search_text = ? WHERE song_id = ?",
        "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = $1, missing_search_text = $2 WHERE song_id = $3",
        [
            Value::from(missing_json.clone()),
            Value::from(search_text.clone()),
            Value::from(id.to_string()),
        ],
    )
    .await?;

    raw::execute(
        &tx,
        "DELETE FROM starred WHERE item_type = 'song' AND item_id = ?",
        "DELETE FROM starred WHERE item_type = 'song' AND item_id = $1",
        [Value::from(id.to_string())],
    )
    .await?;

    let result = raw::execute(
        &tx,
        "DELETE FROM songs WHERE id = ?",
        "DELETE FROM songs WHERE id = $1",
        [Value::from(id.to_string())],
    )
    .await?;

    if result.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(false);
    }

    if let Some(album_id) = album_id {
        raw::execute(
            &tx,
            "UPDATE albums SET 
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = ?),
                duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = ?)
             WHERE id = ?",
            "UPDATE albums SET
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = $1),
                duration = (SELECT COALESCE(SUM(duration), 0)::BIGINT FROM songs WHERE album_id = $2)
             WHERE id = $3",
            [
                Value::from(album_id.clone()),
                Value::from(album_id.clone()),
                Value::from(album_id),
            ],
        )
        .await?;
    }

    if !affected_playlist_ids.is_empty() {
        let sqlite_placeholders = affected_playlist_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let postgres_placeholders = (1..=affected_playlist_ids.len())
            .map(|i| format!("${}", i))
            .collect::<Vec<_>>()
            .join(",");

        let sqlite_sql = format!(
            "UPDATE playlists SET
                song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
                duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s
                            INNER JOIN playlist_songs ps ON s.id = ps.song_id
                            WHERE ps.playlist_id = playlists.id),
                updated_at = datetime('now')
             WHERE id IN ({})",
            sqlite_placeholders
        );
        let postgres_sql = format!(
            "UPDATE playlists SET
                song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
                duration = (SELECT COALESCE(SUM(s.duration), 0)::BIGINT FROM songs s
                            INNER JOIN playlist_songs ps ON s.id = ps.song_id
                            WHERE ps.playlist_id = playlists.id),
                updated_at = CURRENT_TIMESTAMP
             WHERE id IN ({})",
            postgres_placeholders
        );

        let values: Vec<Value> = affected_playlist_ids
            .iter()
            .map(|p| Value::from(p.clone()))
            .collect();
        raw::execute(&tx, &sqlite_sql, &postgres_sql, values).await?;
    }

    tx.commit().await?;
    Ok(true)
}

/// Update a song's file path in the database
pub async fn update_song_path(
    database: &Database,
    song_id: &str,
    new_path: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE songs SET file_path = ?, updated_at = datetime('now') WHERE id = ?",
        "UPDATE songs SET file_path = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [
            Value::from(new_path.to_string()),
            Value::from(song_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update a song's file path and format in the database
/// Used when replacing audio with a different format
pub async fn update_song_path_and_format(
    database: &Database,
    song_id: &str,
    new_path: &str,
    new_format: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE songs SET file_path = ?, file_format = ?, updated_at = datetime('now') WHERE id = ?",
        "UPDATE songs SET file_path = $1, file_format = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [
            Value::from(new_path.to_string()),
            Value::from(new_format.to_string()),
            Value::from(song_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Playback Session queries
// ============================================================================

/// Get or create the single session for a user.
/// Returns the existing session if one exists, otherwise creates a new one.
pub async fn get_or_create_session(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<PlaybackSession> {
    if let Some(session) = raw::query_one::<PlaybackSession>(
        database.conn(),
        "SELECT * FROM playback_sessions WHERE user_id = ?",
        "SELECT * FROM playback_sessions WHERE user_id = $1",
        [Value::from(user_id)],
    )
    .await?
    {
        return Ok(session);
    }

    let id = Uuid::new_v4().to_string();
    raw::execute(
        database.conn(),
        "INSERT INTO playback_sessions (id, user_id, name, client_name, is_playing, last_heartbeat, created_at, owner_client_name)
         VALUES (?, ?, '', 'ferrotune-web', 0, datetime('now'), datetime('now'), 'ferrotune-web')",
        "INSERT INTO playback_sessions (id, user_id, name, client_name, is_playing, last_heartbeat, created_at, owner_client_name)
         VALUES ($1, $2, '', 'ferrotune-web', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'ferrotune-web')",
        [Value::from(id.clone()), Value::from(user_id)],
    )
    .await?;

    let session = raw::query_one::<PlaybackSession>(
        database.conn(),
        "SELECT * FROM playback_sessions WHERE id = ?",
        "SELECT * FROM playback_sessions WHERE id = $1",
        [Value::from(id)],
    )
    .await?
    .ok_or_else(|| {
        crate::error::Error::Orm(sea_orm::DbErr::RecordNotFound(
            "playback_session insert missing".to_string(),
        ))
    })?;
    Ok(session)
}

/// Get a specific session by id (only if it belongs to the given user)
pub async fn get_session(
    database: &Database,
    session_id: &str,
    user_id: i64,
) -> crate::error::Result<Option<PlaybackSession>> {
    Ok(raw::query_one::<PlaybackSession>(
        database.conn(),
        "SELECT * FROM playback_sessions WHERE id = ? AND user_id = ?",
        "SELECT * FROM playback_sessions WHERE id = $1 AND user_id = $2",
        [Value::from(session_id.to_string()), Value::from(user_id)],
    )
    .await?)
}

/// Atomically update session heartbeat and queue position in a single transaction.
/// Ensures followers always see consistent session state + queue position.
///
/// Note: The queue's `current_index` + `position_ms` are the canonical position
/// source. The session table stores display metadata (song info) and liveness;
/// position data there is ephemeral.
#[allow(clippy::too_many_arguments)]
pub async fn update_session_heartbeat_with_position(
    database: &Database,
    session_id: &str,
    is_playing: bool,
    current_song_id: Option<&str>,
    current_song_title: Option<&str>,
    current_song_artist: Option<&str>,
    current_index: Option<i64>,
    position_ms: Option<i64>,
) -> crate::error::Result<bool> {
    let tx = database.conn().begin().await?;

    let result = raw::execute(
        &tx,
        "UPDATE playback_sessions
         SET last_heartbeat = datetime('now'),
             is_playing = ?,
             current_song_id = ?,
             current_song_title = ?,
             current_song_artist = ?,
             last_playing_at = CASE WHEN ? THEN datetime('now') ELSE last_playing_at END
         WHERE id = ?",
        "UPDATE playback_sessions
         SET last_heartbeat = CURRENT_TIMESTAMP,
             is_playing = $1,
             current_song_id = $2,
             current_song_title = $3,
             current_song_artist = $4,
             last_playing_at = CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE last_playing_at END
         WHERE id = $6",
        [
            Value::from(is_playing),
            Value::from(current_song_id.map(|s| s.to_string())),
            Value::from(current_song_title.map(|s| s.to_string())),
            Value::from(current_song_artist.map(|s| s.to_string())),
            Value::from(is_playing),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;

    if let (Some(idx), Some(pos)) = (current_index, position_ms) {
        raw::execute(
            &tx,
            "UPDATE play_queues SET current_index = ?, position_ms = ?, updated_at = datetime('now')
             WHERE session_id = ?",
            "UPDATE play_queues SET current_index = $1, position_ms = $2, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = $3",
            [
                Value::from(idx),
                Value::from(pos),
                Value::from(session_id.to_string()),
            ],
        )
        .await?;
    }

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Update only the heartbeat timestamp (for follower keepalive)
pub async fn update_session_heartbeat_timestamp(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE playback_sessions SET last_heartbeat = datetime('now') WHERE id = ?",
        "UPDATE playback_sessions SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update only last_playing_at (used to reset inactivity timeout on queue start).
pub async fn touch_session_last_playing_at(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE playback_sessions SET last_playing_at = datetime('now') WHERE id = ?",
        "UPDATE playback_sessions SET last_playing_at = CURRENT_TIMESTAMP WHERE id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update the owner of a session (on takeover)
pub async fn update_session_owner(
    database: &Database,
    session_id: &str,
    owner_client_id: Option<&str>,
    owner_client_name: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE playback_sessions SET owner_client_id = ?, owner_client_name = ?, client_name = ? WHERE id = ?",
        "UPDATE playback_sessions SET owner_client_id = $1, owner_client_name = $2, client_name = $3 WHERE id = $4",
        [
            Value::from(owner_client_id.map(|s| s.to_string())),
            Value::from(owner_client_name.to_string()),
            Value::from(owner_client_name.to_string()),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Get the user's session (single session per user)
pub async fn get_user_session(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Option<PlaybackSession>> {
    Ok(raw::query_one::<PlaybackSession>(
        database.conn(),
        "SELECT * FROM playback_sessions WHERE user_id = ?",
        "SELECT * FROM playback_sessions WHERE user_id = $1",
        [Value::from(user_id)],
    )
    .await?)
}

/// Find sessions whose owner has been inactive (not playing) for at least the
/// given number of seconds. Returns the session IDs that should be disowned.
pub async fn get_sessions_with_inactive_owners(
    database: &Database,
    inactivity_seconds: i64,
) -> crate::error::Result<Vec<PlaybackSession>> {
    Ok(raw::query_all::<PlaybackSession>(
        database.conn(),
        "SELECT * FROM playback_sessions
         WHERE owner_client_id IS NOT NULL
           AND is_playing = 0
           AND (last_playing_at IS NULL OR last_playing_at < datetime('now', '-' || ? || ' seconds'))",
        "SELECT * FROM playback_sessions
         WHERE owner_client_id IS NOT NULL
           AND is_playing = FALSE
           AND (last_playing_at IS NULL OR last_playing_at < NOW() - ($1 * INTERVAL '1 second'))",
        [Value::from(inactivity_seconds)],
    )
    .await?)
}

/// Clear ownership from a session (set owner_client_id to NULL).
pub async fn clear_session_owner(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE playback_sessions SET owner_client_id = NULL WHERE id = ?",
        "UPDATE playback_sessions SET owner_client_id = NULL WHERE id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Play Queue queries (server-side queue management)
// ============================================================================

/// Get the play queue for a session, verifying it belongs to the given user
pub async fn get_play_queue_by_session(
    database: &Database,
    session_id: &str,
    user_id: i64,
) -> crate::error::Result<Option<PlayQueue>> {
    Ok(raw::query_one::<PlayQueue>(
        database.conn(),
        "SELECT * FROM play_queues WHERE session_id = ? AND user_id = ?",
        "SELECT * FROM play_queues WHERE session_id = $1 AND user_id = $2",
        [Value::from(session_id.to_string()), Value::from(user_id)],
    )
    .await?)
}

/// Get queue length by session
pub async fn get_queue_length_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<i64> {
    Ok(raw::query_scalar::<i64>(
        database.conn(),
        "SELECT COUNT(*) FROM play_queue_entries WHERE session_id = ?",
        "SELECT COUNT(*) FROM play_queue_entries WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?
    .unwrap_or(0))
}

/// Get queue entries with full song data by session
pub async fn get_queue_entries_with_songs_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    Ok(raw::query_all::<QueueEntryWithSong>(
        database.conn(),
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ?
         ORDER BY pqe.queue_position ASC",
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = $1
         ORDER BY pqe.queue_position ASC",
        [Value::from(session_id.to_string())],
    )
    .await?)
}

/// Get queue entries at specific positions by session
pub async fn get_queue_entries_at_positions_by_session(
    database: &Database,
    session_id: &str,
    positions: &[usize],
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    if positions.is_empty() {
        return Ok(vec![]);
    }

    let sqlite_placeholders: String = positions.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sqlite_sql = format!(
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ? AND pqe.queue_position IN ({sqlite_placeholders})
         ORDER BY pqe.queue_position ASC"
    );
    let postgres_sql = format!(
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = $1 AND pqe.queue_position IN ({})
         ORDER BY pqe.queue_position ASC",
        postgres_placeholders(2, positions.len())
    );
    let mut binds: Vec<Value> = vec![Value::from(session_id.to_string())];
    for &pos in positions {
        binds.push(Value::from(pos as i64));
    }
    Ok(
        raw::query_all::<QueueEntryWithSong>(database.conn(), &sqlite_sql, &postgres_sql, binds)
            .await?,
    )
}

/// Get queue entries in a contiguous range by session
pub async fn get_queue_entries_range_by_session(
    database: &Database,
    session_id: &str,
    offset: usize,
    limit: usize,
) -> crate::error::Result<Vec<QueueEntryWithSong>> {
    Ok(raw::query_all::<QueueEntryWithSong>(
        database.conn(),
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ? AND pqe.queue_position >= ? AND pqe.queue_position < ?
         ORDER BY pqe.queue_position ASC",
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = $1 AND pqe.queue_position >= $2 AND pqe.queue_position < $3
         ORDER BY pqe.queue_position ASC",
        [
            Value::from(session_id.to_string()),
            Value::from(offset as i64),
            Value::from((offset + limit) as i64),
        ],
    )
    .await?)
}

/// Get all song IDs in queue order by session
pub async fn get_queue_song_ids_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<Vec<String>> {
    #[derive(sea_orm::FromQueryResult)]
    struct SongIdRow {
        song_id: String,
    }
    let rows = raw::query_all::<SongIdRow>(
        database.conn(),
        "SELECT song_id FROM play_queue_entries WHERE session_id = ? ORDER BY queue_position",
        "SELECT song_id FROM play_queue_entries WHERE session_id = $1 ORDER BY queue_position",
        [Value::from(session_id.to_string())],
    )
    .await?;
    Ok(rows.into_iter().map(|r| r.song_id).collect())
}

/// Create or replace the play queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_queue_for_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    source_type: &str,
    source_id: Option<&str>,
    source_name: Option<&str>,
    song_ids: &[String],
    source_entry_ids: Option<&[String]>,
    current_index: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    repeat_mode: &str,
    filters_json: Option<&str>,
    sort_json: Option<&str>,
    changed_by: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;
    let instance_id = Uuid::new_v4().to_string();
    let is_postgres = matches!(database.sea_backend(), sea_orm::DbBackend::Postgres);

    raw::execute(
        &tx,
        "DELETE FROM play_queue_entries WHERE session_id = ?",
        "DELETE FROM play_queue_entries WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    raw::execute(
        &tx,
        "DELETE FROM play_queues WHERE session_id = ?",
        "DELETE FROM play_queues WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    const BATCH_SIZE: usize = 199;
    for chunk_start in (0..song_ids.len()).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(song_ids.len());
        let chunk = &song_ids[chunk_start..chunk_end];
        let row_count = chunk.len();

        let mut sql = String::from(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id, source_entry_id, session_id) VALUES ",
        );
        for row in 0..row_count {
            if row > 0 {
                sql.push_str(", ");
            }
            if is_postgres {
                sql.push('(');
                sql.push_str(&postgres_placeholders(row * 6 + 1, 6));
                sql.push(')');
            } else {
                sql.push_str("(?, ?, ?, ?, ?, ?)");
            }
        }

        let mut binds: Vec<Value> = Vec::with_capacity(row_count * 6);
        for (i, song_id) in chunk.iter().enumerate() {
            let position = chunk_start + i;
            let entry_id = Uuid::new_v4().to_string();
            let source_entry_id = source_entry_ids.and_then(|ids| ids.get(position)).cloned();
            binds.push(Value::from(user_id));
            binds.push(Value::from(song_id.clone()));
            binds.push(Value::from(position as i64));
            binds.push(Value::from(entry_id));
            binds.push(Value::from(source_entry_id));
            binds.push(Value::from(session_id.to_string()));
        }
        raw::execute(&tx, &sql, &sql, binds).await?;
    }

    raw::execute(
        &tx,
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, 0, NULL, ?, ?)",
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $12, $13, FALSE, NULL, $14, $15)",
        [
            Value::from(user_id),
            Value::from(source_type.to_string()),
            Value::from(source_id.map(String::from)),
            Value::from(source_name.map(String::from)),
            Value::from(current_index),
            Value::from(is_shuffled),
            Value::from(shuffle_seed),
            Value::from(shuffle_indices_json.map(String::from)),
            Value::from(repeat_mode.to_string()),
            Value::from(filters_json.map(String::from)),
            Value::from(sort_json.map(String::from)),
            Value::from(changed_by.to_string()),
            Value::from(song_ids.len() as i64),
            Value::from(instance_id),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Create a lazy queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_lazy_queue_for_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    source_type: &str,
    source_id: Option<&str>,
    source_name: Option<&str>,
    total_count: i64,
    current_index: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    repeat_mode: &str,
    filters_json: Option<&str>,
    sort_json: Option<&str>,
    song_ids_json: Option<&str>,
    changed_by: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;
    let instance_id = Uuid::new_v4().to_string();

    raw::execute(
        &tx,
        "DELETE FROM play_queue_entries WHERE session_id = ?",
        "DELETE FROM play_queue_entries WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    raw::execute(
        &tx,
        "DELETE FROM play_queues WHERE session_id = ?",
        "DELETE FROM play_queues WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    raw::execute(
        &tx,
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, 1, ?, ?, ?)",
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $12, $13, TRUE, $14, $15, $16)",
        [
            Value::from(user_id),
            Value::from(source_type.to_string()),
            Value::from(source_id.map(String::from)),
            Value::from(source_name.map(String::from)),
            Value::from(current_index),
            Value::from(is_shuffled),
            Value::from(shuffle_seed),
            Value::from(shuffle_indices_json.map(String::from)),
            Value::from(repeat_mode.to_string()),
            Value::from(filters_json.map(String::from)),
            Value::from(sort_json.map(String::from)),
            Value::from(changed_by.to_string()),
            Value::from(total_count),
            Value::from(song_ids_json.map(String::from)),
            Value::from(instance_id),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Update queue position by session
pub async fn update_queue_position_by_session(
    database: &Database,
    session_id: &str,
    current_index: i64,
    position_ms: i64,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE play_queues SET current_index = ?, position_ms = ?, updated_at = datetime('now')
             WHERE session_id = ?",
        "UPDATE play_queues SET current_index = $1, position_ms = $2, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = $3",
        [
            Value::from(current_index),
            Value::from(position_ms),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update only position_ms by session (without changing current_index)
pub async fn update_queue_position_ms_by_session(
    database: &Database,
    session_id: &str,
    position_ms: i64,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE play_queues SET position_ms = ?, updated_at = datetime('now')
             WHERE session_id = ?",
        "UPDATE play_queues SET position_ms = $1, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = $2",
        [
            Value::from(position_ms),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue shuffle state by session
#[allow(clippy::too_many_arguments)]
pub async fn update_queue_shuffle_by_session(
    database: &Database,
    session_id: &str,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    current_index: i64,
    position_ms: i64,
    expected_version: Option<i64>,
) -> crate::error::Result<bool> {
    let result = if let Some(ver) = expected_version {
        raw::execute(
            database.conn(),
            "UPDATE play_queues SET
             is_shuffled = ?, shuffle_seed = ?, shuffle_indices_json = ?,
             current_index = ?, position_ms = ?, updated_at = datetime('now'),
             version = version + 1
             WHERE session_id = ? AND version = ?",
            "UPDATE play_queues SET
             is_shuffled = $1, shuffle_seed = $2, shuffle_indices_json = $3,
             current_index = $4, position_ms = $5, updated_at = CURRENT_TIMESTAMP,
             version = version + 1
             WHERE session_id = $6 AND version = $7",
            [
                Value::from(is_shuffled),
                Value::from(shuffle_seed),
                Value::from(shuffle_indices_json.map(String::from)),
                Value::from(current_index),
                Value::from(position_ms),
                Value::from(session_id.to_string()),
                Value::from(ver),
            ],
        )
        .await?
    } else {
        raw::execute(
            database.conn(),
            "UPDATE play_queues SET
             is_shuffled = ?, shuffle_seed = ?, shuffle_indices_json = ?,
             current_index = ?, position_ms = ?, updated_at = datetime('now'),
             version = version + 1
             WHERE session_id = ?",
            "UPDATE play_queues SET
             is_shuffled = $1, shuffle_seed = $2, shuffle_indices_json = $3,
             current_index = $4, position_ms = $5, updated_at = CURRENT_TIMESTAMP,
             version = version + 1
             WHERE session_id = $6",
            [
                Value::from(is_shuffled),
                Value::from(shuffle_seed),
                Value::from(shuffle_indices_json.map(String::from)),
                Value::from(current_index),
                Value::from(position_ms),
                Value::from(session_id.to_string()),
            ],
        )
        .await?
    };
    Ok(result.rows_affected() > 0)
}

/// Update song_ids_json on a queue (used to eagerly materialize lazy queues)
pub async fn update_queue_song_ids_by_session(
    database: &Database,
    session_id: &str,
    song_ids_json: Option<&str>,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE play_queues SET song_ids_json = ?, updated_at = datetime('now') WHERE session_id = ?",
        "UPDATE play_queues SET song_ids_json = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2",
        [
            Value::from(song_ids_json.map(String::from)),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue repeat mode by session
pub async fn update_queue_repeat_mode_by_session(
    database: &Database,
    session_id: &str,
    repeat_mode: &str,
) -> crate::error::Result<bool> {
    let result = raw::execute(
        database.conn(),
        "UPDATE play_queues SET repeat_mode = ?, updated_at = datetime('now') WHERE session_id = ?",
        "UPDATE play_queues SET repeat_mode = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2",
        [
            Value::from(repeat_mode.to_string()),
            Value::from(session_id.to_string()),
        ],
    )
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Add songs to queue by session
pub async fn add_to_queue_by_session(
    database: &Database,
    user_id: i64,
    session_id: &str,
    song_ids: &[String],
    position: i64,
) -> crate::error::Result<i64> {
    if song_ids.is_empty() {
        return get_queue_length_by_session(database, session_id).await;
    }

    #[derive(sea_orm::FromQueryResult)]
    struct PosRow {
        queue_position: i64,
    }

    let tx = database.conn().begin().await?;

    let queue_len = raw::query_scalar::<i64>(
        &tx,
        "SELECT COUNT(*) FROM play_queue_entries WHERE session_id = ?",
        "SELECT COUNT(*) FROM play_queue_entries WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?
    .unwrap_or(0);

    let insert_pos = if position < 0 { queue_len } else { position };

    if insert_pos < queue_len {
        let positions = raw::query_all::<PosRow>(
            &tx,
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position >= ?
             ORDER BY queue_position DESC",
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = $1 AND queue_position >= $2
             ORDER BY queue_position DESC",
            [Value::from(session_id.to_string()), Value::from(insert_pos)],
        )
        .await?;

        let shift_amount = song_ids.len() as i64;
        for row in positions {
            raw::execute(
                &tx,
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + ?
                 WHERE session_id = ? AND queue_position = ?",
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + $1
                 WHERE session_id = $2 AND queue_position = $3",
                [
                    Value::from(shift_amount),
                    Value::from(session_id.to_string()),
                    Value::from(row.queue_position),
                ],
            )
            .await?;
        }
    }

    for (i, song_id) in song_ids.iter().enumerate() {
        let entry_id = Uuid::new_v4().to_string();
        raw::execute(
            &tx,
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id, session_id) VALUES (?, ?, ?, ?, ?)",
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id, session_id) VALUES ($1, $2, $3, $4, $5)",
            [
                Value::from(user_id),
                Value::from(song_id.clone()),
                Value::from(insert_pos + i as i64),
                Value::from(entry_id),
                Value::from(session_id.to_string()),
            ],
        )
        .await?;
    }

    raw::execute(
        &tx,
        "UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?",
        "UPDATE play_queues SET updated_at = CURRENT_TIMESTAMP WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    tx.commit().await?;
    Ok(queue_len + song_ids.len() as i64)
}

/// Remove song from queue by session
pub async fn remove_from_queue_by_session(
    database: &Database,
    session_id: &str,
    position: i64,
) -> crate::error::Result<bool> {
    #[derive(sea_orm::FromQueryResult)]
    struct PosRow {
        queue_position: i64,
    }

    let tx = database.conn().begin().await?;

    let result = raw::execute(
        &tx,
        "DELETE FROM play_queue_entries WHERE session_id = ? AND queue_position = ?",
        "DELETE FROM play_queue_entries WHERE session_id = $1 AND queue_position = $2",
        [Value::from(session_id.to_string()), Value::from(position)],
    )
    .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    let positions = raw::query_all::<PosRow>(
        &tx,
        "SELECT queue_position FROM play_queue_entries
         WHERE session_id = ? AND queue_position > ?
         ORDER BY queue_position ASC",
        "SELECT queue_position FROM play_queue_entries
         WHERE session_id = $1 AND queue_position > $2
         ORDER BY queue_position ASC",
        [Value::from(session_id.to_string()), Value::from(position)],
    )
    .await?;

    for row in positions {
        raw::execute(
            &tx,
            "UPDATE play_queue_entries
             SET queue_position = queue_position - 1
             WHERE session_id = ? AND queue_position = ?",
            "UPDATE play_queue_entries
             SET queue_position = queue_position - 1
             WHERE session_id = $1 AND queue_position = $2",
            [
                Value::from(session_id.to_string()),
                Value::from(row.queue_position),
            ],
        )
        .await?;
    }

    raw::execute(
        &tx,
        "UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?",
        "UPDATE play_queues SET updated_at = CURRENT_TIMESTAMP WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    tx.commit().await?;
    Ok(true)
}

/// Move song in queue by session
pub async fn move_in_queue_by_session(
    database: &Database,
    session_id: &str,
    from_position: i64,
    to_position: i64,
) -> crate::error::Result<bool> {
    if from_position == to_position {
        return Ok(true);
    }

    #[derive(sea_orm::FromQueryResult)]
    struct PosRow {
        queue_position: i64,
    }

    let tx = database.conn().begin().await?;

    let exists = raw::query_scalar::<i32>(
        &tx,
        "SELECT 1 FROM play_queue_entries WHERE session_id = ? AND queue_position = ?",
        "SELECT 1 FROM play_queue_entries WHERE session_id = $1 AND queue_position = $2",
        [
            Value::from(session_id.to_string()),
            Value::from(from_position),
        ],
    )
    .await?;

    if exists.is_none() {
        return Ok(false);
    }

    let temp_position = -1i64;

    raw::execute(
        &tx,
        "UPDATE play_queue_entries SET queue_position = ? WHERE session_id = ? AND queue_position = ?",
        "UPDATE play_queue_entries SET queue_position = $1 WHERE session_id = $2 AND queue_position = $3",
        [
            Value::from(temp_position),
            Value::from(session_id.to_string()),
            Value::from(from_position),
        ],
    )
    .await?;

    if from_position < to_position {
        let positions = raw::query_all::<PosRow>(
            &tx,
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position > ? AND queue_position <= ?
             ORDER BY queue_position ASC",
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = $1 AND queue_position > $2 AND queue_position <= $3
             ORDER BY queue_position ASC",
            [
                Value::from(session_id.to_string()),
                Value::from(from_position),
                Value::from(to_position),
            ],
        )
        .await?;

        for row in positions {
            raw::execute(
                &tx,
                "UPDATE play_queue_entries
                 SET queue_position = queue_position - 1
                 WHERE session_id = ? AND queue_position = ?",
                "UPDATE play_queue_entries
                 SET queue_position = queue_position - 1
                 WHERE session_id = $1 AND queue_position = $2",
                [
                    Value::from(session_id.to_string()),
                    Value::from(row.queue_position),
                ],
            )
            .await?;
        }
    } else {
        let positions = raw::query_all::<PosRow>(
            &tx,
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position >= ? AND queue_position < ?
             ORDER BY queue_position DESC",
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = $1 AND queue_position >= $2 AND queue_position < $3
             ORDER BY queue_position DESC",
            [
                Value::from(session_id.to_string()),
                Value::from(to_position),
                Value::from(from_position),
            ],
        )
        .await?;

        for row in positions {
            raw::execute(
                &tx,
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + 1
                 WHERE session_id = ? AND queue_position = ?",
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + 1
                 WHERE session_id = $1 AND queue_position = $2",
                [
                    Value::from(session_id.to_string()),
                    Value::from(row.queue_position),
                ],
            )
            .await?;
        }
    }

    raw::execute(
        &tx,
        "UPDATE play_queue_entries SET queue_position = ? WHERE session_id = ? AND queue_position = ?",
        "UPDATE play_queue_entries SET queue_position = $1 WHERE session_id = $2 AND queue_position = $3",
        [
            Value::from(to_position),
            Value::from(session_id.to_string()),
            Value::from(temp_position),
        ],
    )
    .await?;

    raw::execute(
        &tx,
        "UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?",
        "UPDATE play_queues SET updated_at = CURRENT_TIMESTAMP WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    tx.commit().await?;
    Ok(true)
}

/// Clear queue by session
pub async fn clear_queue_by_session(
    database: &Database,
    session_id: &str,
) -> crate::error::Result<()> {
    let tx = database.conn().begin().await?;

    raw::execute(
        &tx,
        "DELETE FROM play_queue_entries WHERE session_id = ?",
        "DELETE FROM play_queue_entries WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    raw::execute(
        &tx,
        "DELETE FROM play_queues WHERE session_id = ?",
        "DELETE FROM play_queues WHERE session_id = $1",
        [Value::from(session_id.to_string())],
    )
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn get_disabled_song_ids_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<String>> {
    #[derive(sea_orm::FromQueryResult)]
    struct Row {
        song_id: String,
    }
    let rows = raw::query_all::<Row>(
        database.conn(),
        "SELECT song_id FROM disabled_songs WHERE user_id = ? ORDER BY song_id",
        "SELECT song_id FROM disabled_songs WHERE user_id = $1 ORDER BY song_id",
        [Value::from(user_id)],
    )
    .await?;
    Ok(rows.into_iter().map(|r| r.song_id).collect())
}

pub async fn get_shuffle_excluded_song_ids_for_user(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<String>> {
    #[derive(sea_orm::FromQueryResult)]
    struct Row {
        song_id: String,
    }
    let rows = raw::query_all::<Row>(
        database.conn(),
        "SELECT song_id FROM shuffle_excludes WHERE user_id = ? ORDER BY song_id",
        "SELECT song_id FROM shuffle_excludes WHERE user_id = $1 ORDER BY song_id",
        [Value::from(user_id)],
    )
    .await?;
    Ok(rows.into_iter().map(|r| r.song_id).collect())
}

// ============================================================================
// Queue source materialization helpers
// ============================================================================

/// Get starred songs for a user (includes play stats for sorting)
pub async fn get_starred_songs(
    database: &Database,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    Ok(raw::query_all::<Song>(
        database.conn(),
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, st.starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN starred st ON st.item_id = s.id AND st.item_type = 'song'
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE st.user_id = ? AND mf.enabled = 1 AND ula.user_id = ?
         ORDER BY st.starred_at DESC",
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, st.starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN starred st ON st.item_id = s.id AND st.item_type = 'song'
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE submission AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE st.user_id = $2 AND mf.enabled AND ula.user_id = $3
         ORDER BY st.starred_at DESC",
        [
            Value::from(user_id),
            Value::from(user_id),
            Value::from(user_id),
        ],
    )
    .await?)
}

/// Get songs recursively under a directory path (includes play stats for sorting)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
/// Also supports legacy format for Subsonic compatibility: "dir-<encoded_path>"
pub async fn get_songs_by_directory(
    database: &Database,
    source_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            let path_prefix = if relative_path.is_empty() {
                String::new()
            } else {
                format!("{}/", relative_path.trim_end_matches('/'))
            };

            if path_prefix.is_empty() {
                return Ok(raw::query_all::<Song>(
                    database.conn(),
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ?
                     ORDER BY s.file_path COLLATE NOCASE",
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL::timestamptz as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = $2
                     ORDER BY LOWER(s.file_path), s.file_path",
                    [Value::from(user_id), Value::from(library_id)],
                )
                .await?);
            } else {
                return Ok(raw::query_all::<Song>(
                    database.conn(),
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ? AND s.file_path LIKE ? || '%'
                     ORDER BY s.file_path COLLATE NOCASE",
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL::timestamptz as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = $2 AND s.file_path LIKE $3 || '%'
                     ORDER BY LOWER(s.file_path), s.file_path",
                    [
                        Value::from(user_id),
                        Value::from(library_id),
                        Value::from(path_prefix.clone()),
                    ],
                )
                .await?);
            }
        }
    }

    let actual_path = source_id
        .strip_prefix("dir-")
        .map(|p| urlencoding::decode(p).unwrap_or_default().into_owned())
        .unwrap_or_else(|| source_id.to_string());

    let path_prefix = if actual_path.is_empty() {
        String::new()
    } else {
        format!("{}/", actual_path.trim_end_matches('/'))
    };

    if path_prefix.is_empty() {
        Ok(raw::query_all::<Song>(
            database.conn(),
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
             ORDER BY s.file_path COLLATE NOCASE",
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL::timestamptz as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
             ORDER BY LOWER(s.file_path), s.file_path",
            [Value::from(user_id)],
        )
        .await?)
    } else {
        Ok(raw::query_all::<Song>(
            database.conn(),
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
             WHERE s.file_path LIKE ? || '%'
             ORDER BY s.file_path COLLATE NOCASE",
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL::timestamptz as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
             WHERE s.file_path LIKE $2 || '%'
             ORDER BY LOWER(s.file_path), s.file_path",
            [Value::from(user_id), Value::from(path_prefix)],
        )
        .await?)
    }
}

/// Get songs in a directory without recursing into subdirectories
/// Only returns songs whose file_path matches "parentPath/filename" (no additional slashes)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
pub async fn get_songs_by_directory_flat(
    database: &Database,
    source_id: &str,
    user_id: i64,
) -> crate::error::Result<Vec<Song>> {
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            let path_prefix = if relative_path.is_empty() {
                String::new()
            } else {
                format!("{}/", relative_path.trim_end_matches('/'))
            };

            if path_prefix.is_empty() {
                return Ok(raw::query_all::<Song>(
                    database.conn(),
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ? AND s.file_path NOT LIKE '%/%'
                     ORDER BY s.file_path COLLATE NOCASE",
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL::timestamptz as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = $2 AND s.file_path NOT LIKE '%/%'
                     ORDER BY LOWER(s.file_path), s.file_path",
                    [Value::from(user_id), Value::from(library_id)],
                )
                .await?);
            } else {
                return Ok(raw::query_all::<Song>(
                    database.conn(),
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ? 
                       AND s.file_path LIKE ? || '%'
                       AND s.file_path NOT LIKE ? || '%/%'
                     ORDER BY s.file_path COLLATE NOCASE",
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL::timestamptz as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = $2 
                       AND s.file_path LIKE $3 || '%'
                       AND s.file_path NOT LIKE $4 || '%/%'
                     ORDER BY LOWER(s.file_path), s.file_path",
                    [
                        Value::from(user_id),
                        Value::from(library_id),
                        Value::from(path_prefix.clone()),
                        Value::from(path_prefix),
                    ],
                )
                .await?);
            }
        }
    }

    Ok(vec![])
}

// ============================================================================
// Playlist Folder Helpers
// ============================================================================

/// Parses a path string like "Folder1/Folder2/Playlist Name" and:
/// 1. Creates any missing folders in the hierarchy
/// 2. Returns (folder_id, playlist_name) where folder_id is the deepest folder
///
/// If the path has no slashes, returns (None, full_path) for root placement.
pub async fn resolve_or_create_folder_path(
    database: &Database,
    path: &str,
    owner_id: i64,
) -> crate::error::Result<(Option<String>, String)> {
    if !path.contains('/') {
        return Ok((None, path.to_string()));
    }

    let parts: Vec<&str> = path.split('/').collect();
    if parts.is_empty() {
        return Ok((None, path.to_string()));
    }

    let playlist_name = parts.last().unwrap().to_string();
    let folder_parts = &parts[..parts.len() - 1];

    if folder_parts.is_empty() {
        return Ok((None, playlist_name));
    }

    #[derive(sea_orm::FromQueryResult)]
    struct IdRow {
        id: String,
    }

    let mut parent_id: Option<String> = None;

    for folder_name in folder_parts {
        if folder_name.is_empty() {
            continue;
        }

        let existing = raw::query_one::<IdRow>(
            database.conn(),
            "SELECT id FROM playlist_folders
             WHERE owner_id = ? AND name = ? AND
                   ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)",
            "SELECT id FROM playlist_folders
             WHERE owner_id = $1 AND name = $2 AND
                   ((parent_id IS NULL AND $3::text IS NULL) OR parent_id = $4)",
            [
                Value::from(owner_id),
                Value::from(folder_name.to_string()),
                Value::from(parent_id.clone()),
                Value::from(parent_id.clone()),
            ],
        )
        .await?;

        let folder_id = if let Some(row) = existing {
            row.id
        } else {
            let new_id = format!("pf-{}", Uuid::new_v4());

            let max_pos = raw::query_scalar::<i64>(
                database.conn(),
                "SELECT COALESCE(MAX(position), -1) FROM playlist_folders WHERE owner_id = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)",
                "SELECT COALESCE(MAX(position), -1) FROM playlist_folders WHERE owner_id = $1 AND ((parent_id IS NULL AND $2::text IS NULL) OR parent_id = $3)",
                [
                    Value::from(owner_id),
                    Value::from(parent_id.clone()),
                    Value::from(parent_id.clone()),
                ],
            )
            .await?
            .unwrap_or(-1);

            raw::execute(
                database.conn(),
                "INSERT INTO playlist_folders (id, name, parent_id, owner_id, position) VALUES (?, ?, ?, ?, ?)",
                "INSERT INTO playlist_folders (id, name, parent_id, owner_id, position) VALUES ($1, $2, $3, $4, $5)",
                [
                    Value::from(new_id.clone()),
                    Value::from(folder_name.to_string()),
                    Value::from(parent_id.clone()),
                    Value::from(owner_id),
                    Value::from(max_pos + 1),
                ],
            )
            .await?;

            new_id
        };

        parent_id = Some(folder_id);
    }

    Ok((parent_id, playlist_name))
}

/// Get the full folder path for a given folder_id by walking up the parent hierarchy.
/// Returns the path segments joined by '/' (e.g., "Folder1/Folder2").
/// Returns None if folder_id is None.
pub async fn get_folder_path(
    database: &Database,
    folder_id: Option<&str>,
) -> crate::error::Result<Option<String>> {
    let Some(folder_id) = folder_id else {
        return Ok(None);
    };

    #[derive(sea_orm::FromQueryResult)]
    struct FolderRow {
        name: String,
        parent_id: Option<String>,
    }

    let mut path_segments: Vec<String> = Vec::new();
    let mut current_id = Some(folder_id.to_string());

    while let Some(id) = current_id.as_ref() {
        let folder = raw::query_one::<FolderRow>(
            database.conn(),
            "SELECT name, parent_id FROM playlist_folders WHERE id = ?",
            "SELECT name, parent_id FROM playlist_folders WHERE id = $1",
            [Value::from(id.clone())],
        )
        .await?;

        match folder {
            Some(FolderRow { name, parent_id }) => {
                path_segments.push(name);
                current_id = parent_id;
            }
            None => {
                current_id = None;
            }
        }
    }

    if path_segments.is_empty() {
        return Ok(None);
    }

    path_segments.reverse();
    Ok(Some(path_segments.join("/")))
}

/// Builds the full playlist name including folder path prefix.
/// Returns "Folder1/Folder2/PlaylistName" if in a folder, or just "PlaylistName" if at root.
pub async fn get_playlist_full_name(
    database: &Database,
    name: &str,
    folder_id: Option<&str>,
) -> crate::error::Result<String> {
    match get_folder_path(database, folder_id).await? {
        Some(path) => Ok(format!("{}/{}", path, name)),
        None => Ok(name.to_string()),
    }
}

/// Delete orphaned queues — queues whose session has no matching playback_sessions
/// row and that haven't been updated in `older_than_days` days.
/// Skips subsonic save/restore queues (playqueue-*) as those are stateless.
pub async fn cleanup_orphaned_queues(
    database: &Database,
    older_than_days: i64,
) -> crate::error::Result<u64> {
    let entries_deleted = raw::execute(
        database.conn(),
        "DELETE FROM play_queue_entries WHERE session_id IN (
            SELECT pq.session_id FROM play_queues pq
            WHERE pq.session_id IS NOT NULL
              AND pq.session_id NOT LIKE 'playqueue-%'
              AND pq.session_id NOT IN (SELECT id FROM playback_sessions)
              AND pq.updated_at < datetime('now', '-' || ? || ' days')
        )",
        "DELETE FROM play_queue_entries WHERE session_id IN (
            SELECT pq.session_id FROM play_queues pq
            WHERE pq.session_id IS NOT NULL
              AND pq.session_id NOT LIKE 'playqueue-%'
              AND pq.session_id NOT IN (SELECT id FROM playback_sessions)
              AND pq.updated_at < NOW() - ($1 * INTERVAL '1 day')
        )",
        [Value::from(older_than_days)],
    )
    .await?;

    let queues_deleted = raw::execute(
        database.conn(),
        "DELETE FROM play_queues
         WHERE session_id IS NOT NULL
           AND session_id NOT LIKE 'playqueue-%'
           AND session_id NOT IN (SELECT id FROM playback_sessions)
           AND updated_at < datetime('now', '-' || ? || ' days')",
        "DELETE FROM play_queues
         WHERE session_id IS NOT NULL
           AND session_id NOT LIKE 'playqueue-%'
           AND session_id NOT IN (SELECT id FROM playback_sessions)
           AND updated_at < NOW() - ($1 * INTERVAL '1 day')",
        [Value::from(older_than_days)],
    )
    .await?;

    Ok(entries_deleted.rows_affected() + queues_deleted.rows_affected())
}
