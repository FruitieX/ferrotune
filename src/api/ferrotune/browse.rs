//! Browse endpoints for the Ferrotune API.
//!
//! This module provides browse endpoints migrated from the OpenSubsonic API,
//! using proper HTTP status codes and simpler JSON responses.

use crate::api::common::browse::{
    get_album_logic, get_artist_logic, get_artists_logic, get_genres_logic, get_indexes_logic,
    get_song_logic,
};
use crate::api::common::models::{
    AlbumDetail, ArtistDetail, ArtistsIndex, DirectoryIndex, GenresList, SongResponse,
};
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{FerrotuneApiError, FerrotuneApiResult};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Ping Endpoint
// ============================================================================

/// Response for ping endpoint
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PingResponse {
    pub status: String,
    pub version: String,
}

/// GET /ferrotune/ping - Check server connectivity
pub async fn ping(_user: FerrotuneAuthenticatedUser) -> Json<PingResponse> {
    Json(PingResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

// ============================================================================
// Artists Endpoints
// ============================================================================

/// Query params for get artists endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArtistsParams {
    /// Include inline cover art thumbnails (small or medium)
    pub inline_images: Option<String>,
}

/// Response for getArtists - list all artists grouped by index
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneArtistsResponse {
    pub artists: ArtistsIndex,
}

/// GET /ferrotune/artists - Get all artists grouped by first letter
pub async fn get_artists(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetArtistsParams>,
) -> FerrotuneApiResult<Json<FerrotuneArtistsResponse>> {
    use crate::api::subsonic::inline_thumbnails::get_artist_thumbnails_base64;
    use crate::thumbnails::ThumbnailSize;

    let mut artists_index = get_artists_logic(&state.pool, user.user_id).await?;

    // Parse inline images parameter
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    // If inline images requested, fetch and patch them into the response
    if let Some(size) = inline_size {
        // Collect all artist IDs
        let artist_ids: Vec<String> = artists_index
            .index
            .iter()
            .flat_map(|idx| idx.artist.iter().map(|a| a.id.clone()))
            .collect();

        let thumbnails = get_artist_thumbnails_base64(&state.pool, &artist_ids, size).await;

        // Patch thumbnails into the response
        for index in &mut artists_index.index {
            for artist in &mut index.artist {
                artist.cover_art_data = thumbnails.get(&artist.id).cloned();
            }
        }
    }

    Ok(Json(FerrotuneArtistsResponse {
        artists: artists_index,
    }))
}

/// Query params for artist detail endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArtistParams {
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

/// Response for artist detail
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneArtistResponse {
    pub artist: ArtistDetail,
}

/// GET /ferrotune/artists/:id - Get artist details with albums and songs
pub async fn get_artist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<GetArtistParams>,
) -> FerrotuneApiResult<Json<FerrotuneArtistResponse>> {
    let artist_detail = get_artist_logic(
        &state.pool,
        user.user_id,
        &id,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await
    .map_err(|e| match e {
        crate::error::Error::NotFound(_) => FerrotuneApiError::from(e),
        _ => FerrotuneApiError::from(e),
    })?;

    Ok(Json(FerrotuneArtistResponse {
        artist: artist_detail,
    }))
}

// ============================================================================
// Albums Endpoints
// ============================================================================

/// Query params for album detail endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAlbumParams {
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist
    #[serde(default)]
    pub filter: Option<String>,
}

/// Response for album detail
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneAlbumResponse {
    pub album: AlbumDetail,
}

