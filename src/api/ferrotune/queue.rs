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

use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::SongResponse;
use crate::api::common::search::{search_songs_for_queue, SearchParams};
use crate::api::common::sorting;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::ferrotune::smart_playlists::get_smart_playlist_songs_by_id;
use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::subsonic::inline_thumbnails::{get_song_thumbnails_base64, InlineImagesParam};
use crate::api::AppState;
use crate::db::models::{ItemType, QueueSourceType, RepeatMode};
use crate::db::queries;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult, Result};
use axum::{
    extract::{Path, Query, State},
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
    /// ID of the song the client intends to play (for verification against index)
    /// If the song at start_index doesn't match this ID, the server will find the
    /// correct index for this song in the materialized queue. This handles cases
    /// where songs are duplicated (e.g., in playlists) or the list changed.
    pub start_song_id: Option<String>,
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
    /// Whether to include inline cover art thumbnails (small or medium)
    pub inline_images: Option<String>,
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
    #[ts(type = "number")]
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
    /// Filters applied when the queue was created (JSON object)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "Record<string, unknown> | null")]
    pub filters: Option<serde_json::Value>,
    /// Sort configuration applied when the queue was created (JSON object with field/direction)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "{ field: string; direction: string } | null")]
    pub sort: Option<serde_json::Value>,
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
    /// Size of inline thumbnails: "small", "medium", or empty (no inline images)
    #[serde(default, flatten)]
    pub inline_images: InlineImagesParam,
}

/// Query parameters for current window fetch
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWindowParams {
    /// Number of songs to fetch before and after current position
    #[serde(default)]
    pub radius: Option<usize>,
    /// Size of inline thumbnails: "small", "medium", or empty (no inline images)
    #[serde(default, flatten)]
    pub inline_images: InlineImagesParam,
}

