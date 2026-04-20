//! Browse queries: artists, albums, songs.
//!
//! SeaORM replacement for the browse-related bodies in `src/db/queries.rs`.
//! Because the existing queries rely on JOINs with computed columns
//! (`play_count`, `last_played`, `starred_at`, `library_enabled`,
//! `folder_path`, `artist_name`, `album_name`), this module uses the
//! dialect-aware [`crate::db::raw`] helpers with [`sea_orm::FromQueryResult`]
//! on the existing `models::*` structs.

use sea_orm::Value;

use crate::db::models::{Album, Artist, Song, SongWithFolder, SongWithLibraryStatus};
use crate::db::{raw, Database};
use crate::error::Result;

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

/// Base SELECT returning every column needed by `models::Song`, aliasing
/// the optional JOIN columns as NULL by default. Callers append WHERE/JOIN
/// clauses as needed.
const SONG_SELECT_FULL_SQLITE: &str = r#"
SELECT s.*, ar.name AS artist_name, al.name AS album_name,
       NULL AS play_count, NULL AS last_played, NULL AS starred_at
FROM songs s
INNER JOIN artists ar ON s.artist_id = ar.id
LEFT JOIN albums al ON s.album_id = al.id
"#;

const SONG_SELECT_FULL_POSTGRES: &str = r#"
SELECT s.*, ar.name AS artist_name, al.name AS album_name,
       NULL::BIGINT AS play_count,
       NULL::TIMESTAMPTZ AS last_played,
       NULL::TIMESTAMPTZ AS starred_at
FROM songs s
INNER JOIN artists ar ON s.artist_id = ar.id
LEFT JOIN albums al ON s.album_id = al.id
"#;

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

pub async fn get_artists(database: &Database) -> Result<Vec<Artist>> {
    let rows = raw::query_all::<Artist>(
        database.conn(),
        r#"SELECT id, name, sort_name, album_count, song_count, cover_art_hash
           FROM artists
           WHERE EXISTS (
               SELECT 1 FROM songs s
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id
               WHERE s.artist_id = artists.id AND mf.enabled = 1
           )
           ORDER BY COALESCE(sort_name, name) COLLATE NOCASE"#,
        r#"SELECT id, name, sort_name, album_count, song_count, cover_art_hash
           FROM artists
           WHERE EXISTS (
               SELECT 1 FROM songs s
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id
               WHERE s.artist_id = artists.id AND mf.enabled
           )
           ORDER BY LOWER(COALESCE(sort_name, name))"#,
        [],
    )
    .await?;
    Ok(rows)
}

pub async fn get_artists_for_user(database: &Database, user_id: i64) -> Result<Vec<Artist>> {
    let rows = raw::query_all::<Artist>(
        database.conn(),
        r#"SELECT id, name, sort_name, album_count, song_count, cover_art_hash
           FROM artists
           WHERE EXISTS (
               SELECT 1 FROM songs s
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id
               INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
               WHERE s.artist_id = artists.id AND mf.enabled = 1 AND ula.user_id = ?
           )
           ORDER BY COALESCE(sort_name, name) COLLATE NOCASE"#,
        r#"SELECT id, name, sort_name, album_count, song_count, cover_art_hash
           FROM artists
           WHERE EXISTS (
               SELECT 1 FROM songs s
               INNER JOIN music_folders mf ON s.music_folder_id = mf.id
               INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
               WHERE s.artist_id = artists.id AND mf.enabled AND ula.user_id = $1
           )
           ORDER BY LOWER(COALESCE(sort_name, name))"#,
        [Value::from(user_id)],
    )
    .await?;
    Ok(rows)
}

pub async fn get_artist_by_id(database: &Database, id: &str) -> Result<Option<Artist>> {
    let row = raw::query_one::<Artist>(
        database.conn(),
        "SELECT * FROM artists WHERE id = ?",
        "SELECT * FROM artists WHERE id = $1",
        [Value::from(id.to_string())],
    )
    .await?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

pub async fn get_albums_by_artist(database: &Database, artist_id: &str) -> Result<Vec<Album>> {
    let rows = raw::query_all::<Album>(
        database.conn(),
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.artist_id = ?
             AND EXISTS (
                 SELECT 1 FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 WHERE s.album_id = a.id AND mf.enabled = 1
             )
           ORDER BY a.year, a.name COLLATE NOCASE"#,
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.artist_id = $1
             AND EXISTS (
                 SELECT 1 FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 WHERE s.album_id = a.id AND mf.enabled
             )
           ORDER BY a.year, LOWER(a.name)"#,
        [Value::from(artist_id.to_string())],
    )
    .await?;
    Ok(rows)
}

pub async fn get_albums_by_artist_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
) -> Result<Vec<Album>> {
    let rows = raw::query_all::<Album>(
        database.conn(),
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.artist_id = ?
             AND EXISTS (
                 SELECT 1 FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?
             )
           ORDER BY a.year, a.name COLLATE NOCASE"#,
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.artist_id = $1
             AND EXISTS (
                 SELECT 1 FROM songs s
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                 WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $2
             )
           ORDER BY a.year, LOWER(a.name)"#,
        [Value::from(artist_id.to_string()), Value::from(user_id)],
    )
    .await?;
    Ok(rows)
}

