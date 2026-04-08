//! Scrobbles management endpoints for the Ferrotune Admin API.
//!
//! Provides endpoints for scrobbling and importing play counts.

use crate::api::common::scrobbling::insert_submission_scrobble_if_not_recent_duplicate;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::retry::with_retry;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Scrobble Endpoint (Single)
// ============================================================================

/// Params for single scrobble
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrobbleParams {
    /// Song ID being scrobbled
    pub id: String,
    /// Time when it was played (timestamp in ms). Defaults to now.
    pub time: Option<i64>,
    /// Whether this is a submission (true) or just "now playing" notification (false)
    /// Defaults to true for Ferrotune API as we typically use it for submission.
    #[serde(default = "default_submission")]
    pub submission: bool,
    /// The queue source type at the time of playback (e.g., "album", "playlist", "library")
    pub queue_source_type: Option<String>,
    /// The specific source ID (e.g., album ID, playlist ID) at the time of playback
    pub queue_source_id: Option<String>,
}

fn default_submission() -> bool {
    true
}

/// POST /ferrotune/scrobbles - Scrobble a song (record playback)
pub async fn scrobble(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(params): Json<ScrobbleParams>,
) -> FerrotuneApiResult<StatusCode> {
    // Calculate played_at timestamp
    let played_at = if let Some(ms) = params.time {
        chrono::DateTime::from_timestamp_millis(ms).unwrap_or_else(Utc::now)
    } else {
        Utc::now()
    };

    // If submission, record it
    if params.submission {
        if insert_submission_scrobble_if_not_recent_duplicate(
            &state.pool,
            user.user_id,
            &params.id,
            played_at,
            params.queue_source_type.as_deref(),
            params.queue_source_id.as_deref(),
        )
        .await?
        {
            // Record scrobble
            // Forward to Last.fm in background (non-blocking)
            {
                let pool = state.pool.clone();
                let uid = user.user_id;
                let song_id = params.id.clone();
                let ts = played_at.timestamp();
                tokio::spawn(async move {
                    if let Err(e) = super::lastfm::forward_scrobble(&pool, uid, &song_id, ts).await
                    {
                        tracing::warn!("Last.fm scrobble failed: {}", e);
                    }
                });
            }
        }
    } else {
        // "Now playing" notification - forward to Last.fm
        {
            let pool = state.pool.clone();
            let uid = user.user_id;
            let song_id = params.id.clone();
            tokio::spawn(async move {
                if let Err(e) = super::lastfm::update_now_playing(&pool, uid, &song_id).await {
                    tracing::warn!("Last.fm now playing update failed: {}", e);
                }
            });
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Import Scrobbles
// ============================================================================

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
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ImportScrobblesRequest>,
) -> FerrotuneApiResult<Json<ImportScrobblesResponse>> {
    // Handle empty entries
    if request.entries.is_empty() {
        return Ok(Json(ImportScrobblesResponse {
            songs_imported: 0,
            total_plays_imported: 0,
        }));
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

    let existing_ids: Vec<String> = query.fetch_all(&state.pool).await?;

    // Filter entries to only include existing songs
    let existing_set: std::collections::HashSet<&str> =
        existing_ids.iter().map(|s| s.as_str()).collect();
    let valid_entries: Vec<&ImportScrobbleEntry> = request
        .entries
        .iter()
        .filter(|e| existing_set.contains(e.song_id.as_str()))
        .collect();

    if valid_entries.is_empty() {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "No valid song IDs found".to_string(),
        )));
    }

    // If replace mode, delete existing scrobbles for the affected songs
    if request.mode == ImportMode::Replace {
        let valid_song_ids: Vec<&str> = valid_entries.iter().map(|e| e.song_id.as_str()).collect();
        let delete_placeholders: Vec<&str> = valid_song_ids.iter().map(|_| "?").collect();
        let delete_query = format!(
            "DELETE FROM scrobbles WHERE user_id = ? AND song_id IN ({})",
            delete_placeholders.join(", ")
        );

        let pool = state.pool.clone();
        let uid = user.user_id;
        let song_ids_owned: Vec<String> = valid_song_ids.iter().map(|s| s.to_string()).collect();
        with_retry(
            || {
                let pool = pool.clone();
                let delete_query = delete_query.clone();
                let song_ids = song_ids_owned.clone();
                async move {
                    let mut delete_stmt = sqlx::query(&delete_query).bind(uid);
                    for id in &song_ids {
                        delete_stmt = delete_stmt.bind(id.as_str());
                    }
                    delete_stmt.execute(&pool).await
                }
            },
            None,
        )
        .await?;
    }

    // Insert new scrobbles - one row per song with play_count
    let mut songs_imported = 0i32;
    let mut total_plays_imported = 0i32;

    for entry in &valid_entries {
        if entry.play_count <= 0 {
            continue;
        }

        let pool = state.pool.clone();
        let uid = user.user_id;
        let song_id = entry.song_id.clone();
        let play_count = entry.play_count;
        let description = request.description.clone();

        let result = with_retry(
            || {
                let pool = pool.clone();
                let song_id = song_id.clone();
                let description = description.clone();
                async move {
                    sqlx::query(
                        r#"
                        INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
                        VALUES (?, ?, NULL, 1, ?, ?)
                        "#,
                    )
                    .bind(uid)
                    .bind(&song_id)
                    .bind(play_count)
                    .bind(&description)
                    .execute(&pool)
                    .await
                }
            },
            None,
        )
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

    Ok(Json(ImportScrobblesResponse {
        songs_imported,
        total_plays_imported,
    }))
}

// ============================================================================
// Check for Duplicate Imports
// ============================================================================

/// Response for checking existing import by description.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CheckImportDuplicateResponse {
    /// Whether an import with this description already exists
    pub exists: bool,
    /// Number of songs in the existing import
    pub song_count: i64,
    /// Total play count in the existing import
    pub total_plays: i64,
}

