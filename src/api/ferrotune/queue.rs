//! Server-side playback queue management for Ferrotune Admin API.
//!
//! This module provides endpoints for managing play queues server-side:
//! - Queue creation from various sources (album, artist, playlist, library, etc.)
//! - Paginated queue fetching for virtualized rendering
//! - Queue modifications (add, remove, move)
//! - Shuffle toggle with server-side shuffle state
//! - Repeat mode management
//!
//! The queue is fully server-authoritative - the client sends play intents and
//! the server materializes and stores the queue. Shuffle indices are generated
//! and stored server-side for consistent behavior across sessions.

use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{
    get_ratings_map, get_starred_map, song_to_response, SongResponse,
};
use crate::api::subsonic::search::{search_songs_for_queue, SearchParams};
use crate::api::subsonic::sorting;
use crate::api::AppState;
use crate::db::models::{QueueSourceType, RepeatMode};
use crate::db::queries;
use crate::error::{Error, Result};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rand::{rngs::StdRng, seq::SliceRandom, SeedableRng};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

// ============================================================================
// Request/Response Types
// ============================================================================

/// Request to start a new queue from a source
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQueueRequest {
    /// Type of source (library, album, artist, playlist, genre, favorites, etc.)
    pub source_type: String,
    /// ID of the source (album ID, artist ID, playlist ID, genre name, etc.)
    pub source_id: Option<String>,
    /// Display name of the source
    pub source_name: Option<String>,
    /// Index of the song to start playing (0-based, in the original order)
    #[serde(default)]
    pub start_index: usize,
    /// Whether to enable shuffle when starting
    #[serde(default)]
    pub shuffle: bool,
    /// Repeat mode (off, all, one)
    #[serde(default)]
    pub repeat_mode: Option<String>,
    /// Optional filters to apply (JSON object)
    pub filters: Option<serde_json::Value>,
    /// Optional sort criteria (JSON object)
    pub sort: Option<serde_json::Value>,
    /// Optional explicit song IDs (for search results, history, or custom queues)
    /// When provided, these songs are used instead of materializing from source_type
    pub song_ids: Option<Vec<String>>,
}

/// Response after starting a queue
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StartQueueResponse {
    /// Total number of songs in the queue
    pub total_count: usize,
    /// Current index in the queue (shuffle-adjusted if shuffled)
    pub current_index: usize,
    /// Whether shuffle is enabled
    pub is_shuffled: bool,
    /// Repeat mode
    pub repeat_mode: String,
    /// Initial window of songs around the current position
    pub window: QueueWindow,
}

/// A window of songs in the queue
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct QueueWindow {
    /// Offset of this window in the queue
    pub offset: usize,
    /// Songs in this window
    pub songs: Vec<QueueSongEntry>,
}

/// A song entry in the queue with its position info
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct QueueSongEntry {
    /// Unique identifier for this queue entry (allows same song multiple times)
    pub entry_id: String,
    /// Position in the queue (display order, accounts for shuffle)
    pub position: usize,
    /// The song data
    #[ts(type = "import('../types').Song")]
    pub song: SongResponse,
}

/// Response for getting the queue state
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetQueueResponse {
    /// Total number of songs in the queue
    pub total_count: usize,
    /// Current index in the queue
    pub current_index: usize,
    /// Current playback position in milliseconds
    pub position_ms: i64,
    /// Whether shuffle is enabled
    pub is_shuffled: bool,
    /// Repeat mode
    pub repeat_mode: String,
    /// Queue source info
    pub source: QueueSourceInfo,
    /// Requested window of songs
    pub window: QueueWindow,
}

/// Queue source information
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct QueueSourceInfo {
    /// Type of source
    #[serde(rename = "type")]
    pub source_type: String,
    /// Source ID
    pub id: Option<String>,
    /// Source display name
    pub name: Option<String>,
}

/// Query parameters for paginated queue fetch
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePaginationParams {
    /// Offset into the queue (0-based)
    #[serde(default)]
    pub offset: Option<usize>,
    /// Maximum number of songs to return
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Query parameters for current window fetch
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWindowParams {
    /// Number of songs to fetch before and after current position
    #[serde(default)]
    pub radius: Option<usize>,
}

/// Request to add songs to the queue
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    /// Song IDs to add
    pub song_ids: Vec<String>,
    /// Position: "next" (after current), "end", or a number
    pub position: AddPosition,
}

