//! Scrobbles management endpoints for the Ferrotune Admin API.
//!
//! Provides endpoints for importing play counts from external sources.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// A single scrobble entry to import.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportScrobbleEntry {
    /// The song ID to add play counts for
    pub song_id: String,
    /// Number of plays to import
    pub play_count: i32,
}

/// Import mode - whether to append to or replace existing scrobbles.
#[derive(Debug, Default, Deserialize, TS, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub enum ImportMode {
    /// Add to existing play counts
    #[default]
    Append,
    /// Replace existing play counts for the affected songs
    Replace,
}

/// Request body for importing scrobbles.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportScrobblesRequest {
    /// The scrobble entries to import
    pub entries: Vec<ImportScrobbleEntry>,
    /// Import mode (append or replace)
    #[serde(default)]
    pub mode: ImportMode,
    /// Optional description for this import batch (e.g., "CSV import Dec 2024")
    pub description: Option<String>,
}

/// Response for importing scrobbles.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportScrobblesResponse {
    /// Number of songs that had play counts imported
    pub songs_imported: i32,
    /// Total number of plays imported
    pub total_plays_imported: i32,
}

/// Import play counts from external sources.
///
/// POST /ferrotune/scrobbles/import
///
/// Accepts a list of song IDs with play counts and creates scrobble records.
/// If mode is "replace", existing scrobbles for the affected songs are deleted first.
pub async fn import_scrobbles(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ImportScrobblesRequest>,
) -> impl IntoResponse {
    // Handle empty entries
    if request.entries.is_empty() {
        return Json(ImportScrobblesResponse {
            songs_imported: 0,
            total_plays_imported: 0,
        })
        .into_response();
    }

    // Collect all song IDs for validation
    let song_ids: Vec<&str> = request.entries.iter().map(|e| e.song_id.as_str()).collect();

    // Validate that all song IDs exist
    let placeholders: Vec<&str> = song_ids.iter().map(|_| "?").collect();
    let validation_query = format!(
        "SELECT id FROM songs WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut query = sqlx::query_scalar::<_, String>(&validation_query);
    for id in &song_ids {
        query = query.bind(*id);
    }

    let existing_ids: Vec<String> = match query.fetch_all(&state.pool).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!("Failed to validate song IDs: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new("Failed to validate song IDs")),
            )
                .into_response();
        }
    };

    // Filter entries to only include existing songs
    let existing_set: std::collections::HashSet<&str> =
        existing_ids.iter().map(|s| s.as_str()).collect();
    let valid_entries: Vec<&ImportScrobbleEntry> = request
        .entries
        .iter()
        .filter(|e| existing_set.contains(e.song_id.as_str()))
        .collect();

    if valid_entries.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(super::ErrorResponse::new("No valid song IDs found")),
        )
            .into_response();
    }

    // If replace mode, delete existing scrobbles for the affected songs
    if request.mode == ImportMode::Replace {
        let valid_song_ids: Vec<&str> = valid_entries.iter().map(|e| e.song_id.as_str()).collect();
        let delete_placeholders: Vec<&str> = valid_song_ids.iter().map(|_| "?").collect();
        let delete_query = format!(
            "DELETE FROM scrobbles WHERE user_id = ? AND song_id IN ({})",
            delete_placeholders.join(", ")
        );

        let mut delete_stmt = sqlx::query(&delete_query).bind(user.user_id);
        for id in &valid_song_ids {
            delete_stmt = delete_stmt.bind(*id);
        }

        if let Err(e) = delete_stmt.execute(&state.pool).await {
            tracing::error!("Failed to delete existing scrobbles: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new(
                    "Failed to delete existing scrobbles",
                )),
            )
                .into_response();
        }
    }

    // Insert new scrobbles - one row per song with play_count
    let mut songs_imported = 0i32;
    let mut total_plays_imported = 0i32;

    for entry in &valid_entries {
        if entry.play_count <= 0 {
            continue;
        }

        let result = sqlx::query(
            r#"
            INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
            VALUES (?, ?, NULL, 1, ?, ?)
            "#,
        )
        .bind(user.user_id)
        .bind(&entry.song_id)
        .bind(entry.play_count)
        .bind(&request.description)
        .execute(&state.pool)
        .await;

        match result {
            Ok(_) => {
                songs_imported += 1;
                total_plays_imported += entry.play_count;
            }
            Err(e) => {
                tracing::error!(
                    "Failed to insert scrobble for song {}: {}",
                    entry.song_id,
                    e
                );
                // Continue with other entries
            }
        }
    }

    Json(ImportScrobblesResponse {
        songs_imported,
        total_plays_imported,
    })
    .into_response()
}

/// Get the current play count for a song (for preview in import dialog).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongPlayCount {
    pub song_id: String,
    pub play_count: i64,
}

/// Request to get play counts for multiple songs.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetPlayCountsRequest {
    pub song_ids: Vec<String>,
}

/// Response containing play counts for songs.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetPlayCountsResponse {
    pub counts: Vec<SongPlayCount>,
}

/// Get current play counts for multiple songs.
///
/// POST /ferrotune/scrobbles/counts
///
/// Used by import dialog to show existing counts for preview.
pub async fn get_play_counts(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<GetPlayCountsRequest>,
) -> impl IntoResponse {
    if request.song_ids.is_empty() {
        return Json(GetPlayCountsResponse { counts: vec![] }).into_response();
    }

    let placeholders: Vec<&str> = request.song_ids.iter().map(|_| "?").collect();
    let query = format!(
        r#"
        SELECT song_id, COALESCE(SUM(play_count), 0) as play_count
        FROM scrobbles
        WHERE user_id = ? AND submission = 1 AND song_id IN ({})
        GROUP BY song_id
        "#,
        placeholders.join(", ")
    );

    let mut stmt = sqlx::query_as::<_, (String, i64)>(&query).bind(user.user_id);
    for id in &request.song_ids {
        stmt = stmt.bind(id);
    }

    match stmt.fetch_all(&state.pool).await {
        Ok(rows) => {
            let counts: Vec<SongPlayCount> = rows
                .into_iter()
                .map(|(song_id, play_count)| SongPlayCount {
                    song_id,
                    play_count,
                })
                .collect();
            Json(GetPlayCountsResponse { counts }).into_response()
        }
        Err(e) => {
            tracing::error!("Failed to fetch play counts: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new("Failed to fetch play counts")),
            )
                .into_response()
        }
    }
}