/// GET /ferrotune/albums/:id - Get album details with songs
pub async fn get_album(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<GetAlbumParams>,
) -> FerrotuneApiResult<Json<FerrotuneAlbumResponse>> {
    let album_detail = get_album_logic(
        &state.pool,
        user.user_id,
        &id,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await
    .map_err(|e| match e {
        crate::error::Error::NotFound(_) => FerrotuneApiError::from(e),
        _ => FerrotuneApiError::from(e),
    })?;

    Ok(Json(FerrotuneAlbumResponse {
        album: album_detail,
    }))
}

// ============================================================================
// Songs Endpoint
// ============================================================================

/// Response for song detail
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSongResponse {
    pub song: SongResponse,
}

/// GET /ferrotune/songs/:id - Get song details
pub async fn get_song(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<FerrotuneSongResponse>> {
    let song = get_song_logic(&state.pool, user.user_id, &id)
        .await
        .map_err(|e| match e {
            crate::error::Error::NotFound(_) => FerrotuneApiError::from(e),
            _ => FerrotuneApiError::from(e),
        })?;

    Ok(Json(FerrotuneSongResponse { song }))
}

// ============================================================================
// Similar Songs Endpoint
// ============================================================================

/// Response for similar songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneSimilarSongsResponse {
    pub songs: Vec<SongResponse>,
}

/// Query params for similar songs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "bliss"), allow(dead_code))]
pub struct GetSimilarSongsParams {
    /// Maximum number of similar songs to return (default: 50)
    #[serde(default = "default_similar_count")]
    pub count: usize,
}

fn default_similar_count() -> usize {
    50
}

/// GET /ferrotune/songs/:id/similar - Get similar songs based on audio analysis
pub async fn get_similar_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<GetSimilarSongsParams>,
) -> FerrotuneApiResult<Json<FerrotuneSimilarSongsResponse>> {
    #[cfg(feature = "bliss")]
    {
        use crate::api::common::browse::song_to_response;
        use crate::api::common::starring::{get_ratings_map, get_starred_map};
        use crate::db::models::ItemType;

        let similar =
            crate::bliss::find_similar_songs(&state.pool, &id, user.user_id, params.count).await?;
        let song_ids: Vec<String> = similar.into_iter().map(|(id, _)| id).collect();
        let songs =
            crate::db::queries::get_songs_by_ids_for_user(&state.pool, &song_ids, user.user_id)
                .await?;

        let starred_map =
            get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;
        let ratings_map =
            get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

        let song_responses: Vec<SongResponse> = songs
            .into_iter()
            .map(|song| {
                let starred = starred_map.get(&song.id).cloned();
                let user_rating = ratings_map.get(&song.id).copied();
                song_to_response(song, None, starred, user_rating)
            })
            .collect();

        Ok(Json(FerrotuneSimilarSongsResponse {
            songs: song_responses,
        }))
    }
    #[cfg(not(feature = "bliss"))]
    {
        let _ = (&user, &state, &id, &params);
        Ok(Json(FerrotuneSimilarSongsResponse { songs: vec![] }))
    }
}

// ============================================================================
// Genres Endpoint
// ============================================================================

/// Response for genres list
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneGenresResponse {
    pub genres: GenresList,
}

/// GET /ferrotune/genres - Get all genres
pub async fn get_genres(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<FerrotuneGenresResponse>> {
    let genres_list = get_genres_logic(&state.pool, user.user_id).await?;

    Ok(Json(FerrotuneGenresResponse {
        genres: genres_list,
    }))
}

// ============================================================================
// Indexes Endpoint (Directory browsing by first letter)
// ============================================================================

/// Response for indexes - directory index by first letter
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneIndexesResponse {
    pub indexes: IndexesData,
}

/// Indexes data structure
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct IndexesData {
    /// Last modification timestamp
    #[ts(type = "number")]
    pub last_modified: i64,
    /// Ignored articles (e.g., "The", "A", "An")
    pub ignored_articles: String,
    /// Index entries grouped by letter
    pub index: Vec<DirectoryIndex>,
}

/// Query params for indexes endpoint
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetIndexesParams {
    /// Optional music folder ID to filter by
    #[serde(default)]
    pub music_folder_id: Option<i64>,
}

/// GET /ferrotune/indexes - Get directory indexes by first letter
///
/// Returns top-level directories (artist folders) grouped by first letter.
/// This is used for file-based browsing as opposed to metadata-based (getArtists).
pub async fn get_indexes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetIndexesParams>,
) -> FerrotuneApiResult<Json<FerrotuneIndexesResponse>> {
    let (indexes, last_modified) =
        get_indexes_logic(&state.pool, user.user_id, params.music_folder_id).await?;

    Ok(Json(FerrotuneIndexesResponse {
        indexes: IndexesData {
            last_modified,
            ignored_articles: "The El La Los Las Le Les".to_string(),
            index: indexes,
        },
    }))
}
