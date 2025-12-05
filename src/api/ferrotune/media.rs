//! Media management endpoints for the Admin API.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use crate::db::queries;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

use super::ErrorResponse;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteSongResponse {
    success: bool,
    message: String,
}

/// Delete a song from the database (not from disk).
///
/// DELETE /api/songs/:id
///
/// This removes the song from the database, including all related data:
/// - Playlist entries
/// - Scrobble history
/// - Starred/favorite status
/// - Full-text search index
///
/// Note: This does NOT delete the actual file from disk. On the next scan,
/// the song will be re-added to the database unless the file is also removed.
pub async fn delete_song(
    _user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // First verify the song exists
    let song = match queries::get_song_by_id(&state.pool, &id).await {
        Ok(Some(song)) => song,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("Song not found: {}", id))),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::with_details("Database error", e.to_string())),
            )
                .into_response();
        }
    };

    // Delete the song
    match queries::delete_song(&state.pool, &id).await {
        Ok(true) => Json(DeleteSongResponse {
            success: true,
            message: format!("Successfully deleted song: {}", song.title),
        })
        .into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new("Song not found or already deleted")),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to delete song",
                e.to_string(),
            )),
        )
            .into_response(),
    }
}