/// Position for adding songs
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AddPosition {
    Named(String),
    Index(usize),
}

/// Request to move a song in the queue
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveInQueueRequest {
    /// Position to move from
    pub from_position: usize,
    /// Position to move to
    pub to_position: usize,
}

/// Request to toggle shuffle
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShuffleRequest {
    /// Whether to enable shuffle
    pub enabled: bool,
}

/// Request to update current position
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePositionRequest {
    /// New current index
    pub current_index: usize,
    /// Playback position in milliseconds
    #[serde(default)]
    pub position_ms: i64,
}

/// Request to update repeat mode
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatModeRequest {
    /// Repeat mode (off, all, one)
    pub mode: String,
}

/// Generic success response
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct QueueSuccessResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_count: Option<usize>,
}

// ============================================================================
// Endpoints
// ============================================================================

/// POST /ferrotune/queue/start - Start a new queue from a source
///
/// Materializes a queue from the specified source (album, artist, playlist, etc.),
/// optionally applying shuffle and storing the result server-side.
///
/// If `song_ids` is provided, those songs are used directly instead of
/// materializing from the source. This is useful for history or custom queues
/// where the client has an explicit list of songs.
///
/// For library/search sources, the server will use `filters` and `sort` to
/// reproduce the song list. The `source_id` field is used as the search query
/// for search-type sources.
pub async fn start_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StartQueueRequest>,
) -> Result<impl IntoResponse> {
    let source_type = QueueSourceType::from_str(&request.source_type);

    // Get songs either from explicit IDs or by materializing from source
    let songs = if let Some(ref song_ids) = request.song_ids {
        // Use explicit song IDs provided by client
        if song_ids.is_empty() {
            return Err(Error::NotFound("No songs provided".to_string()));
        }
        queries::get_songs_by_ids(&state.pool, song_ids).await?
    } else {
        // Materialize songs from the source
        materialize_queue_songs(
            &state.pool,
            user.user_id,
            source_type,
            request.source_id.as_deref(),
            request.filters.as_ref(),
            request.sort.as_ref(),
        )
        .await?
    };

    if songs.is_empty() {
        return Err(Error::NotFound(
            "No songs found for this source".to_string(),
        ));
    }

    let total_count = songs.len();
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();

    // Validate start index
    let start_index = request.start_index.min(total_count - 1);

    // Handle shuffle - only shuffle tracks after the starting position
    let (is_shuffled, shuffle_seed, shuffle_indices, current_index) = if request.shuffle {
        let seed = rand::random::<u64>() as i64;
        let indices = generate_shuffle_indices(total_count, start_index, seed as u64);
        let indices_json = serde_json::to_string(&indices).unwrap_or_default();
        // Keep current position at start_index - shuffle only affects upcoming tracks
        (true, Some(seed), Some(indices_json), start_index as i64)
    } else {
        (false, None, None, start_index as i64)
    };

    let repeat_mode = request.repeat_mode.as_deref().unwrap_or("off");
    let filters_json = request.filters.as_ref().map(|f| f.to_string());
    let sort_json = request.sort.as_ref().map(|s| s.to_string());

    // Save queue to database
    queries::create_queue(
        &state.pool,
        user.user_id,
        source_type.as_str(),
        request.source_id.as_deref(),
        request.source_name.as_deref(),
        &song_ids,
        current_index,
        is_shuffled,
        shuffle_seed,
        shuffle_indices.as_deref(),
        repeat_mode,
        filters_json.as_deref(),
        sort_json.as_deref(),
        &user.client,
    )
    .await?;

    // Fetch entries with entry_ids from database
    let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;

    // Build initial window (±20 songs around current position)
    let window = build_queue_window(
        &state.pool,
        user.user_id,
        &all_entries,
        current_index as usize,
        20,
        is_shuffled,
        shuffle_indices.as_deref(),
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(StartQueueResponse {
            total_count,
            current_index: current_index as usize,
            is_shuffled,
            repeat_mode: repeat_mode.to_string(),
            window,
        }),
    ))
}

