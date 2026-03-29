// Some query functions are defined for completeness and future use
#![allow(dead_code)]

use crate::db::models::*;
use sqlx::SqlitePool;
use uuid::Uuid;

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

pub async fn get_music_folders_for_user(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<Vec<MusicFolder>> {
    sqlx::query_as::<_, MusicFolder>(
        "SELECT mf.*
         FROM music_folders mf
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE mf.enabled = 1 AND ula.user_id = ?
         ORDER BY mf.id",
    )
    .bind(user_id)
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
        "SELECT id, name, sort_name, album_count, song_count, cover_art_hash 
         FROM artists 
         WHERE EXISTS (
             SELECT 1 FROM songs s 
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id 
             WHERE s.artist_id = artists.id AND mf.enabled = 1
         )
         ORDER BY COALESCE(sort_name, name) COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_artists_for_user(pool: &SqlitePool, user_id: i64) -> sqlx::Result<Vec<Artist>> {
    sqlx::query_as::<_, Artist>(
        "SELECT id, name, sort_name, album_count, song_count, cover_art_hash
         FROM artists
         WHERE EXISTS (
             SELECT 1 FROM songs s
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE s.artist_id = artists.id AND mf.enabled = 1 AND ula.user_id = ?
         )
         ORDER BY COALESCE(sort_name, name) COLLATE NOCASE",
    )
    .bind(user_id)
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
           AND EXISTS (
               SELECT 1 FROM songs s 
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id 
               WHERE s.album_id = a.id AND mf.enabled = 1
           )
         ORDER BY a.year, a.name COLLATE NOCASE",
    )
    .bind(artist_id)
    .fetch_all(pool)
    .await
}

pub async fn get_albums_by_artist_for_user(
    pool: &SqlitePool,
    artist_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Album>> {
    sqlx::query_as::<_, Album>(
        "SELECT a.*, ar.name as artist_name
         FROM albums a
         INNER JOIN artists ar ON a.artist_id = ar.id
         WHERE a.artist_id = ?
           AND EXISTS (
               SELECT 1 FROM songs s
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id
               INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
               WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?
           )
         ORDER BY a.year, a.name COLLATE NOCASE",
    )
    .bind(artist_id)
    .bind(user_id)
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
    let query = format!(
        "{} AND s.album_id = ? ORDER BY s.disc_number, s.track_number, s.title COLLATE NOCASE",
        SONG_BASE_QUERY_WITH_SCROBBLES
    );
    sqlx::query_as::<_, Song>(&query)
        .bind(album_id)
        .fetch_all(pool)
        .await
}

pub async fn get_songs_by_album_for_user(
    pool: &SqlitePool,
    album_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.marked_for_deletion_at IS NULL
           AND s.album_id = ? AND mf.enabled = 1 AND ula.user_id = ?
         ORDER BY s.disc_number, s.track_number, s.title COLLATE NOCASE",
    )
    .bind(user_id)
    .bind(album_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Get all songs by a specific artist
/// This returns:
/// 1. Songs from albums by this artist (album artist)
/// 2. Songs where the track artist matches (for compilations/features)
pub async fn get_songs_by_artist(pool: &SqlitePool, artist_id: &str) -> sqlx::Result<Vec<Song>> {
    let query = "SELECT DISTINCT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.marked_for_deletion_at IS NULL AND (s.artist_id = ? OR al.artist_id = ?)
         ORDER BY s.album_id, s.disc_number, s.track_number, s.title COLLATE NOCASE";
    sqlx::query_as::<_, Song>(query)
        .bind(artist_id)
        .bind(artist_id)
        .fetch_all(pool)
        .await
}

pub async fn get_songs_by_artist_for_user(
    pool: &SqlitePool,
    artist_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    let query = "SELECT DISTINCT s.*, ar.name as artist_name, al.name as album_name,
                                pc.play_count, pc.last_played, NULL as starred_at
                 FROM songs s
                 INNER JOIN artists ar ON s.artist_id = ar.id
                 LEFT JOIN albums al ON s.album_id = al.id
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
                                        FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                 WHERE s.marked_for_deletion_at IS NULL
                     AND mf.enabled = 1
                     AND ula.user_id = ?
                     AND (s.artist_id = ? OR al.artist_id = ?)
                 ORDER BY s.album_id, s.disc_number, s.track_number, s.title COLLATE NOCASE";
    sqlx::query_as::<_, Song>(query)
        .bind(user_id)
        .bind(user_id)
        .bind(artist_id)
        .bind(artist_id)
        .fetch_all(pool)
        .await
}

pub async fn get_song_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Song>> {
    let query = format!("{} AND s.id = ?", SONG_BASE_QUERY);
    sqlx::query_as::<_, Song>(&query)
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Get songs by a list of IDs, maintaining the order of the input IDs
/// Only returns songs from enabled music folders.
pub async fn get_songs_by_ids(pool: &SqlitePool, ids: &[String]) -> sqlx::Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Build the placeholder string for the IN clause
    let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
    let placeholder_str = placeholders.join(", ");

    // Build query with JOINs before WHERE clause
    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.marked_for_deletion_at IS NULL
           AND s.id IN ({})
           AND mf.enabled = 1",
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

pub async fn get_songs_by_ids_for_user(
    pool: &SqlitePool,
    ids: &[String],
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
    let placeholder_str = placeholders.join(", ");

    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE s.marked_for_deletion_at IS NULL
           AND s.id IN ({})
           AND mf.enabled = 1 AND ula.user_id = ?",
        placeholder_str
    );

    let mut query_builder = sqlx::query_as::<_, Song>(&query);
    for id in ids {
        query_builder = query_builder.bind(id);
    }
    query_builder = query_builder.bind(user_id);

    let songs: Vec<Song> = query_builder.fetch_all(pool).await?;

    let song_map: std::collections::HashMap<String, Song> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();

    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get songs by a list of IDs with their library enabled status.
/// Returns songs from ALL music folders (including disabled ones).
/// The `library_enabled` flag indicates whether the song can be played.
pub async fn get_songs_by_ids_with_library_status(
    pool: &SqlitePool,
    ids: &[String],
    user_id: i64,
) -> sqlx::Result<Vec<SongWithLibraryStatus>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Build the placeholder string for the IN clause
    let placeholders: Vec<&str> = ids.iter().map(|_| "?").collect();
    let placeholder_str = placeholders.join(", ");

    // Include library_enabled status from music_folders and scrobble stats
    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name, mf.enabled as library_enabled,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.id IN ({})",
        placeholder_str
    );

    let mut query_builder = sqlx::query_as::<_, SongWithLibraryStatus>(&query).bind(user_id);
    for id in ids {
        query_builder = query_builder.bind(id);
    }

    let songs: Vec<SongWithLibraryStatus> = query_builder.fetch_all(pool).await?;

    // Reorder songs to match the input ID order
    let song_map: std::collections::HashMap<String, SongWithLibraryStatus> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();

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
            OR id IN (SELECT playlist_id FROM playlist_shares WHERE shared_with_user_id = ?)
         ORDER BY name COLLATE NOCASE",
    )
    .bind(user_id)
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
pub async fn get_playlist_songs(
    pool: &SqlitePool,
    playlist_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
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
    )
    .bind(user_id)
    .bind(playlist_id)
    .fetch_all(pool)
    .await
}

/// Get songs in a playlist with their original positions (for queue materialization)
/// Returns tuples of (position, entry_id, song) where position is the original playlist position
/// and entry_id is the stable playlist entry identifier.
/// This is needed to correctly map start_index when playlists have missing entries,
/// and to track the original playlist entry for "now playing" indicators.
pub async fn get_playlist_songs_with_positions(
    pool: &SqlitePool,
    playlist_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<(i64, String, Song)>> {
    use sqlx::Row;

    let rows = sqlx::query(
        "SELECT ps.position, ps.entry_id as playlist_entry_id, s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE ps.playlist_id = ? AND ps.song_id IS NOT NULL
         ORDER BY ps.position",
    )
    .bind(user_id)
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let position: i64 = row.get("position");
            let playlist_entry_id: Option<String> = row.get("playlist_entry_id");
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
                cover_art_hash: row.get("cover_art_hash"),
                cover_art_width: row.get("cover_art_width"),
                cover_art_height: row.get("cover_art_height"),
                original_replaygain_track_gain: row.get("original_replaygain_track_gain"),
                original_replaygain_track_peak: row.get("original_replaygain_track_peak"),
                computed_replaygain_track_gain: row.get("computed_replaygain_track_gain"),
                computed_replaygain_track_peak: row.get("computed_replaygain_track_peak"),
            };
            (position, playlist_entry_id.unwrap_or_default(), song)
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
    folder_id: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO playlists (id, name, comment, owner_id, is_public, folder_id, song_count, duration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))"
    )
    .bind(id)
    .bind(name)
    .bind(comment)
    .bind(owner_id)
    .bind(is_public)
    .bind(folder_id)
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
        let entry_id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO playlist_songs (playlist_id, song_id, position, added_at, entry_id) VALUES (?, ?, ?, datetime('now'), ?)")
            .bind(playlist_id)
            .bind(song_id)
            .bind(position)
            .bind(&entry_id)
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

        let entry_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO playlist_songs (playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)"
        )
            .bind(playlist_id)
            .bind(&entry.song_id)
            .bind(position)
            .bind(&missing_json)
            .bind(&entry.missing_search_text)
            .bind(&entry_id)
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
        "SELECT playlist_id, song_id, position, missing_entry_data, entry_id 
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

