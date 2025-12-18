//! Starring and rating endpoints for the Ferrotune API.
//!
//! This module provides starring/favoriting and rating endpoints migrated from
//! the OpenSubsonic API, using proper HTTP status codes.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::starring::get_ratings_map;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Star/Unstar Endpoints
// ============================================================================

/// Request body for star/unstar operations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarRequest {
    /// Song IDs to star/unstar
    #[serde(default)]
    pub id: Vec<String>,
    /// Album IDs to star/unstar
    #[serde(default)]
    pub album_id: Vec<String>,
    /// Artist IDs to star/unstar
    #[serde(default)]
    pub artist_id: Vec<String>,
}

/// POST /ferrotune/star - Star (favorite) items
pub async fn star(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StarRequest>,
) -> FerrotuneApiResult<StatusCode> {
    let now = Utc::now();

    // Star songs
    for id in &request.id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'song', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    // Star albums
    for id in &request.album_id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'album', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    // Star artists
    for id in &request.artist_id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'artist', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /ferrotune/unstar - Unstar (unfavorite) items
pub async fn unstar(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StarRequest>,
) -> FerrotuneApiResult<StatusCode> {
    // Unstar songs
    for id in &request.id {
        sqlx::query("DELETE FROM starred WHERE user_id = ? AND item_type = 'song' AND item_id = ?")
            .bind(user.user_id)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }

    // Unstar albums
    for id in &request.album_id {
        sqlx::query(
            "DELETE FROM starred WHERE user_id = ? AND item_type = 'album' AND item_id = ?",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    }

    // Unstar artists
    for id in &request.artist_id {
        sqlx::query(
            "DELETE FROM starred WHERE user_id = ? AND item_type = 'artist' AND item_id = ?",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Rating Endpoint
// ============================================================================

/// Request body for rating operations
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingRequest {
    /// Item ID to rate
    pub id: String,
    /// Rating value (0-5, where 0 removes the rating)
    pub rating: i32,
}

/// POST /ferrotune/rating - Set rating for an item
pub async fn set_rating(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RatingRequest>,
) -> FerrotuneApiResult<StatusCode> {
    if request.rating < 0 || request.rating > 5 {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "Rating must be between 0 and 5".to_string(),
        )));
    }

    // Determine item type by checking which table contains this ID
    let item_type = if crate::db::queries::get_song_by_id(&state.pool, &request.id)
        .await?
        .is_some()
    {
        "song"
    } else if crate::db::queries::get_album_by_id(&state.pool, &request.id)
        .await?
        .is_some()
    {
        "album"
    } else if crate::db::queries::get_artist_by_id(&state.pool, &request.id)
        .await?
        .is_some()
    {
        "artist"
    } else {
        return Err(FerrotuneApiError::from(Error::NotFound(format!(
            "Item {} not found",
            request.id
        ))));
    };

    if request.rating == 0 {
        // Remove rating
        sqlx::query("DELETE FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?")
            .bind(user.user_id)
            .bind(item_type)
            .bind(&request.id)
            .execute(&state.pool)
            .await?;
    } else {
        // Insert or update rating
        sqlx::query(
            "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = ?, rated_at = ?",
        )
        .bind(user.user_id)
        .bind(item_type)
        .bind(&request.id)
        .bind(request.rating)
        .bind(Utc::now())
        .bind(request.rating)
        .bind(Utc::now())
        .execute(&state.pool)
        .await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Get Starred Endpoint
// ============================================================================

/// Response for get starred items
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneStarredResponse {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artists: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub albums: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub songs: Vec<SongResponse>,
}

/// GET /ferrotune/starred - Get all starred items for the current user
pub async fn get_starred(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<FerrotuneStarredResponse>> {
    // Get starred artists with their starred_at timestamps
    let starred_artists: Vec<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC"
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    // Get ratings for starred artists
    let artist_ids: Vec<String> = starred_artists.iter().map(|(id, _)| id.clone()).collect();
    let artist_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Artist, &artist_ids).await?;

    let mut artist_responses = Vec::new();
    for (id, starred_at) in starred_artists {
        if let Some(artist) = crate::db::queries::get_artist_by_id(&state.pool, &id).await? {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                cover_art: Some(artist.id.clone()),
                cover_art_data: None,
                starred: Some(starred_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                user_rating: artist_ratings.get(&artist.id).copied(),
            });
        }
    }

    // Get starred albums with their starred_at timestamps
    let starred_albums: Vec<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'album' ORDER BY starred_at DESC"
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    // Get ratings for starred albums
    let album_ids: Vec<String> = starred_albums.iter().map(|(id, _)| id.clone()).collect();
    let album_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Album, &album_ids).await?;

    let mut album_responses = Vec::new();
    for (id, starred_at) in starred_albums {
        if let Some(album) = crate::db::queries::get_album_by_id(&state.pool, &id).await? {
            let created = album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
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
                starred: Some(starred_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                user_rating: album_ratings.get(&album.id).copied(),
            });
        }
    }

    // Get starred songs with play counts via join, filtered by enabled music folders
    let starred_songs: Vec<crate::db::models::Song> = sqlx::query_as(
        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                  s.track_number, s.disc_number, s.year, s.genre, s.duration,
                  s.bitrate, s.file_path, s.file_size, s.file_format, 
                  s.created_at, s.updated_at, s.cover_art_hash,
                  pc.play_count,
                  pc.last_played,
                  st.starred_at
           FROM starred st
           INNER JOIN songs s ON st.item_id = s.id
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           LEFT JOIN (
               SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
               FROM scrobbles WHERE submission = 1
               GROUP BY song_id
           ) pc ON s.id = pc.song_id
           WHERE st.user_id = ? AND st.item_type = 'song' AND mf.enabled = 1
           ORDER BY st.starred_at DESC"#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    // Get ratings for starred songs
    let song_ids: Vec<String> = starred_songs.iter().map(|s| s.id.clone()).collect();
    let song_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();
    for song in starred_songs {
        let song_id = song.id.clone();
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };
        let starred = song
            .starred_at
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
        let user_rating = song_ratings.get(&song_id).copied();
        let play_stats = SongPlayStats {
            play_count: song.play_count,
            last_played: song
                .last_played
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
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

    Ok(Json(FerrotuneStarredResponse {
        artists: artist_responses,
        albums: album_responses,
        songs: song_responses,
    }))
}