/// Check if an import with the given description already exists.
///
/// GET /ferrotune/scrobbles/check-duplicate?description=...
///
/// Used by the import dialog to warn about potentially duplicate imports.
pub async fn check_import_duplicate(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CheckDuplicateParams>,
) -> FerrotuneApiResult<Json<CheckImportDuplicateResponse>> {
    let description = params.description.trim();

    if description.is_empty() {
        return Ok(Json(CheckImportDuplicateResponse {
            exists: false,
            song_count: 0,
            total_plays: 0,
        }));
    }

    // Query for existing scrobbles with this description
    let result: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT song_id) as song_count, COALESCE(SUM(play_count), 0) as total_plays
        FROM scrobbles
        WHERE user_id = ? AND description = ?
        "#,
    )
    .bind(user.user_id)
    .bind(description)
    .fetch_optional(&state.pool)
    .await?;

    match result {
        Some((song_count, total_plays)) if song_count > 0 => {
            Ok(Json(CheckImportDuplicateResponse {
                exists: true,
                song_count,
                total_plays,
            }))
        }
        _ => Ok(Json(CheckImportDuplicateResponse {
            exists: false,
            song_count: 0,
            total_plays: 0,
        })),
    }
}

/// Parameters for checking duplicate import.
#[derive(Debug, Deserialize)]
pub struct CheckDuplicateParams {
    pub description: String,
}

// ============================================================================
// Get Play Counts
// ============================================================================

