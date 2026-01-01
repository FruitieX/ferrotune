use crate::api::common::models::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::common::starring::{
    fetch_starred_content, set_item_rating, star_items, unstar_items,
};
use crate::api::first_string_or_none;
use crate::api::string_or_seq;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::query::first_i32;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::api::QsQuery;
use crate::error::Result;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
pub struct RatingParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    id: Option<String>,
    #[serde(deserialize_with = "first_i32")]
    rating: i32,
}

pub async fn set_rating(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<RatingParams>,
) -> Result<impl axum::response::IntoResponse> {
    let id = params.id.ok_or_else(|| {
        crate::error::Error::InvalidRequest("Missing required parameter: id".to_string())
    })?;

    if params.rating < 0 || params.rating > 5 {
        return Err(crate::error::Error::InvalidRequest(
            "Rating must be between 0 and 5".to_string(),
        ));
    }

    set_item_rating(&state.pool, user.user_id, &id, params.rating).await?;

    Ok(format_ok_empty(user.format))
}

#[derive(Deserialize)]
pub struct StarParams {
    #[serde(default, deserialize_with = "string_or_seq")]
    id: Vec<String>,
    #[serde(default, rename = "albumId", deserialize_with = "string_or_seq")]
    album_id: Vec<String>,
    #[serde(default, rename = "artistId", deserialize_with = "string_or_seq")]
    artist_id: Vec<String>,
}

pub async fn star(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    star_items(
        &state.pool,
        user.user_id,
        &params.id,
        &params.album_id,
        &params.artist_id,
    )
    .await?;

    Ok(format_ok_empty(user.format))
}

pub async fn unstar(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    unstar_items(
        &state.pool,
        user.user_id,
        &params.id,
        &params.album_id,
        &params.artist_id,
    )
    .await?;

    Ok(format_ok_empty(user.format))
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct Starred2Response {
    pub starred2: Starred2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StarredResponse {
    pub starred: Starred2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct Starred2Content {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

pub async fn get_starred2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<Starred2Response>> {
    let (artist_responses, album_responses, song_responses) =
        fetch_starred_content(&state.pool, user.user_id).await?;

    let response = Starred2Response {
        starred2: Starred2Content {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/getStarred - Old API, returns same as getStarred2 but with different wrapper
pub async fn get_starred(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<StarredResponse>> {
    let (artist_responses, album_responses, song_responses) =
        fetch_starred_content(&state.pool, user.user_id).await?;

    let response = StarredResponse {
        starred: Starred2Content {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
