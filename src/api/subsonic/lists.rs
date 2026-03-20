pub use crate::api::common::lists::AlbumListType;
use crate::api::common::lists::{
    get_album_list_logic, get_random_songs_logic, get_songs_by_genre_logic,
};
use crate::api::common::models::{AlbumResponse, SongResponse};
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::InlineImagesParam;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumListParams {
    /// List type (serializes as "type" for API compatibility)
    #[serde(rename = "type")]
    pub list_type: AlbumListType,
    pub size: Option<u32>,
    pub offset: Option<u32>,
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
    pub genre: Option<String>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(flatten)]
    #[ts(skip)]
    pub inline_images: InlineImagesParam,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumList2Response {
    pub album_list2: AlbumList2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumList2Content {
    pub album: Vec<AlbumResponse>,
    /// Total count of albums (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub total: Option<i64>,
}

pub async fn get_album_list2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AlbumListParams>,
) -> Result<FormatResponse<AlbumList2Response>> {
    let size = params.size.unwrap_or(10) as i64;
    let offset = params.offset.unwrap_or(0) as i64;
    let inline_size = params.inline_images.get_size();

    let result = get_album_list_logic(
        &state.pool,
        user.user_id,
        params.list_type,
        size,
        offset,
        params.from_year,
        params.to_year,
        params.genre,
        inline_size,
        None,
        None, // No seed for OpenSubsonic compatibility
    )
    .await?;

    let response = AlbumList2Response {
        album_list2: AlbumList2Content {
            album: result.albums,
            total: result.total,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// getAlbumList (non-ID3 variant) — same logic, different response wrapper

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumListResponse {
    pub album_list: AlbumListContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumListContent {
    pub album: Vec<AlbumResponse>,
}

pub async fn get_album_list(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AlbumListParams>,
) -> Result<FormatResponse<AlbumListResponse>> {
    let size = params.size.unwrap_or(10) as i64;
    let offset = params.offset.unwrap_or(0) as i64;
    let inline_size = params.inline_images.get_size();

    let result = get_album_list_logic(
        &state.pool,
        user.user_id,
        params.list_type,
        size,
        offset,
        params.from_year,
        params.to_year,
        params.genre,
        inline_size,
        None,
        None,
    )
    .await?;

    let response = AlbumListResponse {
        album_list: AlbumListContent {
            album: result.albums,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsParams {
    pub size: Option<u32>,
    pub genre: Option<String>,
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsResponse {
    pub random_songs: RandomSongsContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsContent {
    pub song: Vec<SongResponse>,
}

pub async fn get_random_songs(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<RandomSongsParams>,
) -> Result<FormatResponse<RandomSongsResponse>> {
    let size = params.size.unwrap_or(10) as i64;

    let songs = get_random_songs_logic(
        &state.pool,
        user.user_id,
        size,
        params.genre,
        params.from_year,
        params.to_year,
    )
    .await?;

    let response = RandomSongsResponse {
        random_songs: RandomSongsContent { song: songs },
    };

    Ok(FormatResponse::new(user.format, response))
}

// getSongsByGenre endpoint
#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreParams {
    pub genre: String,
    pub count: Option<u32>,
    pub offset: Option<u32>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
    /// Sort field: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreResponse {
    pub songs_by_genre: SongsByGenreContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

pub async fn get_songs_by_genre(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SongsByGenreParams>,
) -> Result<FormatResponse<SongsByGenreResponse>> {
    let count = params.count.unwrap_or(10) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let songs = get_songs_by_genre_logic(
        &state.pool,
        user.user_id,
        &params.genre,
        count,
        offset,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
    .await?;

    let response = SongsByGenreResponse {
        songs_by_genre: SongsByGenreContent { song: songs },
    };

    Ok(FormatResponse::new(user.format, response))
}

#[derive(Deserialize)]
pub struct ScrobbleParams {
    id: String,
    time: Option<i64>,
    submission: Option<bool>,
}

pub async fn scrobble(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ScrobbleParams>,
) -> Result<impl axum::response::IntoResponse> {
    let submission = params.submission.unwrap_or(true);
    let played_at = if let Some(timestamp) = params.time {
        chrono::DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now)
    } else {
        Utc::now()
    };

    sqlx::query(
        "INSERT INTO scrobbles (user_id, song_id, played_at, submission) 
         VALUES (?, ?, ?, ?)",
    )
    .bind(user.user_id)
    .bind(&params.id)
    .bind(played_at)
    .bind(submission)
    .execute(&state.pool)
    .await?;

    // Forward to Last.fm in background
    {
        let pool = state.pool.clone();
        let uid = user.user_id;
        let song_id = params.id.clone();
        if submission {
            let ts = played_at.timestamp();
            tokio::spawn(async move {
                if let Err(e) =
                    crate::api::ferrotune::lastfm::forward_scrobble(&pool, uid, &song_id, ts).await
                {
                    tracing::warn!("Last.fm scrobble failed: {}", e);
                }
            });
        } else {
            tokio::spawn(async move {
                if let Err(e) =
                    crate::api::ferrotune::lastfm::update_now_playing(&pool, uid, &song_id).await
                {
                    tracing::warn!("Last.fm now playing update failed: {}", e);
                }
            });
        }
    }

    Ok(format_ok_empty(user.format))
}