/// GET /ferrotune/queue - Get the current queue with pagination
pub async fn get_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<QueuePaginationParams>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);

    // Get all queue entries with songs (we need them for shuffle mapping)
    let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;
    let total_count = all_entries.len();

    let window = build_queue_window_range(
        &state.pool,
        user.user_id,
        &all_entries,
        offset,
        limit,
        queue.is_shuffled,
        queue.shuffle_indices_json.as_deref(),
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(GetQueueResponse {
            total_count,
            current_index: queue.current_index as usize,
            position_ms: queue.position_ms,
            is_shuffled: queue.is_shuffled,
            repeat_mode: queue.repeat_mode.clone(),
            source: QueueSourceInfo {
                source_type: queue.source_type.clone(),
                id: queue.source_id.clone(),
                name: queue.source_name.clone(),
            },
            window,
        }),
    ))
}

/// GET /ferrotune/queue/current-window - Get songs around current position
pub async fn get_current_window(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CurrentWindowParams>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let radius = params.radius.unwrap_or(20);

    // Get all queue entries with songs
    let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;
    let total_count = all_entries.len();

    let window = build_queue_window(
        &state.pool,
        user.user_id,
        &all_entries,
        queue.current_index as usize,
        radius,
        queue.is_shuffled,
        queue.shuffle_indices_json.as_deref(),
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(GetQueueResponse {
            total_count,
            current_index: queue.current_index as usize,
            position_ms: queue.position_ms,
            is_shuffled: queue.is_shuffled,
            repeat_mode: queue.repeat_mode.clone(),
            source: QueueSourceInfo {
                source_type: queue.source_type.clone(),
                id: queue.source_id.clone(),
                name: queue.source_name.clone(),
            },
            window,
        }),
    ))
}

/// POST /ferrotune/queue/add - Add songs to the queue
pub async fn add_to_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<AddToQueueRequest>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let current_len = queries::get_queue_length(&state.pool, user.user_id).await?;

    // Determine insert position
    let position = match request.position {
        AddPosition::Named(ref s) if s == "next" => queue.current_index + 1,
        AddPosition::Named(ref s) if s == "end" => current_len,
        AddPosition::Named(_) => current_len, // Default to end for unknown strings
        AddPosition::Index(i) => i as i64,
    };

    let new_len =
        queries::add_to_queue(&state.pool, user.user_id, &request.song_ids, position).await?;

    // If shuffle is enabled, we need to update shuffle indices
    if queue.is_shuffled {
        let shuffle_indices = queue.shuffle_indices().unwrap_or_default();
        let mut new_indices = shuffle_indices.clone();

        // Insert new indices for the added songs
        let insert_pos = match request.position {
            AddPosition::Named(ref s) if s == "next" => 1, // After current (position 0 in shuffle)
            _ => new_indices.len(),                        // At end
        };

        // Add indices for new songs (their original queue positions)
        let start_original_pos = position as usize;
        for (i, _) in request.song_ids.iter().enumerate() {
            new_indices.insert(insert_pos + i, start_original_pos + i);
        }

        // Adjust existing indices that point to positions >= insert position
        for idx in new_indices.iter_mut() {
            if *idx >= start_original_pos && *idx < start_original_pos + request.song_ids.len() {
                // This is one of the new songs, skip
                continue;
            }
            if *idx >= start_original_pos {
                *idx += request.song_ids.len();
            }
        }

        let indices_json = serde_json::to_string(&new_indices).unwrap_or_default();
        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            true,
            queue.shuffle_seed,
            Some(&indices_json),
            queue.current_index,
        )
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(QueueSuccessResponse {
            success: true,
            new_index: None,
            total_count: Some(new_len as usize),
        }),
    ))
}

