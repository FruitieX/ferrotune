use crate::api::common::browse::{get_song_play_stats, song_to_response_with_stats};
use crate::api::common::models::{AlbumResponse, SongResponse};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::ferrotune::smart_playlists::get_smart_playlist_songs_by_id;
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_song_thumbnails_base64,
};
use crate::db::models::ItemType;
use crate::thumbnails::ThumbnailSize;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use sea_orm::{FromQueryResult, Value};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Album list types
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub enum AlbumListType {
    Random,
    Newest,
    Highest,
    Frequent,
    Recent,
    Starred,
    AlphabeticalByName,
    AlphabeticalByArtist,
    ByYear,
    ByGenre,
}

pub struct AlbumListResult {
    pub albums: Vec<AlbumResponse>,
    pub total: Option<i64>,
    /// Random seed used for the Random list type (for reproducible ordering)
    pub seed: Option<i64>,
}

fn sqlite_placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

async fn fetch_albums_by_ids_in_order(
    database: &crate::db::Database,
    album_ids: &[String],
) -> crate::error::Result<Vec<crate::db::models::Album>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }

    let sqlite_sql = format!(
        "SELECT a.*, ar.name as artist_name
         FROM albums a
         INNER JOIN artists ar ON a.artist_id = ar.id
         WHERE a.id IN ({})",
        sqlite_placeholders(album_ids.len())
    );
    let postgres_sql = format!(
        "SELECT a.*, ar.name as artist_name
         FROM albums a
         INNER JOIN artists ar ON a.artist_id = ar.id
         WHERE a.id IN ({})",
        postgres_placeholders(1, album_ids.len())
    );
    let params: Vec<Value> = album_ids.iter().cloned().map(Value::from).collect();
    let albums = crate::db::raw::query_all::<crate::db::models::Album>(
        database.conn(),
        &sqlite_sql,
        &postgres_sql,
        params,
    )
    .await?;

    let order_map: std::collections::HashMap<&str, usize> = album_ids
        .iter()
        .enumerate()
        .map(|(index, album_id)| (album_id.as_str(), index))
        .collect();

    let mut ordered_albums = albums;
    ordered_albums.sort_by_key(|album| {
        order_map
            .get(album.id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
    });

    Ok(ordered_albums)
}

#[derive(FromQueryResult)]
struct AlbumIdRow {
    id: String,
}

#[derive(FromQueryResult)]
struct AlbumPlayedRow {
    id: String,
    last_played: String,
}

#[derive(FromQueryResult)]
struct SongIdRow {
    song_id: String,
}

#[derive(FromQueryResult)]
struct ContinueListeningSourceRow {
    source_type: String,
    source_id: String,
    last_played: String,
}

#[derive(FromQueryResult)]
struct ContinueListeningPlaylistRow {
    id: String,
    name: String,
    song_count: i64,
    duration: i64,
}

#[derive(FromQueryResult)]
struct NamedIdRow {
    id: String,
    name: String,
}

async fn query_albums(
    database: &crate::db::Database,
    sqlite_sql: &str,
    postgres_sql: &str,
    params: impl IntoIterator<Item = Value>,
) -> crate::error::Result<Vec<crate::db::models::Album>> {
    crate::db::raw::query_all::<crate::db::models::Album>(
        database.conn(),
        sqlite_sql,
        postgres_sql,
        params,
    )
    .await
    .map_err(Into::into)
}

