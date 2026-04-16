//! Common starring and rating utilities.
//!
//! This module provides shared functionality for starring/favoriting items
//! and rating operations, used by both Subsonic and Ferrotune APIs.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::utils::format_datetime_iso;
use crate::db::models::ItemType;
use crate::db::retry::with_retry;
use crate::db::DatabaseHandle;
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPool, SqlitePool};
use std::collections::HashMap;

fn postgres_placeholders(start_index: usize, count: usize) -> String {
    (start_index..start_index + count)
        .map(|index| format!("${}", index))
        .collect::<Vec<_>>()
        .join(", ")
}

fn unsupported_database_error() -> crate::error::Error {
    crate::error::Error::Internal(
        "database handle exposed neither a SQLite nor PostgreSQL pool".to_string(),
    )
}

async fn star_item_ids_sqlite(
    pool: &SqlitePool,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
    now: &DateTime<Utc>,
) -> sqlx::Result<()> {
    let item_type = item_type.to_string();
    let now = now.to_owned();

    for id in item_ids {
        let pool = pool.clone();
        let id = id.clone();
        let item_type = item_type.clone();
        let now = now.to_owned();
        with_retry(
            || {
                let pool = pool.clone();
                let id = id.clone();
                let item_type = item_type.clone();
                let now = now.to_owned();
                async move {
                    sqlx::query(
                        "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) \
                         VALUES (?, ?, ?, ?)",
                    )
                    .bind(user_id)
                    .bind(&item_type)
                    .bind(&id)
                    .bind(now)
                    .execute(&pool)
                    .await
                }
            },
            None,
        )
        .await?;
    }

    Ok(())
}

async fn star_item_ids_postgres(
    pool: &PgPool,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
    now: &DateTime<Utc>,
) -> sqlx::Result<()> {
    let item_type = item_type.to_string();
    let now = now.to_owned();

    for id in item_ids {
        let pool = pool.clone();
        let id = id.clone();
        let item_type = item_type.clone();
        let now = now.to_owned();
        with_retry(
            || {
                let pool = pool.clone();
                let id = id.clone();
                let item_type = item_type.clone();
                let now = now.to_owned();
                async move {
                    sqlx::query(
                        "INSERT INTO starred (user_id, item_type, item_id, starred_at) \
                         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
                    )
                    .bind(user_id)
                    .bind(&item_type)
                    .bind(&id)
                    .bind(now)
                    .execute(&pool)
                    .await
                }
            },
            None,
        )
        .await?;
    }

    Ok(())
}

async fn unstar_item_ids_sqlite(
    pool: &SqlitePool,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
) -> sqlx::Result<()> {
    let item_type = item_type.to_string();

    for id in item_ids {
        let pool = pool.clone();
        let id = id.clone();
        let item_type = item_type.clone();
        with_retry(
            || {
                let pool = pool.clone();
                let id = id.clone();
                let item_type = item_type.clone();
                async move {
                    sqlx::query(
                        "DELETE FROM starred WHERE user_id = ? AND item_type = ? AND item_id = ?",
                    )
                    .bind(user_id)
                    .bind(&item_type)
                    .bind(&id)
                    .execute(&pool)
                    .await
                }
            },
            None,
        )
        .await?;
    }

    Ok(())
}

