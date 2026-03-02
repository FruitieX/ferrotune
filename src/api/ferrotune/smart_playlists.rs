//! Smart playlist management endpoints for the Ferrotune Admin API.
//!
//! Smart playlists are dynamic playlists that automatically include songs
//! matching specified filter rules. Songs are materialized at query time.

use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::models::SmartPlaylist;
use crate::error::{Error, FerrotuneApiResult};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

// ============================================================================
// Request/Response Types
// ============================================================================

/// Response containing a list of smart playlists
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SmartPlaylistsResponse {
    pub smart_playlists: Vec<SmartPlaylistInfo>,
}

/// Information about a single smart playlist
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SmartPlaylistInfo {
    pub id: String,
    pub name: String,
    pub comment: Option<String>,
    pub is_public: bool,
    pub rules: SmartPlaylistRulesApi,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
    #[ts(type = "number | null")]
    pub max_songs: Option<i64>,
    /// Optional folder ID for organizing smart playlists
    pub folder_id: Option<String>,
    /// Materialized song count (computed on request)
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "string")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "string")]
    pub updated_at: DateTime<Utc>,
}

/// Filter rules for API (matches SmartPlaylistRules but with TS export)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SmartPlaylistRulesApi {
    pub conditions: Vec<SmartPlaylistConditionApi>,
    #[serde(default = "default_logic")]
    pub logic: String,
}

fn default_logic() -> String {
    "and".to_string()
}

/// A single filter condition for API
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SmartPlaylistConditionApi {
    /// Field to filter on
    pub field: String,
    /// Comparison operator
    pub operator: String,
    /// Value to compare against
    #[ts(type = "string | number | boolean")]
    pub value: serde_json::Value,
}

/// Request to create a smart playlist
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateSmartPlaylistRequest {
    pub name: String,
    pub comment: Option<String>,
    pub is_public: Option<bool>,
    pub rules: SmartPlaylistRulesApi,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
    #[ts(type = "number | null")]
    pub max_songs: Option<i64>,
    /// Optional folder ID to place the smart playlist in
    pub folder_id: Option<String>,
}

/// Request to update a smart playlist
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct UpdateSmartPlaylistRequest {
    pub name: Option<String>,
    pub comment: Option<String>,
    pub is_public: Option<bool>,
    pub rules: Option<SmartPlaylistRulesApi>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
    #[ts(type = "number | null | undefined")]
    pub max_songs: Option<Option<i64>>,
    /// Optional folder ID to move the smart playlist to (use null to move to root)
    #[ts(type = "string | null | undefined")]
    pub folder_id: Option<Option<String>>,
}

/// Response after creating a smart playlist
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct CreateSmartPlaylistResponse {
    pub id: String,
    pub name: String,
}

/// Request to materialize a smart playlist into a regular playlist
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MaterializeSmartPlaylistRequest {
    /// Name for the new regular playlist (optional - defaults to smart playlist name)
    pub name: Option<String>,
    /// Optional comment for the new playlist
    pub comment: Option<String>,
}

/// Response after materializing a smart playlist
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MaterializeSmartPlaylistResponse {
    /// ID of the newly created regular playlist
    pub playlist_id: String,
    /// Name of the new playlist
    pub name: String,
    /// Number of songs added to the playlist
    #[ts(type = "number")]
    pub song_count: i64,
}

/// Response for smart playlist songs with pagination info
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SmartPlaylistSongsResponse {
    /// Playlist metadata
    pub id: String,
    pub name: String,
    /// Total matching songs (before limit)
    #[ts(type = "number")]
    pub total_count: i64,
    /// Total duration of all matching songs in seconds
    #[ts(type = "number")]
    pub total_duration: i64,
    /// Offset of the current page
    #[ts(type = "number")]
    pub offset: i64,
    /// Songs (potentially limited by max_songs and pagination)
    pub songs: Vec<crate::api::common::models::SongResponse>,
}

/// Query parameters for smart playlist songs
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistSongsParams {
    /// Offset for pagination (default: 0)
    #[serde(default)]
    pub offset: i64,
    /// Number of songs to return (default: 50)
    #[serde(default = "default_page_size")]
    pub count: i64,
    /// Size for inline cover art images
    pub inline_images: Option<String>,
    /// Filter string (searches title, artist, album)
    pub filter: Option<String>,
    /// Sort field override (if None, uses playlist's defined sort)
    /// Valid values: custom, title, artist, album, year, playCount, dateAdded, lastPlayed, duration
    pub sort_field: Option<String>,
    /// Sort direction override (if None, uses playlist's defined sort)
    /// Valid values: asc, desc
    pub sort_direction: Option<String>,
}

fn default_page_size() -> i64 {
    50
}

// ============================================================================
// Endpoints
// ============================================================================

