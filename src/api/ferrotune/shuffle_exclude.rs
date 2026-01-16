//! Shuffle exclude endpoints.
//!
//! Allows users to mark songs as excluded from shuffle playback.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

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
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
) -> FerrotuneApiResult<Json<ShuffleExcludeStatusResponse>> {
    let result: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .fetch_optional(&state.pool)
            .await?;

    Ok(Json(ShuffleExcludeStatusResponse {
        song_id,
        excluded: result.is_some(),
    }))
}

/// Set shuffle exclude status for a song.
///
/// PUT /ferrotune/songs/:id/shuffle-exclude
pub async fn set_shuffle_exclude(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetShuffleExcludeRequest>,
) -> FerrotuneApiResult<Json<ShuffleExcludeStatusResponse>> {
    if body.excluded {
        // Add to exclusion list
        sqlx::query("INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)")
            .bind(user.user_id)
            .bind(&song_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to exclude song: {}", e)))?;

        Ok(Json(ShuffleExcludeStatusResponse {
            song_id,
            excluded: true,
        }))
    } else {
        // Remove from exclusion list
        sqlx::query("DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .execute(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to include song: {}", e)))?;

        Ok(Json(ShuffleExcludeStatusResponse {
            song_id,
            excluded: false,
        }))
    }
}

/// Get all songs excluded from shuffle for the current user.
///
/// GET /ferrotune/shuffle-excludes
pub async fn get_all_shuffle_excludes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ShuffleExcludesResponse>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT song_id FROM shuffle_excludes WHERE user_id = ?")
            .bind(user.user_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to get excludes: {}", e)))?;

    Ok(Json(ShuffleExcludesResponse {
        song_ids: rows.into_iter().map(|(id,)| id).collect(),
    }))
}

/// Bulk set shuffle exclude status for multiple songs.
///
/// POST /ferrotune/shuffle-excludes/bulk
pub async fn bulk_set_shuffle_excludes(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetShuffleExcludeRequest>,
) -> FerrotuneApiResult<Json<BulkShuffleExcludeResponse>> {
    let count = body.song_ids.len();

    if body.excluded {
        // Add all to exclusion list
        for song_id in &body.song_ids {
            sqlx::query("INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)")
                .bind(user.user_id)
                .bind(song_id)
                .execute(&state.pool)
                .await?;
        }
    } else {
        // Remove all from exclusion list
        for song_id in &body.song_ids {
            sqlx::query("DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?")
                .bind(user.user_id)
                .bind(song_id)
                .execute(&state.pool)
                .await?;
        }
    }

    Ok(Json(BulkShuffleExcludeResponse {
        count,
        excluded: body.excluded,
    }))
}