/// Request to add songs to the queue
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    /// Song IDs to add (either this OR sourceType+sourceId)
    #[serde(default)]
    pub song_ids: Vec<String>,
    /// Position: "next" (after current), "end", or a number
    pub position: AddPosition,
    /// Source type for server-side materialization (e.g., "directory")
    pub source_type: Option<String>,
    /// Source ID for materialization (e.g., directory ID)
    pub source_id: Option<String>,
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
    /// Number of songs added (only for add operations)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_count: Option<usize>,
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
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<StartQueueRequest>,
) -> FerrotuneApiResult<Json<StartQueueResponse>> {
    let source_type = QueueSourceType::from_str(&request.source_type);

    // For playlists with missing entries, we need to track position mappings
    // to correctly translate the client's start_index (based on full playlist positions)
    // to the actual index in the materialized songs array
    let mut position_to_index_map: Option<std::collections::HashMap<i64, usize>> = None;

    // Get songs either from explicit IDs or by materializing from source
    let songs = if let Some(ref song_ids) = request.song_ids {
        // Use explicit song IDs provided by client
        if song_ids.is_empty() {
            return Err(FerrotuneApiError(Error::NotFound(
                "No songs provided".to_string(),
            )));
        }
        queries::get_songs_by_ids(&state.pool, song_ids).await?
    } else if source_type == QueueSourceType::Playlist {
        // For playlists, use the position-aware function to handle missing entries
        let playlist_id = request
            .source_id
            .as_deref()
            .ok_or_else(|| Error::InvalidRequest("Playlist ID required".to_string()))?;
        let songs_with_positions =
            queries::get_playlist_songs_with_positions(&state.pool, playlist_id).await?;

        // Check if custom sorting is requested
        let has_custom_sort = request
            .sort
            .as_ref()
            .and_then(|s| s.get("field"))
            .and_then(|v| v.as_str())
            .is_some();

        // Build position-to-index mapping for start_index translation
        // Only useful when using playlist's natural order (no custom sort)
        if !has_custom_sort {
            let mut mapping = std::collections::HashMap::new();
            for (idx, (position, _)) in songs_with_positions.iter().enumerate() {
                mapping.insert(*position, idx);
            }
            position_to_index_map = Some(mapping);
        }

        // Extract just the songs, apply sorting if needed
        let songs: Vec<_> = songs_with_positions
            .into_iter()
            .map(|(_, song)| song)
            .collect();
        sorting::sort_songs(
            songs,
            request
                .sort
                .as_ref()
                .and_then(|s| s.get("field"))
                .and_then(|v| v.as_str()),
            request
                .sort
                .as_ref()
                .and_then(|s| s.get("direction"))
                .and_then(|v| v.as_str()),
        )
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

    // Filter out disabled songs UNLESS:
    // 1. The user provided explicit song IDs with only 1 song (direct playback)
    // 2. The start_song_id matches a disabled song (playing a specific disabled track)
    let should_filter_disabled = {
        // Direct single-song playback should NOT filter
        let is_direct_single_playback = request
            .song_ids
            .as_ref()
            .map(|ids| ids.len() == 1)
            .unwrap_or(false);

        !is_direct_single_playback
    };

    let songs = if should_filter_disabled {
        // Get disabled song IDs for this user
        let disabled_ids = get_disabled_song_ids(&state.pool, user.user_id).await?;

        if disabled_ids.is_empty() {
            songs
        } else {
            // Filter out disabled songs, but keep the start_song if it was explicitly requested
            let keep_song_id = request.start_song_id.as_ref();
            songs
                .into_iter()
                .filter(|s| !disabled_ids.contains(&s.id) || Some(&s.id) == keep_song_id)
                .collect()
        }
    } else {
        songs
    };

    if songs.is_empty() {
        return Err(FerrotuneApiError(Error::NotFound(
            "No songs found for this source".to_string(),
        )));
    }

    let total_count = songs.len();
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();

    // Translate start_index for playlists with missing entries
    // The client sends the position in the full playlist (including gaps),
    // but we need the index in our materialized songs array
    let mut start_index = if let Some(ref mapping) = position_to_index_map {
        // Try to find exact position match first
        if let Some(&idx) = mapping.get(&(request.start_index as i64)) {
            idx
        } else {
            // Position not found (might be a missing entry position)
            // Find the nearest valid position that's <= the requested position
            let requested_pos = request.start_index as i64;
            mapping
                .iter()
                .filter(|(&pos, _)| pos <= requested_pos)
                .max_by_key(|(&pos, _)| pos)
                .map(|(_, &idx)| idx)
                .unwrap_or(0)
        }
    } else {
        request.start_index.min(total_count.saturating_sub(1))
    };

    // Verify start_song_id matches the song at start_index
    // If not, find the correct index for the intended song
    // This handles cases where:
    // - Songs were deleted/changed between client view and server materialization
    // - Duplicates exist in playlists and client clicked on a different instance
    if let Some(ref intended_song_id) = request.start_song_id {
        let song_at_index = song_ids.get(start_index);
        if song_at_index != Some(intended_song_id) {
            // Song at index doesn't match - find the correct index
            if let Some(correct_index) = song_ids.iter().position(|id| id == intended_song_id) {
                start_index = correct_index;
            }
            // If the song isn't found at all, keep the original start_index
            // (the song may have been deleted)
        }
    }

    // Handle shuffle - when starting shuffled playback without a specific song selected,
    // pick a random starting position for a true shuffle experience
    let (is_shuffled, shuffle_seed, shuffle_indices, current_index) = if request.shuffle {
        let seed = rand::random::<u64>() as i64;

        // If no specific song was requested (start_song_id is None) and start_index is 0,
        // the user pressed "Shuffle" to start from a random position
        let effective_start =
            if request.start_song_id.is_none() && start_index == 0 && total_count > 0 {
                use rand::Rng;
                rand::thread_rng().gen_range(0..total_count)
            } else {
                start_index
            };

        let indices = generate_shuffle_indices(total_count, effective_start, seed as u64);
        let indices_json = serde_json::to_string(&indices).unwrap_or_default();
        // Start playback at effective_start position
        (true, Some(seed), Some(indices_json), effective_start as i64)
    } else {
        (false, None, None, start_index as i64)
    };

    let repeat_mode = request.repeat_mode.as_deref().unwrap_or("off");
    let filters_json = request.filters.as_ref().map(|f| f.to_string());
    let sort_json = request.sort.as_ref().map(|s| s.to_string());

    // Parse inline_images option
    let inline_size = match request.inline_images.as_deref() {
        Some("small") => Some(crate::thumbnails::ThumbnailSize::Small),
        Some("medium") => Some(crate::thumbnails::ThumbnailSize::Medium),
        _ => None,
    };

    // Determine if we should use lazy mode
    // Use lazy mode for large queues (>1000 songs) from reconstructable sources
    // that aren't shuffled (shuffled queues need shuffle indices stored)
    let use_lazy = !is_shuffled
        && total_count > 1000
        && request.song_ids.is_none() // Not explicit song IDs
        && matches!(
            source_type,
            QueueSourceType::Library
                | QueueSourceType::Search
                | QueueSourceType::Genre
                | QueueSourceType::Favorites
                | QueueSourceType::Directory
                | QueueSourceType::DirectoryFlat
        );

    let window = if use_lazy {
        // Lazy queue: store parameters, not song IDs
        queries::create_lazy_queue(
            &state.pool,
            user.user_id,
            source_type.as_str(),
            request.source_id.as_deref(),
            request.source_name.as_deref(),
            total_count as i64,
            current_index,
            is_shuffled,
            shuffle_seed,
            shuffle_indices.as_deref(),
            repeat_mode,
            filters_json.as_deref(),
            sort_json.as_deref(),
            None, // No explicit song IDs
            "ferrotune",
        )
        .await?;

        // Build initial window from the materialized songs we already have
        let window_start = (current_index as usize).saturating_sub(20);
        let window_end = (current_index as usize + 21).min(total_count);
        let window_songs: Vec<_> = songs[window_start..window_end].to_vec();

        build_lazy_queue_window(
            &state.pool,
            user.user_id,
            &window_songs,
            window_start,
            inline_size,
        )
        .await?
    } else {
        // Regular queue: store all song IDs
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
            "ferrotune",
        )
        .await?;

        // Fetch entries with entry_ids from database
        let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;

        // Build initial window (±20 songs around current position)
        build_queue_window(
            &state.pool,
            user.user_id,
            &all_entries,
            current_index as usize,
            20,
            is_shuffled,
            shuffle_indices.as_deref(),
            inline_size,
        )
        .await?
    };

    Ok(Json(StartQueueResponse {
        total_count,
        current_index: current_index as usize,
        is_shuffled,
        repeat_mode: repeat_mode.to_string(),
        window,
    }))
}

