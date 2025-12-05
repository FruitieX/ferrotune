use crate::db::models::*;
use sqlx::SqlitePool;

// User queries
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
    email: Option<&str>,
    is_admin: bool,
) -> sqlx::Result<i64> {
    let result = sqlx::query(
        "INSERT INTO users (username, password_hash, email, is_admin, created_at) 
         VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(username)
    .bind(password_hash)
    .bind(email)
    .bind(is_admin)
    .execute(pool)
    .await?;

    Ok(result.last_insert_rowid())
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
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
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
        "SELECT DISTINCT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
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

/// Get songs in a playlist, ordered by position
pub async fn get_playlist_songs(pool: &SqlitePool, playlist_id: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s
         INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN playlist_songs ps ON s.id = ps.song_id
         WHERE ps.playlist_id = ?
         ORDER BY ps.position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await
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
    // Get all songs in current order
    let songs: Vec<(String, i64)> = sqlx::query_as(
        "SELECT song_id, position FROM playlist_songs WHERE playlist_id = ? ORDER BY position",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?;

    // Update each with new sequential position
    for (i, (song_id, _)) in songs.iter().enumerate() {
        sqlx::query("UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?")
            .bind(i as i64)
            .bind(playlist_id)
            .bind(song_id)
            .execute(pool)
            .await?;
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
