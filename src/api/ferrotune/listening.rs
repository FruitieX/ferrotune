//! Listening statistics endpoints for tracking user listening time.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_artist_thumbnails_base64, get_song_thumbnails_base64,
    InlineImagesParam,
};
use crate::api::AppState;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Query, State},
    response::Json,
};
use sea_orm::{FromQueryResult, Value};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

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
    /// Whether the song was skipped (user manually advanced to next track)
    #[serde(default)]
    pub skipped: bool,
}

/// Response for logging a listening session.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct LogListeningResponse {
    pub success: bool,
    /// The session ID (for updating in subsequent calls)
    #[ts(type = "number")]
    pub session_id: i64,
}

/// Listening statistics for a time period.
#[derive(Debug, Serialize, FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ListeningStats {
    /// Total listening time in seconds
    #[ts(type = "number")]
    pub total_seconds: i64,
    /// Number of listening sessions
    #[ts(type = "number")]
    pub session_count: i64,
    /// Number of unique songs listened to
    #[ts(type = "number")]
    pub unique_songs: i64,
    /// Number of songs skipped
    #[ts(type = "number")]
    pub skip_count: i64,
    /// Total number of scrobbles (completed plays)
    #[ts(type = "number")]
    pub scrobble_count: i64,
}

/// Response for getting listening statistics.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ListeningSqlDialect {
    Sqlite,
    Postgres,
}

#[derive(Debug, Clone, Copy)]
struct ListeningStatsFilter {
    sqlite_listening: &'static str,
    sqlite_scrobbles: &'static str,
    postgres_listening: &'static str,
    postgres_scrobbles: &'static str,
}

#[derive(Debug, Clone)]
struct ListeningPeriodFilter {
    sqlite: String,
    postgres: String,
}

const LAST_7_DAYS_FILTER: ListeningStatsFilter = ListeningStatsFilter {
    sqlite_listening: "AND listened_at >= datetime('now', '-7 days')",
    sqlite_scrobbles: "AND played_at >= datetime('now', '-7 days')",
    postgres_listening: "AND listened_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'",
    postgres_scrobbles: "AND played_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'",
};

const LAST_30_DAYS_FILTER: ListeningStatsFilter = ListeningStatsFilter {
    sqlite_listening: "AND listened_at >= datetime('now', '-30 days')",
    sqlite_scrobbles: "AND played_at >= datetime('now', '-30 days')",
    postgres_listening: "AND listened_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'",
    postgres_scrobbles: "AND played_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'",
};

const THIS_YEAR_FILTER: ListeningStatsFilter = ListeningStatsFilter {
    sqlite_listening: "AND strftime('%Y', listened_at) = strftime('%Y', 'now')",
    sqlite_scrobbles: "AND strftime('%Y', played_at) = strftime('%Y', 'now')",
    postgres_listening: "AND EXTRACT(YEAR FROM listened_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)",
    postgres_scrobbles: "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)",
};

const ALL_TIME_FILTER: ListeningStatsFilter = ListeningStatsFilter {
    sqlite_listening: "",
    sqlite_scrobbles: "",
    postgres_listening: "",
    postgres_scrobbles: "",
};

fn listening_sql_dialect(
    database: &crate::db::Database,
) -> FerrotuneApiResult<ListeningSqlDialect> {
    if database.is_sqlite() {
        Ok(ListeningSqlDialect::Sqlite)
    } else if database.is_postgres() {
        Ok(ListeningSqlDialect::Postgres)
    } else {
        Err(Error::Internal(
            "database handle exposed neither a SQLite nor PostgreSQL pool".to_string(),
        )
        .into())
    }
}

fn build_period_review_filter(year: i32, month: Option<i32>) -> ListeningPeriodFilter {
    if let Some(month) = month {
        ListeningPeriodFilter {
            sqlite: format!(
                "AND strftime('%Y', listened_at) = '{}' AND strftime('%m', listened_at) = '{:02}'",
                year, month
            ),
            postgres: format!(
                "AND EXTRACT(YEAR FROM listened_at) = {} AND EXTRACT(MONTH FROM listened_at) = {}",
                year, month
            ),
        }
    } else {
        ListeningPeriodFilter {
            sqlite: format!("AND strftime('%Y', listened_at) = '{}'", year),
            postgres: format!("AND EXTRACT(YEAR FROM listened_at) = {}", year),
        }
    }
}