async fn query_i64(
    database: &crate::db::Database,
    sqlite_sql: &str,
    postgres_sql: &str,
    params: impl IntoIterator<Item = Value>,
) -> crate::error::Result<i64> {
    crate::db::raw::query_scalar::<i64>(database.conn(), sqlite_sql, postgres_sql, params)
        .await
        .map(|value| value.unwrap_or(0))
        .map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_album_list_logic(
    database: &crate::db::Database,
    user_id: i64,
    list_type: AlbumListType,
    size: i64,
    offset: i64,
    from_year: Option<i32>,
    to_year: Option<i32>,
    genre: Option<String>,
    inline_image_size: Option<ThumbnailSize>,
    since: Option<String>,
    seed: Option<i64>,
) -> crate::error::Result<AlbumListResult> {
    let size = size.min(500);
    let mut result_seed: Option<i64> = None;

    let albums: Vec<crate::db::models::Album> = match list_type {
        AlbumListType::Random => {
            // Use Rust-side Fisher-Yates shuffle with a deterministic seed
            // so that pagination returns consistent results and the client
            // can reproduce the same order for queue materialization.
            // Constrain seed to JS Number.MAX_SAFE_INTEGER to avoid precision loss during JSON round-trip
            let actual_seed =
                seed.unwrap_or_else(|| rand::thread_rng().gen_range(0..=9_007_199_254_740_991i64));
            result_seed = Some(actual_seed);

            let all_ids = crate::db::raw::query_all::<AlbumIdRow>(
                database.conn(),
                "SELECT a.id
                 FROM albums a
                 INNER JOIN artists ar ON a.artist_id = ar.id
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)",
                "SELECT a.id
                 FROM albums a
                 INNER JOIN artists ar ON a.artist_id = ar.id
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)",
                [Value::from(user_id)],
            )
            .await?;

            let mut ids: Vec<String> = all_ids.into_iter().map(|row| row.id).collect();

            // Shuffle deterministically using the seed
            let mut rng = StdRng::seed_from_u64(actual_seed as u64);
            ids.shuffle(&mut rng);

            // Slice for pagination
            let start = (offset as usize).min(ids.len());
            let end = (start + size as usize).min(ids.len());
            let page_ids = &ids[start..end];

            if page_ids.is_empty() {
                Vec::new()
            } else {
                fetch_albums_by_ids_in_order(database, page_ids).await?
            }
        }
        AlbumListType::Newest => {
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY a.created_at DESC 
                 LIMIT ? OFFSET ?",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                 ORDER BY a.created_at DESC 
                 LIMIT $2 OFFSET $3",
                [Value::from(user_id), Value::from(size), Value::from(offset)],
            )
            .await?
        }
        AlbumListType::Highest => {
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                 ORDER BY LOWER(a.name), a.name 
                 LIMIT $2 OFFSET $3",
                [Value::from(user_id), Value::from(size), Value::from(offset)],
            )
            .await?
        }
        AlbumListType::Frequent => {
            // Pre-aggregate scrobbles per album in a derived table instead of
            // using a correlated subquery in the JOIN condition. This avoids
            // re-scanning the scrobbles table for every album row.
            let sqlite_sql = format!(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 LEFT JOIN (
                     SELECT s_inner.album_id, COUNT(sc.id) as scrobble_count
                     FROM scrobbles sc
                     INNER JOIN songs s_inner ON sc.song_id = s_inner.id
                     WHERE sc.user_id = ? {}
                     GROUP BY s_inner.album_id
                 ) freq ON freq.album_id = a.id
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY COALESCE(freq.scrobble_count, 0) DESC 
                 LIMIT ? OFFSET ?",
                if since.is_some() {
                    "AND sc.played_at >= ?"
                } else {
                    ""
                }
            );
            let postgres_sql = if since.is_some() {
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 LEFT JOIN (
                     SELECT s_inner.album_id, COUNT(sc.id) as scrobble_count
                     FROM scrobbles sc
                     INNER JOIN songs s_inner ON sc.song_id = s_inner.id
                     WHERE sc.user_id = $1 AND sc.played_at >= $2::timestamptz
                     GROUP BY s_inner.album_id
                 ) freq ON freq.album_id = a.id
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $3)
                 ORDER BY COALESCE(freq.scrobble_count, 0) DESC 
                 LIMIT $4 OFFSET $5"
            } else {
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 LEFT JOIN (
                     SELECT s_inner.album_id, COUNT(sc.id) as scrobble_count
                     FROM scrobbles sc
                     INNER JOIN songs s_inner ON sc.song_id = s_inner.id
                     WHERE sc.user_id = $1
                     GROUP BY s_inner.album_id
                 ) freq ON freq.album_id = a.id
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $2)
                 ORDER BY COALESCE(freq.scrobble_count, 0) DESC 
                 LIMIT $3 OFFSET $4"
            };
            let mut params = vec![Value::from(user_id)];
            if let Some(ref since_value) = since {
                params.push(Value::from(since_value.clone()));
            }
            params.extend([
                Value::from(user_id),
                Value::from(size),
                Value::from(offset),
            ]);

            query_albums(database, &sqlite_sql, postgres_sql, params).await?
        }
        AlbumListType::Recent => {
            // Aggregate recently played albums in a subquery first, then join
            // back to albums. This avoids the fan-out from joining songs and
            // scrobbles directly which produces many duplicate album rows
            // before DISTINCT can eliminate them.
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN (
                     SELECT s.album_id, MAX(sc.played_at) as last_played
                     FROM scrobbles sc
                     INNER JOIN songs s ON sc.song_id = s.id
                     INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                     INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                     WHERE sc.user_id = ? AND mf.enabled = 1 AND ula.user_id = ?
                     GROUP BY s.album_id
                     ORDER BY last_played DESC
                     LIMIT ? OFFSET ?
                 ) recent ON a.id = recent.album_id
                 ORDER BY recent.last_played DESC",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN (
                     SELECT s.album_id, MAX(sc.played_at) as last_played
                     FROM scrobbles sc
                     INNER JOIN songs s ON sc.song_id = s.id
                     INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                     INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                     WHERE sc.user_id = $1 AND mf.enabled AND ula.user_id = $2
                     GROUP BY s.album_id
                     ORDER BY last_played DESC
                     LIMIT $3 OFFSET $4
                 ) recent ON a.id = recent.album_id
                 ORDER BY recent.last_played DESC",
                [
                    Value::from(user_id),
                    Value::from(user_id),
                    Value::from(size),
                    Value::from(offset),
                ],
            )
            .await?
        }
        AlbumListType::Starred => {
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY st.starred_at DESC 
                 LIMIT ? OFFSET ?",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                 ORDER BY st.starred_at DESC 
                 LIMIT $2 OFFSET $3",
                [Value::from(user_id), Value::from(size), Value::from(offset)],
            )
            .await?
        }
        AlbumListType::AlphabeticalByName => {
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                 ORDER BY LOWER(a.name), a.name 
                 LIMIT $2 OFFSET $3",
                [Value::from(user_id), Value::from(size), Value::from(offset)],
            )
            .await?
        }
        AlbumListType::AlphabeticalByArtist => {
            query_albums(
                database,
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                 ORDER BY ar.name COLLATE NOCASE, a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?",
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                 ORDER BY LOWER(ar.name), ar.name, LOWER(a.name), a.name 
                 LIMIT $2 OFFSET $3",
                [Value::from(user_id), Value::from(size), Value::from(offset)],
            )
            .await?
        }
        AlbumListType::ByYear => {
                        query_albums(
                                database,
                                "SELECT a.*, ar.name as artist_name 
                                 FROM albums a 
                                 INNER JOIN artists ar ON a.artist_id = ar.id 
                                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                                     AND (? IS NULL OR a.year >= ?) AND (? IS NULL OR a.year <= ?)
                                 ORDER BY a.year DESC, a.name COLLATE NOCASE 
                                 LIMIT ? OFFSET ?",
                                "SELECT a.*, ar.name as artist_name 
                                 FROM albums a 
                                 INNER JOIN artists ar ON a.artist_id = ar.id 
                                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                                     AND ($2::INT4 IS NULL OR a.year >= $3) AND ($4::INT4 IS NULL OR a.year <= $5)
                                 ORDER BY a.year DESC, LOWER(a.name), a.name 
                                 LIMIT $6 OFFSET $7",
                                [
                                        Value::from(user_id),
                                        Value::from(from_year),
                                        Value::from(from_year),
                                        Value::from(to_year),
                                        Value::from(to_year),
                                        Value::from(size),
                                        Value::from(offset),
                                ],
                        )
                        .await?
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                                query_albums(
                                        database,
                                        "SELECT a.*, ar.name as artist_name 
                                         FROM albums a 
                                         INNER JOIN artists ar ON a.artist_id = ar.id 
                                         WHERE a.genre = ? 
                                             AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                                         ORDER BY a.name COLLATE NOCASE 
                                         LIMIT ? OFFSET ?",
                                        "SELECT a.*, ar.name as artist_name 
                                         FROM albums a 
                                         INNER JOIN artists ar ON a.artist_id = ar.id 
                                         WHERE a.genre = $1 
                                             AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $2)
                                         ORDER BY LOWER(a.name), a.name 
                                         LIMIT $3 OFFSET $4",
                                        [
                                                Value::from(g.clone()),
                                                Value::from(user_id),
                                                Value::from(size),
                                                Value::from(offset),
                                        ],
                                )
                                .await?
            } else {
                Vec::new()
            }
        }
    };

    // Calculate total if needed (for pagination)
    let total: Option<i64> = match list_type {
        AlbumListType::AlphabeticalByName
        | AlbumListType::AlphabeticalByArtist
        | AlbumListType::Newest
        | AlbumListType::Highest
        | AlbumListType::Frequent => {
            Some(
                query_i64(
                    database,
                    "SELECT COUNT(*) FROM albums a WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)",
                    "SELECT COUNT(*)::BIGINT FROM albums a WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)",
                    [Value::from(user_id)],
                )
                .await?,
            )
        }
        AlbumListType::Starred => {
            Some(
                query_i64(
                    database,
                    "SELECT COUNT(*) FROM starred st INNER JOIN albums a ON st.item_id = a.id 
                     WHERE st.item_type = 'album' AND st.user_id = ?
                       AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)",
                    "SELECT COUNT(*)::BIGINT FROM starred st INNER JOIN albums a ON st.item_id = a.id 
                     WHERE st.item_type = 'album' AND st.user_id = $1
                       AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $2)",
                    [Value::from(user_id), Value::from(user_id)],
                )
                .await?,
            )
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                Some(
                    query_i64(
                        database,
                        "SELECT COUNT(*) FROM albums a WHERE a.genre = ? AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)",
                        "SELECT COUNT(*)::BIGINT FROM albums a WHERE a.genre = $1 AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $2)",
                        [Value::from(g.clone()), Value::from(user_id)],
                    )
                    .await?,
                )
            } else {
                None
            }
        }
        AlbumListType::ByYear => {
            Some(
                query_i64(
                    database,
                    "SELECT COUNT(*) FROM albums a
                     WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)
                       AND (? IS NULL OR a.year >= ?) AND (? IS NULL OR a.year <= ?)",
                    "SELECT COUNT(*)::BIGINT FROM albums a
                     WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)
                       AND ($2::INT4 IS NULL OR a.year >= $3) AND ($4::INT4 IS NULL OR a.year <= $5)",
                    [
                        Value::from(user_id),
                        Value::from(from_year),
                        Value::from(from_year),
                        Value::from(to_year),
                        Value::from(to_year),
                    ],
                )
                .await?,
            )
        }
        AlbumListType::Random => {
            Some(
                query_i64(
                    database,
                    "SELECT COUNT(*) FROM albums a WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1 AND ula.user_id = ?)",
                    "SELECT COUNT(*)::BIGINT FROM albums a WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id JOIN user_library_access ula ON ula.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled AND ula.user_id = $1)",
                    [Value::from(user_id)],
                )
                .await?,
            )
        }
        AlbumListType::Recent => {
            Some(
                query_i64(
                    database,
                    "SELECT COUNT(*) FROM (
                         SELECT s.album_id
                         FROM scrobbles sc
                         INNER JOIN songs s ON sc.song_id = s.id
                         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                         WHERE sc.user_id = ? AND mf.enabled = 1 AND ula.user_id = ?
                         GROUP BY s.album_id
                     )",
                    "SELECT COUNT(*)::BIGINT FROM (
                         SELECT s.album_id
                         FROM scrobbles sc
                         INNER JOIN songs s ON sc.song_id = s.id
                         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                         WHERE sc.user_id = $1 AND mf.enabled AND ula.user_id = $2
                         GROUP BY s.album_id
                     ) recent_albums",
                    [Value::from(user_id), Value::from(user_id)],
                )
                .await?,
            )
        }
    };

    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Album, &album_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Album, &album_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_image_size {
        get_album_thumbnails_base64(database, &album_ids, size).await
    } else {
        std::collections::HashMap::new()
    };

    // Get last played timestamps for "recent" list type
    let played_map: std::collections::HashMap<String, String> = if matches!(
        list_type,
        AlbumListType::Recent
    ) {
        if album_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            let sqlite_sql = format!(
                "SELECT a.id, MAX(sc.played_at) as last_played
                     FROM albums a
                     INNER JOIN songs s ON s.album_id = a.id
                     INNER JOIN scrobbles sc ON sc.song_id = s.id
                     WHERE sc.user_id = ? AND a.id IN ({})
                     GROUP BY a.id",
                sqlite_placeholders(album_ids.len())
            );
            let postgres_sql = format!(
                    "SELECT a.id, to_char(MAX(sc.played_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as last_played
                     FROM albums a
                     INNER JOIN songs s ON s.album_id = a.id
                     INNER JOIN scrobbles sc ON sc.song_id = s.id
                     WHERE sc.user_id = $1 AND a.id IN ({})
                     GROUP BY a.id",
                    postgres_placeholders(2, album_ids.len())
                );
            let mut params = Vec::with_capacity(album_ids.len() + 1);
            params.push(Value::from(user_id));
            params.extend(album_ids.iter().cloned().map(Value::from));

            crate::db::raw::query_all::<AlbumPlayedRow>(
                database.conn(),
                &sqlite_sql,
                &postgres_sql,
                params,
            )
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| (row.id, row.last_played))
            .collect()
        }
    } else {
        std::collections::HashMap::new()
    };

    let album_responses: Vec<AlbumResponse> = albums
        .into_iter()
        .map(|album| AlbumResponse {
            id: album.id.clone(),
            name: album.name,
            artist: album.artist_name,
            artist_id: album.artist_id,
            cover_art: Some(album.id.clone()),
            cover_art_data: thumbnails.get(&album.id).cloned(),
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre,
            created: format_datetime_iso_ms(album.created_at),
            starred: starred_map.get(&album.id).cloned(),
            user_rating: ratings_map.get(&album.id).copied(),
            played: played_map.get(&album.id).cloned(),
        })
        .collect();

    Ok(AlbumListResult {
        albums: album_responses,
        total,
        seed: result_seed,
    })
}