/// GET /ferrotune/smart-playlists - List all smart playlists for the user
pub async fn list_smart_playlists(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<SmartPlaylistsResponse>> {
    let playlists: Vec<SmartPlaylist> = sqlx::query_as(
        "SELECT id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id, created_at, updated_at
         FROM smart_playlists
         WHERE owner_id = ? OR is_public = 1
         ORDER BY name COLLATE NOCASE",
    )
    .bind(user.user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut result = Vec::with_capacity(playlists.len());
    for playlist in playlists {
        let rules: SmartPlaylistRulesApi = serde_json::from_str(&playlist.rules_json)
            .unwrap_or_else(|_| SmartPlaylistRulesApi {
                conditions: vec![],
                logic: "and".to_string(),
            });

        // Count matching songs (respecting max_songs limit)
        let song_count =
            count_matching_songs(&state.pool, &rules, user.user_id, playlist.max_songs).await?;

        result.push(SmartPlaylistInfo {
            id: playlist.id,
            name: playlist.name,
            comment: playlist.comment,
            is_public: playlist.is_public,
            rules,
            sort_field: playlist.sort_field,
            sort_direction: playlist.sort_direction,
            max_songs: playlist.max_songs,
            folder_id: playlist.folder_id,
            song_count,
            created_at: playlist.created_at,
            updated_at: playlist.updated_at,
        });
    }

    Ok(Json(SmartPlaylistsResponse {
        smart_playlists: result,
    }))
}

/// GET /ferrotune/smart-playlists/{id} - Get a single smart playlist
pub async fn get_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<Json<SmartPlaylistInfo>> {
    let playlist: Option<SmartPlaylist> = sqlx::query_as(
        "SELECT id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id, created_at, updated_at
         FROM smart_playlists
         WHERE id = ? AND (owner_id = ? OR is_public = 1)",
    )
    .bind(&id)
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?;

    match playlist {
        Some(playlist) => {
            let rules: SmartPlaylistRulesApi = serde_json::from_str(&playlist.rules_json)
                .unwrap_or_else(|_| SmartPlaylistRulesApi {
                    conditions: vec![],
                    logic: "and".to_string(),
                });

            let song_count =
                count_matching_songs(&state.pool, &rules, user.user_id, playlist.max_songs).await?;

            Ok(Json(SmartPlaylistInfo {
                id: playlist.id,
                name: playlist.name,
                comment: playlist.comment,
                is_public: playlist.is_public,
                rules,
                sort_field: playlist.sort_field,
                sort_direction: playlist.sort_direction,
                max_songs: playlist.max_songs,
                folder_id: playlist.folder_id,
                song_count,
                created_at: playlist.created_at,
                updated_at: playlist.updated_at,
            }))
        }
        None => Err(Error::NotFound(format!("Smart playlist {} not found", id)).into()),
    }
}

/// POST /ferrotune/smart-playlists - Create a new smart playlist
pub async fn create_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateSmartPlaylistRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let id = Uuid::new_v4().to_string();
    let rules_json = serde_json::to_string(&request.rules)
        .map_err(|e| Error::InvalidRequest(format!("Invalid rules: {}", e)))?;

    sqlx::query(
        "INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&request.name)
    .bind(&request.comment)
    .bind(user.user_id)
    .bind(request.is_public.unwrap_or(false))
    .bind(&rules_json)
    .bind(&request.sort_field)
    .bind(&request.sort_direction)
    .bind(request.max_songs)
    .bind(&request.folder_id)
    .execute(&state.pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateSmartPlaylistResponse {
            id,
            name: request.name,
        }),
    ))
}

