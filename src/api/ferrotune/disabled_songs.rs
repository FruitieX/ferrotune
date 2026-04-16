//! Disabled songs endpoints.
//!
//! Allows users to mark songs as disabled. Disabled songs are not automatically
//! included in playback queues and show up as grayed out in library views.
//! The only way to play a disabled song is to start playback directly.

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
) -> FerrotuneApiResult<Json<DisabledStatusResponse>> {
    let result: Option<(i64,)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT id FROM disabled_songs WHERE user_id = ? AND song_id = ?")
            .bind(user.user_id)
            .bind(&song_id)
            .fetch_optional(pool)
            .await?
    } else if let Ok(pool) = state.database.postgres_pool() {
        sqlx::query_as("SELECT id FROM disabled_songs WHERE user_id = $1 AND song_id = $2")
            .bind(user.user_id)
            .bind(&song_id)
            .fetch_optional(pool)
            .await?
    } else {
        return Err(
            Error::Internal("Unsupported database backend for disabled songs".to_string()).into(),
        );
    };

    Ok(Json(DisabledStatusResponse {
        song_id,
        disabled: result.is_some(),
    }))
}

/// Set disabled status for a song.
///
/// PUT /ferrotune/songs/:id/disabled
pub async fn set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(song_id): Path<String>,
    Json(body): Json<SetDisabledRequest>,
) -> FerrotuneApiResult<Json<DisabledStatusResponse>> {
    if body.disabled {
        // Add to disabled list
        if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("INSERT OR IGNORE INTO disabled_songs (user_id, song_id) VALUES (?, ?)")
                .bind(user.user_id)
                .bind(&song_id)
                .execute(pool)
                .await
                .map_err(|e| Error::Internal(format!("Failed to disable song: {}", e)))?;
        } else if let Ok(pool) = state.database.postgres_pool() {
            sqlx::query(
                "INSERT INTO disabled_songs (user_id, song_id) VALUES ($1, $2)
                 ON CONFLICT (user_id, song_id) DO NOTHING",
            )
            .bind(user.user_id)
            .bind(&song_id)
            .execute(pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to disable song: {}", e)))?;
        } else {
            return Err(Error::Internal(
                "Unsupported database backend for disabled songs".to_string(),
            )
            .into());
        }

        Ok(Json(DisabledStatusResponse {
            song_id,
            disabled: true,
        }))
    } else {
        // Remove from disabled list
        if let Ok(pool) = state.database.sqlite_pool() {
            sqlx::query("DELETE FROM disabled_songs WHERE user_id = ? AND song_id = ?")
                .bind(user.user_id)
                .bind(&song_id)
                .execute(pool)
                .await
                .map_err(|e| Error::Internal(format!("Failed to enable song: {}", e)))?;
        } else if let Ok(pool) = state.database.postgres_pool() {
            sqlx::query("DELETE FROM disabled_songs WHERE user_id = $1 AND song_id = $2")
                .bind(user.user_id)
                .bind(&song_id)
                .execute(pool)
                .await
                .map_err(|e| Error::Internal(format!("Failed to enable song: {}", e)))?;
        } else {
            return Err(Error::Internal(
                "Unsupported database backend for disabled songs".to_string(),
            )
            .into());
        }

        Ok(Json(DisabledStatusResponse {
            song_id,
            disabled: false,
        }))
    }
}

/// Get all disabled songs for the current user.
///
/// GET /ferrotune/disabled-songs
pub async fn get_all_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<DisabledSongsResponse>> {
    let rows: Vec<(String,)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as("SELECT song_id FROM disabled_songs WHERE user_id = ?")
            .bind(user.user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to get disabled songs: {}", e)))?
    } else if let Ok(pool) = state.database.postgres_pool() {
        sqlx::query_as("SELECT song_id FROM disabled_songs WHERE user_id = $1")
            .bind(user.user_id)
            .fetch_all(pool)
            .await
            .map_err(|e| Error::Internal(format!("Failed to get disabled songs: {}", e)))?
    } else {
        return Err(
            Error::Internal("Unsupported database backend for disabled songs".to_string()).into(),
        );
    };

    Ok(Json(DisabledSongsResponse {
        song_ids: rows.into_iter().map(|(id,)| id).collect(),
    }))
}

/// Bulk set disabled status for multiple songs.
///
/// POST /ferrotune/disabled-songs/bulk
pub async fn bulk_set_disabled(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<BulkSetDisabledRequest>,
) -> FerrotuneApiResult<Json<BulkDisabledResponse>> {
    let count = body.song_ids.len();

    if body.disabled {
        // Add all to disabled list
        if let Ok(pool) = state.database.sqlite_pool() {
            for song_id in &body.song_ids {
                sqlx::query(
                    "INSERT OR IGNORE INTO disabled_songs (user_id, song_id) VALUES (?, ?)",
                )
                .bind(user.user_id)
                .bind(song_id)
                .execute(pool)
                .await?;
            }
        } else if let Ok(pool) = state.database.postgres_pool() {
            for song_id in &body.song_ids {
                sqlx::query(
                    "INSERT INTO disabled_songs (user_id, song_id) VALUES ($1, $2)
                     ON CONFLICT (user_id, song_id) DO NOTHING",
                )
                .bind(user.user_id)
                .bind(song_id)
                .execute(pool)
                .await?;
            }
        } else {
            return Err(Error::Internal(
                "Unsupported database backend for disabled songs".to_string(),
            )
            .into());
        }
    } else {
        // Remove all from disabled list
        if let Ok(pool) = state.database.sqlite_pool() {
            for song_id in &body.song_ids {
                sqlx::query("DELETE FROM disabled_songs WHERE user_id = ? AND song_id = ?")
                    .bind(user.user_id)
                    .bind(song_id)
                    .execute(pool)
                    .await?;
            }
        } else if let Ok(pool) = state.database.postgres_pool() {
            for song_id in &body.song_ids {
                sqlx::query("DELETE FROM disabled_songs WHERE user_id = $1 AND song_id = $2")
                    .bind(user.user_id)
                    .bind(song_id)
                    .execute(pool)
                    .await?;
            }
        } else {
            return Err(Error::Internal(
                "Unsupported database backend for disabled songs".to_string(),
            )
            .into());
        }
    }

    Ok(Json(BulkDisabledResponse {
        count,
        disabled: body.disabled,
    }))
}
