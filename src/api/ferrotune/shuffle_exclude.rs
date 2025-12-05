//! Shuffle exclude endpoints.
//!
//! Allows users to mark songs as excluded from shuffle playback.

use crate::api::subsonic::auth::AuthenticatedUser;
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

/// Response for getting shuffle exclude status
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShuffleExcludeStatusResponse {
    pub song_id: String,
    pub excluded: bool,
}

/// Response for getting all excluded songs
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ShuffleExcludesResponse {
    pub song_ids: Vec<String>,
}

/// Request body for setting shuffle exclude status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetShuffleExcludeRequest {
    pub excluded: bool,
}

/// Request body for bulk setting shuffle exclude status
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSetShuffleExcludeRequest {
    pub song_ids: Vec<String>,
    pub excluded: bool,
}

/// Response for bulk operation
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct BulkShuffleExcludeResponse {
    pub count: usize,
    pub excluded: bool,
}

/// Get shuffle exclude status for a song.
///
/// GET /ferrotune/songs/:id/shuffle-exclude
pub async fn get_shuffle_exclude(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> impl IntoResponse {
    let result: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .fetch_optional(&state.pool)
            .await
            .unwrap_or(None);

    Json(ShuffleExcludeStatusResponse {
        song_id,
        excluded: result.is_some(),
    })
}

/// Set shuffle exclude status for a song.
///
/// PUT /ferrotune/songs/:id/shuffle-exclude
pub async fn set_shuffle_exclude(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetShuffleExcludeRequest>,
) -> impl IntoResponse {
    if body.excluded {
        // Add to exclusion list
        let result =
            sqlx::query("INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)")
                .bind(user.user_id)
                .bind(&song_id)
                .execute(&state.pool)
                .await;

        match result {
            Ok(_) => Json(ShuffleExcludeStatusResponse {
                song_id,
                excluded: true,
            })
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to exclude song",
                    e.to_string(),
                )),
            )
                .into_response(),
        }
    } else {
        // Remove from exclusion list
        let result = sqlx::query("DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .execute(&state.pool)
            .await;

        match result {
            Ok(_) => Json(ShuffleExcludeStatusResponse {
                song_id,
                excluded: false,
            })
            .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details(
                    "Failed to include song",
                    e.to_string(),
                )),
            )
                .into_response(),
        }
    }
}

/// Get all songs excluded from shuffle for the current user.
///
/// GET /ferrotune/shuffle-excludes
pub async fn get_all_shuffle_excludes(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let result: Result<Vec<(String,)>, _> =
        sqlx::query_as("SELECT song_id FROM shuffle_excludes WHERE user_id = ?")
            .bind(user.user_id)
            .fetch_all(&state.pool)
            .await;

    match result {
        Ok(rows) => Json(ShuffleExcludesResponse {
            song_ids: rows.into_iter().map(|(id,)| id).collect(),
        })
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to get excludes",
                e.to_string(),
            )),
        )
            .into_response(),
    }
}

/// Bulk set shuffle exclude status for multiple songs.
///
/// POST /ferrotune/shuffle-excludes/bulk
pub async fn bulk_set_shuffle_excludes(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetShuffleExcludeRequest>,
) -> impl IntoResponse {
    let count = body.song_ids.len();

    if body.excluded {
        // Add all to exclusion list
        for song_id in &body.song_ids {
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)",
            )
            .bind(user.user_id)
            .bind(song_id)
            .execute(&state.pool)
            .await;
        }
    } else {
        // Remove all from exclusion list
        for song_id in &body.song_ids {
            let _ = sqlx::query("DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
                .bind(user.user_id)
                .bind(song_id)
                .execute(&state.pool)
                .await;
        }
    }

    Json(BulkShuffleExcludeResponse {
        count,
        excluded: body.excluded,
    })
}