/// PUT /ferrotune/smart-playlists/{id} - Update a smart playlist
pub async fn update_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateSmartPlaylistRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    // Check ownership
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM smart_playlists WHERE id = ? AND owner_id = ?")
            .bind(&id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?;

    if existing.is_none() {
        return Err(Error::NotFound(format!(
            "Smart playlist {} not found or not owned by you",
            id
        ))
        .into());
    }

    // Build dynamic update query
    let mut updates = Vec::new();
    let mut bindings: Vec<String> = Vec::new();

    if let Some(name) = &request.name {
        updates.push("name = ?");
        bindings.push(name.clone());
    }
    if let Some(comment) = &request.comment {
        updates.push("comment = ?");
        bindings.push(comment.clone());
    }
    if let Some(is_public) = request.is_public {
        updates.push("is_public = ?");
        bindings.push(if is_public {
            "1".to_string()
        } else {
            "0".to_string()
        });
    }
    if let Some(rules) = &request.rules {
        let rules_json = serde_json::to_string(rules)
            .map_err(|e| Error::InvalidRequest(format!("Invalid rules: {}", e)))?;
        updates.push("rules_json = ?");
        bindings.push(rules_json);
    }
    if let Some(sort_field) = &request.sort_field {
        updates.push("sort_field = ?");
        bindings.push(sort_field.clone());
    }
    if let Some(sort_direction) = &request.sort_direction {
        updates.push("sort_direction = ?");
        bindings.push(sort_direction.clone());
    }
    // Handle max_songs which can be Some(Some(N)), Some(None), or None
    if let Some(max_songs) = request.max_songs {
        match max_songs {
            Some(n) => {
                updates.push("max_songs = ?");
                bindings.push(n.to_string());
            }
            None => {
                updates.push("max_songs = NULL");
            }
        }
    }

    // Handle folder_id which can be Some(Some(id)), Some(None) to move to root, or None to leave unchanged
    if let Some(folder_id) = &request.folder_id {
        match folder_id {
            Some(id) => {
                updates.push("folder_id = ?");
                bindings.push(id.clone());
            }
            None => {
                updates.push("folder_id = NULL");
            }
        }
    }

    if updates.is_empty() {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    updates.push("updated_at = datetime('now')");

    let query = format!(
        "UPDATE smart_playlists SET {} WHERE id = ?",
        updates.join(", ")
    );
    let mut q = sqlx::query(&query);

    for binding in &bindings {
        q = q.bind(binding);
    }
    q = q.bind(&id);

    q.execute(&state.pool).await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

/// DELETE /ferrotune/smart-playlists/{id} - Delete a smart playlist
pub async fn delete_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> FerrotuneApiResult<impl IntoResponse> {
    let result = sqlx::query("DELETE FROM smart_playlists WHERE id = ? AND owner_id = ?")
        .bind(&id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(Error::NotFound(format!(
            "Smart playlist {} not found or not owned by you",
            id
        ))
        .into());
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/smart-playlists/{id}/songs - Get materialized songs from a smart playlist
pub async fn get_smart_playlist_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<SmartPlaylistSongsParams>,
) -> FerrotuneApiResult<Json<SmartPlaylistSongsResponse>> {
    use crate::api::common::browse::song_to_response_with_stats;
    use crate::api::subsonic::inline_thumbnails::get_song_thumbnails_base64;
    use crate::thumbnails::ThumbnailSize;

    // Fetch the smart playlist
    let playlist: SmartPlaylist =
        sqlx::query_as("SELECT * FROM smart_playlists WHERE id = ? AND owner_id = ?")
            .bind(&id)
            .bind(user.user_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| Error::NotFound(format!("Smart playlist {} not found", id)))?;

    // Parse rules
    let rules: SmartPlaylistRulesApi = serde_json::from_str(&playlist.rules_json)
        .map_err(|e| Error::Internal(format!("Failed to parse rules: {}", e)))?;

    // Determine sort field and direction
    // Use params if provided, else use playlist's defined sort (for "custom" sort option)
    let is_custom_sort = params.sort_field.as_deref().is_none_or(|s| s == "custom");
    let sort_field = params
        .sort_field
        .as_deref()
        .filter(|s| *s != "custom") // "custom" means use playlist's sort
        .or(playlist.sort_field.as_deref());
    // When using custom sort, also use the playlist's sort direction
    let sort_direction = if is_custom_sort {
        playlist.sort_direction.as_deref()
    } else {
        params.sort_direction.as_deref()
    };

    // Get total count (with filter applied, respecting max_songs limit)
    let total_count = count_matching_songs_filtered(
        &state.pool,
        &rules,
        user.user_id,
        params.filter.as_deref(),
        playlist.max_songs,
    )
    .await?;

    // Get total duration (with filter applied, respecting max_songs limit)
    let total_duration = sum_matching_songs_duration_filtered(
        &state.pool,
        &rules,
        user.user_id,
        params.filter.as_deref(),
        playlist.max_songs,
        sort_field,
        sort_direction,
    )
    .await?;

    // Build and execute materialization query with pagination
    let songs = materialize_smart_playlist_songs_filtered(
        &state.pool,
        &rules,
        user.user_id,
        sort_field,
        sort_direction,
        playlist.max_songs,
        Some(params.offset),
        Some(params.count),
        params.filter.as_deref(),
    )
    .await?;

    // Get inline thumbnails if requested
    let inline_size: Option<ThumbnailSize> = match params.inline_images.as_deref() {
        Some("small") | Some("s") => Some(ThumbnailSize::Small),
        Some("medium") | Some("m") => Some(ThumbnailSize::Medium),
        _ => None,
    };

    let thumbnails = if let Some(size) = inline_size {
        let song_data: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|s| (s.id.clone(), s.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(&state.pool, &song_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    // Convert to response format
    let song_responses: Vec<_> = songs
        .into_iter()
        .map(|s| {
            let starred = s.starred_at.map(format_datetime_iso_ms);
            let cover_art_data = thumbnails.get(&s.id).cloned();
            // Construct play stats from Song model fields
            let play_stats = crate::api::common::models::SongPlayStats {
                play_count: s.play_count,
                last_played: s.last_played.map(format_datetime_iso_ms),
            };
            song_to_response_with_stats(
                s,
                None,
                starred,
                None,
                Some(play_stats),
                None,
                cover_art_data,
            )
        })
        .collect();

    Ok(Json(SmartPlaylistSongsResponse {
        id: playlist.id,
        name: playlist.name,
        total_count,
        total_duration,
        offset: params.offset,
        songs: song_responses,
    }))
}

/// POST /ferrotune/smart-playlists/{id}/materialize - Convert smart playlist to a regular playlist
///
/// This "materializes" the current songs matching the smart playlist's rules into a regular
/// (static) playlist. The new playlist will contain a snapshot of the songs at the time
/// of creation and won't update automatically like the smart playlist.
pub async fn materialize_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<MaterializeSmartPlaylistRequest>,
) -> FerrotuneApiResult<impl IntoResponse> {
    use crate::db::queries::{add_songs_to_playlist, create_playlist};

    // Fetch the smart playlist
    let playlist: SmartPlaylist = sqlx::query_as(
        "SELECT * FROM smart_playlists WHERE id = ? AND (owner_id = ? OR is_public = 1)",
    )
    .bind(&id)
    .bind(user.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| Error::NotFound(format!("Smart playlist {} not found", id)))?;

    // Parse rules
    let rules: SmartPlaylistRulesApi = serde_json::from_str(&playlist.rules_json)
        .map_err(|e| Error::Internal(format!("Failed to parse rules: {}", e)))?;

    // Materialize all matching songs (using the smart playlist's sort order, no pagination)
    let songs = materialize_smart_playlist_songs(
        &state.pool,
        &rules,
        user.user_id,
        playlist.sort_field.as_deref(),
        playlist.sort_direction.as_deref(),
        playlist.max_songs,
        None, // No pagination offset
        None, // No pagination limit
    )
    .await?;

    let song_count = songs.len() as i64;

    // Generate new playlist ID
    let new_playlist_id = format!("pl-{}", Uuid::new_v4());

    // Use provided name or fall back to smart playlist name
    let new_name = request.name.unwrap_or_else(|| playlist.name.clone());

    // Create the regular playlist
    create_playlist(
        &state.pool,
        &new_playlist_id,
        &new_name,
        user.user_id,
        request.comment.as_deref(),
        false, // Not public by default
        None,  // Materialized playlists go to root for now
    )
    .await
    .map_err(|e| Error::Internal(e.to_string()))?;

    // Add all songs to the playlist
    if !songs.is_empty() {
        let song_ids: Vec<String> = songs.into_iter().map(|s| s.id).collect();
        add_songs_to_playlist(&state.pool, &new_playlist_id, &song_ids)
            .await
            .map_err(|e| Error::Internal(e.to_string()))?;
    }

    Ok((
        StatusCode::CREATED,
        Json(MaterializeSmartPlaylistResponse {
            playlist_id: new_playlist_id,
            name: new_name,
            song_count,
        }),
    ))
}

// ============================================================================
// Materialization Logic
// ============================================================================

/// Count songs matching the smart playlist rules (respecting max_songs if set)
async fn count_matching_songs(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    max_songs: Option<i64>,
) -> FerrotuneApiResult<i64> {
    let (where_clause, where_args) = build_where_clause(rules, user_id)?;

    // Always filter by enabled music folders and user library access
    let enabled_filter = "mf.enabled = 1 AND ula.user_id = ?";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}", enabled_filter)
    } else {
        format!("WHERE {} AND {}", enabled_filter, where_clause)
    };

    let query = format!(
        "SELECT COUNT(*) FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}",
        combined_where
    );

    let mut query_builder = sqlx::query_as::<_, (i64,)>(&query)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id);

    for arg in where_args {
        query_builder = match arg {
            SqlArg::Text(value) => query_builder.bind(value),
            SqlArg::I64(value) => query_builder.bind(value),
        };
    }

    let (count,): (i64,) = query_builder.fetch_one(pool).await?;

    // Apply max_songs limit if set
    let effective_count = match max_songs {
        Some(max) => count.min(max),
        None => count,
    };

    Ok(effective_count)
}

/// Materialize songs matching the smart playlist rules
#[allow(clippy::too_many_arguments)]
pub async fn materialize_smart_playlist_songs(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    sort_field: Option<&str>,
    sort_direction: Option<&str>,
    max_songs: Option<i64>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let (where_clause, where_args) = build_where_clause(rules, user_id)?;

    let safe_max_songs = max_songs.filter(|value| *value > 0);
    let safe_offset = offset.map(|value| value.max(0));
    let safe_limit = limit.filter(|value| *value > 0);

    // Always filter by enabled music folders and user library access
    let enabled_filter = "mf.enabled = 1 AND ula.user_id = ?";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}", enabled_filter)
    } else {
        format!("WHERE {} AND {}", enabled_filter, where_clause)
    };

    // Build ORDER BY clause (text fields use COLLATE NOCASE for case-insensitive sorting)
    let order_by = match sort_field {
        Some("title") | Some("name") => "s.title COLLATE NOCASE",
        Some("artist") => "ar.name COLLATE NOCASE",
        Some("album") => "al.name COLLATE NOCASE",
        Some("year") => "s.year",
        Some("playCount") => "pc.play_count",
        Some("dateAdded") | Some("createdAt") => "s.created_at",
        Some("lastPlayed") => "pc.last_played",
        Some("duration") => "s.duration",
        _ => "RANDOM()",
    };

    let direction = match sort_direction {
        Some("desc") => "DESC",
        Some("asc") => "ASC",
        _ => "ASC",
    };

    // Build LIMIT clause - consider both max_songs and pagination limit
    // If both are set, use the smaller effective limit
    let effective_limit = match (safe_max_songs, safe_limit) {
        (Some(max), Some(lim)) => {
            // With offset, we need to ensure we don't go past max_songs
            let remaining = max - safe_offset.unwrap_or(0);
            if remaining <= 0 {
                Some(0)
            } else {
                Some(lim.min(remaining))
            }
        }
        (Some(max), None) => Some(max),
        (None, Some(lim)) => Some(lim),
        (None, None) => None,
    };

    let limit_offset_clause = match (effective_limit, safe_offset) {
        (Some(lim), Some(off)) => format!("LIMIT {} OFFSET {}", lim, off),
        (Some(lim), None) => format!("LIMIT {}", lim),
        (None, Some(off)) => format!("LIMIT -1 OFFSET {}", off), // SQLite uses -1 for no limit with offset
        (None, None) => String::new(),
    };

    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, st.starred_at
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}
         ORDER BY {} {}
         {}",
        combined_where, order_by, direction, limit_offset_clause
    );

    let mut query_builder = sqlx::query_as::<_, crate::db::models::Song>(&query)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id);

    for arg in where_args {
        query_builder = match arg {
            SqlArg::Text(value) => query_builder.bind(value),
            SqlArg::I64(value) => query_builder.bind(value),
        };
    }

    let songs: Vec<crate::db::models::Song> = query_builder.fetch_all(pool).await?;

    Ok(songs)
}