/// Unmatch a previously matched entry - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry(
    pool: &SqlitePool,
    playlist_id: &str,
    position: i32,
) -> sqlx::Result<()> {
    use crate::db::models::MissingEntryData;

    // First get the missing_entry_data to rebuild search text
    let (missing_json,): (Option<String>,) = sqlx::query_as(
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = ? AND position = ?",
    )
    .bind(playlist_id)
    .bind(position)
    .fetch_one(pool)
    .await?;

    // Build search text from the missing entry data
    let search_text = missing_json
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| {
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
        });

    // Set song_id to NULL and restore missing_search_text
    sqlx::query(
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = ? WHERE playlist_id = ? AND position = ?",
    )
    .bind(search_text)
    .bind(playlist_id)
    .bind(position)
    .execute(pool)
    .await?;

    // Update playlist totals
    update_playlist_totals(pool, playlist_id).await?;

    Ok(())
}

/// Update a missing entry to link it to a matched song, using entry_id for identification
pub async fn match_missing_entry_by_id(
    pool: &SqlitePool,
    playlist_id: &str,
    entry_id: &str,
    song_id: &str,
) -> sqlx::Result<bool> {
    // Set song_id but preserve missing_entry_data so we can re-match if needed
    // Only clear missing_search_text since we no longer need to search for it
    let result = sqlx::query(
        "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND entry_id = ?"
    )
    .bind(song_id)
    .bind(playlist_id)
    .bind(entry_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    // Update playlist totals (duration may change)
    update_playlist_totals(pool, playlist_id).await?;

    Ok(true)
}

/// Batch match multiple missing entries to songs
/// Returns the number of successfully matched entries
pub async fn batch_match_entries(
    pool: &SqlitePool,
    playlist_id: &str,
    matches: &[(String, String)], // Vec of (entry_id, song_id)
) -> sqlx::Result<usize> {
    if matches.is_empty() {
        return Ok(0);
    }

    let mut success_count = 0;

    for (entry_id, song_id) in matches {
        let result = sqlx::query(
            "UPDATE playlist_songs SET song_id = ?, missing_search_text = NULL WHERE playlist_id = ? AND entry_id = ?"
        )
        .bind(song_id)
        .bind(playlist_id)
        .bind(entry_id)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            success_count += 1;
        }
    }

    // Update playlist totals once at the end
    update_playlist_totals(pool, playlist_id).await?;

    Ok(success_count)
}

