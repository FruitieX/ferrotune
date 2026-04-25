//! Listening-history management endpoints.

use crate::api::common::browse::song_to_response;
use crate::api::common::models::SongResponse;
use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::repo::{history, history_admin as history_admin_repo};
use crate::error::{Error, FerrotuneApiResult};
use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

const DEFAULT_LIMIT: u32 = 100;
const MAX_LIMIT: u32 = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub enum ManagedHistoryEntryKind {
    Scrobble,
    Session,
}

impl From<ManagedHistoryEntryKind> for history_admin_repo::HistoryEntryKind {
    fn from(value: ManagedHistoryEntryKind) -> Self {
        match value {
            ManagedHistoryEntryKind::Scrobble => history_admin_repo::HistoryEntryKind::Scrobble,
            ManagedHistoryEntryKind::Session => history_admin_repo::HistoryEntryKind::Session,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ManagedHistoryFilter {
    /// Inclusive lower timestamp bound as RFC3339.
    pub from: Option<String>,
    /// Inclusive upper timestamp bound as RFC3339.
    pub to: Option<String>,
    /// Sessions only: minimum listened duration in seconds.
    pub min_duration: Option<i32>,
    /// Sessions only: maximum listened duration in seconds.
    pub max_duration: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedHistoryEntriesQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub min_duration: Option<String>,
    pub max_duration: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
    #[serde(default = "default_true")]
    pub include_scrobbles: bool,
    #[serde(default = "default_true")]
    pub include_sessions: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ManagedHistoryEntry {
    pub kind: ManagedHistoryEntryKind,
    #[ts(type = "number")]
    pub id: i64,
    pub event_at: Option<String>,
    pub song: SongResponse,
    pub duration_seconds: Option<i32>,
    pub skipped: Option<bool>,
    #[ts(type = "number | null")]
    pub play_count: Option<i64>,
    pub description: Option<String>,
    pub submission: Option<bool>,
    pub queue_source_type: Option<String>,
    pub queue_source_id: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ManagedHistoryEntriesResponse {
    pub items: Vec<ManagedHistoryEntry>,
    #[ts(type = "number")]
    pub total: i64,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteManagedHistoryEntriesRequest {
    #[ts(type = "number[]")]
    pub scrobble_ids: Vec<i64>,
    #[ts(type = "number[]")]
    pub session_ids: Vec<i64>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteMatchingManagedHistoryEntriesRequest {
    pub filter: ManagedHistoryFilter,
    pub kinds: Vec<ManagedHistoryEntryKind>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteManagedHistoryEntriesResponse {
    pub success: bool,
    #[ts(type = "number")]
    pub deleted_scrobbles: i64,
    #[ts(type = "number")]
    pub deleted_sessions: i64,
    pub message: String,
}

fn default_true() -> bool {
    true
}

fn parse_optional_datetime(
    name: &str,
    value: Option<&str>,
) -> FerrotuneApiResult<Option<DateTime<Utc>>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }

    DateTime::parse_from_rfc3339(value)
        .map(|parsed| Some(parsed.with_timezone(&Utc)))
        .map_err(|_| {
            Error::InvalidRequest(format!("{name} must be a valid RFC3339 timestamp")).into()
        })
}

fn parse_optional_duration(name: &str, value: Option<&str>) -> FerrotuneApiResult<Option<i32>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }

    value
        .parse::<i32>()
        .map(Some)
        .map_err(|_| Error::InvalidRequest(format!("{name} must be an integer")).into())
}

fn parse_query_filter(
    query: &ManagedHistoryEntriesQuery,
) -> FerrotuneApiResult<history_admin_repo::HistoryEntryFilter> {
    parse_filter(&ManagedHistoryFilter {
        from: query.from.clone(),
        to: query.to.clone(),
        min_duration: parse_optional_duration("minDuration", query.min_duration.as_deref())?,
        max_duration: parse_optional_duration("maxDuration", query.max_duration.as_deref())?,
    })
}

fn parse_filter(
    filter: &ManagedHistoryFilter,
) -> FerrotuneApiResult<history_admin_repo::HistoryEntryFilter> {
    if filter.min_duration.is_some_and(|value| value < 0) {
        return Err(
            Error::InvalidRequest("minDuration must be zero or greater".to_string()).into(),
        );
    }
    if filter.max_duration.is_some_and(|value| value < 0) {
        return Err(
            Error::InvalidRequest("maxDuration must be zero or greater".to_string()).into(),
        );
    }
    if let (Some(min), Some(max)) = (filter.min_duration, filter.max_duration) {
        if min > max {
            return Err(Error::InvalidRequest(
                "minDuration cannot be greater than maxDuration".to_string(),
            )
            .into());
        }
    }

    let from = parse_optional_datetime("from", filter.from.as_deref())?;
    let to = parse_optional_datetime("to", filter.to.as_deref())?;
    if let (Some(from), Some(to)) = (from, to) {
        if from > to {
            return Err(Error::InvalidRequest("from cannot be after to".to_string()).into());
        }
    }

    Ok(history_admin_repo::HistoryEntryFilter {
        from,
        to,
        min_duration_seconds: filter.min_duration,
        max_duration_seconds: filter.max_duration,
    })
}

fn query_kinds(query: &ManagedHistoryEntriesQuery) -> history_admin_repo::HistoryEntryKinds {
    history_admin_repo::HistoryEntryKinds {
        scrobbles: query.include_scrobbles,
        sessions: query.include_sessions,
    }
}

fn request_kinds(kinds: &[ManagedHistoryEntryKind]) -> history_admin_repo::HistoryEntryKinds {
    let repo_kinds: Vec<history_admin_repo::HistoryEntryKind> =
        kinds.iter().copied().map(Into::into).collect();
    history_admin_repo::HistoryEntryKinds::from_kinds(&repo_kinds)
}

fn row_kind(kind: &str) -> ManagedHistoryEntryKind {
    match kind {
        "session" => ManagedHistoryEntryKind::Session,
        _ => ManagedHistoryEntryKind::Scrobble,
    }
}

fn delete_message(deleted_scrobbles: i64, deleted_sessions: i64) -> String {
    let total = deleted_scrobbles + deleted_sessions;
    if total == 0 {
        return "No matching history entries were deleted".to_string();
    }

    format!(
        "Deleted {total} history {} ({deleted_scrobbles} {}, {deleted_sessions} {})",
        if total == 1 { "entry" } else { "entries" },
        if deleted_scrobbles == 1 {
            "scrobble"
        } else {
            "scrobbles"
        },
        if deleted_sessions == 1 {
            "session"
        } else {
            "sessions"
        },
    )
}

/// GET /ferrotune/history/entries - list raw scrobbles and listening sessions.
pub async fn list_history_entries(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ManagedHistoryEntriesQuery>,
) -> FerrotuneApiResult<Json<ManagedHistoryEntriesResponse>> {
    let filter = parse_query_filter(&params)?;
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = params.offset.unwrap_or(0);

    let page = history_admin_repo::list_history_entries(
        &state.database,
        user.user_id,
        &filter,
        query_kinds(&params),
        i64::from(offset),
        i64::from(limit),
    )
    .await?;

    let song_ids: Vec<String> = page.rows.iter().map(|row| row.song_id.clone()).collect();
    let songs = history::fetch_songs_by_ids(state.database.conn(), &song_ids).await?;
    let song_map: HashMap<String, SongResponse> = songs
        .into_iter()
        .map(|song| (song.id.clone(), song_to_response(song, None, None, None)))
        .collect();

    let mut items = Vec::with_capacity(page.rows.len());
    for row in page.rows {
        let Some(song) = song_map.get(&row.song_id).cloned() else {
            continue;
        };

        items.push(ManagedHistoryEntry {
            kind: row_kind(&row.kind),
            id: row.id,
            event_at: row.event_at.map(format_datetime_iso_ms),
            song,
            duration_seconds: row.duration_seconds,
            skipped: row.skipped,
            play_count: row.play_count,
            description: row.description,
            submission: row.submission,
            queue_source_type: row.queue_source_type,
            queue_source_id: row.queue_source_id,
        });
    }

    Ok(Json(ManagedHistoryEntriesResponse {
        items,
        total: page.total,
    }))
}

/// POST /ferrotune/history/delete - delete specific raw history entries.
pub async fn delete_history_entries(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<DeleteManagedHistoryEntriesRequest>,
) -> FerrotuneApiResult<Json<DeleteManagedHistoryEntriesResponse>> {
    let deleted_scrobbles = history_admin_repo::delete_scrobbles_by_ids(
        &state.database,
        user.user_id,
        &request.scrobble_ids,
    )
    .await? as i64;
    let deleted_sessions = history_admin_repo::delete_listening_sessions_by_ids(
        &state.database,
        user.user_id,
        &request.session_ids,
    )
    .await? as i64;

    Ok(Json(DeleteManagedHistoryEntriesResponse {
        success: true,
        deleted_scrobbles,
        deleted_sessions,
        message: delete_message(deleted_scrobbles, deleted_sessions),
    }))
}

/// POST /ferrotune/history/delete-matching - delete all entries matching a filter.
pub async fn delete_matching_history_entries(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<DeleteMatchingManagedHistoryEntriesRequest>,
) -> FerrotuneApiResult<Json<DeleteManagedHistoryEntriesResponse>> {
    let filter = parse_filter(&request.filter)?;
    let kinds = request_kinds(&request.kinds);

    let deleted_scrobbles = if kinds.scrobbles {
        history_admin_repo::delete_matching_scrobbles(&state.database, user.user_id, &filter)
            .await? as i64
    } else {
        0
    };
    let deleted_sessions = if kinds.sessions {
        history_admin_repo::delete_matching_listening_sessions(
            &state.database,
            user.user_id,
            &filter,
        )
        .await? as i64
    } else {
        0
    };

    Ok(Json(DeleteManagedHistoryEntriesResponse {
        success: true,
        deleted_scrobbles,
        deleted_sessions,
        message: delete_message(deleted_scrobbles, deleted_sessions),
    }))
}