/// Count songs matching the smart playlist rules with optional text filter (respecting max_songs if set)
async fn count_matching_songs_filtered(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    filter: Option<&str>,
    max_songs: Option<i64>,
) -> FerrotuneApiResult<i64> {
    let (where_clause, mut where_args) = build_where_clause(rules, user_id)?;

    let (filter_clause, mut filter_args) = build_filter_clause(filter);

    // Always filter by enabled music folders and user library access
    let enabled_filter = "mf.enabled = 1 AND ula.user_id = ?";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}{}", enabled_filter, filter_clause)
    } else {
        format!(
            "WHERE {} AND {}{}",
            enabled_filter, where_clause, filter_clause
        )
    };

    let query = format!(
        "SELECT COUNT(*) FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}",
        combined_where
    );

    where_args.append(&mut filter_args);

    let mut query_builder = sqlx::query_as::<_, (i64,)>(&query)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id);

    for arg in where_args {
        query_builder = match arg {
            SqlArg::Text(value) => query_builder.bind(value),
            SqlArg::I64(value) => query_builder.bind(value),
        };
    }

    let (count,): (i64,) = query_builder.fetch_one(pool).await?;

    // Apply max_songs limit if set
    let effective_count = match max_songs {
        Some(max) => count.min(max),
        None => count,
    };

    Ok(effective_count)
}