/// GET /ferrotune/queue - Get the current queue with pagination
pub async fn get_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<QueuePaginationParams>,
) -> FerrotuneApiResult<Json<GetQueueResponse>> {
    let queue = match queries::get_play_queue(&state.pool, user.user_id).await? {
        Some(q) => q,
        None => {
            // Return empty queue response instead of 404
            return Ok(Json(GetQueueResponse {
                total_count: 0,
                current_index: 0,
                position_ms: 0,
                is_shuffled: false,
                repeat_mode: "off".to_string(),
                source: QueueSourceInfo {
                    source_type: "other".to_string(),
                    id: None,
                    name: None,
                    filters: None,
                    sort: None,
                },
                window: QueueWindow {
                    offset: 0,
                    songs: vec![],
                },
            }));
        }
    };

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);
    let inline_size = params.inline_images.get_size();

    // Handle lazy queues differently
    let (total_count, window) = if queue.is_lazy {
        // Get total count from queue or compute it
        let total = get_lazy_queue_count(&state.pool, &queue, user.user_id).await?;

        // Materialize just the page we need
        let page_songs =
            materialize_lazy_queue_page(&state.pool, &queue, user.user_id, offset, limit).await?;

        // Build window from the page
        let window =
            build_lazy_queue_window(&state.pool, user.user_id, &page_songs, offset, inline_size)
                .await?;

        (total, window)
    } else {
        // Original behavior: get all entries from database
        let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;
        let total = all_entries.len();

        let window = build_queue_window_range(
            &state.pool,
            user.user_id,
            &all_entries,
            offset,
            limit,
            queue.is_shuffled,
            queue.shuffle_indices_json.as_deref(),
            inline_size,
        )
        .await?;

        (total, window)
    };

    Ok(Json(GetQueueResponse {
        total_count,
        current_index: queue.current_index as usize,
        position_ms: queue.position_ms,
        is_shuffled: queue.is_shuffled,
        repeat_mode: queue.repeat_mode.clone(),
        source: QueueSourceInfo {
            source_type: queue.source_type.clone(),
            id: queue.source_id.clone(),
            name: queue.source_name.clone(),
            filters: queue
                .filters_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
            sort: queue
                .sort_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
        },
        window,
    }))
}