pub async fn get_random_songs_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    genre: Option<String>,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> crate::error::Result<Vec<SongResponse>> {
    let size = size.min(500);

    let songs = crate::db::raw::query_all::<crate::db::models::Song>(
        database.conn(),
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE mf.enabled = 1 AND ula.user_id = ? AND s.marked_for_deletion_at IS NULL
             AND (? IS NULL OR s.genre = ?)
             AND (? IS NULL OR s.year >= ?)
             AND (? IS NULL OR s.year <= ?)
         ORDER BY RANDOM() 
         LIMIT ?",
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE mf.enabled AND ula.user_id = $1 AND s.marked_for_deletion_at IS NULL
             AND ($2::TEXT IS NULL OR s.genre = $3)
             AND ($4::INT4 IS NULL OR s.year >= $5)
             AND ($6::INT4 IS NULL OR s.year <= $7)
         ORDER BY RANDOM() 
         LIMIT $8",
        [
            Value::from(user_id),
            Value::from(genre.clone()),
            Value::from(genre.clone()),
            Value::from(from_year),
            Value::from(from_year),
            Value::from(to_year),
            Value::from(to_year),
            Value::from(size),
        ],
    )
    .await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };

        // For random songs we might want stats too? Subsonic version called `get_song_play_stats`.
        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();

        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            None,
        ));
    }

    Ok(song_responses)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_songs_by_genre_logic(
    database: &crate::db::Database,
    user_id: i64,
    genre: &str,
    count: i64,
    offset: i64,
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> crate::error::Result<Vec<SongResponse>> {
    use crate::api::common::sorting::filter_and_sort_songs;

    let count = count.min(500);

    let songs = crate::db::raw::query_all::<crate::db::models::Song>(
        database.conn(),
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE s.genre = ? AND mf.enabled = 1 AND ula.user_id = ? AND s.marked_for_deletion_at IS NULL
         ORDER BY s.title COLLATE NOCASE
         LIMIT ? OFFSET ?",
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         WHERE s.genre = $1 AND mf.enabled AND ula.user_id = $2 AND s.marked_for_deletion_at IS NULL
         ORDER BY LOWER(s.title), s.title
         LIMIT $3 OFFSET $4",
        [
            Value::from(genre.to_string()),
            Value::from(user_id),
            Value::from(count),
            Value::from(offset),
        ],
    )
    .await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(songs, filter, sort, sort_dir);

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };

        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            None,
        ));
    }

    Ok(song_responses)
}