/// DELETE /ferrotune/queue/{position} - Remove a song from the queue
pub async fn remove_from_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(position): Path<usize>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    // In shuffled mode, position is the shuffled position - need to get original position
    let original_position = if queue.is_shuffled {
        let indices = queue.shuffle_indices().unwrap_or_default();
        if position >= indices.len() {
            return Err(Error::InvalidRequest("Position out of range".to_string()));
        }
        indices[position]
    } else {
        position
    };

    let removed =
        queries::remove_from_queue(&state.pool, user.user_id, original_position as i64).await?;

    if !removed {
        return Err(Error::NotFound("Position not found in queue".to_string()));
    }

    // Update current index if needed
    let mut new_current_index = queue.current_index;
    if (original_position as i64) < queue.current_index {
        new_current_index -= 1;
    } else if (original_position as i64) == queue.current_index {
        // Current track was removed, stay at same position (next song slides in)
        let new_len = queries::get_queue_length(&state.pool, user.user_id).await?;
        if new_current_index >= new_len {
            new_current_index = new_len.saturating_sub(1);
        }
    }

    // Update shuffle indices if shuffled
    if queue.is_shuffled {
        let mut indices = queue.shuffle_indices().unwrap_or_default();

        // Remove the index for the removed song
        indices.retain(|&idx| idx != original_position);

        // Adjust indices greater than the removed position
        for idx in indices.iter_mut() {
            if *idx > original_position {
                *idx -= 1;
            }
        }

        // Find new shuffled current index
        let shuffled_current = if position < indices.len() {
            position as i64
        } else {
            (indices.len().saturating_sub(1)) as i64
        };

        let indices_json = serde_json::to_string(&indices).unwrap_or_default();
        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            true,
            queue.shuffle_seed,
            Some(&indices_json),
            shuffled_current,
        )
        .await?;
    } else {
        queries::update_queue_position(
            &state.pool,
            user.user_id,
            new_current_index,
            queue.position_ms,
        )
        .await?;
    }

    let new_len = queries::get_queue_length(&state.pool, user.user_id).await?;

    Ok((
        StatusCode::OK,
        Json(QueueSuccessResponse {
            success: true,
            new_index: Some(new_current_index as usize),
            total_count: Some(new_len as usize),
        }),
    ))
}

/// POST /ferrotune/queue/move - Move a song to a new position
pub async fn move_in_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<MoveInQueueRequest>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    if queue.is_shuffled {
        // In shuffled mode, we modify the shuffle indices rather than the original queue
        let mut indices = queue.shuffle_indices().unwrap_or_default();

        if request.from_position >= indices.len() || request.to_position >= indices.len() {
            return Err(Error::InvalidRequest("Position out of range".to_string()));
        }

        let moved = indices.remove(request.from_position);
        indices.insert(request.to_position, moved);

        // Adjust current index
        let new_current = if request.from_position == queue.current_index as usize {
            request.to_position as i64
        } else if request.from_position < queue.current_index as usize
            && request.to_position >= queue.current_index as usize
        {
            queue.current_index - 1
        } else if request.from_position > queue.current_index as usize
            && request.to_position <= queue.current_index as usize
        {
            queue.current_index + 1
        } else {
            queue.current_index
        };

        let indices_json = serde_json::to_string(&indices).unwrap_or_default();
        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            true,
            queue.shuffle_seed,
            Some(&indices_json),
            new_current,
        )
        .await?;

        Ok((
            StatusCode::OK,
            Json(QueueSuccessResponse {
                success: true,
                new_index: Some(new_current as usize),
                total_count: None,
            }),
        ))
    } else {
        // Not shuffled, move in the actual queue
        let moved = queries::move_in_queue(
            &state.pool,
            user.user_id,
            request.from_position as i64,
            request.to_position as i64,
        )
        .await?;

        if !moved {
            return Err(Error::NotFound("Position not found in queue".to_string()));
        }

        // Calculate new current index
        let new_current = if request.from_position == queue.current_index as usize {
            request.to_position
        } else if request.from_position < queue.current_index as usize
            && request.to_position >= queue.current_index as usize
        {
            (queue.current_index - 1) as usize
        } else if request.from_position > queue.current_index as usize
            && request.to_position <= queue.current_index as usize
        {
            (queue.current_index + 1) as usize
        } else {
            queue.current_index as usize
        };

        queries::update_queue_position(
            &state.pool,
            user.user_id,
            new_current as i64,
            queue.position_ms,
        )
        .await?;

        Ok((
            StatusCode::OK,
            Json(QueueSuccessResponse {
                success: true,
                new_index: Some(new_current),
                total_count: None,
            }),
        ))
    }
}

