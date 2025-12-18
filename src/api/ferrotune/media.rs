//! Media management endpoints for the Admin API.

use crate::api::common::search::{
    build_fts_query, build_song_filter_conditions, get_song_order_clause, SearchParams,
};
use crate::api::subsonic::auth::{AuthenticatedUser, FerrotuneAuthenticatedUser};
use crate::api::subsonic::xml::ResponseFormat;
use crate::api::AppState;
use crate::db::queries;
use crate::error::FerrotuneApiError;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

use super::ErrorResponse;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct DeleteSongResponse {
    success: bool,
    message: String,
}

/// Delete a song from the database (not from disk).
///
/// DELETE /ferrotune/songs/:id
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
    _user: FerrotuneAuthenticatedUser,
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

/// Response for getting song IDs matching a search/filter query.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongIdsResponse {
    /// List of song IDs matching the query
    pub ids: Vec<String>,
    /// Total count of matching songs
    #[ts(type = "number")]
    pub total: i64,
}

/// Get all song IDs matching the given search and filter criteria.
///
/// GET /ferrotune/songs/ids?query=...&minYear=...&genre=...
pub async fn get_song_ids(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    // Determine if this is a wildcard/all-songs query
    let is_wildcard = params.query.is_empty() || params.query == "*";

    // Build FTS query with prefix wildcards
    let fts_query = if !is_wildcard {
        build_fts_query(&params.query)
    } else {
        None
    };

    let filter_conds = build_song_filter_conditions(&params, user.user_id);
    let has_filters = !filter_conds.conditions.is_empty();

    // Build JOIN clauses based on filter requirements
    let mut joins = format!(
        "INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id{}",
        crate::db::queries::SCROBBLE_STATS_JOIN
    );
    if filter_conds.has_rating_filter {
        joins.push_str(&format!(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = {}",
            user.user_id
        ));
    }
    if filter_conds.has_starred_filter {
        joins.push_str(&format!(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = {}",
            user.user_id
        ));
    }

    let song_order =
        get_song_order_clause(params.song_sort.as_ref(), params.song_sort_dir.as_ref());

    let result: Result<Vec<(String,)>, sqlx::Error> = if is_wildcard {
        // Build WHERE clause for filters
        let where_clause = if has_filters {
            format!("WHERE {}", filter_conds.conditions.join(" AND "))
        } else {
            String::new()
        };

        let query_str =
            format!("SELECT s.id FROM songs s {joins} {where_clause} ORDER BY {song_order}");

        sqlx::query_as(&query_str).fetch_all(&state.pool).await
    } else if let Some(ref fts_q) = fts_query {
        // Build WHERE clause combining FTS and filters
        let mut where_conditions = vec!["songs_fts MATCH ?".to_string()];
        where_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query_str = format!(
            "SELECT s.id FROM songs s {joins} INNER JOIN songs_fts fts ON s.id = fts.song_id {where_clause} ORDER BY {song_order}"
        );

        sqlx::query_as(&query_str)
            .bind(fts_q)
            .fetch_all(&state.pool)
            .await
    } else {
        // Empty query after processing - return empty
        Ok(vec![])
    };

    match result {
        Ok(rows) => {
            let ids: Vec<String> = rows.into_iter().map(|(id,)| id).collect();
            let total = ids.len() as i64;
            Json(SongIdsResponse { ids, total }).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::with_details(
                "Failed to fetch song IDs",
                e.to_string(),
            )),
        )
            .into_response(),
    }
}

// Media Streaming Endpoints (Wrapped from Subsonic)

/// GET /ferrotune/stream - Stream audio
pub async fn stream(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    headers: HeaderMap,
    query: Query<crate::api::subsonic::stream::StreamParams>,
) -> Result<Response, FerrotuneApiError> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::stream::stream(sub_user, state, headers, query)
        .await
        .map_err(FerrotuneApiError::from)
}

/// GET /ferrotune/cover-art - Get cover art
pub async fn get_cover_art(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    query: Query<crate::api::subsonic::coverart::CoverArtParams>,
) -> Result<Response, FerrotuneApiError> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::coverart::get_cover_art(sub_user, state, query)
        .await
        .map_err(FerrotuneApiError::from)
}

/// GET /ferrotune/download - Download audio file
pub async fn download(
    user: FerrotuneAuthenticatedUser,
    state: State<Arc<AppState>>,
    headers: HeaderMap,
    query: Query<crate::api::subsonic::stream::StreamParams>,
) -> Result<Response, FerrotuneApiError> {
    let sub_user = AuthenticatedUser {
        user_id: user.user_id,
        username: user.username,
        is_admin: user.is_admin,
        format: ResponseFormat::Json,
        client: "ferrotune-admin-api".to_string(),
    };

    crate::api::subsonic::stream::download(sub_user, state, headers, query)
        .await
        .map_err(FerrotuneApiError::from)
}