pub struct ForgottenFavoritesResult {
    pub songs: Vec<SongResponse>,
    pub total: i64,
    pub seed: i64,
}

#[allow(clippy::too_many_arguments)]
pub async fn get_forgotten_favorites_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    min_plays: i64,
    not_played_since_days: i64,
    inline_image_size: Option<ThumbnailSize>,
    seed: Option<i64>,
) -> crate::error::Result<ForgottenFavoritesResult> {
    let size = size.min(1000);
    // Constrain seed to JS Number.MAX_SAFE_INTEGER to avoid precision loss during JSON round-trip
    let actual_seed =
        seed.unwrap_or_else(|| rand::thread_rng().gen_range(0..=9_007_199_254_740_991i64));

    // Find songs with high play counts that haven't been played recently
    let qualifying = if database.is_sqlite() {
        let since_modifier = format!("-{} days", not_played_since_days);
        crate::db::raw::query_all::<SongIdRow>(
            database.conn(),
            "SELECT sc.song_id
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id AND ula.user_id = ?
             WHERE sc.user_id = ? AND sc.submission = 1 AND mf.enabled = 1
                 AND s.marked_for_deletion_at IS NULL
             GROUP BY sc.song_id
             HAVING SUM(sc.play_count) >= ?
                 AND (MAX(sc.played_at) IS NULL OR MAX(sc.played_at) < datetime('now', ?))",
            "SELECT sc.song_id
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id AND ula.user_id = $1
             WHERE sc.user_id = $2 AND sc.submission AND mf.enabled
                 AND s.marked_for_deletion_at IS NULL
             GROUP BY sc.song_id
             HAVING SUM(sc.play_count) >= $3
                 AND (MAX(sc.played_at) IS NULL OR MAX(sc.played_at) < $4)",
            [
                Value::from(user_id),
                Value::from(user_id),
                Value::from(min_plays),
                Value::from(since_modifier),
            ],
        )
        .await?
    } else {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(not_played_since_days);
        crate::db::raw::query_all::<SongIdRow>(
            database.conn(),
            "SELECT sc.song_id
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id AND ula.user_id = ?
             WHERE sc.user_id = ? AND sc.submission = 1 AND mf.enabled = 1
                 AND s.marked_for_deletion_at IS NULL
             GROUP BY sc.song_id
             HAVING SUM(sc.play_count) >= ?
                 AND (MAX(sc.played_at) IS NULL OR MAX(sc.played_at) < datetime('now', ?))",
            "SELECT sc.song_id
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id AND ula.user_id = $1
             WHERE sc.user_id = $2 AND sc.submission AND mf.enabled
                 AND s.marked_for_deletion_at IS NULL
             GROUP BY sc.song_id
             HAVING SUM(sc.play_count) >= $3
                 AND (MAX(sc.played_at) IS NULL OR MAX(sc.played_at) < $4)",
            [
                Value::from(user_id),
                Value::from(user_id),
                Value::from(min_plays),
                Value::from(cutoff),
            ],
        )
        .await?
    };

    let total = qualifying.len() as i64;
    let mut ids: Vec<String> = qualifying.into_iter().map(|row| row.song_id).collect();

    // Seeded shuffle for deterministic pagination with randomness per session
    let mut rng = StdRng::seed_from_u64(actual_seed as u64);
    ids.shuffle(&mut rng);

    // Paginate
    let start = (offset as usize).min(ids.len());
    let end = (start + size as usize).min(ids.len());
    let page_ids = &ids[start..end];

    if page_ids.is_empty() {
        return Ok(ForgottenFavoritesResult {
            songs: Vec::new(),
            total,
            seed: actual_seed,
        });
    }

    let songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, page_ids, user_id).await?;

    // Get starred/rating maps and play stats
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(thumb_size) = inline_image_size {
        let song_album_pairs: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|s| (s.id.clone(), s.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_album_pairs, thumb_size).await
    } else {
        std::collections::HashMap::new()
    };

    let mut song_responses = Vec::new();
    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };
        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;
        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        let cover_art_data = thumbnails.get(&song.id).cloned();
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            cover_art_data,
        ));
    }

    Ok(ForgottenFavoritesResult {
        songs: song_responses,
        total,
        seed: actual_seed,
    })
}