async fn unstar_item_ids_postgres(
    pool: &PgPool,
    user_id: i64,
    item_type: &str,
    item_ids: &[String],
) -> sqlx::Result<()> {
    let item_type = item_type.to_string();

    for id in item_ids {
        let pool = pool.clone();
        let id = id.clone();
        let item_type = item_type.clone();
        with_retry(
            || {
                let pool = pool.clone();
                let id = id.clone();
                let item_type = item_type.clone();
                async move {
                    sqlx::query(
                        "DELETE FROM starred WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
                    )
                    .bind(user_id)
                    .bind(&item_type)
                    .bind(&id)
                    .execute(&pool)
                    .await
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
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, String>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results: Vec<(String, DateTime<Utc>)> = if let Ok(pool) = database.sqlite_pool() {
        let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
            placeholders.join(", ")
        );

        let mut query_builder = sqlx::query_as::<_, (String, DateTime<Utc>)>(&query)
            .bind(user_id)
            .bind(item_type.as_str());

        for id in item_ids {
            query_builder = query_builder.bind(id);
        }

        query_builder.fetch_all(pool).await?
    } else if let Ok(pool) = database.postgres_pool() {
        let query = format!(
            "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = $2 AND item_id IN ({})",
            postgres_placeholders(3, item_ids.len())
        );

        let mut query_builder = sqlx::query_as::<_, (String, DateTime<Utc>)>(&query)
            .bind(user_id)
            .bind(item_type.as_str());

        for id in item_ids {
            query_builder = query_builder.bind(id);
        }

        query_builder.fetch_all(pool).await?
    } else {
        return Err(crate::error::Error::Internal(
            "database handle exposed neither a SQLite nor PostgreSQL pool".to_string(),
        ));
    };

    Ok(results
        .into_iter()
        .map(|(id, ts)| (id, format_datetime_iso(ts)))
        .collect())
}

/// Get ratings for multiple items of a given type for a user
pub async fn get_ratings_map(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    item_type: ItemType,
    item_ids: &[String],
) -> crate::error::Result<HashMap<String, i32>> {
    if item_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let results: Vec<(String, i32)> = if let Ok(pool) = database.sqlite_pool() {
        let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT item_id, rating FROM ratings WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
            placeholders.join(", ")
        );

        let mut query_builder = sqlx::query_as::<_, (String, i32)>(&query)
            .bind(user_id)
            .bind(item_type.as_str());

        for id in item_ids {
            query_builder = query_builder.bind(id);
        }

        query_builder.fetch_all(pool).await?
    } else if let Ok(pool) = database.postgres_pool() {
        let query = format!(
            "SELECT item_id, rating FROM ratings WHERE user_id = $1 AND item_type = $2 AND item_id IN ({})",
            postgres_placeholders(3, item_ids.len())
        );

        let mut query_builder = sqlx::query_as::<_, (String, i32)>(&query)
            .bind(user_id)
            .bind(item_type.as_str());

        for id in item_ids {
            query_builder = query_builder.bind(id);
        }

        query_builder.fetch_all(pool).await?
    } else {
        return Err(crate::error::Error::Internal(
            "database handle exposed neither a SQLite nor PostgreSQL pool".to_string(),
        ));
    };

    Ok(results.into_iter().collect())
}

// ============================================================================
// Core starring/unstarring operations
// ============================================================================

/// Star multiple items of different types
pub async fn star_items(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    let now = Utc::now();

    if let Ok(pool) = database.sqlite_pool() {
        star_item_ids_sqlite(pool, user_id, "song", song_ids, &now).await?;
        star_item_ids_sqlite(pool, user_id, "album", album_ids, &now).await?;
        star_item_ids_sqlite(pool, user_id, "artist", artist_ids, &now).await?;
        return Ok(());
    }

    if let Ok(pool) = database.postgres_pool() {
        star_item_ids_postgres(pool, user_id, "song", song_ids, &now).await?;
        star_item_ids_postgres(pool, user_id, "album", album_ids, &now).await?;
        star_item_ids_postgres(pool, user_id, "artist", artist_ids, &now).await?;
        return Ok(());
    }

    Err(unsupported_database_error())
}

/// Unstar multiple items of different types
pub async fn unstar_items(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    song_ids: &[String],
    album_ids: &[String],
    artist_ids: &[String],
) -> crate::error::Result<()> {
    if let Ok(pool) = database.sqlite_pool() {
        unstar_item_ids_sqlite(pool, user_id, "song", song_ids).await?;
        unstar_item_ids_sqlite(pool, user_id, "album", album_ids).await?;
        unstar_item_ids_sqlite(pool, user_id, "artist", artist_ids).await?;
        return Ok(());
    }

    if let Ok(pool) = database.postgres_pool() {
        unstar_item_ids_postgres(pool, user_id, "song", song_ids).await?;
        unstar_item_ids_postgres(pool, user_id, "album", album_ids).await?;
        unstar_item_ids_postgres(pool, user_id, "artist", artist_ids).await?;
        return Ok(());
    }

    Err(unsupported_database_error())
}

/// Determine item type by checking which table contains the ID
pub async fn detect_item_type(
    database: &(impl DatabaseHandle + ?Sized),
    id: &str,
) -> crate::error::Result<ItemType> {
    if crate::db::queries::get_song_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Song)
    } else if crate::db::queries::get_album_by_id(database, id)
        .await?
        .is_some()
    {
        Ok(ItemType::Album)
    } else if crate::db::queries::get_artist_by_id(database, id)
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
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    id: &str,
    rating: i32,
) -> crate::error::Result<()> {
    // Determine item type
    let item_type = detect_item_type(database, id).await?;

    if rating == 0 {
        if let Ok(pool) = database.sqlite_pool() {
            sqlx::query("DELETE FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?")
                .bind(user_id)
                .bind(item_type.as_str())
                .bind(id)
                .execute(pool)
                .await?;
            return Ok(());
        }

        if let Ok(pool) = database.postgres_pool() {
            sqlx::query(
                "DELETE FROM ratings WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
            )
            .bind(user_id)
            .bind(item_type.as_str())
            .bind(id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        return Err(unsupported_database_error());
    }

    let now = Utc::now();

    if let Ok(pool) = database.sqlite_pool() {
        sqlx::query(
            "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = ?, rated_at = ?",
        )
        .bind(user_id)
        .bind(item_type.as_str())
        .bind(id)
        .bind(rating)
        .bind(now)
        .bind(rating)
        .bind(now)
        .execute(pool)
        .await?;
        return Ok(());
    }

    if let Ok(pool) = database.postgres_pool() {
        sqlx::query(
            "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = $6, rated_at = $7",
        )
        .bind(user_id)
        .bind(item_type.as_str())
        .bind(id)
        .bind(rating)
        .bind(now)
        .bind(rating)
        .bind(now)
        .execute(pool)
        .await?;
        return Ok(());
    }

    Err(unsupported_database_error())
}

// ============================================================================
// Fetch starred content
// ============================================================================

/// Fetch all starred content for a user (artists, albums, songs)
/// This is the shared implementation used by both getStarred and getStarred2 endpoints
pub async fn fetch_starred_content(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
) -> crate::error::Result<(Vec<ArtistResponse>, Vec<AlbumResponse>, Vec<SongResponse>)> {
    let starred_artists: Vec<(String, DateTime<Utc>)> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(
            "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else if let Ok(pool) = database.postgres_pool() {
        sqlx::query_as(
            "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = 'artist' ORDER BY starred_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        return Err(unsupported_database_error());
    };

    // Get ratings for starred artists
    let artist_ids: Vec<String> = starred_artists.iter().map(|(id, _)| id.clone()).collect();
    let artist_ratings = get_ratings_map(database, user_id, ItemType::Artist, &artist_ids).await?;

    let mut artist_responses = Vec::new();
    for (id, starred_at) in starred_artists {
        if let Some(artist) = crate::db::queries::get_artist_by_id(database, &id).await? {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                song_count: Some(artist.song_count),
                cover_art: Some(artist.id.clone()),
                cover_art_data: None,
                starred: Some(format_datetime_iso(starred_at)),
                user_rating: artist_ratings.get(&artist.id).copied(),
            });
        }
    }

    // Get starred albums with their starred_at timestamps
    let starred_albums: Vec<(String, DateTime<Utc>)> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(
            "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'album' ORDER BY starred_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else if let Ok(pool) = database.postgres_pool() {
        sqlx::query_as(
            "SELECT item_id, starred_at FROM starred WHERE user_id = $1 AND item_type = 'album' ORDER BY starred_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        return Err(unsupported_database_error());
    };

    // Get ratings for starred albums
    let album_ids: Vec<String> = starred_albums.iter().map(|(id, _)| id.clone()).collect();
    let album_ratings = get_ratings_map(database, user_id, ItemType::Album, &album_ids).await?;

    let mut album_responses = Vec::new();
    for (id, starred_at) in starred_albums {
        if let Some(album) = crate::db::queries::get_album_by_id(database, &id).await? {
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
                starred: Some(format_datetime_iso(starred_at)),
                user_rating: album_ratings.get(&album.id).copied(),
                played: None,
            });
        }
    }

    // Get starred songs with play counts via join, filtered by enabled music folders
    let starred_songs: Vec<crate::db::models::Song> = if let Ok(pool) = database.sqlite_pool() {
        sqlx::query_as(
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
        )
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else if let Ok(pool) = database.postgres_pool() {
        sqlx::query_as(
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
        )
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        return Err(unsupported_database_error());
    };

    // Get ratings for starred songs
    let song_ids: Vec<String> = starred_songs.iter().map(|s| s.id.clone()).collect();
    let song_ratings = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();
    for song in starred_songs {
        let song_id = song.id.clone();
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(database, album_id).await?
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
