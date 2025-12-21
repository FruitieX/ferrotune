//! Smart playlist management endpoints for the Ferrotune Admin API.
//!
//! Smart playlists are dynamic playlists that automatically include songs
//! matching specified filter rules. Songs are materialized at query time.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::models::SmartPlaylist;
use crate::error::{Error, Result};
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
) -> Result<Json<SmartPlaylistsResponse>> {
    let playlists: Vec<SmartPlaylist> = sqlx::query_as(
        "SELECT id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, created_at, updated_at
         FROM smart_playlists
         WHERE owner_id = ? OR is_public = 1
         ORDER BY name",
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

        // Count matching songs
        let song_count = count_matching_songs(&state.pool, &rules, user.user_id).await?;

        result.push(SmartPlaylistInfo {
            id: playlist.id,
            name: playlist.name,
            comment: playlist.comment,
            is_public: playlist.is_public,
            rules,
            sort_field: playlist.sort_field,
            sort_direction: playlist.sort_direction,
            max_songs: playlist.max_songs,
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
) -> Result<Json<SmartPlaylistInfo>> {
    let playlist: Option<SmartPlaylist> = sqlx::query_as(
        "SELECT id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, created_at, updated_at
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

            let song_count = count_matching_songs(&state.pool, &rules, user.user_id).await?;

            Ok(Json(SmartPlaylistInfo {
                id: playlist.id,
                name: playlist.name,
                comment: playlist.comment,
                is_public: playlist.is_public,
                rules,
                sort_field: playlist.sort_field,
                sort_direction: playlist.sort_direction,
                max_songs: playlist.max_songs,
                song_count,
                created_at: playlist.created_at,
                updated_at: playlist.updated_at,
            }))
        }
        None => Err(Error::NotFound(format!("Smart playlist {} not found", id))),
    }
}

/// POST /ferrotune/smart-playlists - Create a new smart playlist
pub async fn create_smart_playlist(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateSmartPlaylistRequest>,
) -> Result<impl IntoResponse> {
    let id = Uuid::new_v4().to_string();
    let rules_json = serde_json::to_string(&request.rules)
        .map_err(|e| Error::InvalidRequest(format!("Invalid rules: {}", e)))?;

    sqlx::query(
        "INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
) -> Result<impl IntoResponse> {
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
        )));
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
        updates.push("max_songs = ?");
        bindings.push(
            max_songs
                .map(|n| n.to_string())
                .unwrap_or("NULL".to_string()),
        );
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
) -> Result<impl IntoResponse> {
    let result = sqlx::query("DELETE FROM smart_playlists WHERE id = ? AND owner_id = ?")
        .bind(&id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(Error::NotFound(format!(
            "Smart playlist {} not found or not owned by you",
            id
        )));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// GET /ferrotune/smart-playlists/{id}/songs - Get materialized songs from a smart playlist
pub async fn get_smart_playlist_songs(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<SmartPlaylistSongsParams>,
) -> Result<Json<SmartPlaylistSongsResponse>> {
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

    // Get total count (with filter applied)
    let total_count =
        count_matching_songs_filtered(&state.pool, &rules, user.user_id, params.filter.as_deref())
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
            let starred = s
                .starred_at
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
            let cover_art_data = thumbnails.get(&s.id).cloned();
            // Construct play stats from Song model fields
            let play_stats = crate::api::common::models::SongPlayStats {
                play_count: s.play_count,
                last_played: s
                    .last_played
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
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
) -> Result<impl IntoResponse> {
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

/// Count songs matching the smart playlist rules
async fn count_matching_songs(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
) -> Result<i64> {
    let where_clause = build_where_clause(rules, user_id)?;

    // Always filter by enabled music folders
    let enabled_filter = "mf.enabled = 1";
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
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}",
        combined_where
    );

    let (count,): (i64,) = sqlx::query_as(&query)
        .bind(user_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    Ok(count)
}

/// Materialize songs matching the smart playlist rules
#[allow(clippy::too_many_arguments)]
async fn materialize_smart_playlist_songs(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    sort_field: Option<&str>,
    sort_direction: Option<&str>,
    max_songs: Option<i64>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<crate::db::models::Song>> {
    let where_clause = build_where_clause(rules, user_id)?;

    // Always filter by enabled music folders
    let enabled_filter = "mf.enabled = 1";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}", enabled_filter)
    } else {
        format!("WHERE {} AND {}", enabled_filter, where_clause)
    };

    // Build ORDER BY clause
    let order_by = match sort_field {
        Some("title") | Some("name") => "s.title",
        Some("artist") => "ar.name",
        Some("album") => "al.name",
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
    let effective_limit = match (max_songs, limit) {
        (Some(max), Some(lim)) => {
            // With offset, we need to ensure we don't go past max_songs
            let remaining = max - offset.unwrap_or(0);
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

    let limit_offset_clause = match (effective_limit, offset) {
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
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}
         ORDER BY {} {}
         {}",
        combined_where, order_by, direction, limit_offset_clause
    );

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
        .bind(user_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    Ok(songs)
}

/// Count songs matching the smart playlist rules with optional text filter
async fn count_matching_songs_filtered(
    pool: &sqlx::SqlitePool,
    rules: &SmartPlaylistRulesApi,
    user_id: i64,
    filter: Option<&str>,
) -> Result<i64> {
    let where_clause = build_where_clause(rules, user_id)?;

    // Add filter clause if provided
    let filter_clause = if let Some(f) = filter {
        if !f.trim().is_empty() {
            let escaped = f.replace('\'', "''");
            format!(
                " AND (s.title LIKE '%{}%' COLLATE NOCASE OR ar.name LIKE '%{}%' COLLATE NOCASE OR al.name LIKE '%{}%' COLLATE NOCASE)",
                escaped, escaped, escaped
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Always filter by enabled music folders
    let enabled_filter = "mf.enabled = 1";
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
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}",
        combined_where
    );

    let (count,): (i64,) = sqlx::query_as(&query)
        .bind(user_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    Ok(count)
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
) -> Result<Vec<crate::db::models::Song>> {
    let where_clause = build_where_clause(rules, user_id)?;

    // Add filter clause if provided
    let filter_clause = if let Some(f) = filter {
        if !f.trim().is_empty() {
            let escaped = f.replace('\'', "''");
            format!(
                " AND (s.title LIKE '%{}%' COLLATE NOCASE OR ar.name LIKE '%{}%' COLLATE NOCASE OR al.name LIKE '%{}%' COLLATE NOCASE)",
                escaped, escaped, escaped
            )
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    // Always filter by enabled music folders
    let enabled_filter = "mf.enabled = 1";
    let combined_where = if where_clause.is_empty() {
        format!("WHERE {}{}", enabled_filter, filter_clause)
    } else {
        format!(
            "WHERE {} AND {}{}",
            enabled_filter, where_clause, filter_clause
        )
    };

    // Build ORDER BY clause
    let order_by = match sort_field {
        Some("title") => "s.title",
        Some("artist") => "ar.name",
        Some("album") => "al.name",
        Some("year") => "s.year",
        Some("playCount") => "pc.play_count",
        Some("dateAdded") | Some("createdAt") => "s.created_at",
        Some("lastPlayed") => "pc.last_played",
        Some("duration") => "s.duration",
        Some("name") => "s.title", // Alias for title
        _ => "RANDOM()",
    };

    let direction = match sort_direction {
        Some("desc") => "DESC",
        Some("asc") => "ASC",
        _ => "ASC",
    };

    // Build LIMIT clause - consider both max_songs and pagination limit
    let effective_limit = match (max_songs, limit) {
        (Some(max), Some(lim)) => {
            let remaining = max - offset.unwrap_or(0);
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

    let limit_offset_clause = match (effective_limit, offset) {
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
         LEFT JOIN (SELECT song_id, SUM(play_count) as play_count, MAX(played_at) as last_played
                    FROM scrobbles WHERE user_id = ? GROUP BY song_id) pc 
            ON s.id = pc.song_id
         LEFT JOIN starred st ON s.id = st.item_id AND st.item_type = 'song' AND st.user_id = ?
         {}
         ORDER BY {} {}
         {}",
        combined_where, order_by, direction, limit_offset_clause
    );

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
        .bind(user_id)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

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
) -> Result<Vec<crate::db::models::Song>> {
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

/// Build WHERE clause from filter rules
fn build_where_clause(rules: &SmartPlaylistRulesApi, user_id: i64) -> Result<String> {
    if rules.conditions.is_empty() {
        return Ok(String::new());
    }

    let conditions: Vec<String> = rules
        .conditions
        .iter()
        .filter_map(|cond| build_condition(cond, user_id))
        .collect();

    if conditions.is_empty() {
        return Ok(String::new());
    }

    let joiner = if rules.logic == "or" { " OR " } else { " AND " };
    Ok(conditions.join(joiner))
}

/// Build a single SQL condition from a filter condition
fn build_condition(cond: &SmartPlaylistConditionApi, _user_id: i64) -> Option<String> {
    let field = &cond.field;
    let op = &cond.operator;
    let value = &cond.value;

    // Map field names to SQL expressions
    let sql_field = match field.as_str() {
        "year" => "s.year",
        "genre" => "s.genre",
        "artist" | "artistName" => "ar.name",
        "album" | "albumName" => "al.name",
        "title" => "s.title",
        "duration" => "s.duration",
        "playCount" => "COALESCE(pc.play_count, 0)",
        "lastPlayed" => "pc.last_played",
        "dateAdded" | "createdAt" => "s.created_at",
        "starred" => "st.starred_at",
        _ => return None, // Unknown field
    };

    // Build the comparison based on operator
    match op.as_str() {
        "eq" => {
            if field == "starred" {
                if value.as_bool().unwrap_or(false) {
                    Some("st.starred_at IS NOT NULL".to_string())
                } else {
                    Some("st.starred_at IS NULL".to_string())
                }
            } else {
                value
                    .as_str()
                    .map(|s| format!("{} = '{}'", sql_field, s.replace('\'', "''")))
                    .or_else(|| value.as_i64().map(|n| format!("{} = {}", sql_field, n)))
            }
        }
        "neq" => value
            .as_str()
            .map(|s| format!("{} != '{}'", sql_field, s.replace('\'', "''")))
            .or_else(|| value.as_i64().map(|n| format!("{} != {}", sql_field, n))),
        "gt" => value.as_i64().map(|n| format!("{} > {}", sql_field, n)),
        "gte" => value.as_i64().map(|n| format!("{} >= {}", sql_field, n)),
        "lt" => value.as_i64().map(|n| format!("{} < {}", sql_field, n)),
        "lte" => value.as_i64().map(|n| format!("{} <= {}", sql_field, n)),
        "contains" => value.as_str().map(|s| {
            format!(
                "{} LIKE '%{}%'",
                sql_field,
                s.replace('\'', "''").replace('%', "\\%")
            )
        }),
        "within" => {
            // Time-based "within" operator, e.g., "30d" for last 30 days
            value.as_str().and_then(|s| {
                let duration = parse_duration(s)?;
                Some(format!(
                    "{} >= datetime('now', '-{} seconds')",
                    sql_field, duration
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
}
