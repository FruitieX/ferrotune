use crate::api::common::browse::{
    get_album_logic, get_artist_logic, get_artists_logic, get_genres_logic, get_song_logic,
};
use crate::api::common::models::{
    AlbumDetail, ArtistDetail, ArtistsIndex, GenresList, SongResponse,
};
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
pub struct IdParam {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolderParam {
    #[allow(dead_code)]
    music_folder_id: Option<i64>,
}

// ===== getArtists =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistsResponse {
    pub artists: ArtistsIndex,
}

pub async fn get_artists(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(_params): Query<MusicFolderParam>,
) -> crate::error::Result<FormatResponse<ArtistsResponse>> {
    let artists_index = get_artists_logic(&state.database, user.user_id).await?;

    Ok(FormatResponse::new(
        user.format,
        ArtistsResponse {
            artists: artists_index,
        },
    ))
}

// ===== getArtist =====

/// Query params for getArtist endpoint
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArtistParams {
    id: String,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    filter: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistDetailResponse {
    pub artist: ArtistDetail,
}

pub async fn get_artist(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetArtistParams>,
) -> crate::error::Result<FormatResponse<ArtistDetailResponse>> {
    let artist_detail = get_artist_logic(
        &state.database,
        user.user_id,
        &params.id,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await?;

    Ok(FormatResponse::new(
        user.format,
        ArtistDetailResponse {
            artist: artist_detail,
        },
    ))
}

// ===== getArtistInfo2 =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistInfoParams {
    id: String,
    #[allow(dead_code)]
    count: Option<u32>,
    #[allow(dead_code)]
    include_not_present: Option<bool>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistInfo2Response {
    pub artist_info2: ArtistInfo2,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistInfo2 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biography: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_brainz_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fm_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub medium_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_image_url: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub similar_artist: Vec<crate::api::common::models::ArtistResponse>,
}

pub async fn get_artist_info2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ArtistInfoParams>,
) -> crate::error::Result<FormatResponse<ArtistInfo2Response>> {
    // Verify the artist exists
    let _artist = crate::db::repo::browse::get_artist_by_id(&state.database, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Artist {} not found", params.id)))?;

    // Return empty artist info (we don't fetch external metadata yet)
    let response = ArtistInfo2Response {
        artist_info2: ArtistInfo2 {
            biography: None,
            music_brainz_id: None,
            last_fm_url: None,
            small_image_url: None,
            medium_image_url: None,
            large_image_url: None,
            similar_artist: Vec::new(),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getAlbum =====

/// Query params for getAlbum endpoint
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAlbumParams {
    id: String,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist
    #[serde(default)]
    filter: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumDetailResponse {
    pub album: AlbumDetail,
}

pub async fn get_album(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetAlbumParams>,
) -> crate::error::Result<FormatResponse<AlbumDetailResponse>> {
    let album_detail = get_album_logic(
        &state.database,
        user.user_id,
        &params.id,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await?;

    Ok(FormatResponse::new(
        user.format,
        AlbumDetailResponse {
            album: album_detail,
        },
    ))
}

// ===== getSong =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongDetailResponse {
    pub song: SongResponse,
}

pub async fn get_song(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<IdParam>,
) -> crate::error::Result<FormatResponse<SongDetailResponse>> {
    let song = get_song_logic(&state.database, user.user_id, &params.id).await?;

    Ok(FormatResponse::new(
        user.format,
        SongDetailResponse { song },
    ))
}

// ===== getGenres =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenresResponse {
    pub genres: GenresList,
}

pub async fn get_genres(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<GenresResponse>> {
    let genres_list = get_genres_logic(&state.database, user.user_id).await?;

    Ok(FormatResponse::new(
        user.format,
        GenresResponse {
            genres: genres_list,
        },
    ))
}

// ===== getSimilarSongs2 =====

#[derive(Deserialize)]
#[cfg_attr(not(feature = "bliss"), allow(dead_code))]
pub struct GetSimilarSongs2Params {
    id: String,
    #[serde(default = "default_similar_count")]
    count: usize,
}

fn default_similar_count() -> usize {
    50
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SimilarSongs2Response {
    pub similar_songs2: SimilarSongs2Inner,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SimilarSongs2Inner {
    pub song: Vec<SongResponse>,
}

pub async fn get_similar_songs2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetSimilarSongs2Params>,
) -> crate::error::Result<FormatResponse<SimilarSongs2Response>> {
    #[cfg(feature = "bliss")]
    let song_responses = {
        use crate::api::common::browse::song_to_response;
        use crate::api::common::starring::{get_ratings_map, get_starred_map};
        use crate::db::models::ItemType;

        let similar = crate::bliss::find_similar_songs(
            &state.database,
            &params.id,
            user.user_id,
            params.count,
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

        songs
            .into_iter()
            .map(|song| {
                let starred = starred_map.get(&song.id).cloned();
                let user_rating = ratings_map.get(&song.id).copied();
                song_to_response(song, None, starred, user_rating)
            })
            .collect::<Vec<_>>()
    };
    #[cfg(not(feature = "bliss"))]
    let song_responses = {
        let _ = (&state, &params);
        Vec::new()
    };

    Ok(FormatResponse::new(
        user.format,
        SimilarSongs2Response {
            similar_songs2: SimilarSongs2Inner {
                song: song_responses,
            },
        },
    ))
}