// ============================================================================
// Continue Listening
// ============================================================================

/// A single entry in the "continue listening" section.
/// Can be an album, playlist, smart playlist, or source-specific item like song radio.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningEntry {
    /// "album" | "playlist" | "smartPlaylist" | "songRadio"
    #[serde(rename = "type")]
    pub entry_type: String,
    /// ISO 8601 timestamp of the last scrobble from this source
    pub last_played: String,
    /// Present when entry_type = "album"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<AlbumResponse>,
    /// Present when entry_type = "playlist" or "smartPlaylist"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist: Option<ContinueListeningPlaylist>,
    /// Present when entry_type = "songRadio"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ContinueListeningSource>,
}

/// Minimal playlist info for continue listening entries.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningPlaylist {
    pub id: String,
    pub name: String,
    /// "playlist" or "smartPlaylist"
    pub playlist_type: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    pub cover_art: Option<String>,
}

/// Minimal non-playlist source info for continue listening entries.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningSource {
    pub id: String,
    pub name: String,
    /// "songRadio"
    pub source_type: String,
    pub cover_art: Option<String>,
}

pub struct ContinueListeningResult {
    pub entries: Vec<ContinueListeningEntry>,
    pub total: i64,
}

#[derive(Debug, Clone)]
pub struct ContinueListeningSourceRef {
    pub source_type: String,
    pub source_id: String,
}

