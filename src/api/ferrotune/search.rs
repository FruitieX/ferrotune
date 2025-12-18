//! Search endpoints for the Ferrotune API.
//!
//! This module provides search endpoints migrated from the OpenSubsonic API,
//! using proper HTTP status codes and simpler JSON responses.

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::{AlbumResponse, ArtistResponse, SongPlayStats, SongResponse};
use crate::api::common::search::{search_albums, search_artists, search_songs, SearchParams};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_artist_thumbnails_base64, get_song_thumbnails_base64,
};
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::error::FerrotuneApiResult;
use crate::thumbnails::ThumbnailSize;
use axum::extract::{Query, State};
use axum::Json;
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Search Endpoint
// ============================================================================

/// Response for search results
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSearchResponse {
    pub search_result: FerrotuneSearchContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSearchContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
    /// Total count of matching artists
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub artist_total: Option<i64>,
    /// Total count of matching albums
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_total: Option<i64>,
    /// Total count of matching songs
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub song_total: Option<i64>,
}

/// GET /ferrotune/search - Search for artists, albums, or songs
pub async fn search(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> FerrotuneApiResult<Json<FerrotuneSearchResponse>> {
    let artist_count = params.artist_count.unwrap_or(20).min(500) as i64;
    let artist_offset = params.artist_offset.unwrap_or(0) as i64;
    let album_count = params.album_count.unwrap_or(20).min(500) as i64;
    let album_offset = params.album_offset.unwrap_or(0) as i64;
    let song_count = params.song_count.unwrap_or(20).min(500) as i64;
    let song_offset = params.song_offset.unwrap_or(0) as i64;

    // Parse inline images parameter
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    // --- Search Artists using common logic ---
    let artist_result = search_artists(
        &state.pool,
        user.user_id,
        &params.query,
        &params,
        artist_count,
        artist_offset,
    )
    .await?;

    let artist_ids: Vec<String> = artist_result.artists.iter().map(|a| a.id.clone()).collect();
    let artist_starred =
        get_starred_map(&state.pool, user.user_id, ItemType::Artist, &artist_ids).await?;
    let artist_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Artist, &artist_ids).await?;

    // Get inline thumbnails for artists if requested
    let artist_thumbnails = if let Some(size) = inline_size {
        get_artist_thumbnails_base64(&state.pool, &artist_ids, size).await
    } else {
        std::collections::HashMap::new()
    };

    let artist_responses: Vec<ArtistResponse> = artist_result
        .artists
        .into_iter()
        .map(|artist| ArtistResponse {
            id: artist.id.clone(),
            name: artist.name.clone(),
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
            cover_art_data: artist_thumbnails.get(&artist.id).cloned(),
            starred: artist_starred.get(&artist.id).cloned(),
            user_rating: artist_ratings.get(&artist.id).copied(),
        })
        .collect();

    // --- Search Albums using common logic ---
    let album_result = search_albums(
        &state.pool,
        user.user_id,
        &params.query,
        &params,
        album_count,
        album_offset,
    )
    .await?;

    let album_ids: Vec<String> = album_result.albums.iter().map(|a| a.id.clone()).collect();
    let album_starred =
        get_starred_map(&state.pool, user.user_id, ItemType::Album, &album_ids).await?;
    let album_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Album, &album_ids).await?;

    // Get inline thumbnails for albums if requested
    let album_thumbnails = if let Some(size) = inline_size {
        get_album_thumbnails_base64(&state.pool, &album_ids, size).await
    } else {
        std::collections::HashMap::new()
    };

    let album_responses: Vec<AlbumResponse> = album_result
        .albums
        .into_iter()
        .map(|album| {
            let created = album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
            AlbumResponse {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id.clone()),
                cover_art_data: album_thumbnails.get(&album.id).cloned(),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: album_starred.get(&album.id).cloned(),
                user_rating: album_ratings.get(&album.id).copied(),
            }
        })
        .collect();

    // --- Search Songs using common logic ---
    let song_result = search_songs(
        &state.pool,
        user.user_id,
        &params.query,
        &params,
        song_count,
        song_offset,
    )
    .await?;

    let song_ids: Vec<String> = song_result.songs.iter().map(|s| s.id.clone()).collect();
    let song_starred =
        get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;
    let song_ratings =
        get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails for songs if requested (uses album thumbnails)
    let song_thumbnail_data: Vec<(String, Option<String>)> = song_result
        .songs
        .iter()
        .map(|s| (s.id.clone(), s.album_id.clone()))
        .collect();
    let song_thumbnails = if let Some(size) = inline_size {
        get_song_thumbnails_base64(&state.pool, &song_thumbnail_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    let song_responses: Vec<SongResponse> = song_result
        .songs
        .into_iter()
        .map(|song| {
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song
                    .last_played
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
            };
            let cover_art_data = song_thumbnails.get(&song.id).cloned();
            song_to_response_with_stats(
                song.clone(),
                None, // Album info already embedded in song
                song_starred.get(&song.id).cloned(),
                song_ratings.get(&song.id).copied(),
                Some(play_stats),
                None,
                cover_art_data,
            )
        })
        .collect();

    Ok(Json(FerrotuneSearchResponse {
        search_result: FerrotuneSearchContent {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
            artist_total: artist_result.total,
            album_total: album_result.total,
            song_total: song_result.total,
        },
    }))
}
