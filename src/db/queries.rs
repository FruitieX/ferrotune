use sqlx::SqlitePool;
use crate::db::models::*;

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
         WHERE a.token = ?"
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
         VALUES (?, ?, ?, ?, datetime('now'))"
    )
    .bind(username)
    .bind(password_hash)
    .bind(email)
    .bind(is_admin)
    .execute(pool)
    .await?;

    Ok(result.last_insert_rowid())
}

// Music folder queries
pub async fn get_music_folders(pool: &SqlitePool) -> sqlx::Result<Vec<MusicFolder>> {
    sqlx::query_as::<_, MusicFolder>("SELECT * FROM music_folders WHERE enabled = 1 ORDER BY id")
        .fetch_all(pool)
        .await
}

pub async fn create_music_folder(
    pool: &SqlitePool,
    name: &str,
    path: &str,
) -> sqlx::Result<i64> {
    let result = sqlx::query(
        "INSERT INTO music_folders (name, path, enabled) VALUES (?, ?, 1)"
    )
    .bind(name)
    .bind(path)
    .execute(pool)
    .await?;

    Ok(result.last_insert_rowid())
}

// Artist queries
pub async fn get_artists(pool: &SqlitePool) -> sqlx::Result<Vec<Artist>> {
    sqlx::query_as::<_, Artist>(
        "SELECT id, name, sort_name, album_count, cover_art_id 
         FROM artists 
         ORDER BY COALESCE(sort_name, name) COLLATE NOCASE"
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
         ORDER BY a.year, a.name"
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
         WHERE a.id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// Song queries
pub async fn get_songs_by_album(pool: &SqlitePool, album_id: &str) -> sqlx::Result<Vec<Song>> {
    sqlx::query_as::<_, Song>(
        "SELECT * FROM songs 
         WHERE album_id = ? 
         ORDER BY disc_number, track_number, title"
    )
    .bind(album_id)
    .fetch_all(pool)
    .await
}

pub async fn get_song_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Song>> {
    sqlx::query_as::<_, Song>("SELECT * FROM songs WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}