/// Get the current play count for a song (for preview in import dialog).
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongPlayCount {
    pub song_id: String,
    #[ts(type = "number")]
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
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<GetPlayCountsRequest>,
) -> FerrotuneApiResult<Json<GetPlayCountsResponse>> {
    if request.song_ids.is_empty() {
        return Ok(Json(GetPlayCountsResponse { counts: vec![] }));
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

    let rows = stmt.fetch_all(&state.pool).await?;

    let counts: Vec<SongPlayCount> = rows
        .into_iter()
        .map(|(song_id, play_count)| SongPlayCount {
            song_id,
            play_count,
        })
        .collect();
    Ok(Json(GetPlayCountsResponse { counts }))
}

// ============================================================================
// Import Scrobbles with Timestamps (for JSON imports like Spotify)
// ============================================================================

/// A single play event with timestamp and duration.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PlayEvent {
    /// ISO 8601 timestamp when the song was played
    pub played_at: String,
    /// Duration listened in seconds
    pub duration_seconds: i32,
    /// Whether this play counts as a scrobble (listened to completion or >= 30s)
    pub is_scrobble: bool,
}

/// A song with its play events to import.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportSongWithPlays {
    /// The song ID to import plays for
    pub song_id: String,
    /// Individual play events with timestamps
    pub plays: Vec<PlayEvent>,
}

/// Request body for importing scrobbles with timestamps.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportWithTimestampsRequest {
    /// Songs with their play events
    pub songs: Vec<ImportSongWithPlays>,
    /// Import mode (append or replace)
    #[serde(default)]
    pub mode: ImportMode,
    /// Optional description for this import batch
    pub description: Option<String>,
}

/// Response for importing scrobbles with timestamps.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ImportWithTimestampsResponse {
    /// Number of songs that had plays imported
    pub songs_imported: i32,
    /// Total number of scrobbles imported (listening sessions that count as plays)
    pub scrobbles_imported: i32,
    /// Total number of listening sessions imported (all play events)
    pub sessions_imported: i32,
}