/// POST /ferrotune/queue/shuffle - Toggle shuffle mode
pub async fn toggle_shuffle(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ShuffleRequest>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let total_count = queries::get_queue_length(&state.pool, user.user_id).await? as usize;
    let current_index = queue.current_index as usize;

    if request.enabled {
        // Enable shuffle - only shuffle upcoming tracks, keep current position
        let seed = rand::random::<u64>() as i64;
        let indices = generate_shuffle_indices(total_count, current_index, seed as u64);
        let indices_json = serde_json::to_string(&indices).unwrap_or_default();

        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            true,
            Some(seed),
            Some(&indices_json),
            current_index as i64, // Keep current index unchanged
        )
        .await?;

        Ok((
            StatusCode::OK,
            Json(QueueSuccessResponse {
                success: true,
                new_index: Some(current_index),
                total_count: None,
            }),
        ))
    } else {
        // Disable shuffle - restore original order, keep current position
        // The current_index still points to the same position in the original order

        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            false,
            None,
            None,
            current_index as i64,
        )
        .await?;

        Ok((
            StatusCode::OK,
            Json(QueueSuccessResponse {
                success: true,
                new_index: Some(current_index),
                total_count: None,
            }),
        ))
    }
}

/// POST /ferrotune/queue/position - Update current position
pub async fn update_position(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdatePositionRequest>,
) -> Result<impl IntoResponse> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let total_count = queries::get_queue_length(&state.pool, user.user_id).await? as usize;

    if request.current_index >= total_count {
        return Err(Error::InvalidRequest("Position out of range".to_string()));
    }

    // If shuffled, update the shuffled current index
    if queue.is_shuffled {
        queries::update_queue_shuffle(
            &state.pool,
            user.user_id,
            true,
            queue.shuffle_seed,
            queue.shuffle_indices_json.as_deref(),
            request.current_index as i64,
        )
        .await?;
    } else {
        queries::update_queue_position(
            &state.pool,
            user.user_id,
            request.current_index as i64,
            request.position_ms,
        )
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(QueueSuccessResponse {
            success: true,
            new_index: Some(request.current_index),
            total_count: None,
        }),
    ))
}

/// POST /ferrotune/queue/repeat - Update repeat mode
pub async fn update_repeat_mode(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RepeatModeRequest>,
) -> Result<impl IntoResponse> {
    // Validate repeat mode
    let mode = RepeatMode::from_str(&request.mode);

    queries::update_queue_repeat_mode(&state.pool, user.user_id, mode.as_str()).await?;

    Ok((
        StatusCode::OK,
        Json(QueueSuccessResponse {
            success: true,
            new_index: None,
            total_count: None,
        }),
    ))
}