/// GET /ferrotune/queue/current-window - Get songs around current position
pub async fn get_current_window(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CurrentWindowParams>,
) -> FerrotuneApiResult<Json<GetQueueResponse>> {
    let queue = match queries::get_play_queue(&state.pool, user.user_id).await? {
        Some(q) => q,
        None => {
            // Return empty queue response instead of 404
            return Ok(Json(GetQueueResponse {
                total_count: 0,
                current_index: 0,
                position_ms: 0,
                is_shuffled: false,
                repeat_mode: "off".to_string(),
                source: QueueSourceInfo {
                    source_type: "other".to_string(),
                    id: None,
                    name: None,
                    filters: None,
                    sort: None,
                },
                window: QueueWindow {
                    offset: 0,
                    songs: vec![],
                },
            }));
        }
    };

    let radius = params.radius.unwrap_or(20);
    let inline_size = params.inline_images.get_size();
    let current_index = queue.current_index as usize;

    // Handle lazy queues differently
    let (total_count, window) = if queue.is_lazy {
        // Get total count from queue
        let total = get_lazy_queue_count(&state.pool, &queue, user.user_id).await?;

        // Calculate window range
        let start = current_index.saturating_sub(radius);
        let end = (current_index + radius + 1).min(total);
        let limit = end - start;

        // Materialize just the window we need
        let page_songs =
            materialize_lazy_queue_page(&state.pool, &queue, user.user_id, start, limit).await?;

        // Build window from the page
        let window =
            build_lazy_queue_window(&state.pool, user.user_id, &page_songs, start, inline_size)
                .await?;

        (total, window)
    } else {
        // Original behavior: get all entries from database
        let all_entries = queries::get_queue_entries_with_songs(&state.pool, user.user_id).await?;
        let total = all_entries.len();

        let window = build_queue_window(
            &state.pool,
            user.user_id,
            &all_entries,
            current_index,
            radius,
            queue.is_shuffled,
            queue.shuffle_indices_json.as_deref(),
            inline_size,
        )
        .await?;

        (total, window)
    };

    Ok(Json(GetQueueResponse {
        total_count,
        current_index,
        position_ms: queue.position_ms,
        is_shuffled: queue.is_shuffled,
        repeat_mode: queue.repeat_mode.clone(),
        source: QueueSourceInfo {
            source_type: queue.source_type.clone(),
            id: queue.source_id.clone(),
            name: queue.source_name.clone(),
            filters: queue
                .filters_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
            sort: queue
                .sort_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
        },
        window,
    }))
}

/// POST /ferrotune/queue/add - Add songs to the queue
pub async fn add_to_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<AddToQueueRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
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

    // Get song IDs either from explicit list or from source materialization
    let song_ids: Vec<String> = if !request.song_ids.is_empty() {
        request.song_ids
    } else if let (Some(source_type_str), Some(source_id)) =
        (&request.source_type, &request.source_id)
    {
        // Materialize songs from source
        let source_type = QueueSourceType::from_str(source_type_str);
        let songs = materialize_queue_songs(
            &state.pool,
            user.user_id,
            source_type,
            Some(source_id),
            None,
            None,
        )
        .await?;
        songs.into_iter().map(|s| s.id).collect()
    } else {
        return Err(FerrotuneApiError(Error::InvalidRequest(
            "Either songIds or sourceType+sourceId required".to_string(),
        )));
    };

    if song_ids.is_empty() {
        return Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: None,
            total_count: Some(current_len as usize),
            added_count: Some(0),
        }));
    }

    let new_len = queries::add_to_queue(&state.pool, user.user_id, &song_ids, position).await?;

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
        for (i, _) in song_ids.iter().enumerate() {
            new_indices.insert(insert_pos + i, start_original_pos + i);
        }

        // Adjust existing indices that point to positions >= insert position
        for idx in new_indices.iter_mut() {
            if *idx >= start_original_pos && *idx < start_original_pos + song_ids.len() {
                // This is one of the new songs, skip
                continue;
            }
            if *idx >= start_original_pos {
                *idx += song_ids.len();
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

    let added_count = song_ids.len();

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: None,
        total_count: Some(new_len as usize),
        added_count: Some(added_count),
    }))
}

