//! Common starring and rating utilities.
//!
//! This module provides shared functionality for starring/favoriting items
//! and rating operations, used by both Subsonic and Ferrotune APIs.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::utils::format_datetime_iso;
use crate::db::models::ItemType;
use crate::db::raw;
use crate::db::retry::with_retry;
use chrono::{DateTime, Utc};
use sea_orm::{FromQueryResult, Value};
use std::collections::HashMap;

fn sqlite_placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn postgres_placeholders(start_index: usize, count: usize) -> String {
    (start_index..start_index + count)
        .map(|index| format!("${}", index))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(FromQueryResult)]
struct StarredRow {
    item_id: String,
    starred_at: DateTime<Utc>,
}

#[derive(FromQueryResult)]
struct RatingRow {
    item_id: String,
    rating: i32,
}

async fn star_item_ids(
    database: &crate::db::Database,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
    now: &DateTime<Utc>,
) -> crate::error::Result<()> {
    for id in item_ids {
        let id = id.clone();
        let item_type = item_type.to_string();
        let now = *now;
        with_retry(
            || {
                let id = id.clone();
                let item_type = item_type.clone();
                async move {
                    raw::execute(
                        database.conn(),
                        "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) \
                         VALUES (?, ?, ?, ?)",
                        "INSERT INTO starred (user_id, item_type, item_id, starred_at) \
                         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
                        [
                            Value::from(user_id),
                            Value::from(item_type),
                            Value::from(id),
                            Value::from(now),
                        ],
                    )
                    .await
                    .map(|_| ())
                }
            },
            None,
        )
        .await?;
    }
    Ok(())
}

async fn unstar_item_ids(
    database: &crate::db::Database,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
) -> crate::error::Result<()> {
    for id in item_ids {
        let id = id.clone();
        let item_type = item_type.to_string();
        with_retry(
            || {
                let id = id.clone();
                let item_type = item_type.clone();
                async move {
                    raw::execute(
                        database.conn(),
                        "DELETE FROM starred WHERE user_id = ? AND item_type = ? AND item_id = ?",
                        "DELETE FROM starred WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
                        [
                            Value::from(user_id),
                            Value::from(item_type),
                            Value::from(id),
                        ],
                    )
                    .await
                    .map(|_| ())
                }
            },
            None,
        )
        .await?;
    }
    Ok(())
}

/// Get starred timestamps for multiple items of a given type for a user
pub async fn get_starred_map(
    database: &crate::db::Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, String>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let sqlite_sql = format!(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        sqlite_placeholders(item_ids.len())
    );
    let postgres_sql = format!(
        "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = $2 AND item_id IN ({})",
        postgres_placeholders(3, item_ids.len())
    );

    let mut params: Vec<Value> = Vec::with_capacity(2 + item_ids.len());
    params.push(Value::from(user_id));
    params.push(Value::from(item_type.as_str().to_string()));
    for id in item_ids {
        params.push(Value::from(id.clone()));
    }

    let results =
        raw::query_all::<StarredRow>(database.conn(), &sqlite_sql, &postgres_sql, params).await?;

    Ok(results
        .into_iter()
        .map(|r| (r.item_id, format_datetime_iso(r.starred_at)))
        .collect())
}

/// Get ratings for multiple items of a given type for a user
pub async fn get_ratings_map(
    database: &crate::db::Database,
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, i32>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let sqlite_sql = format!(
        "SELECT item_id, rating FROM ratings WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        sqlite_placeholders(item_ids.len())
    );
    let postgres_sql = format!(
        "SELECT item_id, rating FROM ratings WHERE user_id = $1 AND item_type = $2 AND item_id IN ({})",
        postgres_placeholders(3, item_ids.len())
    );

    let mut params: Vec<Value> = Vec::with_capacity(2 + item_ids.len());
    params.push(Value::from(user_id));
    params.push(Value::from(item_type.as_str().to_string()));
    for id in item_ids {
        params.push(Value::from(id.clone()));
    }

    let results =
        raw::query_all::<RatingRow>(database.conn(), &sqlite_sql, &postgres_sql, params).await?;

    Ok(results.into_iter().map(|r| (r.item_id, r.rating)).collect())
}

// ============================================================================
// Core starring/unstarring operations
// ============================================================================

/// Star multiple items of different types
pub async fn star_items(
    database: &crate::db::Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    let now = Utc::now();
    star_item_ids(database, user_id, "song", song_ids, &now).await?;
    star_item_ids(database, user_id, "album", album_ids, &now).await?;
    star_item_ids(database, user_id, "artist", artist_ids, &now).await?;
    Ok(())
}

/// Unstar multiple items of different types
pub async fn unstar_items(
    database: &crate::db::Database,
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    unstar_item_ids(database, user_id, "song", song_ids).await?;
    unstar_item_ids(database, user_id, "album", album_ids).await?;
    unstar_item_ids(database, user_id, "artist", artist_ids).await?;
    Ok(())
}

/// Determine item type by checking which table contains the ID
pub async fn detect_item_type(
    database: &crate::db::Database,
    id: &str,
) -> crate::error::Result<ItemType> {
    if crate::db::repo::browse::get_song_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Song)
    } else if crate::db::repo::browse::get_album_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Album)
    } else if crate::db::repo::browse::get_artist_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Artist)
    } else {
        Err(crate::error::Error::NotFound(format!(
            "Item {} not found",
            id
        )))
    }
}