/// DELETE /ferrotune/queue - Clear the entire queue
pub async fn clear_queue(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse> {
    queries::clear_queue(&state.pool, user.user_id).await?;

    Ok((
        StatusCode::OK,
        Json(QueueSuccessResponse {
            success: true,
            new_index: None,
            total_count: Some(0),
        }),
    ))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Materialize songs from a queue source
async fn materialize_queue_songs(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    source_type: QueueSourceType,
    source_id: Option<&str>,
    filters: Option<&serde_json::Value>,
    sort: Option<&serde_json::Value>,
) -> Result<Vec<crate::db::models::Song>> {
    // Parse sort params from JSON for use with non-search sources
    let (sort_field, sort_dir) = sorting::parse_sort_from_json(sort);

    match source_type {
        QueueSourceType::Album => {
            let album_id =
                source_id.ok_or_else(|| Error::InvalidRequest("Album ID required".to_string()))?;
            let songs = queries::get_songs_by_album(pool, album_id).await?;
            // Apply sorting if provided (usually albums use default track order)
            Ok(sorting::sort_songs(
                songs,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Artist => {
            let artist_id =
                source_id.ok_or_else(|| Error::InvalidRequest("Artist ID required".to_string()))?;
            let songs = queries::get_songs_by_artist(pool, artist_id).await?;
            // Apply sorting if provided (client may have sorted the song list)
            Ok(sorting::sort_songs(
                songs,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Playlist => {
            let playlist_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Playlist ID required".to_string()))?;
            let songs = queries::get_playlist_songs(pool, playlist_id).await?;
            // Apply sorting if provided (playlists usually have custom order)
            Ok(sorting::sort_songs(
                songs,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Genre => {
            let genre =
                source_id.ok_or_else(|| Error::InvalidRequest("Genre required".to_string()))?;
            let songs = queries::get_songs_by_genre(pool, genre).await?;
            // Apply sorting if provided
            Ok(sorting::sort_songs(
                songs,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Favorites => {
            let songs = queries::get_starred_songs(pool, user_id).await?;
            // Apply sorting if provided
            Ok(sorting::sort_songs(
                songs,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Library | QueueSourceType::Search => {
            // For library/search, use the search function with filters and sort
            // source_id is used as the search query (empty or "*" for library)
            let query = source_id.unwrap_or("*");

            // Parse filters and sort from JSON into SearchParams
            let search_params = build_search_params_from_json(filters, sort);

            Ok(search_songs_for_queue(pool, user_id, query, &search_params).await?)
        }
        QueueSourceType::History => {
            // History requires explicit song IDs from the client
            Err(Error::InvalidRequest(
                "History source requires explicit song IDs".to_string(),
            ))
        }
        QueueSourceType::Other => {
            // For "other" source with no song IDs, treat as library
            let search_params = build_search_params_from_json(filters, sort);
            Ok(search_songs_for_queue(pool, user_id, "*", &search_params).await?)
        }
    }
}

/// Build SearchParams from JSON filter and sort objects
fn build_search_params_from_json(
    filters: Option<&serde_json::Value>,
    sort: Option<&serde_json::Value>,
) -> SearchParams {
    let mut params = SearchParams {
        query: "*".to_string(),
        artist_count: None,
        artist_offset: None,
        album_count: None,
        album_offset: None,
        song_count: None,
        song_offset: None,
        song_sort: None,
        song_sort_dir: None,
        album_sort: None,
        album_sort_dir: None,
        min_year: None,
        max_year: None,
        genre: None,
        min_duration: None,
        max_duration: None,
        min_rating: None,
        max_rating: None,
        starred_only: None,
        min_play_count: None,
        max_play_count: None,
        shuffle_excluded_only: None,
        min_bitrate: None,
        max_bitrate: None,
        added_after: None,
        added_before: None,
    };

    // Parse filters
    if let Some(f) = filters {
        if let Some(obj) = f.as_object() {
            if let Some(v) = obj.get("minYear").and_then(|v| v.as_i64()) {
                params.min_year = Some(v as i32);
            }
            if let Some(v) = obj.get("maxYear").and_then(|v| v.as_i64()) {
                params.max_year = Some(v as i32);
            }
            if let Some(v) = obj.get("genre").and_then(|v| v.as_str()) {
                params.genre = Some(v.to_string());
            }
            if let Some(v) = obj.get("minDuration").and_then(|v| v.as_i64()) {
                params.min_duration = Some(v as i32);
            }
            if let Some(v) = obj.get("maxDuration").and_then(|v| v.as_i64()) {
                params.max_duration = Some(v as i32);
            }
            if let Some(v) = obj.get("minRating").and_then(|v| v.as_i64()) {
                params.min_rating = Some(v as i32);
            }
            if let Some(v) = obj.get("maxRating").and_then(|v| v.as_i64()) {
                params.max_rating = Some(v as i32);
            }
            if let Some(v) = obj.get("starredOnly").and_then(|v| v.as_bool()) {
                params.starred_only = Some(v);
            }
            if let Some(v) = obj.get("minPlayCount").and_then(|v| v.as_i64()) {
                params.min_play_count = Some(v as i32);
            }
            if let Some(v) = obj.get("maxPlayCount").and_then(|v| v.as_i64()) {
                params.max_play_count = Some(v as i32);
            }
            if let Some(v) = obj.get("shuffleExcludedOnly").and_then(|v| v.as_bool()) {
                params.shuffle_excluded_only = Some(v);
            }
            if let Some(v) = obj.get("minBitrate").and_then(|v| v.as_i64()) {
                params.min_bitrate = Some(v as i32);
            }
            if let Some(v) = obj.get("maxBitrate").and_then(|v| v.as_i64()) {
                params.max_bitrate = Some(v as i32);
            }
            if let Some(v) = obj.get("addedAfter").and_then(|v| v.as_str()) {
                params.added_after = Some(v.to_string());
            }
            if let Some(v) = obj.get("addedBefore").and_then(|v| v.as_str()) {
                params.added_before = Some(v.to_string());
            }
        }
    }

    // Parse sort
    if let Some(s) = sort {
        if let Some(obj) = s.as_object() {
            if let Some(v) = obj.get("field").and_then(|v| v.as_str()) {
                params.song_sort = Some(v.to_string());
            }
            if let Some(v) = obj.get("direction").and_then(|v| v.as_str()) {
                params.song_sort_dir = Some(v.to_string());
            }
        }
    }

    params
}

/// Generate shuffle indices that keep played tracks in order and only shuffle upcoming tracks.
///
/// When shuffling:
/// - Tracks from 0 to current_index (inclusive) remain in their original positions (already played)
/// - Tracks after current_index are shuffled
/// - The current track stays at current_index
fn generate_shuffle_indices(total: usize, current_index: usize, seed: u64) -> Vec<usize> {
    if total == 0 {
        return vec![];
    }

    let mut indices: Vec<usize> = (0..total).collect();

    // If current_index is at or beyond the end, nothing to shuffle
    if current_index >= total.saturating_sub(1) {
        return indices;
    }

    // Only shuffle the portion after current_index
    let upcoming_start = current_index + 1;
    let mut rng = StdRng::seed_from_u64(seed);

    // Shuffle only the upcoming portion
    indices[upcoming_start..].shuffle(&mut rng);

    indices
}

/// Build a window of songs around a position
async fn build_queue_window(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    all_entries: &[crate::db::models::QueueEntryWithSong],
    center_position: usize,
    radius: usize,
    is_shuffled: bool,
    shuffle_indices_json: Option<&str>,
) -> Result<QueueWindow> {
    let total = all_entries.len();
    if total == 0 {
        return Ok(QueueWindow {
            offset: 0,
            songs: vec![],
        });
    }

    let start = center_position.saturating_sub(radius);
    let end = (center_position + radius + 1).min(total);

    build_queue_window_range(
        pool,
        user_id,
        all_entries,
        start,
        end - start,
        is_shuffled,
        shuffle_indices_json,
    )
    .await
}

/// Build a window of songs for a range
async fn build_queue_window_range(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    all_entries: &[crate::db::models::QueueEntryWithSong],
    offset: usize,
    limit: usize,
    is_shuffled: bool,
    shuffle_indices_json: Option<&str>,
) -> Result<QueueWindow> {
    let total = all_entries.len();
    if total == 0 {
        return Ok(QueueWindow {
            offset,
            songs: vec![],
        });
    }

    let shuffle_indices: Vec<usize> = if is_shuffled {
        shuffle_indices_json
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_else(|| (0..total).collect())
    } else {
        (0..total).collect()
    };

    let end = (offset + limit).min(total);

    // Collect song IDs in the window for starred/rating lookup
    let window_song_ids: Vec<String> = (offset..end)
        .filter_map(|i| shuffle_indices.get(i))
        .filter_map(|&orig_idx| all_entries.get(orig_idx))
        .map(|e| e.id.clone())
        .collect();

    let starred_map = get_starred_map(pool, user_id, "song", &window_song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, "song", &window_song_ids).await?;

    let songs: Vec<QueueSongEntry> = (offset..end)
        .filter_map(|display_pos| {
            let orig_idx = *shuffle_indices.get(display_pos)?;
            let entry = all_entries.get(orig_idx)?;
            let starred = starred_map.get(&entry.id).cloned();
            let user_rating = ratings_map.get(&entry.id).copied();
            // Convert QueueEntryWithSong to Song for song_to_response
            let song = crate::db::models::Song {
                id: entry.id.clone(),
                title: entry.title.clone(),
                album_id: entry.album_id.clone(),
                album_name: entry.album_name.clone(),
                artist_id: entry.artist_id.clone(),
                artist_name: entry.artist_name.clone(),
                track_number: entry.track_number,
                disc_number: entry.disc_number,
                year: entry.year,
                genre: entry.genre.clone(),
                duration: entry.duration,
                bitrate: entry.bitrate,
                file_path: entry.file_path.clone(),
                file_size: entry.file_size,
                file_format: entry.file_format.clone(),
                created_at: entry.created_at,
                updated_at: entry.updated_at,
                play_count: entry.play_count,
                last_played: entry.last_played,
                starred_at: entry.starred_at,
            };
            let song_response = song_to_response(song, None, starred, user_rating);
            Some(QueueSongEntry {
                entry_id: entry.entry_id.clone(),
                position: display_pos,
                song: song_response,
            })
        })
        .collect();

    Ok(QueueWindow { offset, songs })
}