/// Log a listening session.
///
/// POST /ferrotune/listening
///
/// If session_id is provided, updates an existing session.
/// Otherwise, creates a new session and returns its ID.
pub async fn log_listening(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<LogListeningRequest>,
) -> FerrotuneApiResult<Json<LogListeningResponse>> {
    let database = &state.database;

    // Validate that the song exists
    let song_exists = crate::db::raw::query_scalar::<i64>(
        database.conn(),
        "SELECT CASE WHEN EXISTS(SELECT 1 FROM songs WHERE id = ?) THEN 1 ELSE 0 END",
        "SELECT (CASE WHEN EXISTS(SELECT 1 FROM songs WHERE id = $1) THEN 1 ELSE 0 END)::BIGINT",
        [Value::from(request.song_id.clone())],
    )
    .await?
    .unwrap_or(0)
        != 0;

    if !song_exists {
        return Err(Error::NotFound("Song not found".to_string()).into());
    }

    // If session_id is provided, update the existing session
    if let Some(session_id) = request.session_id {
        let update_res = crate::db::raw::execute(
            database.conn(),
            "UPDATE listening_sessions \
             SET duration_seconds = ?, skipped = ? \
             WHERE id = ? AND user_id = ? AND song_id = ?",
            "UPDATE listening_sessions \
             SET duration_seconds = $1, skipped = $2 \
             WHERE id = $3 AND user_id = $4 AND song_id = $5",
            [
                Value::from(request.duration_seconds),
                Value::from(request.skipped),
                Value::from(session_id),
                Value::from(user.user_id),
                Value::from(request.song_id.clone()),
            ],
        )
        .await;

        match update_res {
            Ok(res) if res.rows_affected() > 0 => {
                return Ok(Json(LogListeningResponse {
                    success: true,
                    session_id,
                }));
            }
            Ok(_) => {
                tracing::warn!(
                    "Session {} not found for update, creating new one",
                    session_id
                );
            }
            Err(e) => {
                tracing::error!("Failed to update listening session: {}", e);
                return Err(
                    Error::Internal("Failed to update listening session".to_string()).into(),
                );
            }
        }
    }

    // Insert a new listening session
    let new_id = crate::db::raw::query_scalar::<i64>(
        database.conn(),
        "INSERT INTO listening_sessions (user_id, song_id, duration_seconds, skipped, listened_at) \
         VALUES (?, ?, ?, ?, datetime('now')) RETURNING id",
        "INSERT INTO listening_sessions (user_id, song_id, duration_seconds, skipped, listened_at) \
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id",
        [
            Value::from(user.user_id),
            Value::from(request.song_id.clone()),
            Value::from(request.duration_seconds),
            Value::from(request.skipped),
        ],
    )
    .await?;

    match new_id {
        Some(session_id) => Ok(Json(LogListeningResponse {
            success: true,
            session_id,
        })),
        None => {
            tracing::error!("Failed to log listening session: no row returned");
            Err(Error::Internal("Failed to log listening session".to_string()).into())
        }
    }
}