/// Set or remove a rating for an item
pub async fn set_item_rating(
    database: &crate::db::Database,
    user_id: i64,
    id: &str,
    rating: i32,
) -> crate::error::Result<()> {
    let item_type = detect_item_type(database, id).await?;

    if rating == 0 {
        raw::execute(
            database.conn(),
            "DELETE FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?",
            "DELETE FROM ratings WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
            [
                Value::from(user_id),
                Value::from(item_type.as_str().to_string()),
                Value::from(id.to_string()),
            ],
        )
        .await?;
        return Ok(());
    }

    let now = Utc::now();
    raw::execute(
        database.conn(),
        "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = ?, rated_at = ?",
        "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = $6, rated_at = $7",
        [
            Value::from(user_id),
            Value::from(item_type.as_str().to_string()),
            Value::from(id.to_string()),
            Value::from(rating),
            Value::from(now),
            Value::from(rating),
            Value::from(now),
        ],
    )
    .await?;
    Ok(())
}

// ============================================================================
// Fetch starred content
// ============================================================================

/// Fetch all starred content for a user (artists, albums, songs)
/// This is the shared implementation used by both getStarred and getStarred2 endpoints
pub async fn fetch_starred_content(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<(Vec<ArtistResponse>, Vec<AlbumResponse>, Vec<SongResponse>)> {
    let starred_artists = raw::query_all::<StarredRow>(
        database.conn(),
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC",
        "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = 'artist' ORDER BY starred_at DESC",
        [Value::from(user_id)],
    )
    .await?;

    let artist_ids: Vec<String> = starred_artists.iter().map(|r| r.item_id.clone()).collect();
    let artist_ratings = get_ratings_map(database, user_id, ItemType::Artist, &artist_ids).await?;

    let mut artist_responses = Vec::new();
    for row in starred_artists {
        if let Some(artist) =
            crate::db::repo::browse::get_artist_by_id(database, &row.item_id).await?
        {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                song_count: Some(artist.song_count),
                cover_art: Some(artist.id.clone()),
                cover_art_data: None,
                starred: Some(format_datetime_iso(row.starred_at)),
                user_rating: artist_ratings.get(&artist.id).copied(),
            });
        }
    }

    let starred_albums = raw::query_all::<StarredRow>(
        database.conn(),
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'album' ORDER BY starred_at DESC",
        "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = 'album' ORDER BY starred_at DESC",
        [Value::from(user_id)],
    )
    .await?;

    let album_ids: Vec<String> = starred_albums.iter().map(|r| r.item_id.clone()).collect();
    let album_ratings = get_ratings_map(database, user_id, ItemType::Album, &album_ids).await?;

    let mut album_responses = Vec::new();
    for row in starred_albums {
        if let Some(album) =
            crate::db::repo::browse::get_album_by_id(database, &row.item_id).await?
        {
            use crate::api::common::utils::format_datetime_iso_ms;
            let created = format_datetime_iso_ms(album.created_at);
            album_responses.push(AlbumResponse {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id.clone()),
                cover_art_data: None,
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: Some(format_datetime_iso(row.starred_at)),
                user_rating: album_ratings.get(&album.id).copied(),
                played: None,
            });
        }
    }

    let starred_songs = raw::query_all::<crate::db::models::Song>(
        database.conn(),
        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                  s.track_number, s.disc_number, s.year, s.genre, s.duration,
                  s.bitrate, s.file_path, s.file_size, s.file_format,
                  s.created_at, s.updated_at, s.cover_art_hash,
                  s.cover_art_width, s.cover_art_height,
                  s.original_replaygain_track_gain, s.original_replaygain_track_peak,
                  s.computed_replaygain_track_gain, s.computed_replaygain_track_peak,
                  pc.play_count,
                  pc.last_played,
                  st.starred_at
           FROM starred st
           INNER JOIN songs s ON st.item_id = s.id
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (
               SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
               FROM scrobbles WHERE submission = 1 AND user_id = ?
               GROUP BY song_id
           ) pc ON s.id = pc.song_id
           WHERE st.user_id = ? AND st.item_type = 'song' AND mf.enabled = 1 AND ula.user_id = ?
           ORDER BY st.starred_at DESC"#,
        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                  s.track_number, s.disc_number, s.year, s.genre, s.duration,
                  s.bitrate, s.file_path, s.file_size, s.file_format,
                  s.created_at, s.updated_at, s.cover_art_hash,
                  s.cover_art_width, s.cover_art_height,
                  s.original_replaygain_track_gain, s.original_replaygain_track_peak,
                  s.computed_replaygain_track_gain, s.computed_replaygain_track_peak,
                  pc.play_count,
                  pc.last_played,
                  st.starred_at
           FROM starred st
           INNER JOIN songs s ON st.item_id = s.id
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (
               SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
               FROM scrobbles WHERE submission AND user_id = $1
               GROUP BY song_id
           ) pc ON s.id = pc.song_id
           WHERE st.user_id = $2 AND st.item_type = 'song' AND mf.enabled AND ula.user_id = $3
           ORDER BY st.starred_at DESC"#,
        [
            Value::from(user_id),
            Value::from(user_id),
            Value::from(user_id),
        ],
    )
    .await?;

    let song_ids: Vec<String> = starred_songs.iter().map(|s| s.id.clone()).collect();
    let song_ratings = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();
    for song in starred_songs {
        let song_id = song.id.clone();
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };
        let starred = song.starred_at.map(format_datetime_iso);
        let user_rating = song_ratings.get(&song_id).copied();
        let play_stats = SongPlayStats {
            play_count: song.play_count,
            last_played: song.last_played.map(format_datetime_iso),
        };
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

    Ok((artist_responses, album_responses, song_responses))
}
