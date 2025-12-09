use crate::db::models::*;
use sqlx::SqlitePool;
use uuid::Uuid;

// ============================================================================
// User queries
// ============================================================================

pub async fn get_user_by_username(pool: &SqlitePool, username: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = ?")
        .bind(username)
        .fetch_optional(pool)
        .await
}

pub async fn get_user_by_api_key(pool: &SqlitePool, token: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "SELECT u.* FROM users u 
         INNER JOIN api_keys a ON u.id = a.user_id 
         WHERE a.token = ?",
    )
    .bind(token)
    .fetch_optional(pool)
    .await
}

pub async fn create_user(
    pool: &SqlitePool,
    username: &str,
    password_hash: &str,
    subsonic_token: &str,
    email: Option<&str>,
    is_admin: bool,
) -> sqlx::Result<i64> {
    let result = sqlx::query(
        "INSERT INTO users (username, password_hash, subsonic_token, email, is_admin, created_at) 
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(username)
    .bind(password_hash)
    .bind(subsonic_token)
    .bind(email)
    .bind(is_admin)
    .execute(pool)
    .await?;

    Ok(result.last_insert_rowid())
}

pub async fn update_user_password(
    pool: &SqlitePool,
    username: &str,
    password_hash: &str,
    subsonic_token: &str,
) -> sqlx::Result<bool> {
    let result =
        sqlx::query("UPDATE users SET password_hash = ?, subsonic_token = ? WHERE username = ?")
            .bind(password_hash)
            .bind(subsonic_token)
            .bind(username)
            .execute(pool)
            .await?;

    Ok(result.rows_affected() > 0)
}

// User preferences queries
pub async fn get_user_preferences(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<Option<UserPreferences>> {
    sqlx::query_as::<_, UserPreferences>("SELECT * FROM user_preferences WHERE user_id = ?")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

pub async fn upsert_user_preferences(
    pool: &SqlitePool,
    user_id: i64,
    accent_color: &str,
    custom_accent_hue: Option<f64>,
    custom_accent_lightness: Option<f64>,
    custom_accent_chroma: Option<f64>,
    preferences_json: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO user_preferences (user_id, accent_color, custom_accent_hue, custom_accent_lightness, custom_accent_chroma, preferences_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           accent_color = excluded.accent_color,
           custom_accent_hue = excluded.custom_accent_hue,
           custom_accent_lightness = excluded.custom_accent_lightness,
           custom_accent_chroma = excluded.custom_accent_chroma,
           preferences_json = excluded.preferences_json,
           updated_at = datetime('now')",
    )
    .bind(user_id)
    .bind(accent_color)
    .bind(custom_accent_hue)
    .bind(custom_accent_lightness)
    .bind(custom_accent_chroma)
    .bind(preferences_json)
    .execute(pool)
    .await?;

    Ok(())
}

// Music folder queries
pub async fn get_music_folders(pool: &SqlitePool) -> sqlx::Result<Vec<MusicFolder>> {
    sqlx::query_as::<_, MusicFolder>("SELECT * FROM music_folders WHERE enabled = 1 ORDER BY id")
        .fetch_all(pool)
        .await
}

pub async fn create_music_folder(pool: &SqlitePool, name: &str, path: &str) -> sqlx::Result<i64> {
    let result = sqlx::query("INSERT INTO music_folders (name, path, enabled) VALUES (?, ?, 1)")
        .bind(name)
        .bind(path)
        .execute(pool)
        .await?;

    Ok(result.last_insert_rowid())
}

// Artist queries
pub async fn get_artists(pool: &SqlitePool) -> sqlx::Result<Vec<Artist>> {
    sqlx::query_as::<_, Artist>(
        "SELECT id, name, sort_name, album_count 
         FROM artists 
         ORDER BY COALESCE(sort_name, name) COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_artist_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Artist>> {
    sqlx::query_as::<_, Artist>("SELECT * FROM artists WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

// Album queries
pub async fn get_albums_by_artist(pool: &SqlitePool, artist_id: &str) -> sqlx::Result<Vec<Album>> {
    sqlx::query_as::<_, Album>(
        "SELECT a.*, ar.name as artist_name 
         FROM albums a 
         INNER JOIN artists ar ON a.artist_id = ar.id 
         WHERE a.artist_id = ? 
         ORDER BY a.year, a.name",
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
}

pub async fn get_album_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Album>> {
    sqlx::query_as::<_, Album>(
        "SELECT a.*, ar.name as artist_name 
         FROM albums a 
         INNER JOIN artists ar ON a.artist_id = ar.id 
         WHERE a.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// Song queries
pub async fn get_songs_by_album(pool: &SqlitePool, album_id: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.album_id = ? 
         ORDER BY s.disc_number, s.track_number, s.title",
    )
    .bind(album_id)
    .fetch_all(pool)
    .await
}

/// Get all songs by a specific artist
/// This returns:
/// 1. Songs from albums by this artist (album artist)
/// 2. Songs where the track artist matches (for compilations/features)
pub async fn get_songs_by_artist(pool: &SqlitePool, artist_id: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT DISTINCT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.artist_id = ? OR al.artist_id = ?
         ORDER BY s.album_id, s.disc_number, s.track_number, s.title",
    )
    .bind(artist_id)
    .bind(artist_id)
    .fetch_all(pool)
    .await
}

pub async fn get_song_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Get songs by a list of IDs, maintaining the order of the input IDs
pub async fn get_songs_by_ids(pool: &SqlitePool, ids: &[String]) -> sqlx::Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Build the placeholder string for the IN clause
    let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
    let placeholder_str = placeholders.join(", ");

    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id IN ({})",
        placeholder_str
    );

    let mut query_builder = sqlx::query_as::<_, Song>(&query);
    for id in ids {
        query_builder = query_builder.bind(id);
    }

    let songs: Vec<Song> = query_builder.fetch_all(pool).await?;

    // Reorder songs to match the input ID order
    // Create a lookup map from id -> song
    let song_map: std::collections::HashMap<String, Song> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();

    // Return songs in the order of the input IDs
    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get a song by ID with its music folder path for full filesystem path construction
pub async fn get_song_by_id_with_folder(
    pool: &SqlitePool,
    id: &str,
) -> sqlx::Result<Option<SongWithFolder>> {
    sqlx::query_as::<_, SongWithFolder>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name, mf.path as folder_path
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// Playlist queries

/// Get all playlists visible to a user (their own + public playlists)
pub async fn get_playlists_for_user(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<Vec<Playlist>> {
    sqlx::query_as::<_, Playlist>(
        "SELECT * FROM playlists 
         WHERE owner_id = ? OR is_public = 1
         ORDER BY name COLLATE NOCASE",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Get a playlist by ID
pub async fn get_playlist_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Playlist>> {
    sqlx::query_as::<_, Playlist>("SELECT * FROM playlists WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Get songs in a playlist, ordered by position (includes play stats for sorting)
pub async fn get_playlist_songs(pool: &SqlitePool, playlist_id: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = ?
         ORDER BY ps.position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await
}

/// Get songs in a playlist with their original positions (for queue materialization)
/// Returns tuples of (position, song) where position is the original playlist position
/// This is needed to correctly map start_index when playlists have missing entries
pub async fn get_playlist_songs_with_positions(
    pool: &SqlitePool,
    playlist_id: &str,
) -> sqlx::Result<Vec<(i64, Song)>> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT ps.position, s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = ? AND ps.song_id IS NOT NULL
         ORDER BY ps.position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let position: i64 = row.get("position");
            let song = Song {
                id: row.get("id"),
                title: row.get("title"),
                album_id: row.get("album_id"),
                album_name: row.get("album_name"),
                artist_id: row.get("artist_id"),
                artist_name: row.get("artist_name"),
                track_number: row.get("track_number"),
                disc_number: row.get("disc_number"),
                year: row.get("year"),
                genre: row.get("genre"),
                duration: row.get("duration"),
                bitrate: row.get("bitrate"),
                file_path: row.get("file_path"),
                file_size: row.get("file_size"),
                file_format: row.get("file_format"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                play_count: row.get("play_count"),
                last_played: row.get("last_played"),
                starred_at: None,
            };
            (position, song)
        })
        .collect())
}

/// Get unique album IDs from the first N songs in a playlist (for cover art)
pub async fn get_playlist_album_ids(
    pool: &SqlitePool,
    playlist_id: &str,
    limit: i32,
) -> sqlx::Result<Vec<String>> {
    // Get distinct album IDs from playlist songs, maintaining order
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT s.album_id
         FROM songs s
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         WHERE ps.playlist_id = ? AND s.album_id IS NOT NULL
         ORDER BY ps.position
         LIMIT ?",
    )
    .bind(playlist_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Create a new playlist
pub async fn create_playlist(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    owner_id: i64,
    comment: Option<&str>,
    is_public: bool,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO playlists (id, name, comment, owner_id, is_public, song_count, duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))"
    )
    .bind(id)
    .bind(name)
    .bind(comment)
    .bind(owner_id)
    .bind(is_public)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update playlist metadata
pub async fn update_playlist_metadata(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    comment: Option<&str>,
    is_public: Option<bool>,
) -> sqlx::Result<()> {
    // Build dynamic update query based on what's provided
    let mut updates = vec!["updated_at = datetime('now')"];

    if name.is_some() {
        updates.push("name = ?");
    }
    if comment.is_some() {
        updates.push("comment = ?");
    }
    if is_public.is_some() {
        updates.push("is_public = ?");
    }

    let query = format!("UPDATE playlists SET {} WHERE id = ?", updates.join(", "));
    let mut q = sqlx::query(&query);

    if let Some(n) = name {
        q = q.bind(n);
    }
    if let Some(c) = comment {
        q = q.bind(c);
    }
    if let Some(p) = is_public {
        q = q.bind(p);
    }
    q = q.bind(id);

    q.execute(pool).await?;
    Ok(())
}

/// Add songs to end of playlist
pub async fn add_songs_to_playlist(
    pool: &SqlitePool,
    playlist_id: &str,
    song_ids: &[String],
) -> sqlx::Result<()> {
    if song_ids.is_empty() {
        return Ok(());
    }

    // Get current max position
    let max_pos: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?",
    )
    .bind(playlist_id)
    .fetch_one(pool)
    .await?;

    let mut position = max_pos.0 + 1;

    for song_id in song_ids {
        sqlx::query("INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)")
            .bind(playlist_id)
            .bind(song_id)
            .bind(position)
            .execute(pool)
            .await?;
        position += 1;
    }

    // Update playlist totals
    update_playlist_totals(pool, playlist_id).await?;

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
    pool: &SqlitePool,
    playlist_id: &str,
    entries: &[PlaylistEntry],
) -> sqlx::Result<()> {
    if entries.is_empty() {
        return Ok(());
    }

    // Get current max position
    let max_pos: (i64,) = sqlx::query_as(
        "SELECT COALESCE(MAX(position), -1) FROM playlist_songs WHERE playlist_id = ?",
    )
    .bind(playlist_id)
    .fetch_one(pool)
    .await?;

    let mut position = max_pos.0 + 1;

    for entry in entries {
        let missing_json = entry
            .missing_entry_data
            .as_ref()
            .map(|data| serde_json::to_string(data).unwrap_or_default());

        sqlx::query(
            "INSERT INTO playlist_songs (playlist_id, song_id, position, missing_entry_data, missing_search_text) VALUES (?, ?, ?, ?, ?)"
        )
            .bind(playlist_id)
            .bind(&entry.song_id)
            .bind(position)
            .bind(&missing_json)
            .bind(&entry.missing_search_text)
            .execute(pool)
            .await?;
        position += 1;
    }

    // Update playlist totals
    update_playlist_totals(pool, playlist_id).await?;

    Ok(())
}

/// Get all playlist entries including missing entries
pub async fn get_playlist_entries(
    pool: &SqlitePool,
    playlist_id: &str,
) -> sqlx::Result<Vec<PlaylistSong>> {
    sqlx::query_as::<_, PlaylistSong>(
        "SELECT playlist_id, song_id, position, missing_entry_data 
         FROM playlist_songs 
         WHERE playlist_id = ? 
         ORDER BY position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await
}

/// Update a missing entry to link it to a matched song
pub async fn match_missing_entry(
    pool: &SqlitePool,
    playlist_id: &str,
    position: i32,
    song_id: &str,
) -> sqlx::Result<()> {
    // Set song_id but preserve missing_entry_data so we can re-match if needed
    // Only clear missing_search_text since we no longer need to search for it
    sqlx::query(
        "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND position = ?"
    )
    .bind(song_id)
    .bind(playlist_id)
    .bind(position)
    .execute(pool)
    .await?;

    // Update playlist totals (duration may change)
    update_playlist_totals(pool, playlist_id).await?;

    Ok(())
}

/// Remove songs from playlist by position indices
pub async fn remove_songs_by_position(
    pool: &SqlitePool,
    playlist_id: &str,
    positions: &[u32],
) -> sqlx::Result<()> {
    if positions.is_empty() {
        return Ok(());
    }

    // Delete songs at specified positions
    for pos in positions {
        sqlx::query("DELETE FROM playlist_songs WHERE playlist_id = ? AND position = ?")
            .bind(playlist_id)
            .bind(*pos as i64)
            .execute(pool)
            .await?;
    }

    // Reindex positions to remove gaps
    reindex_playlist_positions(pool, playlist_id).await?;

    // Update playlist totals
    update_playlist_totals(pool, playlist_id).await?;

    Ok(())
}

/// Reindex playlist positions to be sequential (0, 1, 2, ...)
async fn reindex_playlist_positions(pool: &SqlitePool, playlist_id: &str) -> sqlx::Result<()> {
    // Get all entries in current order (use position as identifier since song_id can be null)
    let entries: Vec<(i64,)> = sqlx::query_as(
        "SELECT position FROM playlist_songs WHERE playlist_id = ? ORDER BY position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    // Update each with new sequential position using old position as key
    for (new_pos, (old_pos,)) in entries.iter().enumerate() {
        if new_pos as i64 != *old_pos {
            sqlx::query(
                "UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND position = ?",
            )
            .bind(new_pos as i64)
            .bind(playlist_id)
            .bind(old_pos)
            .execute(pool)
            .await?;
        }
    }

    Ok(())
}

/// Update playlist song_count and duration from its songs
async fn update_playlist_totals(pool: &SqlitePool, playlist_id: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = ?),
            updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete a playlist (cascade deletes playlist_songs)
pub async fn delete_playlist(pool: &SqlitePool, id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM playlists WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete a song from the database
/// This also:
/// - Deletes the song from playlists (CASCADE)
/// - Deletes scrobbles for the song (CASCADE)
/// - Deletes starred entries for the song
/// - Cleans up FTS entries via trigger
/// - Updates album song_count
pub async fn delete_song(pool: &SqlitePool, id: &str) -> sqlx::Result<bool> {
    // Get album_id before deleting so we can update album counts
    let album_id: Option<(Option<String>,)> =
        sqlx::query_as("SELECT album_id FROM songs WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    // Delete starred entries for this song
    sqlx::query("DELETE FROM starred WHERE item_type = 'song' AND item_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // Delete the song (cascades to playlist_songs, scrobbles, FTS trigger)
    let result = sqlx::query("DELETE FROM songs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    // Update album song count if song had an album
    if let Some((Some(album_id),)) = album_id {
        sqlx::query(
            "UPDATE albums SET 
                song_count = (SELECT COUNT(*) FROM songs WHERE album_id = ?),
                duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = ?)
             WHERE id = ?",
        )
        .bind(&album_id)
        .bind(&album_id)
        .bind(&album_id)
        .execute(pool)
        .await?;
    }

    // Update all playlists that contained this song
    sqlx::query(
        "UPDATE playlists SET 
            song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id),
            duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s 
                        INNER JOIN playlist_songs ps ON s.id = ps.song_id 
                        WHERE ps.playlist_id = playlists.id),
            updated_at = datetime('now')",
    )
    .execute(pool)
    .await?;

    Ok(true)
}

// ============================================================================
// Play Queue queries (server-side queue management)
// ============================================================================

/// Get the current play queue for a user
pub async fn get_play_queue(pool: &SqlitePool, user_id: i64) -> sqlx::Result<Option<PlayQueue>> {
    sqlx::query_as::<_, PlayQueue>("SELECT * FROM play_queues WHERE user_id = ?")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// Get the total number of songs in a user's queue
pub async fn get_queue_length(pool: &SqlitePool, user_id: i64) -> sqlx::Result<i64> {
    let result: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM play_queue_entries WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    Ok(result.0)
}

/// Get queue entries with pagination (returns songs in queue order)
pub async fn get_queue_entries_paginated(
    pool: &SqlitePool,
    user_id: i64,
    offset: i64,
    limit: i64,
) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.user_id = ?
         ORDER BY pqe.queue_position ASC
         LIMIT ? OFFSET ?",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Get queue entries with full song data including entry_id (for API responses)
pub async fn get_queue_entries_with_songs(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<Vec<QueueEntryWithSong>> {
    sqlx::query_as::<_, QueueEntryWithSong>(
        "SELECT pqe.entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.user_id = ?
         ORDER BY pqe.queue_position ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Get all song IDs in queue order (for shuffle operations)
pub async fn get_queue_song_ids(pool: &SqlitePool, user_id: i64) -> sqlx::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT song_id FROM play_queue_entries WHERE user_id = ? ORDER BY queue_position",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Create or replace the play queue for a user
pub async fn create_queue(
    pool: &SqlitePool,
    user_id: i64,
    source_type: &str,
    source_id: Option<&str>,
    source_name: Option<&str>,
    song_ids: &[String],
    current_index: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    repeat_mode: &str,
    filters_json: Option<&str>,
    sort_json: Option<&str>,
    changed_by: &str,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    // Delete existing queue entries
    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Insert new queue entries
    for (position, song_id) in song_ids.iter().enumerate() {
        let entry_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id) VALUES (?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(song_id)
        .bind(position as i64)
        .bind(&entry_id)
        .execute(&mut *tx)
        .await?;
    }

    // Upsert queue metadata
    sqlx::query(
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index, 
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
         ON CONFLICT(user_id) DO UPDATE SET
           source_type = excluded.source_type,
           source_id = excluded.source_id,
           source_name = excluded.source_name,
           current_index = excluded.current_index,
           position_ms = 0,
           is_shuffled = excluded.is_shuffled,
           shuffle_seed = excluded.shuffle_seed,
           shuffle_indices_json = excluded.shuffle_indices_json,
           repeat_mode = excluded.repeat_mode,
           filters_json = excluded.filters_json,
           sort_json = excluded.sort_json,
           updated_at = datetime('now'),
           changed_by = excluded.changed_by",
    )
    .bind(user_id)
    .bind(source_type)
    .bind(source_id)
    .bind(source_name)
    .bind(current_index)
    .bind(is_shuffled)
    .bind(shuffle_seed)
    .bind(shuffle_indices_json)
    .bind(repeat_mode)
    .bind(filters_json)
    .bind(sort_json)
    .bind(changed_by)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Update queue current position
pub async fn update_queue_position(
    pool: &SqlitePool,
    user_id: i64,
    current_index: i64,
    position_ms: i64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET current_index = ?, position_ms = ?, updated_at = datetime('now')
         WHERE user_id = ?",
    )
    .bind(current_index)
    .bind(position_ms)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue shuffle state
pub async fn update_queue_shuffle(
    pool: &SqlitePool,
    user_id: i64,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    current_index: i64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET 
         is_shuffled = ?, shuffle_seed = ?, shuffle_indices_json = ?, 
         current_index = ?, updated_at = datetime('now')
         WHERE user_id = ?",
    )
    .bind(is_shuffled)
    .bind(shuffle_seed)
    .bind(shuffle_indices_json)
    .bind(current_index)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue repeat mode
pub async fn update_queue_repeat_mode(
    pool: &SqlitePool,
    user_id: i64,
    repeat_mode: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET repeat_mode = ?, updated_at = datetime('now') WHERE user_id = ?",
    )
    .bind(repeat_mode)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Add songs to queue at a specific position
/// Returns the new queue length
pub async fn add_to_queue(
    pool: &SqlitePool,
    user_id: i64,
    song_ids: &[String],
    position: i64, // -1 means end, 0+ means insert at that position
) -> sqlx::Result<i64> {
    if song_ids.is_empty() {
        return get_queue_length(pool, user_id).await;
    }

    let mut tx = pool.begin().await?;

    // Get current queue length
    let (queue_len,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM play_queue_entries WHERE user_id = ?")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;

    // Determine insert position
    let insert_pos = if position < 0 { queue_len } else { position };

    // Shift existing entries if inserting in the middle
    if insert_pos < queue_len {
        sqlx::query(
            "UPDATE play_queue_entries 
             SET queue_position = queue_position + ? 
             WHERE user_id = ? AND queue_position >= ?",
        )
        .bind(song_ids.len() as i64)
        .bind(user_id)
        .bind(insert_pos)
        .execute(&mut *tx)
        .await?;
    }

    // Insert new entries
    for (i, song_id) in song_ids.iter().enumerate() {
        let entry_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id) VALUES (?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(song_id)
        .bind(insert_pos + i as i64)
        .bind(&entry_id)
        .execute(&mut *tx)
        .await?;
    }

    // Update queue timestamp
    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(queue_len + song_ids.len() as i64)
}

/// Remove a song from queue at a specific position
/// Returns true if successful, adjusts subsequent positions
pub async fn remove_from_queue(
    pool: &SqlitePool,
    user_id: i64,
    position: i64,
) -> sqlx::Result<bool> {
    let mut tx = pool.begin().await?;

    // Delete the entry at the specified position
    let result =
        sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ? AND queue_position = ?")
            .bind(user_id)
            .bind(position)
            .execute(&mut *tx)
            .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    // Shift subsequent entries down
    sqlx::query(
        "UPDATE play_queue_entries 
         SET queue_position = queue_position - 1 
         WHERE user_id = ? AND queue_position > ?",
    )
    .bind(user_id)
    .bind(position)
    .execute(&mut *tx)
    .await?;

    // Update queue timestamp
    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Move a song from one position to another in the queue
pub async fn move_in_queue(
    pool: &SqlitePool,
    user_id: i64,
    from_position: i64,
    to_position: i64,
) -> sqlx::Result<bool> {
    if from_position == to_position {
        return Ok(true);
    }

    let mut tx = pool.begin().await?;

    // Check if from_position exists
    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM play_queue_entries WHERE user_id = ? AND queue_position = ?")
            .bind(user_id)
            .bind(from_position)
            .fetch_optional(&mut *tx)
            .await?;

    if exists.is_none() {
        return Ok(false);
    }

    // Use a temporary negative position to avoid UNIQUE constraint conflicts during shift
    // We move the entry to a temporary position, shift others, then move it to final position
    let temp_position = -1i64;

    // Move the entry to temporary position
    sqlx::query(
        "UPDATE play_queue_entries SET queue_position = ? WHERE user_id = ? AND queue_position = ?",
    )
    .bind(temp_position)
    .bind(user_id)
    .bind(from_position)
    .execute(&mut *tx)
    .await?;

    // Shift entries between from and to
    if from_position < to_position {
        // Moving down: shift entries up (decrement)
        // Process from lowest to highest to avoid conflicts
        sqlx::query(
            "UPDATE play_queue_entries 
             SET queue_position = queue_position - 1 
             WHERE user_id = ? AND queue_position > ? AND queue_position <= ?",
        )
        .bind(user_id)
        .bind(from_position)
        .bind(to_position)
        .execute(&mut *tx)
        .await?;
    } else {
        // Moving up: shift entries down (increment)
        // Process from highest to lowest to avoid conflicts
        // We need to iterate manually to ensure ordering
        let positions: Vec<(i64,)> = sqlx::query_as(
            "SELECT queue_position FROM play_queue_entries 
             WHERE user_id = ? AND queue_position >= ? AND queue_position < ?
             ORDER BY queue_position DESC",
        )
        .bind(user_id)
        .bind(to_position)
        .bind(from_position)
        .fetch_all(&mut *tx)
        .await?;

        for (pos,) in positions {
            sqlx::query(
                "UPDATE play_queue_entries 
                 SET queue_position = queue_position + 1 
                 WHERE user_id = ? AND queue_position = ?",
            )
            .bind(user_id)
            .bind(pos)
            .execute(&mut *tx)
            .await?;
        }
    }

    // Move the entry from temporary position to final position
    sqlx::query(
        "UPDATE play_queue_entries SET queue_position = ? WHERE user_id = ? AND queue_position = ?",
    )
    .bind(to_position)
    .bind(user_id)
    .bind(temp_position)
    .execute(&mut *tx)
    .await?;

    // Update queue timestamp
    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Clear the entire queue for a user
pub async fn clear_queue(pool: &SqlitePool, user_id: i64) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM play_queue_entries WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM play_queues WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

// ============================================================================
// Queue source materialization helpers
// ============================================================================

/// Get all songs from the library (all songs)
pub async fn get_all_songs(pool: &SqlitePool) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         ORDER BY s.title COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
}

/// Get starred songs for a user (includes play stats for sorting)
pub async fn get_starred_songs(pool: &SqlitePool, user_id: i64) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, st.starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN starred st ON st.item_id = s.id AND st.item_type = 'song'
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE st.user_id = ?
         ORDER BY st.starred_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Get songs by genre (includes play stats for sorting)
pub async fn get_songs_by_genre(pool: &SqlitePool, genre: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.genre = ?
         ORDER BY s.title COLLATE NOCASE",
    )
    .bind(genre)
    .fetch_all(pool)
    .await
}

/// Get songs recursively under a directory path (includes play stats for sorting)
pub async fn get_songs_by_directory(pool: &SqlitePool, path: &str) -> sqlx::Result<Vec<Song>> {
    // Normalize path: if it's a dir- prefixed ID, extract the path
    let actual_path = path
        .strip_prefix("dir-")
        .map(|p| urlencoding::decode(p).unwrap_or_default().into_owned())
        .unwrap_or_else(|| path.to_string());

    // Build path prefix for matching (add trailing slash for non-empty paths)
    let path_prefix = if actual_path.is_empty() {
        String::new()
    } else {
        format!("{}/", actual_path.trim_end_matches('/'))
    };

    // For root (empty path), match all songs; otherwise match songs starting with the path
    if path_prefix.is_empty() {
        sqlx::query_as::<_, Song>(
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
             ORDER BY s.file_path COLLATE NOCASE",
        )
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, Song>(
            "SELECT s.*, ar.name as artist_name, al.name as album_name,
                    pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s
             INNER JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                        FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
             WHERE s.file_path LIKE ? || '%'
             ORDER BY s.file_path COLLATE NOCASE",
        )
        .bind(&path_prefix)
        .fetch_all(pool)
        .await
    }
}