/// Get listening statistics for the authenticated user.
///
/// GET /ferrotune/listening/stats
pub async fn get_listening_stats(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<ListeningStatsResponse>> {
    // Helper to get stats for a date filter
    async fn get_stats_for_period(
        database: &crate::db::Database,
        user_id: i64,
        filter: ListeningStatsFilter,
    ) -> FerrotuneApiResult<ListeningStats> {
        let sqlite_sql = format!(
            r#"
                SELECT
                    COALESCE(SUM(ls.duration_seconds), 0) as total_seconds,
                    COUNT(*) as session_count,
                    COUNT(DISTINCT ls.song_id) as unique_songs,
                    COALESCE(SUM(CASE WHEN ls.skipped THEN 1 ELSE 0 END), 0) as skip_count,
                    COALESCE((
                        SELECT SUM(s.play_count) FROM scrobbles s
                        WHERE s.user_id = ? {date_filter_scrobbles}
                    ), 0) as scrobble_count
                FROM listening_sessions ls
                WHERE ls.user_id = ?
                {date_filter_ls}
                "#,
            date_filter_ls = filter.sqlite_listening,
            date_filter_scrobbles = filter.sqlite_scrobbles,
        );
        let postgres_sql = format!(
            r#"
                SELECT
                    COALESCE(SUM(ls.duration_seconds), 0)::BIGINT as total_seconds,
                    COUNT(*) as session_count,
                    COUNT(DISTINCT ls.song_id) as unique_songs,
                    COALESCE(SUM(CASE WHEN ls.skipped THEN 1 ELSE 0 END), 0)::BIGINT as skip_count,
                    COALESCE((
                        SELECT COALESCE(SUM(s.play_count), 0)::BIGINT FROM scrobbles s
                        WHERE s.user_id = $1 {date_filter_scrobbles}
                    ), 0)::BIGINT as scrobble_count
                FROM listening_sessions ls
                WHERE ls.user_id = $2
                {date_filter_ls}
                "#,
            date_filter_ls = filter.postgres_listening,
            date_filter_scrobbles = filter.postgres_scrobbles,
        );

        let row = crate::db::raw::query_one::<ListeningStats>(
            database.conn(),
            &sqlite_sql,
            &postgres_sql,
            [Value::from(user_id), Value::from(user_id)],
        )
        .await?;
        row.ok_or_else(|| Error::Internal("Failed to fetch listening stats".to_string()).into())
    }

    // Get stats for each time period
    let last_7_days =
        get_stats_for_period(&state.database, user.user_id, LAST_7_DAYS_FILTER).await?;
    let last_30_days =
        get_stats_for_period(&state.database, user.user_id, LAST_30_DAYS_FILTER).await?;
    let this_year = get_stats_for_period(&state.database, user.user_id, THIS_YEAR_FILTER).await?;
    let all_time = get_stats_for_period(&state.database, user.user_id, ALL_TIME_FILTER).await?;

    Ok(Json(ListeningStatsResponse {
        last_7_days,
        last_30_days,
        this_year,
        all_time,
    }))
}

// ============ Period Review Types ============

#[derive(Debug, Clone, Serialize, Deserialize, FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TopArtist {
    pub artist_id: String,
    pub artist_name: String,
    #[ts(type = "number")]
    pub play_count: i64,
    #[ts(type = "number")]
    pub total_duration_secs: i64,
    pub cover_art: Option<String>,
    /// Base64-encoded cover art thumbnail data (only present if inlineImages requested)
    #[sea_orm(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TopAlbum {
    pub album_id: String,
    pub album_name: String,
    pub artist_id: Option<String>,
    pub artist_name: Option<String>,
    #[ts(type = "number")]
    pub play_count: i64,
    #[ts(type = "number")]
    pub total_duration_secs: i64,
    pub cover_art: Option<String>,
    /// Base64-encoded cover art thumbnail data (only present if inlineImages requested)
    #[sea_orm(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromQueryResult, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TopTrack {
    pub track_id: String,
    pub track_title: String,
    pub artist_id: Option<String>,
    pub artist_name: Option<String>,
    pub album_id: Option<String>,
    pub album_name: Option<String>,
    #[ts(type = "number")]
    pub play_count: i64,
    #[ts(type = "number")]
    pub total_duration_secs: i64,
    pub cover_art: Option<String>,
    /// Base64-encoded cover art thumbnail data (only present if inlineImages requested)
    #[sea_orm(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PeriodReview {
    pub year: i32,
    pub month: Option<i32>,
    #[ts(type = "number")]
    pub total_listening_secs: i64,
    #[ts(type = "number")]
    pub total_play_count: i64,
    #[ts(type = "number")]
    pub unique_tracks: i64,
    #[ts(type = "number")]
    pub unique_albums: i64,
    #[ts(type = "number")]
    pub unique_artists: i64,
    pub top_artists: Vec<TopArtist>,
    pub top_albums: Vec<TopAlbum>,
    pub top_tracks: Vec<TopTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AvailablePeriod {
    pub year: i32,
    pub month: Option<i32>,
    pub has_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct PeriodReviewResponse {
    pub review: PeriodReview,
    pub available_periods: Vec<AvailablePeriod>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PeriodReviewQuery {
    pub year: Option<i32>,
    pub month: Option<i32>,
    /// Include inline cover art thumbnails (small or medium)
    #[serde(flatten)]
    pub inline_images: InlineImagesParam,
}

/// Get period review (year in review or month in review)
pub async fn get_period_review(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(query): Query<PeriodReviewQuery>,
) -> FerrotuneApiResult<Json<PeriodReviewResponse>> {
    // Default to current year if not specified
    let now = chrono::Utc::now();
    let year = query.year.unwrap_or(now.year());
    let month = query.month;

    let dialect = listening_sql_dialect(&state.database)?;
    let date_filter = build_period_review_filter(year, month);
    let enabled_filter = match dialect {
        ListeningSqlDialect::Sqlite => "mf.enabled = 1",
        ListeningSqlDialect::Postgres => "mf.enabled",
    };

    // Get overall stats for the period
    #[derive(FromQueryResult)]
    struct PeriodStatsRow {
        total_listening_secs: i64,
        total_play_count: i64,
        unique_tracks: i64,
        unique_albums: i64,
        unique_artists: i64,
    }

    let stats_sqlite = format!(
        r#"
            SELECT
                COALESCE(SUM(ls.duration_seconds), 0) as total_listening_secs,
                COUNT(*) as total_play_count,
                COUNT(DISTINCT ls.song_id) as unique_tracks,
                COUNT(DISTINCT s.album_id) as unique_albums,
                COUNT(DISTINCT s.artist_id) as unique_artists
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            WHERE ls.user_id = ? {}
            "#,
        date_filter.sqlite
    );
    let stats_postgres = format!(
        r#"
            SELECT
                COALESCE(SUM(ls.duration_seconds), 0)::BIGINT as total_listening_secs,
                COUNT(*) as total_play_count,
                COUNT(DISTINCT ls.song_id) as unique_tracks,
                COUNT(DISTINCT s.album_id) as unique_albums,
                COUNT(DISTINCT s.artist_id) as unique_artists
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            WHERE ls.user_id = $1 {}
            "#,
        date_filter.postgres
    );

    let stats_opt = crate::db::raw::query_all::<PeriodStatsRow>(
        state.database.conn(),
        &stats_sqlite,
        &stats_postgres,
        [Value::from(user.user_id)],
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch period stats: {}", e);
        Error::Internal("Failed to fetch period review".to_string())
    })?;

    let (total_listening_secs, total_play_count, unique_tracks, unique_albums, unique_artists) =
        match stats_opt.into_iter().next() {
            Some(row) => (
                row.total_listening_secs,
                row.total_play_count,
                row.unique_tracks,
                row.unique_albums,
                row.unique_artists,
            ),
            None => (0, 0, 0, 0, 0),
        };

    // Get top artists
    let top_artists_sqlite = format!(
        r#"
            SELECT
                COALESCE(s.artist_id, 'unknown') as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0) as total_duration_secs,
                (SELECT al2.id FROM albums al2 WHERE al2.artist_id = s.artist_id LIMIT 1) as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = ? AND {enabled_filter} AND ula.user_id = ? {}
            GROUP BY s.artist_id
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.sqlite,
    );
    let top_artists_postgres = format!(
        r#"
            SELECT
                COALESCE(s.artist_id, 'unknown') as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0)::BIGINT as total_duration_secs,
                (SELECT al2.id FROM albums al2 WHERE al2.artist_id = s.artist_id LIMIT 1) as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = $1 AND {enabled_filter} AND ula.user_id = $2 {}
            GROUP BY s.artist_id, a.name
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.postgres,
    );
    let mut top_artists: Vec<TopArtist> = crate::db::raw::query_all::<TopArtist>(
        state.database.conn(),
        &top_artists_sqlite,
        &top_artists_postgres,
        [Value::from(user.user_id), Value::from(user.user_id)],
    )
    .await?;

    // Get top albums
    let top_albums_sqlite = format!(
        r#"
            SELECT
                COALESCE(s.album_id, 'unknown') as album_id,
                COALESCE(al.name, 'Unknown Album') as album_name,
                s.artist_id as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0) as total_duration_secs,
                s.album_id as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN albums al ON s.album_id = al.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = ? AND {enabled_filter} AND ula.user_id = ? {}
            GROUP BY s.album_id
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.sqlite,
    );
    let top_albums_postgres = format!(
        r#"
            SELECT
                COALESCE(s.album_id, 'unknown') as album_id,
                COALESCE(al.name, 'Unknown Album') as album_name,
                s.artist_id as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0)::BIGINT as total_duration_secs,
                s.album_id as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN albums al ON s.album_id = al.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = $1 AND {enabled_filter} AND ula.user_id = $2 {}
            GROUP BY s.album_id, al.name, s.artist_id, a.name
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.postgres,
    );
    let mut top_albums: Vec<TopAlbum> = crate::db::raw::query_all::<TopAlbum>(
        state.database.conn(),
        &top_albums_sqlite,
        &top_albums_postgres,
        [Value::from(user.user_id), Value::from(user.user_id)],
    )
    .await?;

    // Get top tracks
    let top_tracks_sqlite = format!(
        r#"
            SELECT
                s.id as track_id,
                COALESCE(s.title, 'Unknown Track') as track_title,
                s.artist_id as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                s.album_id as album_id,
                COALESCE(al.name, 'Unknown Album') as album_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0) as total_duration_secs,
                s.album_id as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN albums al ON s.album_id = al.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = ? AND {enabled_filter} AND ula.user_id = ? {}
            GROUP BY s.id
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.sqlite,
    );
    let top_tracks_postgres = format!(
        r#"
            SELECT
                s.id as track_id,
                COALESCE(s.title, 'Unknown Track') as track_title,
                s.artist_id as artist_id,
                COALESCE(a.name, 'Unknown Artist') as artist_name,
                s.album_id as album_id,
                COALESCE(al.name, 'Unknown Album') as album_name,
                COUNT(*) as play_count,
                COALESCE(SUM(ls.duration_seconds), 0)::BIGINT as total_duration_secs,
                s.album_id as cover_art
            FROM listening_sessions ls
            LEFT JOIN songs s ON ls.song_id = s.id
            LEFT JOIN albums al ON s.album_id = al.id
            LEFT JOIN artists a ON s.artist_id = a.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE ls.user_id = $1 AND {enabled_filter} AND ula.user_id = $2 {}
            GROUP BY s.id, s.title, s.artist_id, a.name, s.album_id, al.name
            ORDER BY play_count DESC
            LIMIT 100
            "#,
        date_filter.postgres,
    );
    let mut top_tracks: Vec<TopTrack> = crate::db::raw::query_all::<TopTrack>(
        state.database.conn(),
        &top_tracks_sqlite,
        &top_tracks_postgres,
        [Value::from(user.user_id), Value::from(user.user_id)],
    )
    .await?;

    // Get inline thumbnails if requested
    let inline_size = query.inline_images.get_size();
    if let Some(size) = inline_size {
        // Artist thumbnails
        let artist_ids: Vec<String> = top_artists.iter().map(|a| a.artist_id.clone()).collect();
        let artist_thumbnails =
            get_artist_thumbnails_base64(&state.database, &artist_ids, size).await;
        for artist in &mut top_artists {
            artist.cover_art_data = artist_thumbnails.get(&artist.artist_id).cloned();
        }

        // Album thumbnails
        let album_ids: Vec<String> = top_albums.iter().map(|a| a.album_id.clone()).collect();
        let album_thumbnails = get_album_thumbnails_base64(&state.database, &album_ids, size).await;
        for album in &mut top_albums {
            album.cover_art_data = album_thumbnails.get(&album.album_id).cloned();
        }

        // Track thumbnails - use album_id for cover art
        let song_thumbnail_data: Vec<(String, Option<String>)> = top_tracks
            .iter()
            .map(|t| (t.track_id.clone(), t.cover_art.clone()))
            .collect();
        let track_thumbnails =
            get_song_thumbnails_base64(&state.database, &song_thumbnail_data, size).await;
        for track in &mut top_tracks {
            track.cover_art_data = track_thumbnails.get(&track.track_id).cloned();
        }
    }

    // Get available periods (years and months with data)
    #[derive(FromQueryResult)]
    struct PeriodRow {
        year: i32,
        month: i32,
    }
    let period_rows_raw = crate::db::raw::query_all::<PeriodRow>(
        state.database.conn(),
        r#"
            SELECT DISTINCT
                CAST(strftime('%Y', listened_at) AS INTEGER) as year,
                CAST(strftime('%m', listened_at) AS INTEGER) as month
            FROM listening_sessions
            WHERE user_id = ?
            ORDER BY year DESC, month DESC
        "#,
        r#"
            SELECT DISTINCT
                EXTRACT(YEAR FROM listened_at)::INTEGER as year,
                EXTRACT(MONTH FROM listened_at)::INTEGER as month
            FROM listening_sessions
            WHERE user_id = $1
            ORDER BY year DESC, month DESC
        "#,
        [Value::from(user.user_id)],
    )
    .await?;
    let period_rows: Vec<(i32, i32)> = period_rows_raw
        .into_iter()
        .map(|r| (r.year, r.month))
        .collect();

    // Build available periods list - include both year summaries and monthly breakdowns
    let mut available_periods = Vec::new();
    let mut seen_years = std::collections::HashSet::new();

    for (y, m) in &period_rows {
        // Add monthly period
        available_periods.push(AvailablePeriod {
            year: *y,
            month: Some(*m),
            has_data: true,
        });

        // Add yearly period if not already added
        if !seen_years.contains(y) {
            seen_years.insert(*y);
            available_periods.push(AvailablePeriod {
                year: *y,
                month: None,
                has_data: true,
            });
        }
    }

    // Sort: years first (no month), then by year desc, month desc
    available_periods.sort_by(|a, b| match (a.month, b.month) {
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        _ => b
            .year
            .cmp(&a.year)
            .then_with(|| b.month.unwrap_or(0).cmp(&a.month.unwrap_or(0))),
    });

    let review = PeriodReview {
        year,
        month,
        total_listening_secs,
        total_play_count,
        unique_tracks,
        unique_albums,
        unique_artists,
        top_artists,
        top_albums,
        top_tracks,
    };

    Ok(Json(PeriodReviewResponse {
        review,
        available_periods,
    }))
}

use chrono::Datelike;