fn postgres_placeholders(start_index: usize, count: usize) -> String {
    (start_index..start_index + count)
        .map(|index| format!("${}", index))
        .collect::<Vec<_>>()
        .join(",")
}

async fn get_continue_listening_source_rows(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> crate::error::Result<Vec<ContinueListeningSourceRow>> {
    crate::db::raw::query_all::<ContinueListeningSourceRow>(
        database.conn(),
        "SELECT source_type, source_id, last_played FROM (
             SELECT
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END as source_type,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END as source_id,
                 MAX(sc.played_at) as last_played
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE sc.user_id = ?
               AND mf.enabled = 1
               AND ula.user_id = ?
               AND COALESCE(sc.queue_source_type, '') NOT IN ('forgottenFavorites', 'continueListening')
             GROUP BY
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END
         ) grouped
         ORDER BY last_played DESC
         LIMIT ? OFFSET ?",
        "SELECT source_type, source_id, to_char(last_played AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as last_played
         FROM (
             SELECT
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END as source_type,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END as source_id,
                 MAX(sc.played_at) as last_played
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE sc.user_id = $1
               AND mf.enabled
               AND ula.user_id = $2
               AND COALESCE(sc.queue_source_type, '') NOT IN ('forgottenFavorites', 'continueListening')
             GROUP BY
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END
         ) grouped
         ORDER BY last_played DESC
         LIMIT $3 OFFSET $4",
        [
            Value::from(user_id),
            Value::from(user_id),
            Value::from(size),
            Value::from(offset),
        ],
    )
    .await
    .map_err(Into::into)
}