/// Unmatch a previously matched entry by entry_id - sets song_id back to NULL
/// while preserving the missing_entry_data for re-matching later.
/// Also restores missing_search_text for searching.
pub async fn unmatch_entry_by_id(
    pool: &SqlitePool,
    playlist_id: &str,
    entry_id: &str,
) -> sqlx::Result<bool> {
    use crate::db::models::MissingEntryData;

    // First get the missing_entry_data to rebuild search text
    let result: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT missing_entry_data FROM playlist_songs WHERE playlist_id = ? AND entry_id = ?",
    )
    .bind(playlist_id)
    .bind(entry_id)
    .fetch_optional(pool)
    .await?;

    let Some((missing_json,)) = result else {
        return Ok(false);
    };

    // Build search text from the missing entry data
    let search_text = missing_json
        .as_ref()
        .and_then(|json| serde_json::from_str::<MissingEntryData>(json).ok())
        .map(|data| {
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
        });

    // Set song_id to NULL and restore missing_search_text
    sqlx::query(
        "UPDATE playlist_songs SET song_id = NULL, missing_search_text = ? WHERE playlist_id = ? AND entry_id = ?",
    )
    .bind(search_text)
    .bind(playlist_id)
    .bind(entry_id)
    .execute(pool)
    .await?;

    // Update playlist totals
    update_playlist_totals(pool, playlist_id).await?;

    Ok(true)
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
pub async fn delete_song(pool: &SqlitePool, id: &str) -> sqlx::Result<bool> {
    // Get song metadata before deleting so we can preserve it in playlist entries
    let song_meta: Option<(String, Option<String>, Option<String>, i64)> = sqlx::query_as(
        "SELECT s.title, ar.name as artist_name, al.name as album_name, s.duration
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let Some((title, artist_name, album_name, duration)) = song_meta else {
        return Ok(false);
    };

    // Get album_id before deleting so we can update album counts
    let album_id: Option<(Option<String>,)> =
        sqlx::query_as("SELECT album_id FROM songs WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    // Build the missing entry data JSON
    let missing_data = serde_json::json!({
        "title": title,
        "artist": artist_name,
        "album": album_name,
        "duration": duration as i32,
        "raw": format!("{} - {}", artist_name.as_deref().unwrap_or("Unknown Artist"), title)
    });
    let missing_json = serde_json::to_string(&missing_data).unwrap_or_default();

    // Build search text: "artist - album - title" for filtering
    let mut parts = Vec::new();
    if let Some(ref a) = artist_name {
        parts.push(a.as_str());
    }
    if let Some(ref al) = album_name {
        parts.push(al.as_str());
    }
    parts.push(title.as_str());
    let search_text = parts.join(" - ");

    // Run all mutations in a single transaction for consistency
    let mut tx = pool.begin().await?;

    // Get affected playlist IDs before mutating (for batch update below)
    let affected_playlist_ids: Vec<(String,)> =
        sqlx::query_as("SELECT DISTINCT playlist_id FROM playlist_songs WHERE song_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;

    // Convert playlist entries to "missing" entries (song_id becomes NULL, metadata preserved)
    sqlx::query(
        "UPDATE playlist_songs SET song_id = NULL, missing_entry_data = ?, missing_search_text = ? WHERE song_id = ?"
    )
    .bind(&missing_json)
    .bind(&search_text)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    // Delete starred entries for this song
    sqlx::query("DELETE FROM starred WHERE item_type = 'song' AND item_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Delete the song (scrobbles cascade, FTS trigger cleans up)
    let result = sqlx::query("DELETE FROM songs WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    if result.rows_affected() == 0 {
        tx.rollback().await?;
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
        .execute(&mut *tx)
        .await?;
    }

    // Batch-update totals for all affected playlists in a single query
    if !affected_playlist_ids.is_empty() {
        let placeholders = affected_playlist_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "UPDATE playlists SET
                song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = playlists.id AND song_id IS NOT NULL),
                duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s
                            INNER JOIN playlist_songs ps ON s.id = ps.song_id
                            WHERE ps.playlist_id = playlists.id),
                updated_at = datetime('now')
             WHERE id IN ({})",
            placeholders
        );
        let mut query = sqlx::query(&sql);
        for (pid,) in &affected_playlist_ids {
            query = query.bind(pid);
        }
        query.execute(&mut *tx).await?;
    }

    tx.commit().await?;

    Ok(true)
}

/// Update a song's file path in the database
pub async fn update_song_path(
    pool: &SqlitePool,
    song_id: &str,
    new_path: &str,
) -> sqlx::Result<bool> {
    let result =
        sqlx::query("UPDATE songs SET file_path = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(new_path)
            .bind(song_id)
            .execute(pool)
            .await?;

    Ok(result.rows_affected() > 0)
}

/// Update a song's file path and format in the database
/// Used when replacing audio with a different format
pub async fn update_song_path_and_format(
    pool: &SqlitePool,
    song_id: &str,
    new_path: &str,
    new_format: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE songs SET file_path = ?, file_format = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(new_path)
    .bind(new_format)
    .bind(song_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// Playback Session queries
// ============================================================================

/// Get or create the single session for a user.
/// Returns the existing session if one exists, otherwise creates a new one.
pub async fn get_or_create_session(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<PlaybackSession> {
    // Try to get existing session first
    if let Some(session) =
        sqlx::query_as::<_, PlaybackSession>("SELECT * FROM playback_sessions WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?
    {
        return Ok(session);
    }

    // Create new session
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO playback_sessions (id, user_id, name, client_name, is_playing, last_heartbeat, created_at, owner_client_name)
         VALUES (?, ?, '', 'ferrotune-web', 0, datetime('now'), datetime('now'), 'ferrotune-web')",
    )
    .bind(&id)
    .bind(user_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, PlaybackSession>("SELECT * FROM playback_sessions WHERE id = ?")
        .bind(&id)
        .fetch_one(pool)
        .await
}

/// Get a specific session by id (only if it belongs to the given user)
pub async fn get_session(
    pool: &SqlitePool,
    session_id: &str,
    user_id: i64,
) -> sqlx::Result<Option<PlaybackSession>> {
    sqlx::query_as::<_, PlaybackSession>(
        "SELECT * FROM playback_sessions WHERE id = ? AND user_id = ?",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// Atomically update session heartbeat and queue position in a single transaction.
/// Ensures followers always see consistent session state + queue position.
///
/// Note: The queue's `current_index` + `position_ms` are the canonical position
/// source. The session table stores display metadata (song info) and liveness;
/// position data there is ephemeral.
#[allow(clippy::too_many_arguments)]
pub async fn update_session_heartbeat_with_position(
    pool: &SqlitePool,
    session_id: &str,
    is_playing: bool,
    current_song_id: Option<&str>,
    current_song_title: Option<&str>,
    current_song_artist: Option<&str>,
    current_index: Option<i64>,
    position_ms: Option<i64>,
) -> sqlx::Result<bool> {
    let mut tx = pool.begin().await?;

    let result = sqlx::query(
        "UPDATE playback_sessions
         SET last_heartbeat = datetime('now'),
             is_playing = ?,
             current_song_id = ?,
             current_song_title = ?,
             current_song_artist = ?
         WHERE id = ?",
    )
    .bind(is_playing)
    .bind(current_song_id)
    .bind(current_song_title)
    .bind(current_song_artist)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;

    if let (Some(idx), Some(pos)) = (current_index, position_ms) {
        sqlx::query(
            "UPDATE play_queues SET current_index = ?, position_ms = ?, updated_at = datetime('now')
             WHERE session_id = ?",
        )
        .bind(idx)
        .bind(pos)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Update only the heartbeat timestamp (for follower keepalive)
pub async fn update_session_heartbeat_timestamp(
    pool: &SqlitePool,
    session_id: &str,
) -> sqlx::Result<bool> {
    let result =
        sqlx::query("UPDATE playback_sessions SET last_heartbeat = datetime('now') WHERE id = ?")
            .bind(session_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

/// Update the owner of a session (on takeover)
pub async fn update_session_owner(
    pool: &SqlitePool,
    session_id: &str,
    owner_client_id: Option<&str>,
    owner_client_name: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE playback_sessions SET owner_client_id = ?, owner_client_name = ?, client_name = ? WHERE id = ?",
    )
    .bind(owner_client_id)
    .bind(owner_client_name)
    .bind(owner_client_name)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Get the user's session (single session per user)
pub async fn get_user_session(
    pool: &SqlitePool,
    user_id: i64,
) -> sqlx::Result<Option<PlaybackSession>> {
    sqlx::query_as::<_, PlaybackSession>("SELECT * FROM playback_sessions WHERE user_id = ?")
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

// ============================================================================
// Play Queue queries (server-side queue management)
// ============================================================================

/// Get the play queue for a session, verifying it belongs to the given user
pub async fn get_play_queue_by_session(
    pool: &SqlitePool,
    session_id: &str,
    user_id: i64,
) -> sqlx::Result<Option<PlayQueue>> {
    sqlx::query_as::<_, PlayQueue>("SELECT * FROM play_queues WHERE session_id = ? AND user_id = ?")
        .bind(session_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// Get queue length by session
pub async fn get_queue_length_by_session(pool: &SqlitePool, session_id: &str) -> sqlx::Result<i64> {
    let result: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM play_queue_entries WHERE session_id = ?")
            .bind(session_id)
            .fetch_one(pool)
            .await?;
    Ok(result.0)
}

/// Get queue entries with full song data by session
pub async fn get_queue_entries_with_songs_by_session(
    pool: &SqlitePool,
    session_id: &str,
) -> sqlx::Result<Vec<QueueEntryWithSong>> {
    sqlx::query_as::<_, QueueEntryWithSong>(
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ?
         ORDER BY pqe.queue_position ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
}

/// Get queue entries at specific positions by session
pub async fn get_queue_entries_at_positions_by_session(
    pool: &SqlitePool,
    session_id: &str,
    positions: &[usize],
) -> sqlx::Result<Vec<QueueEntryWithSong>> {
    if positions.is_empty() {
        return Ok(vec![]);
    }
    let placeholders: String = positions.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ? AND pqe.queue_position IN ({placeholders})
         ORDER BY pqe.queue_position ASC"
    );
    let mut query = sqlx::query_as::<_, QueueEntryWithSong>(&sql).bind(session_id);
    for &pos in positions {
        query = query.bind(pos as i64);
    }
    query.fetch_all(pool).await
}

/// Get queue entries in a contiguous range by session
pub async fn get_queue_entries_range_by_session(
    pool: &SqlitePool,
    session_id: &str,
    offset: usize,
    limit: usize,
) -> sqlx::Result<Vec<QueueEntryWithSong>> {
    sqlx::query_as::<_, QueueEntryWithSong>(
        "SELECT pqe.entry_id, pqe.source_entry_id, pqe.queue_position, s.*, ar.name as artist_name, al.name as album_name
         FROM play_queue_entries pqe
         INNER JOIN songs s ON pqe.song_id = s.id
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE pqe.session_id = ? AND pqe.queue_position >= ? AND pqe.queue_position < ?
         ORDER BY pqe.queue_position ASC",
    )
    .bind(session_id)
    .bind(offset as i64)
    .bind((offset + limit) as i64)
    .fetch_all(pool)
    .await
}

/// Get all song IDs in queue order by session
pub async fn get_queue_song_ids_by_session(
    pool: &SqlitePool,
    session_id: &str,
) -> sqlx::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT song_id FROM play_queue_entries WHERE session_id = ? ORDER BY queue_position",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Create or replace the play queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_queue_for_session(
    pool: &SqlitePool,
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
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    let instance_id = Uuid::new_v4().to_string();

    // Delete existing queue entries for this session
    sqlx::query("DELETE FROM play_queue_entries WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    // Also delete old queue row for this session (if any)
    sqlx::query("DELETE FROM play_queues WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    // Insert new queue entries in batches
    const BATCH_SIZE: usize = 199;
    for chunk_start in (0..song_ids.len()).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(song_ids.len());
        let chunk = &song_ids[chunk_start..chunk_end];
        let row_count = chunk.len();

        let mut sql = String::from(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id, source_entry_id, session_id) VALUES ",
        );
        for i in 0..row_count {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str("(?, ?, ?, ?, ?, ?)");
        }

        let mut query = sqlx::query(&sql);
        for (i, song_id) in chunk.iter().enumerate() {
            let position = chunk_start + i;
            let entry_id = Uuid::new_v4().to_string();
            let source_entry_id = source_entry_ids.and_then(|ids| ids.get(position)).cloned();
            query = query
                .bind(user_id)
                .bind(song_id)
                .bind(position as i64)
                .bind(entry_id)
                .bind(source_entry_id)
                .bind(session_id);
        }
        query.execute(&mut *tx).await?;
    }

    // Insert queue metadata (session_id is unique per queue now)
    sqlx::query(
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, 0, NULL, ?, ?)",
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
    .bind(song_ids.len() as i64)
    .bind(&instance_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Create a lazy queue for a session
#[allow(clippy::too_many_arguments)]
pub async fn create_lazy_queue_for_session(
    pool: &SqlitePool,
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
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    let instance_id = Uuid::new_v4().to_string();

    // Delete existing queue entries (lazy queues don't use entries table)
    sqlx::query("DELETE FROM play_queue_entries WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    // Delete old queue row for this session
    sqlx::query("DELETE FROM play_queues WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    // Insert queue metadata with is_lazy = true
    sqlx::query(
        "INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index,
         position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
         filters_json, sort_json, created_at, updated_at, changed_by, total_count, is_lazy, song_ids_json, instance_id, session_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, 1, ?, ?, ?)",
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
    .bind(total_count)
    .bind(song_ids_json)
    .bind(&instance_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Update queue position by session
pub async fn update_queue_position_by_session(
    pool: &SqlitePool,
    session_id: &str,
    current_index: i64,
    position_ms: i64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET current_index = ?, position_ms = ?, updated_at = datetime('now')
         WHERE session_id = ?",
    )
    .bind(current_index)
    .bind(position_ms)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update only position_ms by session (without changing current_index)
pub async fn update_queue_position_ms_by_session(
    pool: &SqlitePool,
    session_id: &str,
    position_ms: i64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET position_ms = ?, updated_at = datetime('now')
         WHERE session_id = ?",
    )
    .bind(position_ms)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue shuffle state by session
#[allow(clippy::too_many_arguments)]
pub async fn update_queue_shuffle_by_session(
    pool: &SqlitePool,
    session_id: &str,
    is_shuffled: bool,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    current_index: i64,
    position_ms: i64,
    expected_version: Option<i64>,
) -> sqlx::Result<bool> {
    let result = if let Some(ver) = expected_version {
        // Optimistic locking: only update if version matches
        sqlx::query(
            "UPDATE play_queues SET
             is_shuffled = ?, shuffle_seed = ?, shuffle_indices_json = ?,
             current_index = ?, position_ms = ?, updated_at = datetime('now'),
             version = version + 1
             WHERE session_id = ? AND version = ?",
        )
        .bind(is_shuffled)
        .bind(shuffle_seed)
        .bind(shuffle_indices_json)
        .bind(current_index)
        .bind(position_ms)
        .bind(session_id)
        .bind(ver)
        .execute(pool)
        .await?
    } else {
        sqlx::query(
            "UPDATE play_queues SET
             is_shuffled = ?, shuffle_seed = ?, shuffle_indices_json = ?,
             current_index = ?, position_ms = ?, updated_at = datetime('now'),
             version = version + 1
             WHERE session_id = ?",
        )
        .bind(is_shuffled)
        .bind(shuffle_seed)
        .bind(shuffle_indices_json)
        .bind(current_index)
        .bind(position_ms)
        .bind(session_id)
        .execute(pool)
        .await?
    };
    Ok(result.rows_affected() > 0)
}

/// Update song_ids_json on a queue (used to eagerly materialize lazy queues)
pub async fn update_queue_song_ids_by_session(
    pool: &SqlitePool,
    session_id: &str,
    song_ids_json: Option<&str>,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET song_ids_json = ?, updated_at = datetime('now') WHERE session_id = ?",
    )
    .bind(song_ids_json)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Update queue repeat mode by session
pub async fn update_queue_repeat_mode_by_session(
    pool: &SqlitePool,
    session_id: &str,
    repeat_mode: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE play_queues SET repeat_mode = ?, updated_at = datetime('now') WHERE session_id = ?",
    )
    .bind(repeat_mode)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Add songs to queue by session
pub async fn add_to_queue_by_session(
    pool: &SqlitePool,
    user_id: i64,
    session_id: &str,
    song_ids: &[String],
    position: i64,
) -> sqlx::Result<i64> {
    if song_ids.is_empty() {
        return get_queue_length_by_session(pool, session_id).await;
    }

    let mut tx = pool.begin().await?;

    let (queue_len,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM play_queue_entries WHERE session_id = ?")
            .bind(session_id)
            .fetch_one(&mut *tx)
            .await?;

    let insert_pos = if position < 0 { queue_len } else { position };

    if insert_pos < queue_len {
        let positions: Vec<(i64,)> = sqlx::query_as(
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position >= ?
             ORDER BY queue_position DESC",
        )
        .bind(session_id)
        .bind(insert_pos)
        .fetch_all(&mut *tx)
        .await?;

        let shift_amount = song_ids.len() as i64;
        for (pos,) in positions {
            sqlx::query(
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + ?
                 WHERE session_id = ? AND queue_position = ?",
            )
            .bind(shift_amount)
            .bind(session_id)
            .bind(pos)
            .execute(&mut *tx)
            .await?;
        }
    }

    for (i, song_id) in song_ids.iter().enumerate() {
        let entry_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id, session_id) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(song_id)
        .bind(insert_pos + i as i64)
        .bind(&entry_id)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(queue_len + song_ids.len() as i64)
}

/// Remove song from queue by session
pub async fn remove_from_queue_by_session(
    pool: &SqlitePool,
    session_id: &str,
    position: i64,
) -> sqlx::Result<bool> {
    let mut tx = pool.begin().await?;

    let result =
        sqlx::query("DELETE FROM play_queue_entries WHERE session_id = ? AND queue_position = ?")
            .bind(session_id)
            .bind(position)
            .execute(&mut *tx)
            .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    // Shift positions down one-by-one in ASC order to avoid UNIQUE constraint
    // violations. A bulk UPDATE can fail because SQLite may process rows in
    // rowid order which doesn't necessarily match queue_position order.
    let positions: Vec<(i64,)> = sqlx::query_as(
        "SELECT queue_position FROM play_queue_entries
         WHERE session_id = ? AND queue_position > ?
         ORDER BY queue_position ASC",
    )
    .bind(session_id)
    .bind(position)
    .fetch_all(&mut *tx)
    .await?;

    for (pos,) in positions {
        sqlx::query(
            "UPDATE play_queue_entries
             SET queue_position = queue_position - 1
             WHERE session_id = ? AND queue_position = ?",
        )
        .bind(session_id)
        .bind(pos)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Move song in queue by session
pub async fn move_in_queue_by_session(
    pool: &SqlitePool,
    session_id: &str,
    from_position: i64,
    to_position: i64,
) -> sqlx::Result<bool> {
    if from_position == to_position {
        return Ok(true);
    }

    let mut tx = pool.begin().await?;

    let exists: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM play_queue_entries WHERE session_id = ? AND queue_position = ?",
    )
    .bind(session_id)
    .bind(from_position)
    .fetch_optional(&mut *tx)
    .await?;

    if exists.is_none() {
        return Ok(false);
    }

    let temp_position = -1i64;

    sqlx::query(
        "UPDATE play_queue_entries SET queue_position = ? WHERE session_id = ? AND queue_position = ?",
    )
    .bind(temp_position)
    .bind(session_id)
    .bind(from_position)
    .execute(&mut *tx)
    .await?;

    if from_position < to_position {
        // Shift positions down one-by-one in ASC order to avoid UNIQUE constraint
        // violations (same rationale as remove_from_queue_by_session).
        let positions: Vec<(i64,)> = sqlx::query_as(
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position > ? AND queue_position <= ?
             ORDER BY queue_position ASC",
        )
        .bind(session_id)
        .bind(from_position)
        .bind(to_position)
        .fetch_all(&mut *tx)
        .await?;

        for (pos,) in positions {
            sqlx::query(
                "UPDATE play_queue_entries
                 SET queue_position = queue_position - 1
                 WHERE session_id = ? AND queue_position = ?",
            )
            .bind(session_id)
            .bind(pos)
            .execute(&mut *tx)
            .await?;
        }
    } else {
        let positions: Vec<(i64,)> = sqlx::query_as(
            "SELECT queue_position FROM play_queue_entries
             WHERE session_id = ? AND queue_position >= ? AND queue_position < ?
             ORDER BY queue_position DESC",
        )
        .bind(session_id)
        .bind(to_position)
        .bind(from_position)
        .fetch_all(&mut *tx)
        .await?;

        for (pos,) in positions {
            sqlx::query(
                "UPDATE play_queue_entries
                 SET queue_position = queue_position + 1
                 WHERE session_id = ? AND queue_position = ?",
            )
            .bind(session_id)
            .bind(pos)
            .execute(&mut *tx)
            .await?;
        }
    }

    sqlx::query(
        "UPDATE play_queue_entries SET queue_position = ? WHERE session_id = ? AND queue_position = ?",
    )
    .bind(to_position)
    .bind(session_id)
    .bind(temp_position)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE play_queues SET updated_at = datetime('now') WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Clear queue by session
pub async fn clear_queue_by_session(pool: &SqlitePool, session_id: &str) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM play_queue_entries WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM play_queues WHERE session_id = ?")
        .bind(session_id)
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
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE st.user_id = ? AND mf.enabled = 1 AND ula.user_id = ?
         ORDER BY st.starred_at DESC",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

/// Get songs by genre (includes play stats for sorting)
pub async fn get_songs_by_genre(
    pool: &SqlitePool,
    genre: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, NULL as starred_at
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                    FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
         WHERE s.genre = ?
         ORDER BY s.title COLLATE NOCASE",
    )
    .bind(user_id)
    .bind(genre)
    .fetch_all(pool)
    .await
}

/// Get songs recursively under a directory path (includes play stats for sorting)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
/// Also supports legacy format for Subsonic compatibility: "dir-<encoded_path>"
pub async fn get_songs_by_directory(
    pool: &SqlitePool,
    source_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    // Parse the source ID - new format is "libraryId:path"
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            // New format: libraryId:relativePath
            let path_prefix = if relative_path.is_empty() {
                // Library root - match all songs in this library
                String::new()
            } else {
                format!("{}/", relative_path.trim_end_matches('/'))
            };

            if path_prefix.is_empty() {
                // All songs in this library
                return sqlx::query_as::<_, Song>(
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ?
                     ORDER BY s.file_path COLLATE NOCASE",
                )
                .bind(user_id)
                .bind(library_id)
                .fetch_all(pool)
                .await;
            } else {
                // Songs under a specific path in this library
                return sqlx::query_as::<_, Song>(
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ? AND s.file_path LIKE ? || '%'
                     ORDER BY s.file_path COLLATE NOCASE",
                )
                .bind(user_id)
                .bind(library_id)
                .bind(&path_prefix)
                .fetch_all(pool)
                .await;
            }
        }
    }

    // Legacy format: dir-<encoded_path> or just a path (for Subsonic compatibility)
    let actual_path = source_id
        .strip_prefix("dir-")
        .map(|p| urlencoding::decode(p).unwrap_or_default().into_owned())
        .unwrap_or_else(|| source_id.to_string());

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
                        FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
             ORDER BY s.file_path COLLATE NOCASE",
        )
        .bind(user_id)
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
                        FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
             WHERE s.file_path LIKE ? || '%'
             ORDER BY s.file_path COLLATE NOCASE",
        )
        .bind(user_id)
        .bind(&path_prefix)
        .fetch_all(pool)
        .await
    }
}

/// Get songs in a directory without recursing into subdirectories
/// Only returns songs whose file_path matches "parentPath/filename" (no additional slashes)
/// Supports new format: "libraryId:relativePath" (e.g., "1:Artist/Album")
pub async fn get_songs_by_directory_flat(
    pool: &SqlitePool,
    source_id: &str,
    user_id: i64,
) -> sqlx::Result<Vec<Song>> {
    // Parse the source ID - format is "libraryId:path"
    if let Some((library_id_str, relative_path)) = source_id.split_once(':') {
        if let Ok(library_id) = library_id_str.parse::<i64>() {
            let path_prefix = if relative_path.is_empty() {
                // Library root - match files directly in root (no slashes in file_path)
                String::new()
            } else {
                format!("{}/", relative_path.trim_end_matches('/'))
            };

            if path_prefix.is_empty() {
                // Files at library root - no slashes in file_path
                return sqlx::query_as::<_, Song>(
                    "SELECT s.*, ar.name as artist_name, al.name as album_name,
                            pc.play_count, pc.last_played, NULL as starred_at
                     FROM songs s
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN albums al ON s.album_id = al.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played 
                                FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE s.music_folder_id = ? AND s.file_path NOT LIKE '%/%'
                     ORDER BY s.file_path COLLATE NOCASE",
                )
                .bind(user_id)
                .bind(library_id)
                .fetch_all(pool)
                .await;
            } else {
                // Files directly in the specified directory (path matches prefix but no additional slashes after)
                // Use GLOB to match "prefix*" but NOT "prefix*/*" (no slashes after prefix)
                return sqlx::query_as::<_, Song>(
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
                )
                .bind(user_id)
                .bind(library_id)
                .bind(&path_prefix)
                .bind(&path_prefix)
                .fetch_all(pool)
                .await;
            }
        }
    }

    // Legacy format not supported for flat directory queries
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
    pool: &SqlitePool,
    path: &str,
    owner_id: i64,
) -> sqlx::Result<(Option<String>, String)> {
    // If no slashes, return as-is (root placement)
    if !path.contains('/') {
        return Ok((None, path.to_string()));
    }

    let parts: Vec<&str> = path.split('/').collect();
    if parts.is_empty() {
        return Ok((None, path.to_string()));
    }

    // Last part is the playlist name, rest are folders
    let playlist_name = parts.last().unwrap().to_string();
    let folder_parts = &parts[..parts.len() - 1];

    if folder_parts.is_empty() {
        return Ok((None, playlist_name));
    }

    // Create folder hierarchy
    let mut parent_id: Option<String> = None;

    for folder_name in folder_parts {
        if folder_name.is_empty() {
            continue;
        }

        // Check if folder already exists
        let existing: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT id FROM playlist_folders 
            WHERE owner_id = ? AND name = ? AND 
                  (parent_id IS NULL AND ? IS NULL OR parent_id = ?)
            "#,
        )
        .bind(owner_id)
        .bind(folder_name)
        .bind(&parent_id)
        .bind(&parent_id)
        .fetch_optional(pool)
        .await?;

        let folder_id = if let Some((id,)) = existing {
            id
        } else {
            // Create new folder
            let new_id = format!("pf-{}", Uuid::new_v4());

            // Get next position
            let (max_pos,): (i64,) = sqlx::query_as(
                "SELECT COALESCE(MAX(position), -1) FROM playlist_folders WHERE owner_id = ? AND (parent_id IS NULL AND ? IS NULL OR parent_id = ?)",
            )
            .bind(owner_id)
            .bind(&parent_id)
            .bind(&parent_id)
            .fetch_one(pool)
            .await?;

            sqlx::query(
                r#"
                INSERT INTO playlist_folders (id, name, parent_id, owner_id, position)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(&new_id)
            .bind(folder_name)
            .bind(&parent_id)
            .bind(owner_id)
            .bind(max_pos + 1)
            .execute(pool)
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
    pool: &SqlitePool,
    folder_id: Option<&str>,
) -> sqlx::Result<Option<String>> {
    let Some(folder_id) = folder_id else {
        return Ok(None);
    };

    let mut path_segments: Vec<String> = Vec::new();
    let mut current_id = Some(folder_id.to_string());

    while let Some(ref id) = current_id {
        let folder: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT name, parent_id FROM playlist_folders WHERE id = ?")
                .bind(id)
                .fetch_optional(pool)
                .await?;

        match folder {
            Some((name, parent_id)) => {
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

    // Reverse because we collected from leaf to root
    path_segments.reverse();
    Ok(Some(path_segments.join("/")))
}

/// Builds the full playlist name including folder path prefix.
/// Returns "Folder1/Folder2/PlaylistName" if in a folder, or just "PlaylistName" if at root.
pub async fn get_playlist_full_name(
    pool: &SqlitePool,
    name: &str,
    folder_id: Option<&str>,
) -> sqlx::Result<String> {
    match get_folder_path(pool, folder_id).await? {
        Some(path) => Ok(format!("{}/{}", path, name)),
        None => Ok(name.to_string()),
    }
}

/// Delete orphaned queues — queues whose session has no matching playback_sessions
/// row and that haven't been updated in `older_than_days` days.
/// Skips subsonic save/restore queues (playqueue-*) as those are stateless.
pub async fn cleanup_orphaned_queues(pool: &SqlitePool, older_than_days: i64) -> sqlx::Result<u64> {
    // Delete queue entries first (FK-like cleanup)
    let entries_deleted = sqlx::query(
        "DELETE FROM play_queue_entries WHERE session_id IN (
            SELECT pq.session_id FROM play_queues pq
            WHERE pq.session_id IS NOT NULL
              AND pq.session_id NOT LIKE 'playqueue-%'
              AND pq.session_id NOT IN (SELECT id FROM playback_sessions)
              AND pq.updated_at < datetime('now', '-' || ? || ' days')
        )",
    )
    .bind(older_than_days)
    .execute(pool)
    .await?;

    // Delete the orphaned queue metadata
    let queues_deleted = sqlx::query(
        "DELETE FROM play_queues
         WHERE session_id IS NOT NULL
           AND session_id NOT LIKE 'playqueue-%'
           AND session_id NOT IN (SELECT id FROM playback_sessions)
           AND updated_at < datetime('now', '-' || ? || ' days')",
    )
    .bind(older_than_days)
    .execute(pool)
    .await?;

    Ok(entries_deleted.rows_affected() + queues_deleted.rows_affected())
}
