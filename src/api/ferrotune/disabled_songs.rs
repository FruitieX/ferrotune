//! Disabled songs endpoints.
//!
//! Allows users to mark songs as disabled. Disabled songs are not automatically
//! included in playback queues and show up as grayed out in library views.
//! The only way to play a disabled song is to start playback directly.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

use super::ErrorResponse;

/// Response for getting disabled status
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DisabledStatusResponse {
    pub song_id: String,
    pub disabled: bool,
}

/// Response for getting all disabled songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DisabledSongsResponse {
    pub song_ids: Vec<String>,
}

/// Request body for setting disabled status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisabledRequest {
    pub disabled: bool,
}

/// Request body for bulk setting disabled status
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkSetDisabledRequest {
    pub song_ids: Vec<String>,
    pub disabled: bool,
}

/// Response for bulk operation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkDisabledResponse {
    pub count: usize,
    pub disabled: bool,
}

/// Get disabled status for a song.
///
/// GET /ferrotune/songs/:id/disabled
pub async fn get_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> impl IntoResponse {
    let result: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM disabled_songs WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .fetch_optional(&state.pool)
            .await
            .unwrap_or(None);

    Json(DisabledStatusResponse {
        song_id,
        disabled: result.is_some(),
    })
}

/// Set disabled status for a song.
///
/// PUT /ferrotune/songs/:id/disabled
pub async fn set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetDisabledRequest>,
) -> impl IntoResponse {
    if body.disabled {
        // Add to disabled list
        let result =
            sqlx::query("INSERT OR IGNORE INTO disabled_songs (user_id, song_id) VALUES (?, ?)")
                .bind(user.user_id)
                .bind(&song_id)
                .execute(&state.pool)
                .await;

        match result {
            Ok(_) => Json(DisabledStatusResponse {
                song_id,
                disabled: true,
            })
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to disable song",
                    e.to_string(),
                )),
            )
                .into_response(),
        }
    } else {
        // Remove from disabled list
        let result = sqlx::query("DELETE FROM disabled_songs WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .execute(&state.pool)
            .await;

        match result {
            Ok(_) => Json(DisabledStatusResponse {
                song_id,
                disabled: false,
            })
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to enable song",
                    e.to_string(),
                )),
            )
                .into_response(),
        }
    }
}

/// Get all disabled songs for the current user.
///
/// GET /ferrotune/disabled-songs
pub async fn get_all_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let result: Result<Vec<(String,)>, _> =
        sqlx::query_as("SELECT song_id FROM disabled_songs WHERE user_id = ?")
            .bind(user.user_id)
            .fetch_all(&state.pool)
            .await;

    match result {
        Ok(rows) => Json(DisabledSongsResponse {
            song_ids: rows.into_iter().map(|(id,)| id).collect(),
        })
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to get disabled songs",
                e.to_string(),
            )),
        )
            .into_response(),
    }
}

/// Bulk set disabled status for multiple songs.
///
/// POST /ferrotune/disabled-songs/bulk
pub async fn bulk_set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetDisabledRequest>,
) -> impl IntoResponse {
    let count = body.song_ids.len();

    if body.disabled {
        // Add all to disabled list
        for song_id in &body.song_ids {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO disabled_songs (user_id, song_id) VALUES (?, ?)",
            )
            .bind(user.user_id)
            .bind(song_id)
            .execute(&state.pool)
            .await;
        }
    } else {
        // Remove all from disabled list
        for song_id in &body.song_ids {
            let _ = sqlx::query("DELETE FROM disabled_songs WHERE user_id = ? AND song_id = ?")
                .bind(user.user_id)
                .bind(song_id)
                .execute(&state.pool)
                .await;
        }
    }

    Json(BulkDisabledResponse {
        count,
        disabled: body.disabled,
    })
}