/// DELETE /ferrotune/queue/{position} - Remove a song from the queue
pub async fn remove_from_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(position): Path<usize>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    // In shuffled mode, position is the shuffled position - need to get original position
    let original_position = if queue.is_shuffled {
        let indices = queue.shuffle_indices().unwrap_or_default();
        if position >= indices.len() {
            return Err(FerrotuneApiError(Error::InvalidRequest(
                "Position out of range".to_string(),
            )));
        }
        indices[position]
    } else {
        position
    };

    let removed =
        queries::remove_from_queue(&state.pool, user.user_id, original_position as i64).await?;

    if !removed {
        return Err(FerrotuneApiError(Error::NotFound(
            "Position not found in queue".to_string(),
        )));
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

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_current_index as usize),
        total_count: Some(new_len as usize),
        added_count: None,
    }))
}

/// POST /ferrotune/queue/move - Move a song to a new position
pub async fn move_in_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<MoveInQueueRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    if queue.is_shuffled {
        // In shuffled mode, we modify the shuffle indices rather than the original queue
        let mut indices = queue.shuffle_indices().unwrap_or_default();

        if request.from_position >= indices.len() || request.to_position >= indices.len() {
            return Err(FerrotuneApiError(Error::InvalidRequest(
                "Position out of range".to_string(),
            )));
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

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(new_current as usize),
            total_count: None,
            added_count: None,
        }))
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
            return Err(FerrotuneApiError(Error::NotFound(
                "Position not found in queue".to_string(),
            )));
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

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(new_current),
            total_count: None,
            added_count: None,
        }))
    }
}

/// POST /ferrotune/queue/shuffle - Toggle shuffle mode
pub async fn toggle_shuffle(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ShuffleRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let total_count = get_queue_total_count(&state.pool, &queue, user.user_id).await?;
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

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(current_index),
            total_count: None,
            added_count: None,
        }))
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

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(current_index),
            total_count: None,
            added_count: None,
        }))
    }
}

/// POST /ferrotune/queue/position - Update current position
pub async fn update_position(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdatePositionRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let queue = queries::get_play_queue(&state.pool, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let total_count = get_queue_total_count(&state.pool, &queue, user.user_id).await?;

    if request.current_index >= total_count {
        return Err(FerrotuneApiError(Error::InvalidRequest(
            "Position out of range".to_string(),
        )));
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

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(request.current_index),
        total_count: None,
        added_count: None,
    }))
}

/// POST /ferrotune/queue/repeat - Update repeat mode
pub async fn update_repeat_mode(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RepeatModeRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    // Validate repeat mode
    let mode = RepeatMode::from_str(&request.mode);

    queries::update_queue_repeat_mode(&state.pool, user.user_id, mode.as_str()).await?;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: None,
        total_count: None,
        added_count: None,
    }))
}

/// DELETE /ferrotune/queue - Clear the entire queue
pub async fn clear_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    queries::clear_queue(&state.pool, user.user_id).await?;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: None,
        total_count: Some(0),
        added_count: None,
    }))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get all disabled song IDs for a user