async fn count_continue_listening_sources(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<i64> {
    query_i64(
        database,
        "SELECT COUNT(*) FROM (
             SELECT 1
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE sc.user_id = ?
               AND mf.enabled = 1
               AND ula.user_id = ?
               AND COALESCE(sc.queue_source_type, '') NOT IN ('forgottenFavorites', 'continueListening')
             GROUP BY
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END
         )",
        "SELECT COUNT(*)::BIGINT FROM (
             SELECT 1
             FROM scrobbles sc
             INNER JOIN songs s ON sc.song_id = s.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             WHERE sc.user_id = $1
               AND mf.enabled
               AND ula.user_id = $2
               AND COALESCE(sc.queue_source_type, '') NOT IN ('forgottenFavorites', 'continueListening')
             GROUP BY
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_type
                     ELSE 'album'
                 END,
                 CASE
                     WHEN sc.queue_source_type IN ('playlist', 'smartPlaylist', 'songRadio')
                          AND sc.queue_source_id IS NOT NULL
                         THEN sc.queue_source_id
                     ELSE s.album_id
                 END
         ) grouped",
        [Value::from(user_id), Value::from(user_id)],
    )
    .await
}

pub async fn get_continue_listening_source_refs(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> crate::error::Result<Vec<ContinueListeningSourceRef>> {
    let size = size.min(500);

    let rows = get_continue_listening_source_rows(database, user_id, size, offset).await?;

    Ok(rows
        .into_iter()
        .map(|row| ContinueListeningSourceRef {
            source_type: row.source_type,
            source_id: row.source_id,
        })
        .collect())
}

/// Get the "continue listening" list: recent playback sources grouped by
/// the actual source (album, playlist, smart playlist, or supported virtual sources).
///
/// Scrobbles with `queue_source_type` in ("playlist", "smartPlaylist", "songRadio")
/// that have a valid `queue_source_id` are grouped by that source. Everything
/// else is grouped by the song's album, except for explicitly excluded virtual
/// sources like forgotten favorites and continue-listening self-echo.
pub async fn get_continue_listening_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    inline_image_size: Option<ThumbnailSize>,
) -> crate::error::Result<ContinueListeningResult> {
    let size = size.min(500);

    let sources = get_continue_listening_source_rows(database, user_id, size, offset).await?;
    let total = count_continue_listening_sources(database, user_id).await?;

    if sources.is_empty() {
        return Ok(ContinueListeningResult {
            entries: Vec::new(),
            total,
        });
    }

    // Step 3: Collect IDs by type for batch fetching
    let mut album_ids: Vec<String> = Vec::new();
    let mut playlist_ids: Vec<String> = Vec::new();
    let mut smart_playlist_ids: Vec<String> = Vec::new();
    let mut song_radio_ids: Vec<String> = Vec::new();

    for source in &sources {
        match source.source_type.as_str() {
            "album" => album_ids.push(source.source_id.clone()),
            "playlist" => playlist_ids.push(source.source_id.clone()),
            "smartPlaylist" => smart_playlist_ids.push(source.source_id.clone()),
            "songRadio" => song_radio_ids.push(source.source_id.clone()),
            _ => {}
        }
    }

    // Step 4: Batch-fetch album details
    let album_map: std::collections::HashMap<String, AlbumResponse> = if !album_ids.is_empty() {
        let albums = fetch_albums_by_ids_in_order(database, &album_ids).await?;

        let ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
        let starred_map = get_starred_map(database, user_id, ItemType::Album, &ids).await?;
        let ratings_map = get_ratings_map(database, user_id, ItemType::Album, &ids).await?;
        let thumbnails = if let Some(size) = inline_image_size {
            get_album_thumbnails_base64(database, &ids, size).await
        } else {
            std::collections::HashMap::new()
        };

        albums
            .into_iter()
            .map(|album| {
                let id = album.id.clone();
                let response = AlbumResponse {
                    id: album.id.clone(),
                    name: album.name,
                    artist: album.artist_name,
                    artist_id: album.artist_id,
                    cover_art: Some(album.id.clone()),
                    cover_art_data: thumbnails.get(&album.id).cloned(),
                    song_count: album.song_count,
                    duration: album.duration,
                    year: album.year,
                    genre: album.genre,
                    created: format_datetime_iso_ms(album.created_at),
                    starred: starred_map.get(&album.id).cloned(),
                    user_rating: ratings_map.get(&album.id).copied(),
                    played: None, // will be set from source data
                };
                (id, response)
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    // Step 5: Batch-fetch regular playlist details
    let playlist_map: std::collections::HashMap<String, ContinueListeningPlaylist> =
        if !playlist_ids.is_empty() {
            let sqlite_sql = format!(
                "SELECT p.id, p.name, p.song_count,
                        COALESCE((
                            SELECT SUM(s.duration)
                            FROM playlist_songs ps
                            JOIN songs s ON s.id = ps.song_id
                            WHERE ps.playlist_id = p.id
                        ), 0) as duration
                 FROM playlists p
                 WHERE p.id IN ({})",
                sqlite_placeholders(playlist_ids.len())
            );
            let postgres_sql = format!(
                "SELECT p.id, p.name, p.song_count,
                        COALESCE((
                            SELECT SUM(s.duration)::BIGINT
                            FROM playlist_songs ps
                            JOIN songs s ON s.id = ps.song_id
                            WHERE ps.playlist_id = p.id
                        ), 0)::BIGINT as duration
                 FROM playlists p
                 WHERE p.id IN ({})",
                postgres_placeholders(1, playlist_ids.len())
            );
            let rows = crate::db::raw::query_all::<ContinueListeningPlaylistRow>(
                database.conn(),
                &sqlite_sql,
                &postgres_sql,
                playlist_ids.iter().cloned().map(Value::from),
            )
            .await?;
            rows.into_iter()
                .map(|row| {
                    let id = row.id;
                    (
                        id.clone(),
                        ContinueListeningPlaylist {
                            cover_art: Some(id.clone()),
                            id,
                            name: row.name,
                            playlist_type: "playlist".to_string(),
                            song_count: row.song_count,
                            duration: row.duration,
                        },
                    )
                })
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    // Step 6: Batch-fetch smart playlist details
    let smart_playlist_map: std::collections::HashMap<String, ContinueListeningPlaylist> =
        if !smart_playlist_ids.is_empty() {
            let sqlite_sql = format!(
                "SELECT sp.id, sp.name FROM smart_playlists sp WHERE sp.id IN ({})",
                sqlite_placeholders(smart_playlist_ids.len())
            );
            let postgres_sql = format!(
                "SELECT sp.id, sp.name FROM smart_playlists sp WHERE sp.id IN ({})",
                postgres_placeholders(1, smart_playlist_ids.len())
            );
            let rows = crate::db::raw::query_all::<NamedIdRow>(
                database.conn(),
                &sqlite_sql,
                &postgres_sql,
                smart_playlist_ids.iter().cloned().map(Value::from),
            )
            .await?;
            let mut map = std::collections::HashMap::with_capacity(rows.len());
            for row in rows {
                let id = row.id;
                let songs =
                    get_smart_playlist_songs_by_id(database, &id, user_id, None, None).await?;
                let duration = songs.iter().map(|song| song.duration).sum();
                map.insert(
                    id.clone(),
                    ContinueListeningPlaylist {
                        id: id.clone(),
                        name: row.name,
                        playlist_type: "smartPlaylist".to_string(),
                        song_count: songs.len() as i64,
                        duration,
                        cover_art: Some(format!("sp-{}", id)),
                    },
                );
            }
            map
        } else {
            std::collections::HashMap::new()
        };

    // Step 7: Batch-fetch source-specific details for song radio entries.
    let song_radio_map: std::collections::HashMap<String, ContinueListeningSource> =
        if !song_radio_ids.is_empty() {
            crate::db::repo::browse::get_songs_by_ids_for_user(database, &song_radio_ids, user_id)
                .await?
                .into_iter()
                .map(|song| {
                    let id = song.id.clone();
                    (
                        id.clone(),
                        ContinueListeningSource {
                            id,
                            name: format!("{} Radio", song.title),
                            source_type: "songRadio".to_string(),
                            cover_art: song.album_id.clone().or_else(|| Some(song.id.clone())),
                        },
                    )
                })
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    // Step 8: Assemble entries in source order (already sorted by last_played DESC)
    let entries: Vec<ContinueListeningEntry> = sources
        .into_iter()
        .filter_map(|source| {
            let source_type = source.source_type;
            let source_id = source.source_id;
            let last_played = source.last_played;

            match source_type.as_str() {
                "album" => {
                    let mut album = album_map.get(&source_id).cloned()?;
                    album.played = Some(last_played.clone());
                    Some(ContinueListeningEntry {
                        entry_type: "album".to_string(),
                        last_played,
                        album: Some(album),
                        playlist: None,
                        source: None,
                    })
                }
                "playlist" => {
                    let playlist = playlist_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "playlist".to_string(),
                        last_played,
                        album: None,
                        playlist: Some(playlist),
                        source: None,
                    })
                }
                "smartPlaylist" => {
                    let playlist = smart_playlist_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "smartPlaylist".to_string(),
                        last_played,
                        album: None,
                        playlist: Some(playlist),
                        source: None,
                    })
                }
                "songRadio" => {
                    let source = song_radio_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "songRadio".to_string(),
                        last_played,
                        album: None,
                        playlist: None,
                        source: Some(source),
                    })
                }
                _ => None,
            }
        })
        .collect();

    Ok(ContinueListeningResult { entries, total })
}
