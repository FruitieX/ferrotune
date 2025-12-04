//! Listening statistics endpoints for tracking user listening time.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::sync::Arc;

/// Request body for logging a listening session.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogListeningRequest {
    /// The ID of the song that was listened to
    pub song_id: String,
    /// Duration listened in seconds (may be less than song duration if skipped)
    pub duration_seconds: i64,
    /// Optional session ID to update an existing session instead of creating a new one
    pub session_id: Option<i64>,
}

/// Response for logging a listening session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogListeningResponse {
    pub success: bool,
    /// The session ID (for updating in subsequent calls)
    pub session_id: i64,
}

/// Listening statistics for a time period.
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    /// Total listening time in seconds
    pub total_seconds: i64,
    /// Number of listening sessions
    pub session_count: i64,
    /// Number of unique songs listened to
    pub unique_songs: i64,
}

/// Response for getting listening statistics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStatsResponse {
    /// Stats for the last 7 days
    pub last_7_days: ListeningStats,
    /// Stats for the last 30 days
    pub last_30_days: ListeningStats,
    /// Stats for the current year
    pub this_year: ListeningStats,
    /// All-time stats
    pub all_time: ListeningStats,
}

/// Log a listening session.
///
/// POST /ferrotune/listening
///
/// If session_id is provided, updates an existing session.
/// Otherwise, creates a new session and returns its ID.
pub async fn log_listening(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<LogListeningRequest>,
) -> impl IntoResponse {
    // Validate that the song exists
    let song_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM songs WHERE id = ?)")
        .bind(&request.song_id)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(false);

    if !song_exists {
        return (
            StatusCode::NOT_FOUND,
            Json(super::ErrorResponse::new("Song not found")),
        )
            .into_response();
    }

    // If session_id is provided, update the existing session
    if let Some(session_id) = request.session_id {
        let result = sqlx::query(
            r#"
            UPDATE listening_sessions 
            SET duration_seconds = ?
            WHERE id = ? AND user_id = ? AND song_id = ?
            "#,
        )
        .bind(request.duration_seconds)
        .bind(session_id)
        .bind(user.user_id)
        .bind(&request.song_id)
        .execute(&state.pool)
        .await;

        match result {
            Ok(rows) if rows.rows_affected() > 0 => {
                return Json(LogListeningResponse {
                    success: true,
                    session_id,
                })
                .into_response();
            }
            Ok(_) => {
                // Session not found or wrong user/song - create a new one instead
                tracing::warn!(
                    "Session {} not found for update, creating new one",
                    session_id
                );
            }
            Err(e) => {
                tracing::error!("Failed to update listening session: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(super::ErrorResponse::new(
                        "Failed to update listening session",
                    )),
                )
                    .into_response();
            }
        }
    }

    // Insert a new listening session
    let result = sqlx::query_scalar::<_, i64>(
        r#"
        INSERT INTO listening_sessions (user_id, song_id, duration_seconds, listened_at)
        VALUES (?, ?, ?, datetime('now'))
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(&request.song_id)
    .bind(request.duration_seconds)
    .fetch_one(&state.pool)
    .await;

    match result {
        Ok(session_id) => Json(LogListeningResponse {
            success: true,
            session_id,
        })
        .into_response(),
        Err(e) => {
            tracing::error!("Failed to log listening session: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::new("Failed to log listening session")),
            )
                .into_response()
        }
    }
}

/// Get listening statistics for the authenticated user.
///
/// GET /ferrotune/listening/stats
pub async fn get_listening_stats(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Helper to get stats for a date filter
    async fn get_stats_for_period(
        db: &sqlx::SqlitePool,
        user_id: i64,
        date_filter: &str,
    ) -> Result<ListeningStats, sqlx::Error> {
        let query = format!(
            r#"
            SELECT 
                COALESCE(SUM(duration_seconds), 0) as total_seconds,
                COUNT(*) as session_count,
                COUNT(DISTINCT song_id) as unique_songs
            FROM listening_sessions
            WHERE user_id = ?
            {}
            "#,
            date_filter
        );

        sqlx::query_as::<_, ListeningStats>(&query)
            .bind(user_id)
            .fetch_one(db)
            .await
    }

    // Get stats for each time period
    let last_7_days = get_stats_for_period(
        &state.pool,
        user.user_id,
        "AND listened_at >= datetime('now', '-7 days')",
    )
    .await;

    let last_30_days = get_stats_for_period(
        &state.pool,
        user.user_id,
        "AND listened_at >= datetime('now', '-30 days')",
    )
    .await;

    let this_year = get_stats_for_period(
        &state.pool,
        user.user_id,
        "AND strftime('%Y', listened_at) = strftime('%Y', 'now')",
    )
    .await;

    let all_time = get_stats_for_period(&state.pool, user.user_id, "").await;

    // Check for errors
    match (last_7_days, last_30_days, this_year, all_time) {
        (Ok(last_7_days), Ok(last_30_days), Ok(this_year), Ok(all_time)) => {
            Json(ListeningStatsResponse {
                last_7_days,
                last_30_days,
                this_year,
                all_time,
            })
            .into_response()
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::new("Failed to fetch listening stats")),
        )
            .into_response(),
    }
}