async fn get_disabled_song_ids(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<std::collections::HashSet<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT song_id FROM disabled_songs WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(pool)
            .await?;

    Ok(rows.into_iter().map(|(id,)| id).collect())
}

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

    // Extract text filter from filters JSON (used by artist/album/genre/playlist pages)
    let text_filter = filters
        .and_then(|f| f.get("filter"))
        .and_then(|v| v.as_str());

    match source_type {
        QueueSourceType::Album => {
            let album_id =
                source_id.ok_or_else(|| Error::InvalidRequest("Album ID required".to_string()))?;
            let songs = queries::get_songs_by_album(pool, album_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Artist => {
            let artist_id =
                source_id.ok_or_else(|| Error::InvalidRequest("Artist ID required".to_string()))?;
            let songs = queries::get_songs_by_artist(pool, artist_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Playlist => {
            let playlist_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Playlist ID required".to_string()))?;
            let songs = queries::get_playlist_songs(pool, playlist_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::SmartPlaylist => {
            let playlist_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Smart playlist ID required".to_string()))?;
            // Smart playlists have their own sorting/filtering built into the rules,
            // but we allow the client to override sort when playing
            get_smart_playlist_songs_by_id(
                pool,
                playlist_id,
                user_id,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::Genre => {
            // Genre uses search_songs_for_queue with genre filter for consistency with search3 API
            let genre =
                source_id.ok_or_else(|| Error::InvalidRequest("Genre required".to_string()))?;

            // Build search params with genre filter
            let mut search_params = build_search_params_from_json(filters, sort);
            search_params.genre = Some(genre.to_string());

            // Use text filter as FTS query, or wildcard for all songs in genre
            let query = text_filter.unwrap_or("*");

            Ok(search_songs_for_queue(pool, user_id, query, &search_params).await?)
        }
        QueueSourceType::Favorites => {
            let songs = queries::get_starred_songs(pool, user_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::Library | QueueSourceType::Search => {
            // For library/search, use the search function with filters and sort
            // The query can come from either source_id or filters.query
            // (client uses filters.query for search results, source_id for library filtering)
            let query_from_filters = filters
                .and_then(|f| f.get("query"))
                .and_then(|v| v.as_str());
            let query = query_from_filters.or(source_id).unwrap_or("*");

            // Parse filters and sort from JSON into SearchParams
            let search_params = build_search_params_from_json(filters, sort);

            Ok(search_songs_for_queue(pool, user_id, query, &search_params).await?)
        }
        QueueSourceType::Directory => {
            let dir_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            let songs = queries::get_songs_by_directory(pool, dir_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::DirectoryFlat => {
            // Non-recursive directory - only files in the current folder, not subfolders
            let dir_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            let songs = queries::get_songs_by_directory_flat(pool, dir_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
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
        disabled_only: None,
        min_bitrate: None,
        max_bitrate: None,
        added_after: None,
        added_before: None,
        inline_images: None, // Not used for queue materialization
        missing_cover_art: None,
        file_format: None,
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
            if let Some(v) = obj.get("disabledOnly").and_then(|v| v.as_bool()) {
                params.disabled_only = Some(v);
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
            if let Some(v) = obj.get("missingCoverArt").and_then(|v| v.as_bool()) {
                params.missing_cover_art = Some(v);
            }
            if let Some(v) = obj.get("fileFormat").and_then(|v| v.as_str()) {
                params.file_format = Some(v.to_string());
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

/// Materialize a page of songs from a lazy queue
/// This re-runs the materialization query with pagination
pub async fn materialize_lazy_queue_page(
    pool: &sqlx::SqlitePool,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
    offset: usize,
    limit: usize,
) -> Result<Vec<crate::db::models::Song>> {
    // If we have explicit song IDs, use those
    if let Some(ref song_ids) = queue.parse_song_ids() {
        // Get the slice we need
        let page_ids: Vec<&str> = song_ids
            .iter()
            .skip(offset)
            .take(limit)
            .map(|s| s.as_str())
            .collect();

        if page_ids.is_empty() {
            return Ok(vec![]);
        }

        // Fetch songs by IDs - need to convert to owned strings for the query
        let page_ids_owned: Vec<String> = page_ids.iter().map(|s| s.to_string()).collect();
        return Ok(queries::get_songs_by_ids(pool, &page_ids_owned).await?);
    }

    // Parse the source parameters
    let source_type = QueueSourceType::from_str(&queue.source_type);
    let filters: Option<serde_json::Value> = queue
        .filters_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());
    let sort: Option<serde_json::Value> = queue
        .sort_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    // For shuffled queues, we need the full list + shuffle indices
    // This is a fallback - ideally we'd use a deterministic permutation
    if queue.is_shuffled {
        // Materialize all songs and apply shuffle
        let all_songs = materialize_queue_songs(
            pool,
            user_id,
            source_type,
            queue.source_id.as_deref(),
            filters.as_ref(),
            sort.as_ref(),
        )
        .await?;

        // Apply shuffle indices if available
        if let Some(indices) = queue.shuffle_indices() {
            let shuffled: Vec<crate::db::models::Song> = indices
                .iter()
                .skip(offset)
                .take(limit)
                .filter_map(|&idx| all_songs.get(idx).cloned())
                .collect();
            return Ok(shuffled);
        }

        // No shuffle indices, return unshuffled
        return Ok(all_songs.into_iter().skip(offset).take(limit).collect());
    }

    // For non-shuffled queues, we can materialize just the page
    // However, the current materialization functions don't support pagination
    // So we materialize all and slice - this could be optimized further
    let all_songs = materialize_queue_songs(
        pool,
        user_id,
        source_type,
        queue.source_id.as_deref(),
        filters.as_ref(),
        sort.as_ref(),
    )
    .await?;

    Ok(all_songs.into_iter().skip(offset).take(limit).collect())
}

/// Get the total count for a queue (handles both lazy and non-lazy queues)
/// For lazy queues: uses cached total_count or re-materializes to count
/// For non-lazy queues: counts entries in the database
pub async fn get_queue_total_count(
    pool: &sqlx::SqlitePool,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
) -> Result<usize> {
    if queue.is_lazy {
        get_lazy_queue_count(pool, queue, user_id).await
    } else {
        Ok(queries::get_queue_length(pool, user_id).await? as usize)
    }
}

/// Get the total count for a lazy queue
/// This re-runs the count query based on source parameters
pub async fn get_lazy_queue_count(
    pool: &sqlx::SqlitePool,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
) -> Result<usize> {
    // If we have a cached total_count, use it
    if let Some(count) = queue.total_count {
        return Ok(count as usize);
    }

    // If we have explicit song IDs, count those
    if let Some(ref song_ids) = queue.parse_song_ids() {
        return Ok(song_ids.len());
    }

    // Otherwise, materialize and count
    let source_type = QueueSourceType::from_str(&queue.source_type);
    let filters: Option<serde_json::Value> = queue
        .filters_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());
    let sort: Option<serde_json::Value> = queue
        .sort_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    let songs = materialize_queue_songs(
        pool,
        user_id,
        source_type,
        queue.source_id.as_deref(),
        filters.as_ref(),
        sort.as_ref(),
    )
    .await?;

    Ok(songs.len())
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
#[allow(clippy::too_many_arguments)]
async fn build_queue_window(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    all_entries: &[crate::db::models::QueueEntryWithSong],
    center_position: usize,
    radius: usize,
    is_shuffled: bool,
    shuffle_indices_json: Option<&str>,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
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
        inline_size,
    )
    .await
}

/// Build a window of songs for a range
#[allow(clippy::too_many_arguments)]
async fn build_queue_window_range(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    all_entries: &[crate::db::models::QueueEntryWithSong],
    offset: usize,
    limit: usize,
    is_shuffled: bool,
    shuffle_indices_json: Option<&str>,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
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

    // Collect song IDs and album IDs in the window for starred/rating/thumbnail lookup
    let window_entries: Vec<(&crate::db::models::QueueEntryWithSong, usize)> = (offset..end)
        .filter_map(|display_pos| {
            let orig_idx = *shuffle_indices.get(display_pos)?;
            let entry = all_entries.get(orig_idx)?;
            Some((entry, display_pos))
        })
        .collect();

    let window_song_ids: Vec<String> = window_entries.iter().map(|(e, _)| e.id.clone()).collect();

    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &window_song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &window_song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_size {
        let song_thumbnail_data: Vec<(String, Option<String>)> = window_entries
            .iter()
            .map(|(e, _)| (e.id.clone(), e.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(pool, &song_thumbnail_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    let songs: Vec<QueueSongEntry> = window_entries
        .into_iter()
        .map(|(entry, display_pos)| {
            let starred = starred_map.get(&entry.id).cloned();
            let user_rating = ratings_map.get(&entry.id).copied();
            let cover_art_data = thumbnails.get(&entry.id).cloned();
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
                cover_art_hash: entry.cover_art_hash.clone(),
            };
            let song_response = song_to_response_with_stats(
                song,
                None,
                starred,
                user_rating,
                None,
                None,
                cover_art_data,
            );
            QueueSongEntry {
                entry_id: entry.entry_id.clone(),
                position: display_pos,
                song: song_response,
            }
        })
        .collect();

    Ok(QueueWindow { offset, songs })
}

/// Build a window of songs from a slice (for lazy queues)
async fn build_lazy_queue_window(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    songs: &[crate::db::models::Song],
    offset: usize,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
) -> Result<QueueWindow> {
    if songs.is_empty() {
        return Ok(QueueWindow {
            offset,
            songs: vec![],
        });
    }

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();

    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_size {
        let song_thumbnail_data: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|s| (s.id.clone(), s.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(pool, &song_thumbnail_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    let queue_songs: Vec<QueueSongEntry> = songs
        .iter()
        .enumerate()
        .map(|(idx, song)| {
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            let cover_art_data = thumbnails.get(&song.id).cloned();

            let song_response = song_to_response_with_stats(
                song.clone(),
                None,
                starred,
                user_rating,
                None,
                None,
                cover_art_data,
            );

            // Generate a stable entry_id for lazy queue entries
            let entry_id = format!("lazy-{}-{}", offset + idx, &song.id);

            QueueSongEntry {
                entry_id,
                position: offset + idx,
                song: song_response,
            }
        })
        .collect();

    Ok(QueueWindow {
        offset,
        songs: queue_songs,
    })
}
