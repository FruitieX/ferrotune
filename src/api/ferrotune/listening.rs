//! Listening statistics endpoints for tracking user listening time.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_artist_thumbnails_base64, get_song_thumbnails_base64,
    InlineImagesParam,
};
use crate::api::AppState;
use crate::db::entity;
use crate::db::repo::listening as listening_repo;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Query, State},
    response::Json,
};
use chrono::{DateTime, Datelike, TimeZone, Utc};
use sea_orm::sea_query::{Expr, SubQueryStatement};
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait,
};
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

fn period_bounds(year: i32, month: Option<i32>) -> (DateTime<Utc>, DateTime<Utc>) {
    if let Some(month) = month {
        let start = Utc
            .with_ymd_and_hms(year, month as u32, 1, 0, 0, 0)
            .unwrap();
        let (next_year, next_month) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        let end = Utc
            .with_ymd_and_hms(next_year, next_month as u32, 1, 0, 0, 0)
            .unwrap();
        (start, end)
    } else {
        let start = Utc.with_ymd_and_hms(year, 1, 1, 0, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(year + 1, 1, 1, 0, 0, 0).unwrap();
        (start, end)
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
    let song_exists = listening_repo::song_exists(database, &request.song_id).await?;

    if !song_exists {
        return Err(Error::NotFound("Song not found".to_string()).into());
    }

    // If session_id is provided, update the existing session
    if let Some(session_id) = request.session_id {
        let update_res = listening_repo::update_listening_session(
            database,
            session_id,
            user.user_id,
            &request.song_id,
            request.duration_seconds,
            request.skipped,
        )
        .await;

        match update_res {
            Ok(true) => {
                return Ok(Json(LogListeningResponse {
                    success: true,
                    session_id,
                }));
            }
            Ok(false) => {
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
    match listening_repo::create_listening_session(
        database,
        user.user_id,
        &request.song_id,
        request.duration_seconds,
        request.skipped,
    )
    .await
    {
        Ok(session_id) => Ok(Json(LogListeningResponse {
            success: true,
            session_id,
        })),
        Err(e) => {
            tracing::error!("Failed to log listening session: no row returned");
            Err(e.into())
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
    let now = Utc::now();
    let current_year_start = Utc
        .with_ymd_and_hms(now.year(), 1, 1, 0, 0, 0)
        .single()
        .ok_or_else(|| Error::Internal("Failed to compute current year start".to_string()))?;

    let last_7_days = listening_repo::get_listening_stats_for_period(
        &state.database,
        user.user_id,
        Some(now - chrono::Duration::days(7)),
    )
    .await?;
    let last_30_days = listening_repo::get_listening_stats_for_period(
        &state.database,
        user.user_id,
        Some(now - chrono::Duration::days(30)),
    )
    .await?;
    let this_year = listening_repo::get_listening_stats_for_period(
        &state.database,
        user.user_id,
        Some(current_year_start),
    )
    .await?;
    let all_time =
        listening_repo::get_listening_stats_for_period(&state.database, user.user_id, None).await?;

    Ok(Json(ListeningStatsResponse {
        last_7_days: ListeningStats {
            total_seconds: last_7_days.total_seconds,
            session_count: last_7_days.session_count,
            unique_songs: last_7_days.unique_songs,
            skip_count: last_7_days.skip_count,
            scrobble_count: last_7_days.scrobble_count,
        },
        last_30_days: ListeningStats {
            total_seconds: last_30_days.total_seconds,
            session_count: last_30_days.session_count,
            unique_songs: last_30_days.unique_songs,
            skip_count: last_30_days.skip_count,
            scrobble_count: last_30_days.scrobble_count,
        },
        this_year: ListeningStats {
            total_seconds: this_year.total_seconds,
            session_count: this_year.session_count,
            unique_songs: this_year.unique_songs,
            skip_count: this_year.skip_count,
            scrobble_count: this_year.scrobble_count,
        },
        all_time: ListeningStats {
            total_seconds: all_time.total_seconds,
            session_count: all_time.session_count,
            unique_songs: all_time.unique_songs,
            skip_count: all_time.skip_count,
            scrobble_count: all_time.scrobble_count,
        },
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

    let (start, end) = period_bounds(year, month);
    let start_off = start.fixed_offset();
    let end_off = end.fixed_offset();

    // Get overall stats for the period. No library-visibility gate here to
    // match the previous raw SQL which joined songs with LEFT JOIN only.
    #[derive(FromQueryResult)]
    struct PeriodStatsRow {
        total_listening_secs: Option<i64>,
        total_play_count: i64,
        unique_tracks: i64,
        unique_albums: i64,
        unique_artists: i64,
    }

    let stats_opt: Option<PeriodStatsRow> = entity::listening_sessions::Entity::find()
        .select_only()
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::DurationSeconds,
            ))
            .sum()
            .cast_as("BIGINT"),
            "total_listening_secs",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::Id,
            ))
            .count()
            .cast_as("BIGINT"),
            "total_play_count",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::SongId,
            ))
            .count_distinct()
            .cast_as("BIGINT"),
            "unique_tracks",
        )
        .expr_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::AlbumId))
                .count_distinct()
                .cast_as("BIGINT"),
            "unique_albums",
        )
        .expr_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::ArtistId))
                .count_distinct()
                .cast_as("BIGINT"),
            "unique_artists",
        )
        .join(
            JoinType::LeftJoin,
            entity::listening_sessions::Relation::Songs.def(),
        )
        .filter(entity::listening_sessions::Column::UserId.eq(user.user_id))
        .filter(entity::listening_sessions::Column::ListenedAt.gte(start_off))
        .filter(entity::listening_sessions::Column::ListenedAt.lt(end_off))
        .into_model::<PeriodStatsRow>()
        .one(state.database.conn())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch period stats: {}", e);
            Error::Internal("Failed to fetch period review".to_string())
        })?;

    let (total_listening_secs, total_play_count, unique_tracks, unique_albums, unique_artists) =
        match stats_opt {
            Some(row) => (
                row.total_listening_secs.unwrap_or(0),
                row.total_play_count,
                row.unique_tracks,
                row.unique_albums,
                row.unique_artists,
            ),
            None => (0, 0, 0, 0, 0),
        };

    // Build a base select that applies the period + visibility gate used by
    // the top-artists / albums / tracks queries.
    let gated_base = || {
        entity::listening_sessions::Entity::find()
            .join(
                JoinType::LeftJoin,
                entity::listening_sessions::Relation::Songs.def(),
            )
            .join(JoinType::LeftJoin, entity::songs::Relation::Artists.def())
            .join(JoinType::LeftJoin, entity::songs::Relation::Albums.def())
            .join(
                JoinType::InnerJoin,
                entity::songs::Relation::MusicFolders.def(),
            )
            .join(
                JoinType::InnerJoin,
                entity::music_folders::Relation::UserLibraryAccess.def(),
            )
            .filter(entity::listening_sessions::Column::UserId.eq(user.user_id))
            .filter(entity::music_folders::Column::Enabled.eq(true))
            .filter(entity::user_library_access::Column::UserId.eq(user.user_id))
            .filter(entity::listening_sessions::Column::ListenedAt.gte(start_off))
            .filter(entity::listening_sessions::Column::ListenedAt.lt(end_off))
    };

    // Correlated subquery: the first album id for a given artist id.
    let cover_art_subquery = {
        use sea_orm::sea_query::Query as SqQuery;
        SqQuery::select()
            .column((entity::albums::Entity, entity::albums::Column::Id))
            .from(entity::albums::Entity)
            .and_where(
                Expr::col((entity::albums::Entity, entity::albums::Column::ArtistId))
                    .equals((entity::songs::Entity, entity::songs::Column::ArtistId)),
            )
            .limit(1)
            .to_owned()
    };

    // Top artists
    let mut top_artists: Vec<TopArtist> = gated_base()
        .select_only()
        .expr_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::ArtistId)).if_null("unknown"),
            "artist_id",
        )
        .expr_as(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name))
                .if_null("Unknown Artist"),
            "artist_name",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::Id,
            ))
            .count()
            .cast_as("BIGINT"),
            "play_count",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::DurationSeconds,
            ))
            .sum()
            .cast_as("BIGINT"),
            "total_duration_secs",
        )
        .expr_as(
            sea_orm::sea_query::SimpleExpr::SubQuery(
                None,
                Box::new(SubQueryStatement::SelectStatement(
                    cover_art_subquery.clone(),
                )),
            ),
            "cover_art",
        )
        .group_by(entity::songs::Column::ArtistId)
        .group_by(entity::artists::Column::Name)
        .order_by_desc(Expr::col(sea_orm::sea_query::Alias::new("play_count")))
        .limit(100)
        .into_model::<TopArtist>()
        .all(state.database.conn())
        .await?;

    // Top albums
    let mut top_albums: Vec<TopAlbum> = gated_base()
        .select_only()
        .expr_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::AlbumId)).if_null("unknown"),
            "album_id",
        )
        .expr_as(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name))
                .if_null("Unknown Album"),
            "album_name",
        )
        .column_as(entity::songs::Column::ArtistId, "artist_id")
        .expr_as(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name))
                .if_null("Unknown Artist"),
            "artist_name",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::Id,
            ))
            .count()
            .cast_as("BIGINT"),
            "play_count",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::DurationSeconds,
            ))
            .sum()
            .cast_as("BIGINT"),
            "total_duration_secs",
        )
        .column_as(entity::songs::Column::AlbumId, "cover_art")
        .group_by(entity::songs::Column::AlbumId)
        .group_by(entity::albums::Column::Name)
        .group_by(entity::songs::Column::ArtistId)
        .group_by(entity::artists::Column::Name)
        .order_by_desc(Expr::col(sea_orm::sea_query::Alias::new("play_count")))
        .limit(100)
        .into_model::<TopAlbum>()
        .all(state.database.conn())
        .await?;

    // Top tracks
    let mut top_tracks: Vec<TopTrack> = gated_base()
        .select_only()
        .column_as(entity::songs::Column::Id, "track_id")
        .expr_as(
            Expr::col((entity::songs::Entity, entity::songs::Column::Title))
                .if_null("Unknown Track"),
            "track_title",
        )
        .column_as(entity::songs::Column::ArtistId, "artist_id")
        .expr_as(
            Expr::col((entity::artists::Entity, entity::artists::Column::Name))
                .if_null("Unknown Artist"),
            "artist_name",
        )
        .column_as(entity::songs::Column::AlbumId, "album_id")
        .expr_as(
            Expr::col((entity::albums::Entity, entity::albums::Column::Name))
                .if_null("Unknown Album"),
            "album_name",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::Id,
            ))
            .count()
            .cast_as("BIGINT"),
            "play_count",
        )
        .expr_as(
            Expr::col((
                entity::listening_sessions::Entity,
                entity::listening_sessions::Column::DurationSeconds,
            ))
            .sum()
            .cast_as("BIGINT"),
            "total_duration_secs",
        )
        .column_as(entity::songs::Column::AlbumId, "cover_art")
        .group_by(entity::songs::Column::Id)
        .group_by(entity::songs::Column::Title)
        .group_by(entity::songs::Column::ArtistId)
        .group_by(entity::artists::Column::Name)
        .group_by(entity::songs::Column::AlbumId)
        .group_by(entity::albums::Column::Name)
        .order_by_desc(Expr::col(sea_orm::sea_query::Alias::new("play_count")))
        .limit(100)
        .into_model::<TopTrack>()
        .all(state.database.conn())
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

    // Get available periods (years and months with data). We fetch distinct
    // listened_at timestamps and derive (year, month) in Rust to avoid a
    // dialect branch on EXTRACT/strftime.
    let listened_ats: Vec<chrono::DateTime<chrono::FixedOffset>> =
        entity::listening_sessions::Entity::find()
            .select_only()
            .column(entity::listening_sessions::Column::ListenedAt)
            .filter(entity::listening_sessions::Column::UserId.eq(user.user_id))
            .distinct()
            .order_by(entity::listening_sessions::Column::ListenedAt, Order::Desc)
            .into_tuple::<chrono::DateTime<chrono::FixedOffset>>()
            .all(state.database.conn())
            .await?;

    let mut period_pairs: std::collections::BTreeSet<(i32, i32)> =
        std::collections::BTreeSet::new();
    for dt in &listened_ats {
        let utc = dt.with_timezone(&Utc);
        period_pairs.insert((utc.year(), utc.month() as i32));
    }
    // Convert to a Vec in descending order (year desc, month desc).
    let mut period_rows: Vec<(i32, i32)> = period_pairs.into_iter().collect();
    period_rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));

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