/// Sum total duration of songs matching the smart playlist rules with optional text filter (respecting max_songs if set)
async fn sum_matching_songs_duration_filtered(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    filter: Option<&str>,
    max_songs: Option<i64>,
    sort_field: Option<&str>,
    sort_direction: Option<&str>,
) -> FerrotuneApiResult<i64> {
    let (where_clause, mut where_args) = build_where_clause(rules, user_id)?;

    let (filter_clause, mut filter_args) = build_filter_clause(filter);

    // Always filter by enabled music folders and user library access
    let enabled_filter = "mf.enabled = 1 AND ula.user_id = ?";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}{}", enabled_filter, filter_clause)
    } else {
        format!(
            "WHERE {} AND {}{}",
            enabled_filter, where_clause, filter_clause
        )
    };

    // If max_songs is set, we need to use a subquery to respect the limit
    // The duration sum should only include the songs that would actually be shown
    let safe_max_songs = max_songs.filter(|value| *value > 0);

    let query = if let Some(max) = safe_max_songs {
        // Build ORDER BY clause for the subquery (needed for correct LIMIT)
        // Text fields use COLLATE NOCASE for case-insensitive sorting
        let order_by = match sort_field {
            Some("title") | Some("name") => "s.title COLLATE NOCASE",
            Some("artist") => "ar.name COLLATE NOCASE",
            Some("album") => "al.name COLLATE NOCASE",
            Some("year") => "s.year",
            Some("playCount") => "pc.play_count",
            Some("dateAdded") | Some("createdAt") => "s.created_at",
            Some("lastPlayed") => "pc.last_played",
            Some("duration") => "s.duration",
            _ => "RANDOM()",
        };
        let direction = match sort_direction {
            Some("desc") => "DESC",
            Some("asc") => "ASC",
            _ => "ASC",
        };

        format!(
            "SELECT COALESCE(SUM(duration), 0) FROM (
                SELECT s.duration FROM songs s
                LEFT JOIN artists ar ON s.artist_id = ar.id
                LEFT JOIN albums al ON s.album_id = al.id
                INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
                LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                           FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
                   ON s.id = pc.song_id
                LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
                {}
                ORDER BY {} {}
                LIMIT {}
            )",
            combined_where, order_by, direction, max
        )
    } else {
        format!(
            "SELECT COALESCE(SUM(s.duration), 0) FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             INNER JOIN music_folders mf ON s.music_folder_id = mf.id
             INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
             LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                        FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
                ON s.id = pc.song_id
             LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
             {}",
            combined_where
        )
    };

    where_args.append(&mut filter_args);

    let mut query_builder = sqlx::query_as::<_, (i64,)>(&query)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id);

    for arg in where_args {
        query_builder = match arg {
            SqlArg::Text(value) => query_builder.bind(value),
            SqlArg::I64(value) => query_builder.bind(value),
        };
    }

    let (duration,): (i64,) = query_builder.fetch_one(pool).await?;

    Ok(duration)
}

/// Materialize songs matching the smart playlist rules with optional text filter
#[allow(clippy::too_many_arguments)]
async fn materialize_smart_playlist_songs_filtered(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    sort_field: Option<&str>,
    sort_direction: Option<&str>,
    max_songs: Option<i64>,
    offset: Option<i64>,
    limit: Option<i64>,
    filter: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let (where_clause, mut where_args) = build_where_clause(rules, user_id)?;

    let (filter_clause, mut filter_args) = build_filter_clause(filter);

    let safe_max_songs = max_songs.filter(|value| *value > 0);
    let safe_offset = offset.map(|value| value.max(0));
    let safe_limit = limit.filter(|value| *value > 0);

    // Always filter by enabled music folders and user library access
    let enabled_filter = "mf.enabled = 1 AND ula.user_id = ?";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}{}", enabled_filter, filter_clause)
    } else {
        format!(
            "WHERE {} AND {}{}",
            enabled_filter, where_clause, filter_clause
        )
    };

    // Build ORDER BY clause (text fields use COLLATE NOCASE for case-insensitive sorting)
    let order_by = match sort_field {
        Some("title") | Some("name") => "s.title COLLATE NOCASE",
        Some("artist") => "ar.name COLLATE NOCASE",
        Some("album") => "al.name COLLATE NOCASE",
        Some("year") => "s.year",
        Some("playCount") => "pc.play_count",
        Some("dateAdded") | Some("createdAt") => "s.created_at",
        Some("lastPlayed") => "pc.last_played",
        Some("duration") => "s.duration",
        _ => "RANDOM()",
    };

    let direction = match sort_direction {
        Some("desc") => "DESC",
        Some("asc") => "ASC",
        _ => "ASC",
    };

    // Build LIMIT clause - consider both max_songs and pagination limit
    let effective_limit = match (safe_max_songs, safe_limit) {
        (Some(max), Some(lim)) => {
            let remaining = max - safe_offset.unwrap_or(0);
            if remaining <= 0 {
                Some(0)
            } else {
                Some(lim.min(remaining))
            }
        }
        (Some(max), None) => Some(max),
        (None, Some(lim)) => Some(lim),
        (None, None) => None,
    };

    let limit_offset_clause = match (effective_limit, safe_offset) {
        (Some(lim), Some(off)) => format!("LIMIT {} OFFSET {}", lim, off),
        (Some(lim), None) => format!("LIMIT {}", lim),
        (None, Some(off)) => format!("LIMIT -1 OFFSET {}", off),
        (None, None) => String::new(),
    };

    let query = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name,
                pc.play_count, pc.last_played, st.starred_at
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}
         ORDER BY {} {}
         {}",
        combined_where, order_by, direction, limit_offset_clause
    );

    where_args.append(&mut filter_args);

    let mut query_builder = sqlx::query_as::<_, crate::db::models::Song>(&query)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id);

    for arg in where_args {
        query_builder = match arg {
            SqlArg::Text(value) => query_builder.bind(value),
            SqlArg::I64(value) => query_builder.bind(value),
        };
    }

    let songs: Vec<crate::db::models::Song> = query_builder.fetch_all(pool).await?;

    Ok(songs)
}

