//! Browse endpoints for the Ferrotune API.
//!
//! This module provides browse endpoints migrated from the native API API,
//! using proper HTTP status codes and simpler JSON responses.

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::browse::{
    get_album_logic, get_artist_logic, get_artists_logic, get_genres_logic, get_indexes_logic,
    get_song_logic, song_to_response_with_stats,
};
use crate::api::common::models::{
    AlbumDetail, AlbumResponse, ArtistDetail, ArtistsIndex, DirectoryIndex, GenresList,
    SongPlayStats, SongResponse,
};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::{format_datetime_iso, format_datetime_iso_ms};
use crate::api::AppState;
use crate::db::models::ItemType;
use crate::db::repo::browse::CollectionSongSort;
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

/// GET /api/ping - Check server connectivity
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

/// GET /api/artists - Get all artists grouped by first letter
pub async fn get_artists(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetArtistsParams>,
) -> FerrotuneApiResult<Json<FerrotuneArtistsResponse>> {
    use crate::api::inline_thumbnails::get_artist_thumbnails_base64;
    use crate::thumbnails::ThumbnailSize;

    let mut artists_index = get_artists_logic(&state.database, user.user_id).await?;

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

        let thumbnails = get_artist_thumbnails_base64(&state.database, &artist_ids, size).await;

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

/// Response for artist detail
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneArtistResponse {
    pub artist: ArtistDetail,
}

/// GET /api/artists/:id - Get artist metadata
pub async fn get_artist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<FerrotuneArtistResponse>> {
    let artist_detail = get_artist_logic(&state.database, user.user_id, &id).await?;

    Ok(Json(FerrotuneArtistResponse {
        artist: artist_detail,
    }))
}

// ============================================================================
// Albums Endpoints
// ============================================================================

/// Response for album detail
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct FerrotuneAlbumResponse {
    pub album: AlbumDetail,
}

/// GET /api/albums/:id - Get album metadata
pub async fn get_album(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<FerrotuneAlbumResponse>> {
    let album_detail = get_album_logic(&state.database, user.user_id, &id).await?;

    Ok(Json(FerrotuneAlbumResponse {
        album: album_detail,
    }))
}

// ============================================================================
// Paginated collection children
// ============================================================================

fn default_collection_page_count() -> i64 {
    100
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CollectionSongsParams {
    #[serde(default)]
    #[ts(type = "number")]
    pub offset: i64,
    #[serde(default = "default_collection_page_count")]
    #[ts(type = "number")]
    pub count: i64,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub sort_dir: Option<String>,
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CollectionSongsResponse {
    pub songs: Vec<SongResponse>,
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub offset: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistAlbumsParams {
    #[serde(default)]
    #[ts(type = "number")]
    pub offset: i64,
    #[serde(default = "default_collection_page_count")]
    #[ts(type = "number")]
    pub count: i64,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistAlbumsResponse {
    pub albums: Vec<AlbumResponse>,
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub offset: i64,
}

fn validate_page(offset: i64, count: i64) -> Result<(u64, u64), FerrotuneApiError> {
    if offset < 0 {
        return Err(
            crate::error::Error::InvalidRequest("offset must be non-negative".to_string()).into(),
        );
    }
    if !(1..=500).contains(&count) {
        return Err(crate::error::Error::InvalidRequest(
            "count must be between 1 and 500".to_string(),
        )
        .into());
    }
    Ok((offset as u64, count as u64))
}

fn collection_song_sort(value: Option<&str>) -> Result<CollectionSongSort, FerrotuneApiError> {
    match value.unwrap_or("trackNumber") {
        "custom" | "trackNumber" => Ok(CollectionSongSort::TrackNumber),
        "name" => Ok(CollectionSongSort::Name),
        "artist" => Ok(CollectionSongSort::Artist),
        "album" => Ok(CollectionSongSort::Album),
        "year" => Ok(CollectionSongSort::Year),
        "genre" => Ok(CollectionSongSort::Genre),
        "dateAdded" => Ok(CollectionSongSort::DateAdded),
        "duration" => Ok(CollectionSongSort::Duration),
        "bitRate" => Ok(CollectionSongSort::BitRate),
        "format" => Ok(CollectionSongSort::Format),
        "playCount" => Ok(CollectionSongSort::PlayCount),
        "playStarts" => Ok(CollectionSongSort::PlayStarts),
        "lastPlayed" => Ok(CollectionSongSort::LastPlayed),
        value => Err(crate::error::Error::InvalidRequest(format!(
            "unsupported collection song sort: {value}"
        ))
        .into()),
    }
}

fn collection_song_descending(value: Option<&str>) -> Result<bool, FerrotuneApiError> {
    match value.unwrap_or("asc") {
        "asc" => Ok(false),
        "desc" => Ok(true),
        value => Err(crate::error::Error::InvalidRequest(format!(
            "unsupported sort direction: {value}"
        ))
        .into()),
    }
}

async fn collection_songs_response(
    database: &crate::db::Database,
    user_id: i64,
    page: crate::db::repo::browse::CollectionSongPage,
    offset: i64,
) -> FerrotuneApiResult<Json<CollectionSongsResponse>> {
    let song_ids = page
        .songs
        .iter()
        .map(|song| song.id.clone())
        .collect::<Vec<_>>();
    let (starred, ratings) = tokio::try_join!(
        get_starred_map(database, user_id, ItemType::Song, &song_ids),
        get_ratings_map(database, user_id, ItemType::Song, &song_ids),
    )?;
    let songs = page
        .songs
        .into_iter()
        .map(|song| {
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song.last_played.map(format_datetime_iso),
            };
            let starred_at = starred.get(&song.id).cloned();
            let rating = ratings.get(&song.id).copied();
            song_to_response_with_stats(
                song,
                None,
                starred_at,
                rating,
                Some(play_stats),
                None,
                None,
            )
        })
        .collect();
    Ok(Json(CollectionSongsResponse {
        songs,
        total: page.total,
        offset,
    }))
}

pub async fn get_album_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<CollectionSongsParams>,
) -> FerrotuneApiResult<Json<CollectionSongsResponse>> {
    let (offset, count) = validate_page(params.offset, params.count)?;
    let sort = collection_song_sort(params.sort.as_deref())?;
    let descending = collection_song_descending(params.sort_dir.as_deref())?;
    let page = crate::db::repo::browse::page_album_songs_for_user(
        &state.database,
        &id,
        user.user_id,
        params.filter.as_deref(),
        sort,
        descending,
        offset,
        count,
    )
    .await?;
    collection_songs_response(&state.database, user.user_id, page, params.offset).await
}

pub async fn get_artist_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<CollectionSongsParams>,
) -> FerrotuneApiResult<Json<CollectionSongsResponse>> {
    let (offset, count) = validate_page(params.offset, params.count)?;
    let sort = collection_song_sort(params.sort.as_deref())?;
    let descending = collection_song_descending(params.sort_dir.as_deref())?;
    let page = crate::db::repo::browse::page_artist_songs_for_user(
        &state.database,
        &id,
        user.user_id,
        params.filter.as_deref(),
        sort,
        descending,
        offset,
        count,
    )
    .await?;
    collection_songs_response(&state.database, user.user_id, page, params.offset).await
}

pub async fn get_artist_albums(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<ArtistAlbumsParams>,
) -> FerrotuneApiResult<Json<ArtistAlbumsResponse>> {
    let (offset, count) = validate_page(params.offset, params.count)?;
    let page = crate::db::repo::browse::page_albums_by_artist_for_user(
        &state.database,
        &id,
        user.user_id,
        offset,
        count,
    )
    .await?;
    let album_ids = page
        .albums
        .iter()
        .map(|album| album.id.clone())
        .collect::<Vec<_>>();
    let (starred, ratings) = tokio::try_join!(
        get_starred_map(&state.database, user.user_id, ItemType::Album, &album_ids),
        get_ratings_map(&state.database, user.user_id, ItemType::Album, &album_ids),
    )?;
    let albums = page
        .albums
        .into_iter()
        .map(|album| AlbumResponse {
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
            created: format_datetime_iso_ms(album.created_at),
            starred: starred.get(&album.id).cloned(),
            user_rating: ratings.get(&album.id).copied(),
            played: None,
        })
        .collect();
    Ok(Json(ArtistAlbumsResponse {
        albums,
        total: page.total,
        offset: params.offset,
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

/// GET /api/songs/:id - Get song details
pub async fn get_song(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<FerrotuneSongResponse>> {
    let song = get_song_logic(&state.database, user.user_id, &id)
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

/// GET /api/songs/:id/similar - Get similar songs based on audio analysis
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

        let similar = crate::bliss::find_similar_songs(
            &state.database,
            &id,
            user.user_id,
            params.count,
            None,
        )
        .await?;
        let song_ids: Vec<String> = similar.into_iter().map(|(id, _)| id).collect();
        let songs = crate::db::repo::browse::get_songs_by_ids_for_user(
            &state.database,
            &song_ids,
            user.user_id,
        )
        .await?;

        let starred_map =
            get_starred_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;
        let ratings_map =
            get_ratings_map(&state.database, user.user_id, ItemType::Song, &song_ids).await?;

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

/// GET /api/genres - Get all genres
pub async fn get_genres(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<FerrotuneGenresResponse>> {
    let genres_list = get_genres_logic(&state.database, user.user_id).await?;

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

/// GET /api/indexes - Get directory indexes by first letter
///
/// Returns top-level directories (artist folders) grouped by first letter.
/// This is used for file-based browsing as opposed to metadata-based (getArtists).
pub async fn get_indexes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetIndexesParams>,
) -> FerrotuneApiResult<Json<FerrotuneIndexesResponse>> {
    let (indexes, last_modified) =
        get_indexes_logic(&state.database, user.user_id, params.music_folder_id).await?;

    Ok(Json(FerrotuneIndexesResponse {
        indexes: IndexesData {
            last_modified,
            ignored_articles: "The El La Los Las Le Les".to_string(),
            index: indexes,
        },
    }))
}