/// Import play events with individual timestamps.
///
/// POST /ferrotune/scrobbles/import-with-timestamps
///
/// Imports play events into both `scrobbles` (for play counts) and
/// `listening_sessions` (for Year in Review duration stats).
///
/// Each play event includes:
/// - `played_at`: ISO 8601 timestamp
/// - `duration_seconds`: How long the song was listened to
/// - `is_scrobble`: Whether this counts as a scrobble (completed or >= 30s)
///
/// Play events where `is_scrobble` is true are inserted into `scrobbles`.
/// All play events are inserted into `listening_sessions` for duration tracking.
pub async fn import_with_timestamps(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ImportWithTimestampsRequest>,
) -> FerrotuneApiResult<Json<ImportWithTimestampsResponse>> {
    // Handle empty entries
    if request.songs.is_empty() {
        return Ok(Json(ImportWithTimestampsResponse {
            songs_imported: 0,
            scrobbles_imported: 0,
            sessions_imported: 0,
        }));
    }

    // Collect all song IDs for validation
    let song_ids: Vec<&str> = request.songs.iter().map(|s| s.song_id.as_str()).collect();

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

    let existing_ids: Vec<String> = query.fetch_all(&state.pool).await?;
    let existing_set: std::collections::HashSet<&str> =
        existing_ids.iter().map(|s| s.as_str()).collect();

    // Filter to only valid songs
    let valid_songs: Vec<&ImportSongWithPlays> = request
        .songs
        .iter()
        .filter(|s| existing_set.contains(s.song_id.as_str()))
        .collect();

    if valid_songs.is_empty() {
        return Err(FerrotuneApiError::from(Error::InvalidRequest(
            "No valid song IDs found".to_string(),
        )));
    }

    // If replace mode, delete existing data for the affected songs
    if request.mode == ImportMode::Replace {
        let valid_song_ids: Vec<&str> = valid_songs.iter().map(|s| s.song_id.as_str()).collect();
        let delete_placeholders: Vec<&str> = valid_song_ids.iter().map(|_| "?").collect();

        // Delete from scrobbles
        let delete_scrobbles_query = format!(
            "DELETE FROM scrobbles WHERE user_id = ? AND song_id IN ({})",
            delete_placeholders.join(", ")
        );
        let pool = state.pool.clone();
        let uid = user.user_id;
        let song_ids_owned: Vec<String> = valid_song_ids.iter().map(|s| s.to_string()).collect();
        with_retry(
            || {
                let pool = pool.clone();
                let delete_query = delete_scrobbles_query.clone();
                let song_ids = song_ids_owned.clone();
                async move {
                    let mut delete_stmt = sqlx::query(&delete_query).bind(uid);
                    for id in &song_ids {
                        delete_stmt = delete_stmt.bind(id.as_str());
                    }
                    delete_stmt.execute(&pool).await
                }
            },
            None,
        )
        .await?;

        // Delete from listening_sessions
        let delete_sessions_query = format!(
            "DELETE FROM listening_sessions WHERE user_id = ? AND song_id IN ({})",
            delete_placeholders.join(", ")
        );
        let pool = state.pool.clone();
        let song_ids_owned: Vec<String> = valid_song_ids.iter().map(|s| s.to_string()).collect();
        with_retry(
            || {
                let pool = pool.clone();
                let delete_query = delete_sessions_query.clone();
                let song_ids = song_ids_owned.clone();
                async move {
                    let mut delete_stmt = sqlx::query(&delete_query).bind(uid);
                    for id in &song_ids {
                        delete_stmt = delete_stmt.bind(id.as_str());
                    }
                    delete_stmt.execute(&pool).await
                }
            },
            None,
        )
        .await?;
    }

    let mut songs_imported = 0i32;
    let mut scrobbles_imported = 0i32;
    let mut sessions_imported = 0i32;

    for song in &valid_songs {
        if song.plays.is_empty() {
            continue;
        }

        let mut song_had_imports = false;

        for play in &song.plays {
            // Parse the timestamp
            let played_at = match chrono::DateTime::parse_from_rfc3339(&play.played_at) {
                Ok(dt) => dt.to_utc(),
                Err(_) => {
                    // Try parsing without timezone (assume UTC)
                    match chrono::NaiveDateTime::parse_from_str(
                        &play.played_at,
                        "%Y-%m-%dT%H:%M:%SZ",
                    ) {
                        Ok(ndt) => ndt.and_utc(),
                        Err(_) => {
                            tracing::warn!(
                                "Failed to parse timestamp: {} for song {}",
                                play.played_at,
                                song.song_id
                            );
                            continue;
                        }
                    }
                }
            };

            // Insert into listening_sessions (all plays for duration tracking)
            let pool = state.pool.clone();
            let uid = user.user_id;
            let song_id = song.song_id.clone();
            let duration = play.duration_seconds;

            let session_result = with_retry(
                || {
                    let pool = pool.clone();
                    let song_id = song_id.clone();
                    async move {
                        sqlx::query(
                            r#"
                            INSERT INTO listening_sessions (user_id, song_id, duration_seconds, listened_at)
                            VALUES (?, ?, ?, ?)
                            "#,
                        )
                        .bind(uid)
                        .bind(&song_id)
                        .bind(duration)
                        .bind(played_at)
                        .execute(&pool)
                        .await
                    }
                },
                None,
            )
            .await;

            if session_result.is_ok() {
                sessions_imported += 1;
                song_had_imports = true;
            }

            // Insert into scrobbles only if this is a scrobble
            if play.is_scrobble {
                let pool = state.pool.clone();
                let song_id = song.song_id.clone();
                let description = request.description.clone();

                let scrobble_result = with_retry(
                    || {
                        let pool = pool.clone();
                        let song_id = song_id.clone();
                        let description = description.clone();
                        async move {
                            sqlx::query(
                                r#"
                                INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
                                VALUES (?, ?, ?, 1, 1, ?)
                                "#,
                            )
                            .bind(uid)
                            .bind(&song_id)
                            .bind(played_at)
                            .bind(&description)
                            .execute(&pool)
                            .await
                        }
                    },
                    None,
                )
                .await;

                if scrobble_result.is_ok() {
                    scrobbles_imported += 1;
                }
            }
        }

        if song_had_imports {
            songs_imported += 1;
        }
    }

    Ok(Json(ImportWithTimestampsResponse {
        songs_imported,
        scrobbles_imported,
        sessions_imported,
    }))
}