/// Public helper to get songs from a smart playlist by ID.
/// Used by queue materialization to support smartPlaylist source type.
/// Accepts optional sort_field_override and sort_direction_override to allow
/// the client to override the playlist's default sort when playing.
pub async fn get_smart_playlist_songs_by_id(
    pool: &sqlx::SqlitePool,
    playlist_id: &str,
    user_id: i64,
    sort_field_override: Option<&str>,
    sort_direction_override: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    // Fetch the smart playlist
    let playlist: SmartPlaylist =
        sqlx::query_as("SELECT * FROM smart_playlists WHERE id = ? AND owner_id = ?")
            .bind(playlist_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| Error::NotFound(format!("Smart playlist {} not found", playlist_id)))?;

    // Parse rules
    let rules: SmartPlaylistRulesApi = serde_json::from_str(&playlist.rules_json)
        .map_err(|e| Error::Internal(format!("Failed to parse rules: {}", e)))?;

    // Use client overrides if provided, otherwise fall back to playlist defaults
    let sort_field = sort_field_override.or(playlist.sort_field.as_deref());
    let sort_direction = sort_direction_override.or(playlist.sort_direction.as_deref());

    // Materialize songs (no pagination - get all for queue)
    materialize_smart_playlist_songs(
        pool,
        &rules,
        user_id,
        sort_field,
        sort_direction,
        playlist.max_songs,
        None, // No pagination offset
        None, // No pagination limit
    )
    .await
}

#[derive(Debug, Clone)]
enum SqlArg {
    Text(String),
    I64(i64),
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn build_filter_clause(filter: Option<&str>) -> (String, Vec<SqlArg>) {
    if let Some(raw) = filter {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let pattern = format!("%{}%", escape_like_pattern(trimmed));
            return (
                " AND (s.title LIKE ? ESCAPE '\\\\' COLLATE NOCASE OR ar.name LIKE ? ESCAPE '\\\\' COLLATE NOCASE OR al.name LIKE ? ESCAPE '\\\\' COLLATE NOCASE)".to_string(),
                vec![
                    SqlArg::Text(pattern.clone()),
                    SqlArg::Text(pattern.clone()),
                    SqlArg::Text(pattern),
                ],
            );
        }
    }

    (String::new(), vec![])
}

/// Build WHERE clause from filter rules
fn build_where_clause(
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
) -> FerrotuneApiResult<(String, Vec<SqlArg>)> {
    if rules.conditions.is_empty() {
        return Ok((String::new(), vec![]));
    }

    let mut conditions: Vec<String> = Vec::new();
    let mut args: Vec<SqlArg> = Vec::new();

    for cond in &rules.conditions {
        if let Some((sql, mut cond_args)) = build_condition(cond, user_id) {
            conditions.push(sql);
            args.append(&mut cond_args);
        }
    }

    if conditions.is_empty() {
        return Ok((String::new(), vec![]));
    }

    let joiner = if rules.logic == "or" { " OR " } else { " AND " };
    Ok((conditions.join(joiner), args))
}

