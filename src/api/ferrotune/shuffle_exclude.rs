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
    let result = crate::db::raw::query_scalar::<i64>(
        state.database.conn(),
        "SELECT id FROM shuffle_excludes WHERE user_id = ? AND song_id = ?",
        "SELECT id FROM shuffle_excludes WHERE user_id = $1 AND song_id = $2",
        [
            sea_orm::Value::from(user.user_id),
            sea_orm::Value::from(song_id.clone()),
        ],
    )
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
        crate::db::raw::execute(
            state.database.conn(),
            "INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)",
            "INSERT INTO shuffle_excludes (user_id, song_id) VALUES ($1, $2) \
             ON CONFLICT (user_id, song_id) DO NOTHING",
            [
                sea_orm::Value::from(user.user_id),
                sea_orm::Value::from(song_id.clone()),
            ],
        )
        .await
        .map_err(|e| Error::Internal(format!("Failed to exclude song: {}", e)))?;

        Ok(Json(ShuffleExcludeStatusResponse {
            song_id,
            excluded: true,
        }))
    } else {
        crate::db::raw::execute(
            state.database.conn(),
            "DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?",
            "DELETE FROM shuffle_excludes WHERE user_id = $1 AND song_id = $2",
            [
                sea_orm::Value::from(user.user_id),
                sea_orm::Value::from(song_id.clone()),
            ],
        )
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
    #[derive(sea_orm::FromQueryResult)]
    struct IdRow {
        song_id: String,
    }
    let rows = crate::db::raw::query_all::<IdRow>(
        state.database.conn(),
        "SELECT song_id FROM shuffle_excludes WHERE user_id = ?",
        "SELECT song_id FROM shuffle_excludes WHERE user_id = $1",
        [sea_orm::Value::from(user.user_id)],
    )
    .await
    .map_err(|e| Error::Internal(format!("Failed to get excludes: {}", e)))?;

    Ok(Json(ShuffleExcludesResponse {
        song_ids: rows.into_iter().map(|r| r.song_id).collect(),
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
        for song_id in &body.song_ids {
            crate::db::raw::execute(
                state.database.conn(),
                "INSERT OR IGNORE INTO shuffle_excludes (user_id, song_id) VALUES (?, ?)",
                "INSERT INTO shuffle_excludes (user_id, song_id) VALUES ($1, $2) \
                 ON CONFLICT (user_id, song_id) DO NOTHING",
                [
                    sea_orm::Value::from(user.user_id),
                    sea_orm::Value::from(song_id.clone()),
                ],
            )
            .await?;
        }
    } else {
        for song_id in &body.song_ids {
            crate::db::raw::execute(
                state.database.conn(),
                "DELETE FROM shuffle_excludes WHERE user_id = ? AND song_id = ?",
                "DELETE FROM shuffle_excludes WHERE user_id = $1 AND song_id = $2",
                [
                    sea_orm::Value::from(user.user_id),
                    sea_orm::Value::from(song_id.clone()),
                ],
            )
            .await?;
        }
    }

    Ok(Json(BulkShuffleExcludeResponse {
        count,
        excluded: body.excluded,
    }))
}