pub async fn get_album_by_id(database: &Database, id: &str) -> Result<Option<Album>> {
    let row = raw::query_one::<Album>(
        database.conn(),
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.id = ?"#,
        r#"SELECT a.*, ar.name AS artist_name
           FROM albums a
           INNER JOIN artists ar ON a.artist_id = ar.id
           WHERE a.id = $1"#,
        [Value::from(id.to_string())],
    )
    .await?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

pub async fn get_songs_by_album(database: &Database, album_id: &str) -> Result<Vec<Song>> {
    let rows = raw::query_all::<Song>(
        database.conn(),
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN (SELECT song_id, SUM(play_count) AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL AND s.album_id = ?
           ORDER BY s.disc_number, s.track_number, s.title COLLATE NOCASE"#,
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN (SELECT song_id, SUM(play_count)::BIGINT AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL AND s.album_id = $1
           ORDER BY s.disc_number, s.track_number, LOWER(s.title)"#,
        [Value::from(album_id.to_string())],
    )
    .await?;
    Ok(rows)
}

pub async fn get_songs_by_album_for_user(
    database: &Database,
    album_id: &str,
    user_id: i64,
) -> Result<Vec<Song>> {
    let rows = raw::query_all::<Song>(
        database.conn(),
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, SUM(play_count) AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL
             AND s.album_id = ? AND mf.enabled = 1 AND ula.user_id = ?
           ORDER BY s.disc_number, s.track_number, s.title COLLATE NOCASE"#,
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, SUM(play_count)::BIGINT AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL
             AND s.album_id = $2 AND mf.enabled AND ula.user_id = $3
           ORDER BY s.disc_number, s.track_number, LOWER(s.title)"#,
        [
            Value::from(user_id),
            Value::from(album_id.to_string()),
            Value::from(user_id),
        ],
    )
    .await?;
    Ok(rows)
}

/// Get all songs by a specific artist (both track artist and album artist).
pub async fn get_songs_by_artist(database: &Database, artist_id: &str) -> Result<Vec<Song>> {
    let rows = raw::query_all::<Song>(
        database.conn(),
        r#"SELECT DISTINCT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN (SELECT song_id, COUNT(*) AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL AND (s.artist_id = ? OR al.artist_id = ?)
           ORDER BY s.album_id, s.disc_number, s.track_number, s.title COLLATE NOCASE"#,
        r#"SELECT DISTINCT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL AND (s.artist_id = $1 OR al.artist_id = $2)
           ORDER BY s.album_id, s.disc_number, s.track_number, s.title"#,
        [
            Value::from(artist_id.to_string()),
            Value::from(artist_id.to_string()),
        ],
    )
    .await?;
    Ok(rows)
}

pub async fn get_songs_by_artist_for_user(
    database: &Database,
    artist_id: &str,
    user_id: i64,
) -> Result<Vec<Song>> {
    let rows = raw::query_all::<Song>(
        database.conn(),
        r#"SELECT DISTINCT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, COUNT(*) AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL
             AND mf.enabled = 1
             AND ula.user_id = ?
             AND (s.artist_id = ? OR al.artist_id = ?)
           ORDER BY s.album_id, s.disc_number, s.track_number, s.title COLLATE NOCASE"#,
        r#"SELECT DISTINCT s.*, ar.name AS artist_name, al.name AS album_name,
                  pc.play_count, pc.last_played, NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, COUNT(*)::BIGINT AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission AND user_id = $1 GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.marked_for_deletion_at IS NULL
             AND mf.enabled
             AND ula.user_id = $2
             AND (s.artist_id = $3 OR al.artist_id = $4)
           ORDER BY s.album_id, s.disc_number, s.track_number, s.title"#,
        [
            Value::from(user_id),
            Value::from(user_id),
            Value::from(artist_id.to_string()),
            Value::from(artist_id.to_string()),
        ],
    )
    .await?;
    Ok(rows)
}

pub async fn get_song_by_id(database: &Database, id: &str) -> Result<Option<Song>> {
    let row = raw::query_one::<Song>(
        database.conn(),
        &format!(
            "{} WHERE s.marked_for_deletion_at IS NULL AND s.id = ?",
            SONG_SELECT_FULL_SQLITE
        ),
        &format!(
            "{} WHERE s.marked_for_deletion_at IS NULL AND s.id = $1",
            SONG_SELECT_FULL_POSTGRES
        ),
        [Value::from(id.to_string())],
    )
    .await?;
    Ok(row)
}

pub async fn get_songs_by_ids_for_user(
    database: &Database,
    ids: &[String],
    user_id: i64,
) -> Result<Vec<Song>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let sqlite_placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let postgres_placeholders = (1..=ids.len())
        .map(|i| format!("${}", i))
        .collect::<Vec<_>>()
        .join(", ");
    let user_placeholder = ids.len() + 1;

    let sqlite_sql = format!(
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                 NULL AS play_count, NULL AS last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           WHERE s.marked_for_deletion_at IS NULL
             AND s.id IN ({})
             AND mf.enabled = 1 AND ula.user_id = ?"#,
        sqlite_placeholders,
    );
    let postgres_sql = format!(
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name,
                 NULL::BIGINT AS play_count,
                 NULL::TIMESTAMPTZ AS last_played,
                 NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           WHERE s.marked_for_deletion_at IS NULL
             AND s.id IN ({})
             AND mf.enabled AND ula.user_id = ${}"#,
        postgres_placeholders, user_placeholder,
    );

    let mut values: Vec<Value> = ids.iter().map(|id| Value::from(id.clone())).collect();
    values.push(Value::from(user_id));

    let songs: Vec<Song> =
        raw::query_all::<Song>(database.conn(), &sqlite_sql, &postgres_sql, values).await?;

    // Preserve the input ordering.
    let song_map: std::collections::HashMap<String, Song> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();
    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get songs by a list of IDs with their library enabled status.
/// Returns songs from ALL music folders (including disabled ones).
pub async fn get_songs_by_ids_with_library_status(
    database: &Database,
    ids: &[String],
    user_id: i64,
) -> Result<Vec<SongWithLibraryStatus>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let sqlite_placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    // First bind is user_id (=$1), then the IDs.
    let postgres_placeholders = (2..=ids.len() + 1)
        .map(|i| format!("${}", i))
        .collect::<Vec<_>>()
        .join(", ");

    let sqlite_sql = format!(
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name, mf.enabled AS library_enabled,
                  pc.play_count, pc.last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, SUM(play_count) AS play_count, MAX(played_at) AS last_played
                      FROM scrobbles WHERE submission = 1 AND user_id = ? GROUP BY song_id) pc ON s.id = pc.song_id
           WHERE s.id IN ({})"#,
        sqlite_placeholders,
    );
    let postgres_sql = format!(
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name, mf.enabled AS library_enabled,
                  pc.play_count, pc.last_played, NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           LEFT JOIN (
               SELECT song_id, SUM(play_count)::BIGINT AS play_count, MAX(played_at) AS last_played
               FROM scrobbles WHERE submission = TRUE AND user_id = $1 GROUP BY song_id
           ) pc ON s.id = pc.song_id
           WHERE s.id IN ({})"#,
        postgres_placeholders,
    );

    let mut values: Vec<Value> = vec![Value::from(user_id)];
    values.extend(ids.iter().map(|id| Value::from(id.clone())));

    let songs: Vec<SongWithLibraryStatus> = raw::query_all::<SongWithLibraryStatus>(
        database.conn(),
        &sqlite_sql,
        &postgres_sql,
        values,
    )
    .await?;

    // Preserve the input ordering.
    let song_map: std::collections::HashMap<String, SongWithLibraryStatus> =
        songs.into_iter().map(|s| (s.id.clone(), s)).collect();
    Ok(ids
        .iter()
        .filter_map(|id| song_map.get(id).cloned())
        .collect())
}

/// Get a song by ID with its music folder path for full filesystem path construction.
pub async fn get_song_by_id_with_folder(
    database: &Database,
    id: &str,
) -> Result<Option<SongWithFolder>> {
    let row = raw::query_one::<SongWithFolder>(
        database.conn(),
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name, mf.path AS folder_path,
                 NULL AS play_count, NULL AS last_played, NULL AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN music_folders mf ON s.music_folder_id = mf.id
           WHERE s.id = ?"#,
        r#"SELECT s.*, ar.name AS artist_name, al.name AS album_name, mf.path AS folder_path,
                 NULL::BIGINT AS play_count,
                 NULL::TIMESTAMPTZ AS last_played,
                 NULL::TIMESTAMPTZ AS starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN music_folders mf ON s.music_folder_id = mf.id
           WHERE s.id = $1"#,
        [Value::from(id.to_string())],
    )
    .await?;
    Ok(row)
}