/// Build a single SQL condition from a filter condition
fn build_condition(
    cond: &SmartPlaylistConditionApi,
    user_id: i64,
) -> Option<(String, Vec<SqlArg>)> {
    let field = &cond.field;
    let op = &cond.operator;
    let value = &cond.value;

    // Handle special boolean fields that need custom SQL
    match field.as_str() {
        "starred" => {
            return match op.as_str() {
                "eq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some(("st.starred_at IS NOT NULL".to_string(), vec![]))
                    } else {
                        Some(("st.starred_at IS NULL".to_string(), vec![]))
                    }
                }
                "neq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some(("st.starred_at IS NULL".to_string(), vec![]))
                    } else {
                        Some(("st.starred_at IS NOT NULL".to_string(), vec![]))
                    }
                }
                _ => None,
            };
        }
        "coverArt" => {
            // coverArt uses enum values: "any", "embedded", "album"
            // - "any": song has any cover art (either embedded or from album)
            // - "embedded": song has its own embedded cover art
            // - "album": song's album has cover art
            let val_str = value.as_str().unwrap_or("");
            let (has_condition, not_has_condition) = match val_str {
                "any" => (
                    "(s.cover_art_hash IS NOT NULL OR al.cover_art_hash IS NOT NULL)",
                    "(s.cover_art_hash IS NULL AND (al.cover_art_hash IS NULL OR s.album_id IS NULL))",
                ),
                "embedded" => (
                    "s.cover_art_hash IS NOT NULL",
                    "s.cover_art_hash IS NULL",
                ),
                "album" => (
                    "(s.album_id IS NOT NULL AND al.cover_art_hash IS NOT NULL)",
                    "(s.album_id IS NULL OR al.cover_art_hash IS NULL)",
                ),
                _ => return None,
            };
            return match op.as_str() {
                "eq" => Some((has_condition.to_string(), vec![])),
                "neq" => Some((not_has_condition.to_string(), vec![])),
                _ => None,
            };
        }
        "shuffleExcluded" => {
            // shuffleExcluded checks if song is in the shuffle_excludes table
            return match op.as_str() {
                "eq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some((format!(
                            "EXISTS (SELECT 1 FROM shuffle_excludes se WHERE se.song_id = s.id AND se.user_id = {})",
                            user_id
                        ), vec![]))
                    } else {
                        Some((format!(
                            "NOT EXISTS (SELECT 1 FROM shuffle_excludes se WHERE se.song_id = s.id AND se.user_id = {})",
                            user_id
                        ), vec![]))
                    }
                }
                "neq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some((format!(
                            "NOT EXISTS (SELECT 1 FROM shuffle_excludes se WHERE se.song_id = s.id AND se.user_id = {})",
                            user_id
                        ), vec![]))
                    } else {
                        Some((format!(
                            "EXISTS (SELECT 1 FROM shuffle_excludes se WHERE se.song_id = s.id AND se.user_id = {})",
                            user_id
                        ), vec![]))
                    }
                }
                _ => None,
            };
        }
        "disabled" => {
            // disabled checks if song is in the disabled_songs table
            return match op.as_str() {
                "eq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some((format!(
                            "EXISTS (SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id AND ds.user_id = {})",
                            user_id
                        ), vec![]))
                    } else {
                        Some((format!(
                            "NOT EXISTS (SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id AND ds.user_id = {})",
                            user_id
                        ), vec![]))
                    }
                }
                "neq" => {
                    if value.as_bool().unwrap_or(false) {
                        Some((format!(
                            "NOT EXISTS (SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id AND ds.user_id = {})",
                            user_id
                        ), vec![]))
                    } else {
                        Some((format!(
                            "EXISTS (SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id AND ds.user_id = {})",
                            user_id
                        ), vec![]))
                    }
                }
                _ => None,
            };
        }
        "musicFolder" | "library" => {
            // Filter by music folder ID - the value should be the music folder ID
            let folder_id = value
                .as_i64()
                .or_else(|| value.as_str().and_then(|s| s.parse::<i64>().ok()))?;

            return match op.as_str() {
                "eq" => Some(("mf.id = ?".to_string(), vec![SqlArg::I64(folder_id)])),
                "neq" => Some(("mf.id != ?".to_string(), vec![SqlArg::I64(folder_id)])),
                _ => None,
            };
        }
        "coverArtResolution" => {
            // Filter by cover art resolution (the smaller of width/height)
            // Uses MIN(cover_art_width, cover_art_height) for comparison
            // Falls back to album cover art if song doesn't have embedded cover
            return match op.as_str() {
                "eq" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) = ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "neq" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) != ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "gt" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) > ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "gte" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) >= ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "lt" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) < ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "lte" => value.as_i64().map(|n| {
                    (
                        "COALESCE(MIN(s.cover_art_width, s.cover_art_height), MIN(al.cover_art_width, al.cover_art_height)) <= ?".to_string(),
                        vec![SqlArg::I64(n)],
                    )
                }),
                "empty" => Some(
                    (
                        "(s.cover_art_width IS NULL AND s.cover_art_height IS NULL AND al.cover_art_width IS NULL AND al.cover_art_height IS NULL)".to_string(),
                        vec![],
                    )
                ),
                "notEmpty" => Some(
                    (
                        "(s.cover_art_width IS NOT NULL OR al.cover_art_width IS NOT NULL)".to_string(),
                        vec![],
                    )
                ),
                _ => None,
            };
        }
        _ => {}
    }

    // Map field names to SQL expressions and field-specific bound args.
    let (sql_field, field_args) = match field.as_str() {
        "year" => ("s.year".to_string(), vec![]),
        "genre" => ("s.genre".to_string(), vec![]),
        "artist" | "artistName" => ("ar.name".to_string(), vec![]),
        "album" | "albumName" => ("al.name".to_string(), vec![]),
        "title" => ("s.title".to_string(), vec![]),
        "duration" => ("s.duration".to_string(), vec![]),
        "bitrate" => ("COALESCE(s.bitrate, 0)".to_string(), vec![]),
        "playCount" => ("COALESCE(pc.play_count, 0)".to_string(), vec![]),
        "rating" => (
            "COALESCE((SELECT r.rating FROM ratings r WHERE r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ?), 0)".to_string(),
            vec![SqlArg::I64(user_id)],
        ),
        "lastPlayed" => ("pc.last_played".to_string(), vec![]),
        "dateAdded" | "createdAt" => ("s.created_at".to_string(), vec![]),
        "fileFormat" => ("LOWER(s.file_format)".to_string(), vec![]),
        "albumartist" => ("ar.name".to_string(), vec![]), // Same as artist for now (album artist not stored separately)
        "composer" => return None, // Composer field not in database schema
        "comment" => return None,  // Comment field not in database schema for songs
        _ => return None, // Unknown field
    };

    let with_field_args = |mut op_args: Vec<SqlArg>| {
        let mut args = field_args.clone();
        args.append(&mut op_args);
        args
    };

    // Build the comparison based on operator
    match op.as_str() {
        "eq" => value
            .as_str()
            .map(|s| {
                if field == "fileFormat" {
                    (
                        format!("{} = ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_lowercase())]),
                    )
                } else {
                    (
                        format!("{} = ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_string())]),
                    )
                }
            })
            .or_else(|| {
                value.as_i64().map(|n| {
                    (
                        format!("{} = ?", sql_field),
                        with_field_args(vec![SqlArg::I64(n)]),
                    )
                })
            }),
        "neq" => value
            .as_str()
            .map(|s| {
                if field == "fileFormat" {
                    (
                        format!("{} != ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_lowercase())]),
                    )
                } else {
                    (
                        format!("{} != ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_string())]),
                    )
                }
            })
            .or_else(|| {
                value.as_i64().map(|n| {
                    (
                        format!("{} != ?", sql_field),
                        with_field_args(vec![SqlArg::I64(n)]),
                    )
                })
            }),
        "gt" => value
            .as_i64()
            .map(|n| {
                (
                    format!("{} > ?", sql_field),
                    with_field_args(vec![SqlArg::I64(n)]),
                )
            })
            .or_else(|| {
                value.as_str().map(|s| {
                    (
                        format!("date({}) > ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_string())]),
                    )
                })
            }),
        "gte" => value.as_i64().map(|n| {
            (
                format!("{} >= ?", sql_field),
                with_field_args(vec![SqlArg::I64(n)]),
            )
        }),
        "lt" => value
            .as_i64()
            .map(|n| {
                (
                    format!("{} < ?", sql_field),
                    with_field_args(vec![SqlArg::I64(n)]),
                )
            })
            .or_else(|| {
                value.as_str().map(|s| {
                    (
                        format!("date({}) < ?", sql_field),
                        with_field_args(vec![SqlArg::Text(s.to_string())]),
                    )
                })
            }),
        "lte" => value.as_i64().map(|n| {
            (
                format!("{} <= ?", sql_field),
                with_field_args(vec![SqlArg::I64(n)]),
            )
        }),
        "contains" => value.as_str().map(|s| {
            (
                format!("{} LIKE ? ESCAPE '\\\\' COLLATE NOCASE", sql_field),
                with_field_args(vec![SqlArg::Text(format!("%{}%", escape_like_pattern(s)))]),
            )
        }),
        "notContains" => value.as_str().map(|s| {
            (
                format!("{} NOT LIKE ? ESCAPE '\\\\' COLLATE NOCASE", sql_field),
                with_field_args(vec![SqlArg::Text(format!("%{}%", escape_like_pattern(s)))]),
            )
        }),
        "startsWith" => value.as_str().map(|s| {
            (
                format!("{} LIKE ? ESCAPE '\\\\' COLLATE NOCASE", sql_field),
                with_field_args(vec![SqlArg::Text(format!("{}%", escape_like_pattern(s)))]),
            )
        }),
        "endsWith" => value.as_str().map(|s| {
            (
                format!("{} LIKE ? ESCAPE '\\\\' COLLATE NOCASE", sql_field),
                with_field_args(vec![SqlArg::Text(format!("%{}", escape_like_pattern(s)))]),
            )
        }),
        "empty" => Some((
            format!("({} IS NULL OR {} = '')", sql_field, sql_field),
            field_args.clone(),
        )),
        "notEmpty" => Some((
            format!("({} IS NOT NULL AND {} != '')", sql_field, sql_field),
            field_args.clone(),
        )),
        "within" => {
            // Time-based "within" operator, e.g., "30d" for last 30 days
            value.as_str().and_then(|s| {
                let duration = parse_duration(s)?;
                Some((
                    format!("{} >= datetime('now', '-{} seconds')", sql_field, duration),
                    vec![],
                ))
            })
        }
        _ => None,
    }
}

/// Parse a duration string like "30d", "1w", "6m" into seconds
fn parse_duration(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().ok()?;

    let seconds = match unit.to_lowercase().as_str() {
        "s" => num,
        "m" => num * 60,
        "h" => num * 3600,
        "d" => num * 86400,
        "w" => num * 7 * 86400,
        _ => {
            // Maybe it's months
            if s.ends_with("mo") || s.ends_with("M") {
                let num_str = s.trim_end_matches("mo").trim_end_matches('M');
                let num: i64 = num_str.parse().ok()?;
                num * 30 * 86400
            } else if s.ends_with("y") {
                let num_str = s.trim_end_matches('y');
                let num: i64 = num_str.parse().ok()?;
                num * 365 * 86400
            } else {
                return None;
            }
        }
    };

    Some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration() {
        assert_eq!(parse_duration("30d"), Some(30 * 86400));
        assert_eq!(parse_duration("7d"), Some(7 * 86400));
        assert_eq!(parse_duration("1w"), Some(7 * 86400));
        assert_eq!(parse_duration("24h"), Some(24 * 3600));
        assert_eq!(parse_duration(""), None);
    }

    #[test]
    fn test_build_condition_uses_placeholders_for_contains() {
        let condition = SmartPlaylistConditionApi {
            field: "title".to_string(),
            operator: "contains".to_string(),
            value: serde_json::json!("a'b%_c"),
        };

        let (sql, args) = build_condition(&condition, 1).expect("condition should be built");

        assert!(sql.contains("LIKE ?"));
        assert!(sql.contains("ESCAPE '\\\\'"));
        assert!(!sql.contains("a'b%_c"));
        assert_eq!(args.len(), 1);

        match &args[0] {
            SqlArg::Text(pattern) => {
                assert!(pattern.starts_with('%'));
                assert!(pattern.ends_with('%'));
                assert!(pattern.contains("\\%"));
                assert!(pattern.contains("\\_"));
            }
            SqlArg::I64(_) => panic!("expected text SQL arg"),
        }
    }

    #[test]
    fn test_build_filter_clause_uses_bound_patterns() {
        let (sql, args) = build_filter_clause(Some("rock_%"));

        assert!(sql.contains("s.title LIKE ?"));
        assert!(sql.contains("ar.name LIKE ?"));
        assert!(sql.contains("al.name LIKE ?"));
        assert_eq!(args.len(), 3);

        for arg in args {
            match arg {
                SqlArg::Text(pattern) => {
                    assert!(pattern.starts_with('%'));
                    assert!(pattern.ends_with('%'));
                    assert!(pattern.contains("\\_"));
                    assert!(pattern.contains("\\%"));
                }
                SqlArg::I64(_) => panic!("expected text SQL arg"),
            }
        }
    }

    #[test]
    fn test_build_condition_rating_binds_user_id() {
        let condition = SmartPlaylistConditionApi {
            field: "rating".to_string(),
            operator: "eq".to_string(),
            value: serde_json::json!(5),
        };

        let (sql, args) = build_condition(&condition, 42).expect("condition should be built");

        assert!(sql.contains("r.user_id = ?"));
        assert!(!sql.contains("42"));
        assert_eq!(args.len(), 2);

        match (&args[0], &args[1]) {
            (SqlArg::I64(user_id), SqlArg::I64(rating)) => {
                assert_eq!(*user_id, 42);
                assert_eq!(*rating, 5);
            }
            _ => panic!("expected integer SQL args"),
        }
    }
}
