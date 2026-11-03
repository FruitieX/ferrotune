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

use crate::api::auth::FerrotuneAuthenticatedUser;
use crate::api::common::browse::song_to_response_with_stats;
use crate::api::common::models::SongResponse;
use crate::api::common::search::{search_songs_for_queue, SearchParams};
use crate::api::common::sorting;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::inline_thumbnails::{get_song_thumbnails_base64, InlineImagesParam};
use crate::api::smart_playlists::get_smart_playlist_songs_by_id;
use crate::api::{AppState, SessionEvent};
use crate::db::models::{
    ItemType, PlayQueue, PlayQueueUpNext, QueueEntryWithSong, QueueSourceType, RepeatMode, Song,
};
use crate::db::queries;
use crate::db::repo;
use crate::error::{Error, FerrotuneApiError, FerrotuneApiResult};
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
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StartQueueRequest {
    /// Playback session ID (required for multi-session support)
    pub session_id: Option<String>,
    /// Type of source (library, album, artist, playlist, genre, favorites, etc.)
    pub source_type: String,
    /// ID of the source (album ID, artist ID, playlist ID, genre name, etc.)
    pub source_id: Option<String>,
    /// Display name of the source
    pub source_name: Option<String>,
    /// Index of the song to start playing (0-based, in the original order)
    #[serde(default)]
    #[ts(type = "number")]
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
    #[ts(type = "Record<string, unknown> | null")]
    pub filters: Option<serde_json::Value>,
    /// Optional sort criteria (JSON object)
    #[ts(type = "Record<string, unknown> | null")]
    pub sort: Option<serde_json::Value>,
    /// Optional explicit song IDs (for search results, history, or custom queues)
    /// When provided, these songs are used instead of materializing from source_type
    pub song_ids: Option<Vec<String>>,
    /// Multiple sources to concatenate. The first occurrence of each song wins.
    #[serde(default)]
    pub sources: Vec<QueueSourceRequest>,
    /// Whether to include inline cover art thumbnails (small or medium)
    pub inline_images: Option<String>,
    /// Client ID of the requesting client (used for auto-claiming ownership)
    pub client_id: Option<String>,
    /// Client name of the requesting client (used for auto-claiming ownership)
    pub client_name: Option<String>,
    /// When true, the server broadcasts QueueUpdated instead of QueueChanged,
    /// so other clients update their queue UI without restarting playback.
    /// Used when the queue is swapped but the current song should keep playing
    /// (e.g., starting song radio for the currently playing song).
    #[serde(default)]
    pub keep_playing: bool,
}

/// A queue source used by batch collection actions.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct QueueSourceRequest {
    pub source_type: String,
    pub source_id: Option<String>,
    /// Filters to apply when materializing this source, like a queue start's
    /// `filters` (e.g. a view's text filter).
    #[serde(default)]
    #[ts(optional, type = "Record<string, unknown>")]
    pub filters: Option<serde_json::Value>,
    /// Sort to apply when materializing this source.
    #[serde(default)]
    #[ts(optional, type = "Record<string, unknown>")]
    pub sort: Option<serde_json::Value>,
}

/// Response after starting a queue
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StartQueueResponse {
    /// Total number of songs in the queue (context + up next)
    pub total_count: usize,
    /// Current index in the queue (display order, shuffle-aware)
    pub current_index: usize,
    /// Number of upcoming "up next" songs
    pub up_next_count: usize,
    /// Whether shuffle is enabled
    pub is_shuffled: bool,
    /// Repeat mode
    pub repeat_mode: String,
    /// Queue source information
    pub source: QueueSourceInfo,
    /// Initial window of songs around the current position
    pub window: QueueWindow,
    /// Whether the playback context is lazily materialized. Cross-section
    /// reorders need real context rows and are disabled for lazy queues.
    pub is_lazy: bool,
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
    /// Original playlist entry_id when queue was materialized from a playlist
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_entry_id: Option<String>,
    /// Position in the queue (display order, accounts for shuffle)
    pub position: usize,
    /// Where this entry came from: `context` (the playlist/album/library the
    /// queue was started from) or `upNext` (explicitly queued by the user).
    pub origin: String,
    /// The song data
    #[ts(type = "import('../types').Song")]
    pub song: SongResponse,
}

/// Response for getting the queue state
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GetQueueResponse {
    /// Total number of songs in the queue (context + up next)
    pub total_count: usize,
    /// Number of upcoming "up next" songs
    pub up_next_count: usize,
    /// Current index in the queue (display order, shuffle-aware)
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
    /// Optimistic concurrency version — incremented on each queue mutation.
    /// Used by native clients to skip redundant invalidations when both SSE
    /// and explicit invalidation arrive for the same version.
    #[ts(type = "number")]
    pub version: i64,
    /// Whether the playback context is lazily materialized. Cross-section
    /// reorders need real context rows and are disabled for lazy queues.
    pub is_lazy: bool,
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
    /// Unique identifier for this queue instance (UUID, generated on each queue start)
    pub instance_id: String,
}

impl QueueSourceInfo {
    fn from_queue(queue: &PlayQueue) -> Self {
        Self {
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
            instance_id: queue.instance_id.clone().unwrap_or_default(),
        }
    }

    fn empty() -> Self {
        Self {
            source_type: "other".to_string(),
            id: None,
            name: None,
            filters: None,
            sort: None,
            instance_id: String::new(),
        }
    }
}

/// Query parameters for paginated queue fetch
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePaginationParams {
    /// Playback session ID
    pub session_id: Option<String>,
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
    /// Playback session ID
    pub session_id: Option<String>,
    /// Number of songs to fetch before and after current position
    #[serde(default)]
    pub radius: Option<usize>,
    /// Size of inline thumbnails: "small", "medium", or empty (no inline images)
    #[serde(default, flatten)]
    pub inline_images: InlineImagesParam,
}

/// Request to add songs to the queue
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AddToQueueRequest {
    /// Playback session ID
    pub session_id: Option<String>,
    /// Song IDs to add (either this OR sourceType+sourceId)
    #[serde(default)]
    pub song_ids: Vec<String>,
    /// Position in display order: "next" (after current), "end", or a number
    #[ts(type = "\"next\" | \"end\" | number")]
    pub position: AddPosition,
    /// Legacy client-provided current index. Kept for wire compatibility;
    /// up-next insertion no longer needs it.
    #[allow(dead_code)]
    pub current_index: Option<usize>,
    /// Source type for server-side materialization (e.g., "directory")
    pub source_type: Option<String>,
    /// Source ID for materialization (e.g., directory ID)
    pub source_id: Option<String>,
    /// Multiple sources to concatenate. The first occurrence of each song wins.
    #[serde(default)]
    pub sources: Vec<QueueSourceRequest>,
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
    /// Playback session ID
    pub session_id: Option<String>,
    /// Position to move from
    pub from_position: usize,
    /// Position to move to
    pub to_position: usize,
}

/// Request to toggle shuffle
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShuffleRequest {
    /// Playback session ID
    pub session_id: Option<String>,
    /// Whether to enable shuffle
    pub enabled: bool,
}

/// Request to update current position
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePositionRequest {
    /// Playback session ID
    pub session_id: Option<String>,
    /// Client ID of the audio owner applying this position update
    pub client_id: Option<String>,
    /// New current index
    pub current_index: usize,
    /// Playback position in milliseconds
    #[serde(default)]
    pub position_ms: i64,
    /// When true, generate new shuffle indices (used for repeat-all wrap-around)
    #[serde(default)]
    pub reshuffle: bool,
}

/// Request to update repeat mode
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatModeRequest {
    /// Playback session ID
    pub session_id: Option<String>,
    /// Repeat mode (off, all, one)
    pub mode: String,
}

/// Generic success response
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
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
    /// Number of upcoming "up next" songs after the operation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub up_next_count: Option<usize>,
}

/// Query parameters for endpoints that need session_id but don't have a request body
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionParams {
    pub session_id: Option<String>,
}

// ============================================================================
// Session-ID requirement helper
// ============================================================================

/// Maximum number of songs allowed in a single queue.
const MAX_QUEUE_SIZE: usize = 50_000;

/// All queue endpoints require a session_id.
/// Returns 400 Bad Request if missing.
fn require_session_id(session_id: Option<&str>) -> FerrotuneApiResult<&str> {
    Ok(session_id.ok_or_else(|| Error::InvalidRequest("session_id is required".to_string()))?)
}

fn resolve_original_queue_position(
    queue: &PlayQueue,
    display_position: usize,
) -> FerrotuneApiResult<usize> {
    if !queue.is_shuffled {
        return Ok(display_position);
    }

    let indices = queue.shuffle_indices().unwrap_or_default();
    indices.get(display_position).copied().ok_or_else(|| {
        FerrotuneApiError(Error::InvalidRequest("Position out of range".to_string()))
    })
}

fn shifted_current_index_after_remove(
    current_display_index: usize,
    removed_display_position: usize,
    new_len: usize,
) -> usize {
    if new_len == 0 {
        return 0;
    }

    if removed_display_position < current_display_index {
        current_display_index - 1
    } else {
        current_display_index.min(new_len - 1)
    }
}

// ============================================================================
// Up-next queue layout
// ============================================================================

/// Cap on the explicitly queued "up next" list. It is separate from the
/// playback context, so it can stay small while the context is huge.
const MAX_UP_NEXT_SIZE: usize = 10_000;

/// One item in the merged playback view (context + up-next).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QueueDisplayItem {
    /// A track from the playback context at this context index.
    Context(usize),
    /// An up-next row that already played, anchored under this context index.
    Anchored { anchor: usize, index: usize },
    /// An up-next row that is still upcoming.
    Upcoming { index: usize },
}

/// The up-next list, indexed for display-position math.
///
/// Display order is:
/// `C0, anchored(0), C1, anchored(1), ..., C[current], anchored(current),
///  upcoming, C[current + 1], ...`
///
/// Upcoming rows always follow the current track, so they never need to know
/// which context position they were queued from. When one starts playing it
/// is anchored to the current context index and becomes history.
#[derive(Debug, Default, Clone)]
struct UpNextLayout {
    rows: Vec<PlayQueueUpNext>,
    anchored: std::collections::BTreeMap<usize, Vec<usize>>,
    upcoming: Vec<usize>,
}

impl UpNextLayout {
    fn new(rows: Vec<PlayQueueUpNext>) -> Self {
        let mut anchored: std::collections::BTreeMap<usize, Vec<usize>> =
            std::collections::BTreeMap::new();
        let mut upcoming = Vec::new();
        for (index, row) in rows.iter().enumerate() {
            match row.anchor_context_index {
                Some(anchor) if anchor >= 0 => {
                    anchored.entry(anchor as usize).or_default().push(index);
                }
                _ => upcoming.push(index),
            }
        }
        Self {
            rows,
            anchored,
            upcoming,
        }
    }

    fn anchored_count(&self, anchor: usize) -> usize {
        self.anchored.get(&anchor).map_or(0, Vec::len)
    }

    fn anchored_before(&self, anchor: usize) -> usize {
        self.anchored
            .range(..anchor)
            .map(|(_, indices)| indices.len())
            .sum()
    }

    fn upcoming_count(&self) -> usize {
        self.upcoming.len()
    }

    fn total(&self, context_total: usize) -> usize {
        context_total + self.rows.len()
    }

    /// Number of display items before `C[context_index]`.
    fn context_prefix(&self, context_index: usize, current_index: usize) -> usize {
        context_index
            + self.anchored_before(context_index)
            + if context_index > current_index {
                self.upcoming_count()
            } else {
                0
            }
    }

    fn display_item_at(
        &self,
        display_index: usize,
        context_total: usize,
        current_index: usize,
    ) -> Option<QueueDisplayItem> {
        if context_total == 0 || display_index >= self.total(context_total) {
            return None;
        }

        // Last context index whose block starts at or before `display_index`.
        let mut lo = 0usize;
        let mut hi = context_total;
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.context_prefix(mid, current_index) <= display_index {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        let context_index = lo.saturating_sub(1);
        if context_index >= context_total {
            return None;
        }

        let local = display_index - self.context_prefix(context_index, current_index);
        if local == 0 {
            return Some(QueueDisplayItem::Context(context_index));
        }
        let anchored = self.anchored_count(context_index);
        if local <= anchored {
            return Some(QueueDisplayItem::Anchored {
                anchor: context_index,
                index: local - 1,
            });
        }
        if context_index == current_index {
            let upcoming_index = local - 1 - anchored;
            if upcoming_index < self.upcoming_count() {
                return Some(QueueDisplayItem::Upcoming {
                    index: upcoming_index,
                });
            }
        }
        None
    }

    fn current_display_index(
        &self,
        current_index: usize,
        current_manual_entry_id: Option<&str>,
    ) -> usize {
        let base = self.context_prefix(current_index, current_index);
        let Some(entry_id) = current_manual_entry_id else {
            return base;
        };
        let Some(indices) = self.anchored.get(&current_index) else {
            return base;
        };
        for (index, row_index) in indices.iter().enumerate() {
            if self.rows[*row_index].entry_id == entry_id {
                return base + 1 + index;
            }
        }
        base
    }

    fn anchored_row(&self, anchor: usize, index: usize) -> Option<&PlayQueueUpNext> {
        self.anchored
            .get(&anchor)
            .and_then(|rows| rows.get(index))
            .and_then(|row_index| self.rows.get(*row_index))
    }

    fn upcoming_row(&self, index: usize) -> Option<&PlayQueueUpNext> {
        self.upcoming
            .get(index)
            .and_then(|row_index| self.rows.get(*row_index))
    }
}

/// A context track materialized for one queue window.
struct ContextWindowItem {
    context_index: usize,
    entry_id: String,
    source_entry_id: Option<String>,
    song: Song,
}

fn song_from_queue_entry(entry: &QueueEntryWithSong) -> Song {
    Song {
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
        cover_art_width: entry.cover_art_width,
        cover_art_height: entry.cover_art_height,
        original_replaygain_track_gain: entry.original_replaygain_track_gain,
        original_replaygain_track_peak: entry.original_replaygain_track_peak,
        computed_replaygain_track_gain: entry.computed_replaygain_track_gain,
        computed_replaygain_track_peak: entry.computed_replaygain_track_peak,
        play_starts: None,
        like_count: None,
        last_liked: None,
    }
}

fn context_item_from_entry(entry: QueueEntryWithSong) -> ContextWindowItem {
    let context_index = entry.queue_position.max(0) as usize;
    ContextWindowItem {
        context_index,
        entry_id: entry.entry_id.clone(),
        source_entry_id: entry.source_entry_id.clone(),
        song: song_from_queue_entry(&entry),
    }
}

/// Load context tracks for a contiguous context-index range.
#[allow(clippy::too_many_arguments)]
async fn load_context_items(
    database: &crate::db::Database,
    state: &AppState,
    user_id: i64,
    session_id: &str,
    queue: &PlayQueue,
    context_total: usize,
    start: usize,
    count: usize,
) -> FerrotuneApiResult<Vec<ContextWindowItem>> {
    let end = (start + count).min(context_total);
    if start >= end {
        return Ok(vec![]);
    }

    if queue.is_lazy {
        let page =
            materialize_lazy_queue_page(database, queue, user_id, start, end - start).await?;
        return Ok(page
            .into_iter()
            .enumerate()
            .map(|(offset, song)| {
                let context_index = start + offset;
                ContextWindowItem {
                    context_index,
                    entry_id: format!("lazy-{}-{}", context_index, song.id),
                    source_entry_id: None,
                    song,
                }
            })
            .collect());
    }

    if queue.is_shuffled {
        let indices = get_shuffle_indices(
            state,
            user_id,
            queue.shuffle_seed,
            queue.shuffle_indices_json.as_deref(),
            context_total,
        )
        .await;

        let mapping: Vec<(usize, usize)> = (start..end)
            .filter_map(|context_index| {
                indices
                    .get(context_index)
                    .map(|&original| (context_index, original))
            })
            .collect();
        let original_positions: Vec<usize> =
            mapping.iter().map(|(_, original)| *original).collect();

        let entries = queries::get_queue_entries_at_positions_by_session(
            database,
            session_id,
            &original_positions,
        )
        .await?;
        let mut by_position: std::collections::HashMap<i64, QueueEntryWithSong> = entries
            .into_iter()
            .map(|entry| (entry.queue_position, entry))
            .collect();

        let mut items = Vec::with_capacity(mapping.len());
        for (context_index, original) in mapping {
            if let Some(entry) = by_position.remove(&(original as i64)) {
                let mut item = context_item_from_entry(entry);
                item.context_index = context_index;
                items.push(item);
            }
        }
        Ok(items)
    } else {
        let entries =
            queries::get_queue_entries_range_by_session(database, session_id, start, end - start)
                .await?;
        Ok(entries.into_iter().map(context_item_from_entry).collect())
    }
}

/// Build a window of the merged context + up-next display.
#[allow(clippy::too_many_arguments)]
async fn build_queue_window(
    database: &crate::db::Database,
    state: &AppState,
    user_id: i64,
    session_id: &str,
    queue: &PlayQueue,
    layout: &UpNextLayout,
    context_total: usize,
    offset: usize,
    limit: usize,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
) -> FerrotuneApiResult<QueueWindow> {
    let total = layout.total(context_total);
    let end = (offset + limit).min(total);
    if offset >= end {
        return Ok(QueueWindow {
            offset,
            songs: vec![],
        });
    }

    let current_index = queue.current_index.max(0) as usize;
    let display_items: Vec<(usize, QueueDisplayItem)> = (offset..end)
        .filter_map(|display_index| {
            layout
                .display_item_at(display_index, context_total, current_index)
                .map(|item| (display_index, item))
        })
        .collect();

    let mut min_context = usize::MAX;
    let mut max_context = 0usize;
    for (_, item) in &display_items {
        if let QueueDisplayItem::Context(context_index) = item {
            min_context = min_context.min(*context_index);
            max_context = max_context.max(*context_index);
        }
    }

    let context_items = if min_context == usize::MAX {
        vec![]
    } else {
        load_context_items(
            database,
            state,
            user_id,
            session_id,
            queue,
            context_total,
            min_context,
            max_context - min_context + 1,
        )
        .await?
    };
    let context_by_index: std::collections::HashMap<usize, ContextWindowItem> = context_items
        .into_iter()
        .map(|item| (item.context_index, item))
        .collect();

    let manual_song_ids: Vec<String> = display_items
        .iter()
        .filter_map(|(_, item)| match item {
            QueueDisplayItem::Anchored { anchor, index } => layout
                .anchored_row(*anchor, *index)
                .map(|row| row.song_id.clone()),
            QueueDisplayItem::Upcoming { index } => {
                layout.upcoming_row(*index).map(|row| row.song_id.clone())
            }
            QueueDisplayItem::Context(_) => None,
        })
        .collect();
    let manual_songs = if manual_song_ids.is_empty() {
        vec![]
    } else {
        repo::browse::get_songs_by_ids_for_user(database, &manual_song_ids, user_id).await?
    };
    let manual_song_map: std::collections::HashMap<String, Song> = manual_songs
        .into_iter()
        .map(|song| (song.id.clone(), song))
        .collect();

    let mut items: Vec<(usize, String, Option<String>, &'static str, Song)> =
        Vec::with_capacity(display_items.len());
    for (display_index, item) in display_items {
        match item {
            QueueDisplayItem::Context(context_index) => {
                if let Some(context) = context_by_index.get(&context_index) {
                    items.push((
                        display_index,
                        context.entry_id.clone(),
                        context.source_entry_id.clone(),
                        "context",
                        context.song.clone(),
                    ));
                }
            }
            QueueDisplayItem::Anchored { anchor, index } => {
                if let Some(row) = layout.anchored_row(anchor, index) {
                    if let Some(song) = manual_song_map.get(&row.song_id) {
                        items.push((
                            display_index,
                            row.entry_id.clone(),
                            None,
                            "upNext",
                            song.clone(),
                        ));
                    }
                }
            }
            QueueDisplayItem::Upcoming { index } => {
                if let Some(row) = layout.upcoming_row(index) {
                    if let Some(song) = manual_song_map.get(&row.song_id) {
                        items.push((
                            display_index,
                            row.entry_id.clone(),
                            None,
                            "upNext",
                            song.clone(),
                        ));
                    }
                }
            }
        }
    }

    build_window_from_items(database, user_id, &items, offset, inline_size).await
}

/// Build a `QueueWindow` from display items.
async fn build_window_from_items(
    database: &crate::db::Database,
    user_id: i64,
    items: &[(usize, String, Option<String>, &'static str, Song)],
    offset: usize,
    inline_size: Option<crate::thumbnails::ThumbnailSize>,
) -> FerrotuneApiResult<QueueWindow> {
    if items.is_empty() {
        return Ok(QueueWindow {
            offset,
            songs: vec![],
        });
    }

    let song_ids: Vec<String> = items
        .iter()
        .map(|(_, _, _, _, song)| song.id.clone())
        .collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;
    let likes_map =
        crate::db::repo::song_likes::song_like_map(database, user_id, &song_ids).await?;

    let thumbnails = if let Some(size) = inline_size {
        let song_thumbnail_data: Vec<(String, Option<String>)> = items
            .iter()
            .map(|(_, _, _, _, song)| (song.id.clone(), song.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_thumbnail_data, size).await
    } else {
        std::collections::HashMap::new()
    };

    let songs = items
        .iter()
        .map(|(display_index, entry_id, source_entry_id, origin, song)| {
            let song_id = song.id.clone();
            let mut owned = song.clone();
            if let Some(likes) = likes_map.get(&song_id) {
                owned.like_count = Some(likes.like_count);
                owned.last_liked = likes.last_liked;
            }
            let song_response = song_to_response_with_stats(
                owned,
                None,
                starred_map.get(&song_id).cloned(),
                ratings_map.get(&song_id).copied(),
                None,
                None,
                thumbnails.get(&song_id).cloned(),
            );
            QueueSongEntry {
                entry_id: entry_id.clone(),
                source_entry_id: source_entry_id.clone(),
                position: *display_index,
                origin: origin.to_string(),
                song: song_response,
            }
        })
        .collect();

    Ok(QueueWindow { offset, songs })
}

/// Broadcast a QueueChanged event to all SSE subscribers of a session
async fn broadcast_queue_changed(state: &AppState, session_id: &str) {
    state
        .session_manager
        .broadcast(session_id, SessionEvent::QueueChanged)
        .await;
}

/// Broadcast a queue-updated event (metadata change only, no playback restart).
async fn broadcast_queue_updated(state: &AppState, session_id: &str) {
    state
        .session_manager
        .broadcast(
            session_id,
            SessionEvent::QueueUpdated {
                source_client_id: None,
            },
        )
        .await;
}

/// Broadcast that a client moved the queue position. Naming the client lets
/// it skip refetching the queue it just moved.
async fn broadcast_position_updated(state: &AppState, session_id: &str, client_id: &str) {
    state
        .session_manager
        .broadcast(
            session_id,
            SessionEvent::QueueUpdated {
                source_client_id: Some(client_id.to_string()),
            },
        )
        .await;
}

// ============================================================================
// Endpoints
// ============================================================================

/// POST /api/queue/start - Start a new queue from a source
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
    Json(mut request): Json<StartQueueRequest>,
) -> FerrotuneApiResult<Json<StartQueueResponse>> {
    let source_type: QueueSourceType = request.source_type.parse().map_err(|_| {
        Error::InvalidRequest(format!("Invalid source type: {}", request.source_type))
    })?;

    if source_type == QueueSourceType::ForgottenFavorites
        && request.song_ids.is_none()
        && request.sources.is_empty()
    {
        crate::api::common::lists::ForgottenFavoritesSettings::for_user(
            &state.database,
            user.user_id,
        )
        .await?
        .snapshot_into(&mut request.filters);
    }

    // For playlists with missing entries, we need to track position mappings
    // to correctly translate the client's start_index (based on full playlist positions)
    // to the actual index in the materialized songs array
    let mut position_to_index_map: Option<std::collections::HashMap<i64, usize>> = None;

    // Track playlist entry_ids alongside songs for "now playing" indicator stability
    // These are kept in sync with the songs vec through all transformations
    let mut playlist_entry_ids: Option<Vec<String>> = None;

    // Get songs either from explicit IDs or by materializing from source
    let songs = if let Some(ref song_ids) = request.song_ids {
        // Use explicit song IDs provided by client
        if song_ids.is_empty() {
            return Err(FerrotuneApiError(Error::NotFound(
                "No songs provided".to_string(),
            )));
        }
        repo::browse::get_songs_by_ids_for_user(&state.database, song_ids, user.user_id).await?
    } else if !request.sources.is_empty() {
        materialize_queue_sources(&state.database, user.user_id, &request.sources).await?
    } else if source_type == QueueSourceType::Playlist {
        // For playlists, use the position-aware function to handle missing entries
        let playlist_id = request
            .source_id
            .as_deref()
            .ok_or_else(|| Error::InvalidRequest("Playlist ID required".to_string()))?;
        let songs_with_positions =
            queries::get_playlist_songs_with_positions(&state.database, playlist_id, user.user_id)
                .await?;

        // Extract text filter from filters JSON
        let text_filter = request
            .filters
            .as_ref()
            .and_then(|f| f.get("filter"))
            .and_then(|v| v.as_str());

        // Check if custom sorting or filtering is requested
        let has_custom_sort = request
            .sort
            .as_ref()
            .and_then(|s| s.get("field"))
            .and_then(|v| v.as_str())
            .is_some();
        let has_filter = text_filter.is_some();

        // Build position-to-index mapping for start_index translation
        // Only useful when using playlist's natural order (no custom sort or filter)
        if !has_custom_sort && !has_filter {
            let mut mapping = std::collections::HashMap::new();
            for (idx, (position, _, _)) in songs_with_positions.iter().enumerate() {
                mapping.insert(*position, idx);
            }
            position_to_index_map = Some(mapping);
        }

        // Extract songs and entry_ids as paired tuples, then apply filtering and sorting
        let mut paired: Vec<(String, crate::db::models::Song)> = songs_with_positions
            .into_iter()
            .map(|(_, entry_id, song)| (entry_id, song))
            .collect();

        let sort_field = request
            .sort
            .as_ref()
            .and_then(|s| s.get("field"))
            .and_then(|v| v.as_str());
        let sort_dir = request
            .sort
            .as_ref()
            .and_then(|s| s.get("direction"))
            .and_then(|v| v.as_str());

        // Apply filtering and sorting while keeping entry_ids paired
        // We use filter_and_sort_songs on the songs, but need to keep the pairing.
        // Instead, do the same operations on the paired vec.
        if let Some(filter) = text_filter {
            let filter_lower = filter.to_lowercase();
            paired.retain(|(_, song)| {
                song.title.to_lowercase().contains(&filter_lower)
                    || song.artist_name.to_lowercase().contains(&filter_lower)
                    || song
                        .album_name
                        .as_deref()
                        .is_some_and(|n| n.to_lowercase().contains(&filter_lower))
                    || song
                        .genre
                        .as_deref()
                        .is_some_and(|g| g.to_lowercase().contains(&filter_lower))
            });
        }

        // Sort the paired vec using the same sort logic
        let songs_only: Vec<_> = paired.iter().map(|(_, s)| s.clone()).collect();
        let sorted_songs = sorting::filter_and_sort_songs(songs_only, None, sort_field, sort_dir);

        // Rebuild paired vec in sorted order by matching song positions
        // Create index mapping: for each song in sorted order, find its original paired index
        let mut sorted_paired = Vec::with_capacity(sorted_songs.len());
        let mut used = vec![false; paired.len()];
        for sorted_song in &sorted_songs {
            if let Some(idx) = paired
                .iter()
                .enumerate()
                .position(|(i, (_, s))| !used[i] && s.id == sorted_song.id)
            {
                used[idx] = true;
                sorted_paired.push(paired[idx].clone());
            }
        }
        paired = sorted_paired;

        // Split into separate vecs
        let (entry_ids, songs): (Vec<String>, Vec<crate::db::models::Song>) =
            paired.into_iter().unzip();
        playlist_entry_ids = Some(entry_ids);

        songs
    } else {
        // Materialize songs from the source
        materialize_queue_songs(
            &state.database,
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
        let disabled_ids = get_disabled_song_ids(&state.database, user.user_id).await?;

        if disabled_ids.is_empty() {
            songs
        } else {
            // Filter out disabled songs, but keep the start_song if it was explicitly requested
            let keep_song_id = request.start_song_id.as_ref();

            // If we have playlist entry_ids, filter them in sync with songs
            if let Some(ref mut entry_ids) = playlist_entry_ids {
                let mut filtered_songs = Vec::new();
                let mut filtered_entry_ids = Vec::new();
                for (song, eid) in songs.into_iter().zip(entry_ids.drain(..)) {
                    if !disabled_ids.contains(&song.id) || Some(&song.id) == keep_song_id {
                        filtered_songs.push(song);
                        filtered_entry_ids.push(eid);
                    }
                }
                *entry_ids = filtered_entry_ids;
                filtered_songs
            } else {
                songs
                    .into_iter()
                    .filter(|s| !disabled_ids.contains(&s.id) || Some(&s.id) == keep_song_id)
                    .collect()
            }
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

    if total_count > MAX_QUEUE_SIZE {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Queue size {} exceeds maximum of {}",
            total_count, MAX_QUEUE_SIZE
        ))));
    }

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

    let mut chosen_start_index = start_index;

    // Handle shuffle - when starting shuffled playback without a specific song selected,
    // pick a random starting position for a true shuffle experience
    let (is_shuffled, shuffle_seed, shuffle_indices, current_index) = if request.shuffle {
        let seed = rand::random::<u64>() as i64;

        // If no specific song was requested (start_song_id is None) and start_index is 0,
        // the user pressed "Shuffle" to start from a random position
        let effective_start =
            if request.start_song_id.is_none() && start_index == 0 && total_count > 0 {
                use rand::RngExt;
                rand::rng().random_range(0..total_count)
            } else {
                start_index
            };
        chosen_start_index = effective_start;

        let indices = generate_shuffle_indices(total_count, effective_start, seed as u64);
        let indices_json = serde_json::to_string(&indices)
            .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;
        // The current song is at position 0 in the shuffled indices
        (true, Some(seed), Some(indices_json), 0i64)
    } else {
        (false, None, None, start_index as i64)
    };

    let starting_song_id = song_ids.get(chosen_start_index).cloned();

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
                | QueueSourceType::ForgottenFavorites
                | QueueSourceType::Directory
                | QueueSourceType::DirectoryFlat
        );

    let session_id = require_session_id(request.session_id.as_deref())?;

    if use_lazy {
        // Lazy queue: store parameters, not song IDs
        queries::create_lazy_queue_for_session(
            &state.database,
            user.user_id,
            session_id,
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
            None,
            "ferrotune",
        )
        .await?;
    } else {
        // Regular queue: store all song IDs
        queries::create_queue_for_session(
            &state.database,
            user.user_id,
            session_id,
            source_type.as_str(),
            request.source_id.as_deref(),
            request.source_name.as_deref(),
            &song_ids,
            playlist_entry_ids.as_deref(),
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
    }

    // Invalidate shuffle cache since queue changed
    invalidate_shuffle_cache(&state, user.user_id).await;

    // Update last_played_at for playlist/smart playlist sources
    if let Some(ref source_id) = request.source_id {
        match source_type {
            QueueSourceType::Playlist => {
                crate::db::repo::playlists::touch_playlist_last_played(&state.database, source_id)
                    .await?;
            }
            QueueSourceType::SmartPlaylist => {
                crate::db::repo::playlists::touch_smart_playlist_last_played(
                    &state.database,
                    source_id,
                )
                .await?;
            }
            _ => {}
        }
    }

    // Fetch the queue to get the created_at timestamp
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Queue not found after creation".to_string()))?;

    // A fresh queue never carries over the previous queue's up-next entries.
    let layout = UpNextLayout::default();
    let window_start = (current_index as usize).saturating_sub(50);
    let window_end = (current_index as usize + 51).min(total_count);
    let window = build_queue_window(
        &state.database,
        &state,
        user.user_id,
        session_id,
        &queue,
        &layout,
        total_count,
        window_start,
        window_end - window_start,
        inline_size,
    )
    .await?;

    // Explicit playback may claim ownership when there is no live owner. The
    // OwnerChanged event must be sent before QueueChanged so clients know who
    // the owner is when processing the queue.
    if let Some(ref client_id) = request.client_id {
        let session = queries::get_session(&state.database, session_id, user.user_id)
            .await?
            .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;
        let owner_is_disconnected = match session.owner_client_id.as_deref() {
            Some(owner_id) => {
                !state
                    .session_manager
                    .is_client_connected(session_id, owner_id)
                    .await
            }
            None => true,
        };

        if owner_is_disconnected {
            let client_name = request
                .client_name
                .as_deref()
                .unwrap_or("ferrotune-web")
                .to_string();
            queries::update_session_owner(
                &state.database,
                session_id,
                Some(client_id),
                &client_name,
            )
            .await?;
            state
                .session_manager
                .broadcast(
                    session_id,
                    SessionEvent::OwnerChanged {
                        owner_client_id: Some(client_id.clone()),
                        owner_client_name: Some(client_name),
                        resume_playback: None,
                        position_ms: None,
                    },
                )
                .await;
        }
    }

    // Update last_playing_at since playback is about to start — this resets the
    // inactivity timer so the background task doesn't immediately disown us.
    queries::touch_session_last_playing_at(&state.database, session_id).await?;

    // Broadcast to SSE subscribers: QueueUpdated (no playback restart) when
    // keep_playing is set, QueueChanged (full restart) otherwise.
    if request.keep_playing {
        broadcast_queue_updated(&state, session_id).await;
    } else {
        broadcast_queue_changed(&state, session_id).await;
    }

    // Record explicit playback start event
    if let Some(song_id) = starting_song_id {
        let trigger_type = if request.shuffle { "shuffle" } else { "direct" };
        let explicit_start = request.start_song_id.is_some();
        if let Err(e) = crate::db::repo::listening::create_playback_start(
            &state.database,
            user.user_id,
            &song_id,
            Some(session_id),
            Some(&request.source_type),
            request.source_id.as_deref(),
            request.client_name.as_deref(),
            Some(trigger_type),
            explicit_start,
        )
        .await
        {
            tracing::warn!("Failed to log playback start for song {}: {:?}", song_id, e);
        }
    }

    Ok(Json(StartQueueResponse {
        total_count,
        current_index: current_index as usize,
        up_next_count: 0,
        is_shuffled,
        repeat_mode: repeat_mode.to_string(),
        source: QueueSourceInfo::from_queue(&queue),
        window,
        is_lazy: queue.is_lazy,
    }))
}

/// GET /api/queue - Get the current queue with pagination
pub async fn get_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<QueuePaginationParams>,
) -> FerrotuneApiResult<Json<GetQueueResponse>> {
    let session_id = require_session_id(params.session_id.as_deref())?;
    let queue = match queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
    {
        Some(q) => q,
        None => {
            return Ok(Json(GetQueueResponse {
                total_count: 0,
                up_next_count: 0,
                current_index: 0,
                position_ms: 0,
                is_shuffled: false,
                repeat_mode: "off".to_string(),
                source: QueueSourceInfo::empty(),
                window: QueueWindow {
                    offset: 0,
                    songs: vec![],
                },
                version: 0,
                is_lazy: false,
            }));
        }
    };

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(50).min(200);
    let inline_size = params.inline_images.get_size();

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let total_count = layout.total(context_total);
    let current_index = layout.current_display_index(
        queue.current_index.max(0) as usize,
        queue.current_manual_entry_id.as_deref(),
    );
    let window = build_queue_window(
        &state.database,
        &state,
        user.user_id,
        session_id,
        &queue,
        &layout,
        context_total,
        offset,
        limit,
        inline_size,
    )
    .await?;

    Ok(Json(GetQueueResponse {
        total_count,
        up_next_count: layout.upcoming_count(),
        current_index,
        position_ms: queue.position_ms,
        is_shuffled: queue.is_shuffled,
        repeat_mode: queue.repeat_mode.clone(),
        source: QueueSourceInfo::from_queue(&queue),
        window,
        version: queue.version,
        is_lazy: queue.is_lazy,
    }))
}

/// GET /api/queue/current-window - Get songs around current position
pub async fn get_current_window(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<CurrentWindowParams>,
) -> FerrotuneApiResult<Json<GetQueueResponse>> {
    let session_id = require_session_id(params.session_id.as_deref())?;
    let queue = match queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
    {
        Some(q) => q,
        None => {
            return Ok(Json(GetQueueResponse {
                total_count: 0,
                up_next_count: 0,
                current_index: 0,
                position_ms: 0,
                is_shuffled: false,
                repeat_mode: "off".to_string(),
                source: QueueSourceInfo::empty(),
                window: QueueWindow {
                    offset: 0,
                    songs: vec![],
                },
                version: 0,
                is_lazy: false,
            }));
        }
    };

    let radius = params.radius.unwrap_or(20);
    let inline_size = params.inline_images.get_size();

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let total_count = layout.total(context_total);
    let current_index = layout.current_display_index(
        queue.current_index.max(0) as usize,
        queue.current_manual_entry_id.as_deref(),
    );

    let start = current_index.saturating_sub(radius);
    let end = (current_index + radius + 1).min(total_count);
    let window = build_queue_window(
        &state.database,
        &state,
        user.user_id,
        session_id,
        &queue,
        &layout,
        context_total,
        start,
        end - start,
        inline_size,
    )
    .await?;

    Ok(Json(GetQueueResponse {
        total_count,
        up_next_count: layout.upcoming_count(),
        current_index,
        position_ms: queue.position_ms,
        is_shuffled: queue.is_shuffled,
        repeat_mode: queue.repeat_mode.clone(),
        source: QueueSourceInfo::from_queue(&queue),
        window,
        version: queue.version,
        is_lazy: queue.is_lazy,
    }))
}

/// POST /api/queue/add - Add songs to the up-next queue
///
/// `next` prepends the batch to the up-next list, `end` appends it. The
/// playback context is never touched, so a lazy queue can accept up-next songs
/// without materializing.
pub async fn add_to_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<AddToQueueRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(request.session_id.as_deref())?;
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let manual_total =
        queries::count_up_next_by_session(&state.database, session_id).await? as usize;

    // Get song IDs either from explicit list or from source materialization
    let song_ids: Vec<String> = if !request.song_ids.is_empty() {
        request.song_ids
    } else if !request.sources.is_empty() {
        materialize_queue_sources(&state.database, user.user_id, &request.sources)
            .await?
            .into_iter()
            .map(|song| song.id)
            .collect()
    } else if let (Some(source_type_str), Some(source_id)) =
        (&request.source_type, &request.source_id)
    {
        let source_type: QueueSourceType = source_type_str.parse().map_err(|_| {
            Error::InvalidRequest(format!("Invalid source type: {}", source_type_str))
        })?;
        let songs = materialize_queue_songs(
            &state.database,
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
        let layout =
            UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
        return Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(layout.current_display_index(
                queue.current_index.max(0) as usize,
                queue.current_manual_entry_id.as_deref(),
            )),
            total_count: Some(layout.total(context_total)),
            added_count: Some(0),
            up_next_count: Some(layout.upcoming_count()),
        }));
    }

    if manual_total + song_ids.len() > MAX_UP_NEXT_SIZE {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Adding {} songs would exceed the maximum up-next size of {}",
            song_ids.len(),
            MAX_UP_NEXT_SIZE
        ))));
    }
    if context_total + manual_total + song_ids.len() > MAX_QUEUE_SIZE {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Adding {} songs would exceed maximum queue size of {}",
            song_ids.len(),
            MAX_QUEUE_SIZE
        ))));
    }

    let added_count = song_ids.len();
    let mut rows: Vec<(String, String, i64)> = Vec::with_capacity(added_count);
    let mut entry_ids: Vec<String> = Vec::with_capacity(added_count);
    for song_id in song_ids {
        let entry_id = uuid::Uuid::new_v4().to_string();
        entry_ids.push(entry_id.clone());
        rows.push((entry_id, song_id, 0));
    }

    match &request.position {
        AddPosition::Named(name) if name == "next" => {
            // Prepend the batch, preserving the selection order.
            let min = queries::min_up_next_sequence(&state.database, session_id)
                .await?
                .unwrap_or(0);
            let base = min - added_count as i64;
            for (offset, row) in rows.iter_mut().enumerate() {
                row.2 = base + offset as i64;
            }
            queries::insert_up_next_entries(&state.database, user.user_id, session_id, &rows)
                .await?;
        }
        AddPosition::Named(name) if name == "end" => {
            let max = queries::max_up_next_sequence(&state.database, session_id)
                .await?
                .unwrap_or(0);
            let base = max + 1;
            for (offset, row) in rows.iter_mut().enumerate() {
                row.2 = base + offset as i64;
            }
            queries::insert_up_next_entries(&state.database, user.user_id, session_id, &rows)
                .await?;
        }
        AddPosition::Index(index) => {
            let existing = queries::list_up_next_by_session(&state.database, session_id).await?;
            let mut upcoming: Vec<(String, String, i64)> = existing
                .into_iter()
                .filter(|row| row.anchor_context_index.is_none())
                .map(|row| (row.entry_id, row.song_id, row.sequence))
                .collect();
            let insert_at = (*index).min(upcoming.len());
            upcoming.splice(insert_at..insert_at, rows.iter().cloned());
            let sequence_rows: Vec<(String, i64)> = upcoming
                .iter()
                .enumerate()
                .map(|(offset, (entry_id, _, _))| (entry_id.clone(), offset as i64))
                .collect();
            queries::insert_up_next_entries(&state.database, user.user_id, session_id, &rows)
                .await?;
            queries::update_up_next_sequences(&state.database, session_id, &sequence_rows).await?;
        }
        AddPosition::Named(_) => {
            // Unknown named positions behave like "end".
            let max = queries::max_up_next_sequence(&state.database, session_id)
                .await?
                .unwrap_or(0);
            let base = max + 1;
            for (offset, row) in rows.iter_mut().enumerate() {
                row.2 = base + offset as i64;
            }
            queries::insert_up_next_entries(&state.database, user.user_id, session_id, &rows)
                .await?;
        }
    }

    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let total_count = layout.total(context_total);
    let new_current_index = layout.current_display_index(
        queue.current_index.max(0) as usize,
        queue.current_manual_entry_id.as_deref(),
    );

    broadcast_queue_updated(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_current_index),
        total_count: Some(total_count),
        added_count: Some(added_count),
        up_next_count: Some(layout.upcoming_count()),
    }))
}

/// DELETE /api/queue/{position} - Remove a song from the queue
pub async fn remove_from_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Path(position): Path<usize>,
    Query(params): Query<SessionParams>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(params.session_id.as_deref())?;
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let current_context_index = queue.current_index.max(0) as usize;
    let item = layout
        .display_item_at(position, context_total, current_context_index)
        .ok_or_else(|| Error::NotFound("Position not found in queue".to_string()))?;

    let mut new_context_total = context_total;
    let mut new_context_index = current_context_index;
    let mut new_manual_entry_id = queue.current_manual_entry_id.clone();

    match item {
        QueueDisplayItem::Context(context_index) => {
            // In shuffled mode the context index must be mapped back to the
            // stored entry position before deleting it.
            let original_position = resolve_original_queue_position(&queue, context_index)?;
            let removed = queries::remove_from_queue_by_session(
                &state.database,
                session_id,
                original_position as i64,
            )
            .await?;
            if !removed {
                return Err(FerrotuneApiError(Error::NotFound(
                    "Position not found in queue".to_string(),
                )));
            }

            new_context_total = context_total.saturating_sub(1);
            new_context_index = shifted_current_index_after_remove(
                current_context_index,
                context_index,
                new_context_total,
            );

            queries::shift_up_next_anchors_after_removal(
                &state.database,
                session_id,
                context_index as i64,
            )
            .await?;

            if queue.is_shuffled {
                let mut indices = queue.shuffle_indices().unwrap_or_default();
                indices.retain(|&idx| idx != original_position);
                for idx in indices.iter_mut() {
                    if *idx > original_position {
                        *idx -= 1;
                    }
                }
                let indices_json = serde_json::to_string(&indices)
                    .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;
                let updated = queries::update_queue_shuffle_by_session(
                    &state.database,
                    session_id,
                    true,
                    queue.shuffle_seed,
                    Some(&indices_json),
                    new_context_index as i64,
                    queue.position_ms,
                    Some(queue.version),
                )
                .await?;
                if !updated {
                    return Err(FerrotuneApiError(Error::InvalidRequest(
                        "Queue was modified concurrently, please retry".to_string(),
                    )));
                }
                queries::set_queue_current_manual_entry(
                    &state.database,
                    session_id,
                    new_manual_entry_id.as_deref(),
                )
                .await?;
                invalidate_shuffle_cache(&state, user.user_id).await;
            } else {
                queries::update_queue_cursor_by_session(
                    &state.database,
                    session_id,
                    new_context_index as i64,
                    new_manual_entry_id.as_deref(),
                    queue.position_ms,
                )
                .await?;
            }
        }
        QueueDisplayItem::Anchored { anchor, index } => {
            let entry_id = layout
                .anchored_row(anchor, index)
                .map(|row| row.entry_id.clone())
                .ok_or_else(|| Error::NotFound("Position not found in queue".to_string()))?;
            queries::delete_up_next_entry_by_session(&state.database, session_id, &entry_id)
                .await?;
            if queue.current_manual_entry_id.as_deref() == Some(entry_id.as_str()) {
                new_manual_entry_id = None;
                queries::update_queue_cursor_by_session(
                    &state.database,
                    session_id,
                    new_context_index as i64,
                    None,
                    queue.position_ms,
                )
                .await?;
            }
        }
        QueueDisplayItem::Upcoming { index } => {
            let entry_id = layout
                .upcoming_row(index)
                .map(|row| row.entry_id.clone())
                .ok_or_else(|| Error::NotFound("Position not found in queue".to_string()))?;
            queries::delete_up_next_entry_by_session(&state.database, session_id, &entry_id)
                .await?;
        }
    }

    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let total_count = layout.total(new_context_total);
    let new_index = layout.current_display_index(new_context_index, new_manual_entry_id.as_deref());

    broadcast_queue_updated(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_index),
        total_count: Some(total_count),
        added_count: None,
        up_next_count: Some(layout.upcoming_count()),
    }))
}

/// POST /api/queue/move - Move a song to a new position
pub async fn move_in_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<MoveInQueueRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(request.session_id.as_deref())?;
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let current_context_index = queue.current_index.max(0) as usize;
    let from_item = layout
        .display_item_at(request.from_position, context_total, current_context_index)
        .ok_or_else(|| Error::InvalidRequest("From position out of range".to_string()))?;
    let to_item = layout
        .display_item_at(request.to_position, context_total, current_context_index)
        .ok_or_else(|| Error::InvalidRequest("To position out of range".to_string()))?;

    if request.from_position == request.to_position {
        return Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(layout.current_display_index(
                current_context_index,
                queue.current_manual_entry_id.as_deref(),
            )),
            total_count: Some(layout.total(context_total)),
            added_count: None,
            up_next_count: Some(layout.upcoming_count()),
        }));
    }

    let mut new_context_index = current_context_index;
    match (from_item, to_item) {
        (QueueDisplayItem::Context(from_context), QueueDisplayItem::Context(to_context)) => {
            let from_original = resolve_original_queue_position(&queue, from_context)?;
            let to_original = resolve_original_queue_position(&queue, to_context)?;

            if queue.is_shuffled {
                let mut indices = queue.shuffle_indices().unwrap_or_default();
                if from_context >= indices.len() || to_context >= indices.len() {
                    return Err(FerrotuneApiError(Error::InvalidRequest(
                        "Position out of range".to_string(),
                    )));
                }
                let moved = indices.remove(from_context);
                indices.insert(to_context, moved);

                new_context_index = if from_context == current_context_index {
                    to_context
                } else if from_context < current_context_index
                    && to_context >= current_context_index
                {
                    current_context_index - 1
                } else if from_context > current_context_index
                    && to_context <= current_context_index
                {
                    current_context_index + 1
                } else {
                    current_context_index
                };

                let indices_json = serde_json::to_string(&indices)
                    .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;
                let updated = queries::update_queue_shuffle_by_session(
                    &state.database,
                    session_id,
                    true,
                    queue.shuffle_seed,
                    Some(&indices_json),
                    new_context_index as i64,
                    queue.position_ms,
                    Some(queue.version),
                )
                .await?;
                if !updated {
                    return Err(FerrotuneApiError(Error::InvalidRequest(
                        "Queue was modified concurrently, please retry".to_string(),
                    )));
                }
                invalidate_shuffle_cache(&state, user.user_id).await;
            } else {
                let moved = queries::move_in_queue_by_session(
                    &state.database,
                    session_id,
                    from_original as i64,
                    to_original as i64,
                )
                .await?;
                if !moved {
                    return Err(FerrotuneApiError(Error::NotFound(
                        "Position not found in queue".to_string(),
                    )));
                }

                new_context_index = if from_context == current_context_index {
                    to_context
                } else if from_context < current_context_index
                    && to_context >= current_context_index
                {
                    current_context_index - 1
                } else if from_context > current_context_index
                    && to_context <= current_context_index
                {
                    current_context_index + 1
                } else {
                    current_context_index
                };

                queries::update_queue_cursor_by_session(
                    &state.database,
                    session_id,
                    new_context_index as i64,
                    queue.current_manual_entry_id.as_deref(),
                    queue.position_ms,
                )
                .await?;
            }

            queries::shift_up_next_anchors_for_move(
                &state.database,
                session_id,
                from_context as i64,
                to_context as i64,
            )
            .await?;
            queries::set_queue_current_manual_entry(
                &state.database,
                session_id,
                queue.current_manual_entry_id.as_deref(),
            )
            .await?;
        }
        (
            QueueDisplayItem::Upcoming { index: from_index },
            QueueDisplayItem::Upcoming { index: to_index },
        ) => {
            let mut entry_ids: Vec<String> = layout
                .upcoming
                .iter()
                .filter_map(|row_index| layout.rows.get(*row_index))
                .map(|row| row.entry_id.clone())
                .collect();
            if from_index >= entry_ids.len() || to_index >= entry_ids.len() {
                return Err(FerrotuneApiError(Error::InvalidRequest(
                    "Position out of range".to_string(),
                )));
            }
            let moved = entry_ids.remove(from_index);
            entry_ids.insert(to_index, moved);
            let sequence_rows: Vec<(String, i64)> = entry_ids
                .iter()
                .enumerate()
                .map(|(offset, entry_id)| (entry_id.clone(), offset as i64))
                .collect();
            queries::update_up_next_sequences(&state.database, session_id, &sequence_rows).await?;
            queries::set_queue_current_manual_entry(
                &state.database,
                session_id,
                queue.current_manual_entry_id.as_deref(),
            )
            .await?;
        }
        (
            QueueDisplayItem::Anchored {
                anchor: from_anchor,
                index: from_index,
            },
            QueueDisplayItem::Anchored {
                anchor: to_anchor,
                index: to_index,
            },
        ) if from_anchor == to_anchor => {
            let mut entry_ids: Vec<String> = layout
                .anchored
                .get(&from_anchor)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row_index| layout.rows.get(*row_index))
                        .map(|row| row.entry_id.clone())
                        .collect()
                })
                .unwrap_or_default();
            if from_index >= entry_ids.len() || to_index >= entry_ids.len() {
                return Err(FerrotuneApiError(Error::InvalidRequest(
                    "Position out of range".to_string(),
                )));
            }
            let moved = entry_ids.remove(from_index);
            entry_ids.insert(to_index, moved);
            let sequence_rows: Vec<(String, i64)> = entry_ids
                .iter()
                .enumerate()
                .map(|(offset, entry_id)| (entry_id.clone(), offset as i64))
                .collect();
            queries::update_up_next_sequences(&state.database, session_id, &sequence_rows).await?;
            queries::set_queue_current_manual_entry(
                &state.database,
                session_id,
                queue.current_manual_entry_id.as_deref(),
            )
            .await?;
        }
        (
            QueueDisplayItem::Context(from_context),
            QueueDisplayItem::Upcoming { index: to_index },
        ) => {
            if queue.is_lazy {
                return Err(FerrotuneApiError(Error::InvalidRequest(
                    "Moving tracks out of a lazily loaded queue isn't supported yet".to_string(),
                )));
            }
            if from_context <= current_context_index {
                return Err(FerrotuneApiError(Error::InvalidRequest(
                    "Only tracks after the current one can move into the queue".to_string(),
                )));
            }

            let from_original = resolve_original_queue_position(&queue, from_context)?;
            let entries = queries::get_queue_entries_at_positions_by_session(
                &state.database,
                session_id,
                &[from_original],
            )
            .await?;
            let entry = entries.into_iter().next().ok_or_else(|| {
                FerrotuneApiError(Error::NotFound("Position not found in queue".to_string()))
            })?;

            let shuffle_json = if queue.is_shuffled {
                let mut indices = queue.shuffle_indices().unwrap_or_default();
                indices.retain(|&index| index != from_original);
                for index in indices.iter_mut() {
                    if *index > from_original {
                        *index -= 1;
                    }
                }
                Some(
                    serde_json::to_string(&indices)
                        .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?,
                )
            } else {
                None
            };

            queries::move_context_row_to_up_next(
                &state.database,
                user.user_id,
                session_id,
                from_original as i64,
                from_context as i64,
                current_context_index as i64,
                shuffle_json.as_deref(),
                &entry.entry_id,
                &entry.id,
                to_index,
            )
            .await?;

            if queue.is_shuffled {
                invalidate_shuffle_cache(&state, user.user_id).await;
            }
            new_context_index = current_context_index;
        }
        (
            QueueDisplayItem::Upcoming { index: from_index },
            QueueDisplayItem::Context(to_context),
        ) => {
            if queue.is_lazy {
                return Err(FerrotuneApiError(Error::InvalidRequest(
                    "Moving tracks into a lazily loaded queue isn't supported yet".to_string(),
                )));
            }

            let row = layout
                .upcoming_row(from_index)
                .ok_or_else(|| FerrotuneApiError(Error::NotFound("Row not found".to_string())))?;
            let manual_entry_id = row.entry_id.clone();
            let song_id = row.song_id.clone();

            // Match the drop line: a downward drag (up next -> later playlist
            // row) inserts after the target; an upward drag (into the played
            // section) inserts before it.
            let insert_context_index = if request.from_position < request.to_position {
                to_context + 1
            } else {
                to_context
            };

            // Inserting at or before the current track pushes it forward one
            // slot; the same song stays current. Targeting the played section
            // is allowed and places the moved song in history.
            let moved_context_index =
                current_context_index + usize::from(insert_context_index <= current_context_index);

            let (insert_position, shift_entries, shuffle_json) =
                if queue.is_shuffled {
                    let mut indices = queue.shuffle_indices().unwrap_or_default();
                    let new_original = context_total;
                    let insert_at = insert_context_index.min(indices.len());
                    indices.insert(insert_at, new_original);
                    (
                        new_original as i64,
                        false,
                        Some(serde_json::to_string(&indices).map_err(|e| {
                            Error::Internal(format!("Failed to serialize JSON: {e}"))
                        })?),
                    )
                } else {
                    (insert_context_index as i64, true, None)
                };

            queries::move_up_next_row_to_context(
                &state.database,
                user.user_id,
                session_id,
                &manual_entry_id,
                &song_id,
                insert_position,
                shift_entries,
                insert_context_index as i64,
                moved_context_index as i64,
                shuffle_json.as_deref(),
            )
            .await?;

            if queue.is_shuffled {
                invalidate_shuffle_cache(&state, user.user_id).await;
            }
            new_context_index = moved_context_index;
        }
        _ => {
            return Err(FerrotuneApiError(Error::InvalidRequest(
                "Played tracks stay in place; move upcoming tracks instead".to_string(),
            )));
        }
    }

    let updated_context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let new_index =
        layout.current_display_index(new_context_index, queue.current_manual_entry_id.as_deref());

    broadcast_queue_updated(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_index),
        total_count: Some(layout.total(updated_context_total)),
        added_count: None,
        up_next_count: Some(layout.upcoming_count()),
    }))
}

/// POST /api/queue/shuffle - Toggle shuffle mode
pub async fn toggle_shuffle(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<ShuffleRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(request.session_id.as_deref())?;
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let total_count =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let current_index = queue.current_index as usize;

    if request.enabled {
        // Enable shuffle - current song goes to position 0, all others shuffled after it
        let seed = rand::random::<u64>() as i64;

        // In shuffled mode, current_index is in the shuffled space.
        // We need to find which original index is currently playing.
        // For a non-shuffled queue, current_index IS the original index.
        let original_index = if queue.is_shuffled {
            // Already shuffled — look up the original index from existing shuffle indices
            let indices = get_shuffle_indices(
                &state,
                user.user_id,
                queue.shuffle_seed,
                queue.shuffle_indices_json.as_deref(),
                total_count,
            )
            .await;
            indices.get(current_index).copied().unwrap_or(current_index)
        } else {
            current_index
        };

        let indices = generate_shuffle_indices(total_count, original_index, seed as u64);
        let indices_json = serde_json::to_string(&indices)
            .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;

        // Current song is now at shuffled position 0
        let updated = queries::update_queue_shuffle_by_session(
            &state.database,
            session_id,
            true,
            Some(seed),
            Some(&indices_json),
            0, // Current song is at position 0 in shuffled order
            queue.position_ms,
            Some(queue.version),
        )
        .await?;

        if !updated {
            return Err(FerrotuneApiError(Error::InvalidRequest(
                "Queue was modified concurrently, please retry".to_string(),
            )));
        }

        // For lazy queues, eagerly materialize song IDs so that subsequent page
        // requests use the fast parse_song_ids() path instead of re-materializing
        // all songs from the source on every page fetch.
        if queue.is_lazy && queue.song_ids_json.is_none() {
            let source_type: QueueSourceType = queue.source_type.parse().unwrap_or_default();
            let filters: Option<serde_json::Value> = queue
                .filters_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok());
            let sort: Option<serde_json::Value> = queue
                .sort_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok());

            let all_songs = materialize_queue_songs(
                &state.database,
                user.user_id,
                source_type,
                queue.source_id.as_deref(),
                filters.as_ref(),
                sort.as_ref(),
            )
            .await?;

            let song_ids: Vec<&str> = all_songs.iter().map(|s| s.id.as_str()).collect();
            let song_ids_json = serde_json::to_string(&song_ids)
                .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;
            queries::update_queue_song_ids_by_session(
                &state.database,
                session_id,
                Some(&song_ids_json),
            )
            .await
            .ok();
        }

        // Invalidate old cache and prime the new one
        invalidate_shuffle_cache(&state, user.user_id).await;

        // Up-next rows survive; their played history no longer has a stable
        // context position in the new order.
        queries::delete_up_next_anchored_by_session(&state.database, session_id).await?;
        queries::set_queue_current_manual_entry(&state.database, session_id, None).await?;

        let layout =
            UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);

        broadcast_queue_updated(&state, session_id).await;

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(layout.current_display_index(0, None)),
            total_count: Some(layout.total(total_count)),
            added_count: None,
            up_next_count: Some(layout.upcoming_count()),
        }))
    } else {
        // Disable shuffle - restore original order
        // Look up the original index of the currently-playing song from shuffle indices
        let indices = get_shuffle_indices(
            &state,
            user.user_id,
            queue.shuffle_seed,
            queue.shuffle_indices_json.as_deref(),
            total_count,
        )
        .await;
        let original_index = indices.get(current_index).copied().unwrap_or(current_index);

        let updated = queries::update_queue_shuffle_by_session(
            &state.database,
            session_id,
            false,
            None,
            None,
            original_index as i64,
            queue.position_ms,
            Some(queue.version),
        )
        .await?;

        if !updated {
            return Err(FerrotuneApiError(Error::InvalidRequest(
                "Queue was modified concurrently, please retry".to_string(),
            )));
        }

        // Invalidate shuffle cache
        invalidate_shuffle_cache(&state, user.user_id).await;

        queries::delete_up_next_anchored_by_session(&state.database, session_id).await?;
        queries::set_queue_current_manual_entry(&state.database, session_id, None).await?;

        let layout =
            UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);

        broadcast_queue_updated(&state, session_id).await;

        Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(layout.current_display_index(original_index, None)),
            total_count: Some(layout.total(total_count)),
            added_count: None,
            up_next_count: Some(layout.upcoming_count()),
        }))
    }
}

/// POST /api/queue/position - Update current position
pub async fn update_position(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<UpdatePositionRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(request.session_id.as_deref())?;
    let request_client_id = request
        .client_id
        .as_deref()
        .filter(|client_id| !client_id.is_empty())
        .ok_or_else(|| {
            FerrotuneApiError(Error::InvalidRequest(
                "clientId is required to update queue position".to_string(),
            ))
        })?;

    let session = queries::get_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;

    if session.owner_client_id.as_deref() != Some(request_client_id) {
        let owner_is_disconnected = match session.owner_client_id.as_deref() {
            Some(owner_id) => {
                !state
                    .session_manager
                    .is_client_connected(session_id, owner_id)
                    .await
            }
            None => true,
        };

        let request_client_name = state
            .session_manager
            .get_client_name(session_id, request_client_id)
            .await;

        if owner_is_disconnected {
            let Some(client_name) = request_client_name else {
                return Err(FerrotuneApiError(Error::Forbidden(
                    "Only the session owner can update queue position".to_string(),
                )));
            };
            queries::update_session_owner(
                &state.database,
                session_id,
                Some(request_client_id),
                &client_name,
            )
            .await?;
            state
                .session_manager
                .broadcast(
                    session_id,
                    SessionEvent::OwnerChanged {
                        owner_client_id: Some(request_client_id.to_string()),
                        owner_client_name: Some(client_name),
                        resume_playback: None,
                        position_ms: None,
                    },
                )
                .await;
        } else {
            return Err(FerrotuneApiError(Error::Forbidden(
                "Only the session owner can update queue position".to_string(),
            )));
        }
    }

    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let display_total = layout.total(context_total);
    let current_context_index = queue.current_index.max(0) as usize;

    if request.current_index >= display_total {
        return Err(FerrotuneApiError(Error::InvalidRequest(
            "Position out of range".to_string(),
        )));
    }

    // Handle reshuffle (e.g., repeat-all wrap-around in shuffle mode)
    if request.reshuffle && queue.is_shuffled {
        let seed = rand::random::<u64>() as i64;
        use rand::RngExt;
        let start = rand::rng().random_range(0..context_total);
        let indices = generate_shuffle_indices(context_total, start, seed as u64);
        let indices_json = serde_json::to_string(&indices)
            .map_err(|e| Error::Internal(format!("Failed to serialize JSON: {e}")))?;

        queries::update_queue_shuffle_by_session(
            &state.database,
            session_id,
            true,
            Some(seed),
            Some(&indices_json),
            0,
            0,
            None,
        )
        .await?;

        // A new cycle starts clean: unplayed up-next rows follow the new
        // current, played history has no stable anchors in the new order.
        queries::delete_up_next_anchored_by_session(&state.database, session_id).await?;
        queries::set_queue_current_manual_entry(&state.database, session_id, None).await?;

        invalidate_shuffle_cache(&state, user.user_id).await;

        let layout =
            UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);

        broadcast_queue_changed(&state, session_id).await;

        return Ok(Json(QueueSuccessResponse {
            success: true,
            new_index: Some(layout.current_display_index(0, None)),
            total_count: Some(layout.total(context_total)),
            added_count: None,
            up_next_count: Some(layout.upcoming_count()),
        }));
    }

    let item = layout
        .display_item_at(request.current_index, context_total, current_context_index)
        .ok_or_else(|| {
            FerrotuneApiError(Error::InvalidRequest("Position out of range".to_string()))
        })?;

    let new_context_index: usize;
    let mut new_manual_entry_id: Option<String> = None;
    match item {
        QueueDisplayItem::Context(context_index) => {
            new_context_index = context_index;
        }
        QueueDisplayItem::Anchored { anchor, index } => {
            new_context_index = anchor;
            new_manual_entry_id = layout
                .anchored_row(anchor, index)
                .map(|row| row.entry_id.clone());
        }
        QueueDisplayItem::Upcoming { index } => {
            let row = layout
                .upcoming_row(index)
                .ok_or_else(|| FerrotuneApiError(Error::NotFound("Row not found".to_string())))?;
            new_context_index = current_context_index;
            new_manual_entry_id = Some(row.entry_id.clone());
            queries::anchor_upcoming_through_sequence(
                &state.database,
                session_id,
                current_context_index as i64,
                row.sequence,
            )
            .await?;
        }
    }

    if queue.is_shuffled {
        queries::update_queue_shuffle_by_session(
            &state.database,
            session_id,
            true,
            queue.shuffle_seed,
            queue.shuffle_indices_json.as_deref(),
            new_context_index as i64,
            request.position_ms,
            None,
        )
        .await?;
        queries::set_queue_current_manual_entry(
            &state.database,
            session_id,
            new_manual_entry_id.as_deref(),
        )
        .await?;
    } else {
        queries::update_queue_cursor_by_session(
            &state.database,
            session_id,
            new_context_index as i64,
            new_manual_entry_id.as_deref(),
            request.position_ms,
        )
        .await?;
    }

    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let new_display_index =
        layout.current_display_index(new_context_index, new_manual_entry_id.as_deref());

    broadcast_position_updated(&state, session_id, request_client_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_display_index),
        total_count: Some(layout.total(context_total)),
        added_count: None,
        up_next_count: Some(layout.upcoming_count()),
    }))
}

/// POST /api/queue/repeat - Update repeat mode
pub async fn update_repeat_mode(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Json(request): Json<RepeatModeRequest>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(request.session_id.as_deref())?;
    // Verify session belongs to user
    queries::get_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;
    // Validate repeat mode
    let mode: RepeatMode = request
        .mode
        .parse()
        .map_err(|_| Error::InvalidRequest(format!("Invalid repeat mode: {}", request.mode)))?;

    queries::update_queue_repeat_mode_by_session(&state.database, session_id, mode.as_str())
        .await?;

    broadcast_queue_updated(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: None,
        total_count: None,
        added_count: None,
        up_next_count: None,
    }))
}

/// DELETE /api/queue - Clear the entire queue
pub async fn clear_queue(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SessionParams>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(params.session_id.as_deref())?;
    // Verify session belongs to user
    queries::get_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("Session not found".to_string()))?;
    queries::clear_queue_by_session(&state.database, session_id).await?;

    broadcast_queue_changed(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: None,
        total_count: Some(0),
        added_count: None,
        up_next_count: Some(0),
    }))
}

/// DELETE /api/queue/up-next - Clear the explicitly queued songs
///
/// Removes every still-upcoming up-next row. Played up-next history and the
/// playback context stay untouched, so the playlist keeps playing.
pub async fn clear_up_next(
    user: FerrotuneAuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SessionParams>,
) -> FerrotuneApiResult<Json<QueueSuccessResponse>> {
    let session_id = require_session_id(params.session_id.as_deref())?;
    let queue = queries::get_play_queue_by_session(&state.database, session_id, user.user_id)
        .await?
        .ok_or_else(|| Error::NotFound("No queue found".to_string()))?;

    let context_total =
        get_queue_total_count(&state.database, &queue, user.user_id, session_id).await?;
    queries::delete_up_next_upcoming_by_session(&state.database, session_id).await?;

    let layout =
        UpNextLayout::new(queries::list_up_next_by_session(&state.database, session_id).await?);
    let new_index = layout.current_display_index(
        queue.current_index.max(0) as usize,
        queue.current_manual_entry_id.as_deref(),
    );

    broadcast_queue_updated(&state, session_id).await;

    Ok(Json(QueueSuccessResponse {
        success: true,
        new_index: Some(new_index),
        total_count: Some(layout.total(context_total)),
        added_count: None,
        up_next_count: Some(0),
    }))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get all disabled song IDs for a user
async fn get_disabled_song_ids(
    database: &crate::db::Database,
    user_id: i64,
) -> FerrotuneApiResult<std::collections::HashSet<String>> {
    Ok(queries::get_disabled_song_ids_for_user(database, user_id)
        .await?
        .into_iter()
        .collect())
}

async fn materialize_song_radio_songs(
    database: &crate::db::Database,
    user_id: i64,
    song_id: &str,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    #[cfg(feature = "bliss")]
    {
        let similar =
            crate::bliss::find_similar_songs(database, song_id, user_id, 50, None).await?;
        let mut song_ids: Vec<String> = Vec::with_capacity(similar.len() + 1);
        song_ids.push(song_id.to_string());
        song_ids.extend(similar.into_iter().map(|(id, _)| id));
        Ok(repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?)
    }
    #[cfg(not(feature = "bliss"))]
    {
        Err(Error::InvalidRequest("Song radio requires the 'bliss' feature".to_string()).into())
    }
}

async fn materialize_favorites_songs(
    database: &crate::db::Database,
    user_id: i64,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let songs = queries::get_starred_songs(database, user_id).await?;
    Ok(sorting::filter_and_sort_songs(
        songs,
        text_filter,
        sort_field,
        sort_dir,
    ))
}

async fn materialize_history_songs(
    database: &crate::db::Database,
    user_id: i64,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let aggregates =
        crate::db::repo::history::list_recent_song_aggregates(database.conn(), user_id, 500, 0)
            .await?;
    let ids: Vec<String> = aggregates.iter().map(|a| a.song_id.clone()).collect();
    let rows = crate::db::repo::history::fetch_songs_by_ids(database.conn(), &ids).await?;
    let mut by_id: std::collections::HashMap<String, crate::db::models::Song> =
        rows.into_iter().map(|s| (s.id.clone(), s)).collect();
    let songs: Vec<crate::db::models::Song> = aggregates
        .into_iter()
        .filter_map(|agg| {
            let last_played = agg.last_played?;
            by_id.remove(&agg.song_id).map(|mut s| {
                s.play_count = Some(agg.play_count);
                s.last_played = Some(last_played);
                s
            })
        })
        .collect();

    Ok(sorting::filter_and_sort_songs(
        songs,
        text_filter,
        sort_field,
        sort_dir,
    ))
}

async fn materialize_album_list_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    source_id: Option<&str>,
    filters: Option<&serde_json::Value>,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    // If albumIds are provided in filters, use those directly (backward compat)
    let album_ids: Option<Vec<String>> = filters
        .and_then(|f| f.get("albumIds"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

    let album_ids = if let Some(ids) = album_ids {
        ids
    } else {
        let list_type_str = source_id
            .ok_or_else(|| Error::InvalidRequest("Album list type required".to_string()))?;
        let list_type: crate::api::common::lists::AlbumListType =
            serde_json::from_value(serde_json::Value::String(list_type_str.to_string())).map_err(
                |_| Error::InvalidRequest(format!("Invalid album list type: {}", list_type_str)),
            )?;
        let since = filters
            .and_then(|f| f.get("since"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let seed = filters.and_then(|f| f.get("seed")).and_then(|v| v.as_i64());
        let result = crate::api::common::lists::get_album_list_logic(
            database,
            user_id,
            list_type,
            500,
            0,
            None,
            None,
            None,
            None,
            since,
            seed,
            text_filter,
            sort_field,
            sort_dir,
        )
        .await?;
        result.albums.into_iter().map(|a| a.id).collect()
    };

    // Fetch songs for each album, capping total at 1000
    let mut songs = Vec::new();
    for album_id in &album_ids {
        if songs.len() >= 1000 {
            break;
        }
        let album_songs =
            repo::browse::get_songs_by_album_for_user(database, album_id, user_id).await?;
        songs.extend(album_songs);
    }
    songs.truncate(1000);
    Ok(songs)
}

async fn materialize_forgotten_favorites_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    filters: Option<&serde_json::Value>,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let seed = filters
        .and_then(|f| f.get("seed"))
        .and_then(|v| v.as_i64())
        .or(Some(0));
    let settings = crate::api::common::lists::ForgottenFavoritesSettings::for_queue(
        database, user_id, filters,
    )
    .await?;

    let result = crate::api::common::lists::get_forgotten_favorites_song_models(
        database,
        user_id,
        MAX_QUEUE_SIZE as i64,
        0,
        settings,
        seed,
        crate::api::common::lists::ListViewOptions {
            filter: text_filter,
            sort: sort_field,
            sort_dir,
        },
    )
    .await?;

    if result.1 as usize > MAX_QUEUE_SIZE {
        return Err(FerrotuneApiError(Error::InvalidRequest(format!(
            "Queue size {} exceeds maximum of {}",
            result.1, MAX_QUEUE_SIZE
        ))));
    }

    Ok(result.0)
}

async fn materialize_forgotten_favorites_queue_song_page(
    database: &crate::db::Database,
    user_id: i64,
    filters: Option<&serde_json::Value>,
    view_options: crate::api::common::lists::ListViewOptions<'_>,
    offset: usize,
    limit: usize,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let seed = filters
        .and_then(|f| f.get("seed"))
        .and_then(|v| v.as_i64())
        .or(Some(0));
    let settings = crate::api::common::lists::ForgottenFavoritesSettings::for_queue(
        database, user_id, filters,
    )
    .await?;

    let result = crate::api::common::lists::get_forgotten_favorites_song_models(
        database,
        user_id,
        limit as i64,
        offset as i64,
        settings,
        seed,
        view_options,
    )
    .await?;

    Ok(result.0)
}

async fn materialize_most_played_recently_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    filters: Option<&serde_json::Value>,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let since = filters
        .and_then(|f| f.get("since"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let result = crate::api::common::lists::get_most_played_recently_logic(
        database,
        user_id,
        1000,
        0,
        None,
        since,
        crate::api::common::lists::ListViewOptions {
            filter: text_filter,
            sort: sort_field,
            sort_dir,
        },
    )
    .await?;

    let song_ids: Vec<String> = result.songs.iter().map(|s| s.id.clone()).collect();
    Ok(repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?)
}

async fn materialize_most_liked_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    text_filter: Option<&str>,
    sort_field: Option<&str>,
    sort_dir: Option<&str>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let (songs, _) = crate::api::common::lists::get_most_liked_song_models(
        database,
        user_id,
        1000,
        0,
        crate::api::common::lists::ListViewOptions {
            filter: text_filter,
            sort: sort_field,
            sort_dir,
        },
    )
    .await?;
    Ok(songs)
}

/// Materialize songs for the Similar Tracks (discovery) queue source.
async fn materialize_similar_tracks_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    filters: Option<&serde_json::Value>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    #[cfg(feature = "bliss")]
    {
        // Use the same discovery logic (and seed) that produced the client view,
        // so the playback queue matches the list the user clicked on.
        let seed = filters.and_then(|f| f.get("seed")).and_then(|v| v.as_i64());
        let count = filters
            .and_then(|f| f.get("count"))
            .and_then(|v| v.as_i64())
            .unwrap_or(50);
        let exclude_recent_days = filters
            .and_then(|f| f.get("excludeRecentDays"))
            .and_then(|v| v.as_i64())
            .unwrap_or(7);
        // Forward the seed song ID resolved when the section's list was built.
        // Without this, a remote-controlling session could have recorded new
        // scrobbles between view and play, so the server would pick a different
        // seed song and materialize a different "similar tracks" list than the
        // one the user clicked — playing the wrong song.
        let seed_song_id = filters
            .and_then(|f| f.get("seedSongId"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let discovery = crate::api::discovery::discover_similar_songs(
            database,
            user_id,
            count,
            exclude_recent_days,
            1000,
            0,
            None,
            seed,
            seed_song_id,
        )
        .await?;

        let song_ids: Vec<String> = discovery.song.into_iter().map(|s| s.id).collect();
        return Ok(repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?);
    }

    #[cfg(not(feature = "bliss"))]
    {
        let _ = (database, user_id, filters);
        Ok(Vec::new())
    }
}

/// Materialize songs from a queue source
pub(crate) async fn materialize_queue_songs(
    database: &crate::db::Database,
    user_id: i64,
    source_type: QueueSourceType,
    source_id: Option<&str>,
    filters: Option<&serde_json::Value>,
    sort: Option<&serde_json::Value>,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
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
            let songs =
                repo::browse::get_songs_by_album_for_user(database, album_id, user_id).await?;
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
            // Same query, filter and order as the artist page's song list, so
            // the queue matches what the user saw.
            let sort = crate::api::browse::artist_song_sort(sort_field.as_deref())?;
            let descending = crate::api::browse::collection_song_descending(sort_dir.as_deref())?;
            Ok(repo::browse::get_songs_by_artist_for_user(
                database,
                artist_id,
                user_id,
                text_filter,
                sort,
                descending,
            )
            .await?)
        }
        QueueSourceType::Playlist => {
            let playlist_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Playlist ID required".to_string()))?;
            let songs = queries::get_playlist_songs(database, playlist_id, user_id).await?;
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
                database,
                playlist_id,
                user_id,
                sort_field.as_deref(),
                sort_dir.as_deref(),
                text_filter,
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

            Ok(
                search_songs_for_queue(database, user_id, query, &search_params, None, None)
                    .await?,
            )
        }
        QueueSourceType::Favorites => {
            materialize_favorites_songs(
                database,
                user_id,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
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

            Ok(
                search_songs_for_queue(database, user_id, query, &search_params, None, None)
                    .await?,
            )
        }
        QueueSourceType::Directory => {
            let dir_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            let songs = queries::get_songs_by_directory(database, dir_id, user_id).await?;
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
            let songs = queries::get_songs_by_directory_flat(database, dir_id, user_id).await?;
            // Apply text filtering and sorting if provided
            Ok(sorting::filter_and_sort_songs(
                songs,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            ))
        }
        QueueSourceType::History => {
            materialize_history_songs(
                database,
                user_id,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::SongRadio => {
            let song_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Song ID required for radio".to_string()))?;
            materialize_song_radio_songs(database, user_id, song_id).await
        }
        QueueSourceType::AlbumList => {
            materialize_album_list_queue_songs(
                database,
                user_id,
                source_id,
                filters,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::ContinueListening => {
            let continue_listening = crate::api::common::lists::get_continue_listening_logic(
                database,
                user_id,
                500,
                0,
                None,
                crate::api::common::lists::ListViewOptions {
                    filter: text_filter,
                    sort: sort_field.as_deref(),
                    sort_dir: sort_dir.as_deref(),
                },
            )
            .await?;

            let mut songs = Vec::new();
            for item in continue_listening.entries {
                if songs.len() >= 1000 {
                    break;
                }

                match item.entry_type.as_str() {
                    "album" => {
                        let Some(album) = item.album else {
                            continue;
                        };
                        let album_songs =
                            repo::browse::get_songs_by_album_for_user(database, &album.id, user_id)
                                .await?;
                        songs.extend(album_songs);
                    }
                    "playlist" => {
                        let Some(playlist) = item.playlist else {
                            continue;
                        };
                        let playlist_songs =
                            queries::get_playlist_songs(database, &playlist.id, user_id).await?;
                        songs.extend(playlist_songs);
                    }
                    "smartPlaylist" => {
                        let Some(playlist) = item.playlist else {
                            continue;
                        };
                        let smart_playlist_songs = get_smart_playlist_songs_by_id(
                            database,
                            &playlist.id,
                            user_id,
                            None,
                            None,
                            None,
                        )
                        .await?;
                        songs.extend(smart_playlist_songs);
                    }
                    "songRadio" => {
                        let Some(source) = item.source else {
                            continue;
                        };
                        let radio_songs =
                            materialize_song_radio_songs(database, user_id, &source.id).await?;
                        songs.extend(radio_songs);
                    }
                    "albumList" => {
                        let Some(source) = item.source else {
                            continue;
                        };
                        let album_list_songs = materialize_album_list_queue_songs(
                            database,
                            user_id,
                            Some(&source.id),
                            None,
                            None,
                            None,
                            None,
                        )
                        .await?;
                        songs.extend(album_list_songs);
                    }
                    "favorites" => {
                        let favorite_songs =
                            materialize_favorites_songs(database, user_id, None, None, None)
                                .await?;
                        songs.extend(favorite_songs);
                    }
                    "history" => {
                        let history_songs =
                            materialize_history_songs(database, user_id, None, None, None).await?;
                        songs.extend(history_songs);
                    }
                    "forgottenFavorites" => {
                        let forgotten_favorite_songs = materialize_forgotten_favorites_queue_songs(
                            database, user_id, None, None, None, None,
                        )
                        .await?;
                        songs.extend(forgotten_favorite_songs);
                    }
                    "mostPlayedRecently" => {
                        let most_played_recently_songs =
                            materialize_most_played_recently_queue_songs(
                                database, user_id, None, None, None, None,
                            )
                            .await?;
                        songs.extend(most_played_recently_songs);
                    }
                    "mostLiked" => {
                        songs.extend(
                            materialize_most_liked_queue_songs(database, user_id, None, None, None)
                                .await?,
                        );
                    }
                    "similarTracks" => {
                        let similar_songs =
                            materialize_similar_tracks_queue_songs(database, user_id, filters)
                                .await?;
                        songs.extend(similar_songs);
                    }
                    _ => {}
                }
            }
            songs.truncate(1000);
            Ok(songs)
        }
        QueueSourceType::ForgottenFavorites => {
            materialize_forgotten_favorites_queue_songs(
                database,
                user_id,
                filters,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::MostPlayedRecently => {
            materialize_most_played_recently_queue_songs(
                database,
                user_id,
                filters,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::MostLiked => {
            materialize_most_liked_queue_songs(
                database,
                user_id,
                text_filter,
                sort_field.as_deref(),
                sort_dir.as_deref(),
            )
            .await
        }
        QueueSourceType::SimilarTracks => {
            materialize_similar_tracks_queue_songs(database, user_id, filters).await
        }
        QueueSourceType::Other => {
            // For "other" source with no song IDs, treat as library
            let search_params = build_search_params_from_json(filters, sort);
            Ok(search_songs_for_queue(database, user_id, "*", &search_params, None, None).await?)
        }
    }
}

/// Materialize several collection sources in request order, keeping the first
/// occurrence of each song ID. This gives bulk actions deterministic ordering
/// without sending complete collection DTOs through the browser.
pub(crate) async fn materialize_queue_sources(
    database: &crate::db::Database,
    user_id: i64,
    sources: &[QueueSourceRequest],
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    let mut seen = std::collections::HashSet::new();
    let mut songs = Vec::new();

    for source in sources {
        let source_type: QueueSourceType = source.source_type.parse().map_err(|_| {
            Error::InvalidRequest(format!("Invalid source type: {}", source.source_type))
        })?;
        let source_songs = materialize_queue_songs(
            database,
            user_id,
            source_type,
            source.source_id.as_deref(),
            source.filters.as_ref(),
            source.sort.as_ref(),
        )
        .await?;

        for song in source_songs {
            if seen.insert(song.id.clone()) {
                songs.push(song);
            }
        }
    }

    Ok(songs)
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
        artist_sort: None,
        artist_sort_dir: None,
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
        min_likes: None,
        max_likes: None,
        shuffle_excluded_only: None,
        disabled_only: None,
        min_bitrate: None,
        max_bitrate: None,
        added_after: None,
        added_before: None,
        inline_images: None, // Not used for queue materialization
        missing_cover_art: None,
        file_format: None,
        artist_filter: None,
        album_filter: None,
        title_filter: None,
        last_played_after: None,
        last_played_before: None,
        music_folder_id: None,
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
            if let Some(v) = obj.get("minLikes").and_then(|v| v.as_i64()) {
                params.min_likes = Some(v as i32);
            }
            if let Some(v) = obj.get("maxLikes").and_then(|v| v.as_i64()) {
                params.max_likes = Some(v as i32);
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
            if let Some(v) = obj.get("artistFilter").and_then(|v| v.as_str()) {
                params.artist_filter = Some(v.to_string());
            }
            if let Some(v) = obj.get("albumFilter").and_then(|v| v.as_str()) {
                params.album_filter = Some(v.to_string());
            }
            if let Some(v) = obj.get("titleFilter").and_then(|v| v.as_str()) {
                params.title_filter = Some(v.to_string());
            }
            if let Some(v) = obj.get("lastPlayedAfter").and_then(|v| v.as_str()) {
                params.last_played_after = Some(v.to_string());
            }
            if let Some(v) = obj.get("lastPlayedBefore").and_then(|v| v.as_str()) {
                params.last_played_before = Some(v.to_string());
            }
            if let Some(v) = obj.get("musicFolderId").and_then(|v| v.as_i64()) {
                params.music_folder_id = Some(v);
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
    database: &crate::db::Database,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
    offset: usize,
    limit: usize,
) -> FerrotuneApiResult<Vec<crate::db::models::Song>> {
    // If we have explicit song IDs, use those
    if let Some(ref song_ids) = queue.parse_song_ids() {
        // Apply shuffle indices if the queue is shuffled
        let ordered_ids: Vec<&str> = if queue.is_shuffled {
            if let Some(indices) = queue.shuffle_indices() {
                indices
                    .iter()
                    .filter_map(|&idx| song_ids.get(idx).map(|s| s.as_str()))
                    .collect()
            } else {
                song_ids.iter().map(|s| s.as_str()).collect()
            }
        } else {
            song_ids.iter().map(|s| s.as_str()).collect()
        };

        // Get the slice we need
        let page_ids: Vec<&str> = ordered_ids
            .iter()
            .skip(offset)
            .take(limit)
            .copied()
            .collect();

        if page_ids.is_empty() {
            return Ok(vec![]);
        }

        // Fetch songs by IDs - need to convert to owned strings for the query
        let page_ids_owned: Vec<String> = page_ids.iter().map(|s| s.to_string()).collect();
        return Ok(
            repo::browse::get_songs_by_ids_for_user(database, &page_ids_owned, user_id).await?,
        );
    }

    // Parse the source parameters
    let source_type: QueueSourceType = queue.source_type.parse().unwrap_or_default();
    let filters: Option<serde_json::Value> = queue
        .filters_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());
    let sort: Option<serde_json::Value> = queue
        .sort_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    if queue.is_shuffled {
        return Err(
            Error::Internal("shuffled queues must store explicit song IDs".to_string()).into(),
        );
    }

    if matches!(source_type, QueueSourceType::ForgottenFavorites) {
        let (sort_field, sort_dir) = sorting::parse_sort_from_json(sort.as_ref());
        let text_filter = filters
            .as_ref()
            .and_then(|f| f.get("filter"))
            .and_then(|v| v.as_str());

        return materialize_forgotten_favorites_queue_song_page(
            database,
            user_id,
            filters.as_ref(),
            crate::api::common::lists::ListViewOptions {
                filter: text_filter,
                sort: sort_field.as_deref(),
                sort_dir: sort_dir.as_deref(),
            },
            offset,
            limit,
        )
        .await;
    }

    // For non-shuffled lazy queues, materialize just the page we need when
    // the source supports server-side pagination (library/search/genre).
    // This avoids loading thousands of songs just to render a 50-song slice.
    if matches!(
        source_type,
        QueueSourceType::Library
            | QueueSourceType::Search
            | QueueSourceType::Genre
            | QueueSourceType::Directory
            | QueueSourceType::DirectoryFlat
    ) {
        if let Some(page) = materialize_lazy_queue_page_paginated(
            database,
            user_id,
            source_type,
            queue.source_id.as_deref(),
            filters.as_ref(),
            sort.as_ref(),
            offset,
            limit,
        )
        .await?
        {
            return Ok(page);
        }
    }

    // Sources without a server-side page query (favorites, history,
    // playlists, …) fall back to full materialization; the caller only needs
    // one page, so slice it out of the materialized list.
    let all_songs = materialize_queue_songs(
        database,
        user_id,
        source_type,
        queue.source_id.as_deref(),
        filters.as_ref(),
        sort.as_ref(),
    )
    .await?;

    Ok(all_songs.into_iter().skip(offset).take(limit).collect())
}

/// Materialize a single page of a lazy queue using source-native pagination.
/// Returns None when the source cannot be paginated server-side, so callers
/// can fall back to full materialization.
#[allow(clippy::too_many_arguments)]
async fn materialize_lazy_queue_page_paginated(
    database: &crate::db::Database,
    user_id: i64,
    source_type: QueueSourceType,
    source_id: Option<&str>,
    filters: Option<&serde_json::Value>,
    sort: Option<&serde_json::Value>,
    offset: usize,
    limit: usize,
) -> FerrotuneApiResult<Option<Vec<crate::db::models::Song>>> {
    let (_sort_field, _sort_dir) = sorting::parse_sort_from_json(sort);
    let text_filter = filters
        .and_then(|f| f.get("filter"))
        .and_then(|v| v.as_str());

    let songs = match source_type {
        QueueSourceType::Library | QueueSourceType::Search => {
            let query_from_filters = filters
                .and_then(|f| f.get("query"))
                .and_then(|v| v.as_str());
            let query = query_from_filters.or(source_id).unwrap_or("*");
            let search_params = build_search_params_from_json(filters, sort);

            search_songs_for_queue(
                database,
                user_id,
                query,
                &search_params,
                Some(offset),
                Some(limit),
            )
            .await?
        }
        QueueSourceType::Genre => {
            let genre =
                source_id.ok_or_else(|| Error::InvalidRequest("Genre required".to_string()))?;
            let mut search_params = build_search_params_from_json(filters, sort);
            search_params.genre = Some(genre.to_string());
            let query = text_filter.unwrap_or("*");

            search_songs_for_queue(
                database,
                user_id,
                query,
                &search_params,
                Some(offset),
                Some(limit),
            )
            .await?
        }
        QueueSourceType::Directory => {
            let dir_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            return Ok(Some(
                queries::get_songs_by_directory_page(
                    database,
                    dir_id,
                    user_id,
                    false,
                    text_filter,
                    _sort_field.as_deref(),
                    _sort_dir.as_deref(),
                    offset,
                    limit,
                )
                .await?,
            ));
        }
        QueueSourceType::DirectoryFlat => {
            let dir_id = source_id
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            return Ok(Some(
                queries::get_songs_by_directory_page(
                    database,
                    dir_id,
                    user_id,
                    true,
                    text_filter,
                    _sort_field.as_deref(),
                    _sort_dir.as_deref(),
                    offset,
                    limit,
                )
                .await?,
            ));
        }
        _ => return Ok(None),
    };

    Ok(Some(songs))
}

/// Get the total count for a queue (handles both lazy and non-lazy queues)
/// For lazy queues: uses cached total_count or re-materializes to count
/// For non-lazy queues: counts entries in the database
pub async fn get_queue_total_count(
    database: &crate::db::Database,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
    session_id: &str,
) -> FerrotuneApiResult<usize> {
    if queue.is_lazy {
        get_lazy_queue_count(database, queue, user_id).await
    } else {
        Ok(queries::get_queue_length_by_session(database, session_id).await? as usize)
    }
}

/// Get the total count for a lazy queue
/// This re-runs the count query based on source parameters
pub async fn get_lazy_queue_count(
    database: &crate::db::Database,
    queue: &crate::db::models::PlayQueue,
    user_id: i64,
) -> FerrotuneApiResult<usize> {
    // If we have a cached total_count, use it
    if let Some(count) = queue.total_count {
        return Ok(count as usize);
    }

    // If we have explicit song IDs, count those
    if let Some(ref song_ids) = queue.parse_song_ids() {
        return Ok(song_ids.len());
    }

    // Otherwise, count without materializing when the source supports it.
    let source_type: QueueSourceType = queue.source_type.parse().unwrap_or_default();
    let filters: Option<serde_json::Value> = queue
        .filters_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());
    let sort: Option<serde_json::Value> = queue
        .sort_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    if matches!(
        source_type,
        QueueSourceType::Library
            | QueueSourceType::Search
            | QueueSourceType::Genre
            | QueueSourceType::Directory
            | QueueSourceType::DirectoryFlat
    ) {
        let text_filter = filters
            .as_ref()
            .and_then(|f| f.get("filter"))
            .and_then(|v| v.as_str());

        let mut search_params = build_search_params_from_json(filters.as_ref(), sort.as_ref());
        if let QueueSourceType::Genre = source_type {
            let genre = queue
                .source_id
                .as_deref()
                .ok_or_else(|| Error::InvalidRequest("Genre required".to_string()))?;
            search_params.genre = Some(genre.to_string());
        }

        let query = match source_type {
            QueueSourceType::Library
            | QueueSourceType::Directory
            | QueueSourceType::DirectoryFlat => text_filter.unwrap_or("*"),
            QueueSourceType::Search => queue.source_id.as_deref().unwrap_or("*"),
            QueueSourceType::Genre => text_filter.unwrap_or("*"),
            _ => "*",
        };

        if matches!(
            source_type,
            QueueSourceType::Library | QueueSourceType::Search | QueueSourceType::Genre
        ) {
            return crate::api::common::search::count_songs_for_queue(
                database,
                user_id,
                query,
                &search_params,
            )
            .await
            .map(|c| c as usize)
            .map_err(FerrotuneApiError::from);
        }
        if matches!(
            source_type,
            QueueSourceType::Directory | QueueSourceType::DirectoryFlat
        ) {
            let source_id = queue
                .source_id
                .as_deref()
                .ok_or_else(|| Error::InvalidRequest("Directory ID required".to_string()))?;
            return queries::count_songs_by_directory(
                database,
                source_id,
                user_id,
                source_type == QueueSourceType::DirectoryFlat,
                text_filter,
            )
            .await
            .map(|count| count as usize)
            .map_err(FerrotuneApiError::from);
        }
    }

    // Sources without a server-side count query (favorites, history,
    // playlists, forgotten favorites, …) have to be materialized to be
    // counted, as the doc comment above promises.
    let songs = materialize_queue_songs(
        database,
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

    if total == 1 {
        return vec![0];
    }

    // Place current song at position 0, shuffle ALL other songs after it.
    // This ensures every track in the source is reachable regardless of
    // where playback started.
    let mut others: Vec<usize> = (0..total).filter(|&i| i != current_index).collect();
    let mut rng = StdRng::seed_from_u64(seed);
    others.shuffle(&mut rng);

    let mut indices = Vec::with_capacity(total);
    indices.push(current_index);
    indices.extend(others);
    indices
}

/// Get shuffle indices from the in-memory cache, or parse from JSON and cache.
async fn get_shuffle_indices(
    state: &AppState,
    user_id: i64,
    shuffle_seed: Option<i64>,
    shuffle_indices_json: Option<&str>,
    total: usize,
) -> Vec<usize> {
    let seed = match shuffle_seed {
        Some(s) => s,
        None => {
            // No seed → can't cache, parse directly
            return shuffle_indices_json
                .and_then(|json| serde_json::from_str(json).ok())
                .unwrap_or_else(|| (0..total).collect());
        }
    };

    // Try read cache first
    {
        let cache = state.shuffle_cache.read().await;
        if let Some(indices) = cache.get(&(user_id, seed)) {
            return (**indices).clone();
        }
    }

    // Parse and fill cache
    let indices: Vec<usize> = shuffle_indices_json
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_else(|| (0..total).collect());

    let indices_arc = Arc::new(indices.clone());
    {
        let mut cache = state.shuffle_cache.write().await;
        cache.insert((user_id, seed), indices_arc);
    }

    indices
}

/// Invalidate the shuffle indices cache for a user.
async fn invalidate_shuffle_cache(state: &AppState, user_id: i64) {
    let mut cache = state.shuffle_cache.write().await;
    cache.retain(|&(uid, _), _| uid != user_id);
}

#[cfg(test)]
mod tests {
    use super::{shifted_current_index_after_remove, QueueDisplayItem, UpNextLayout};
    use crate::db::models::PlayQueueUpNext;

    fn up_next(entry_id: &str, anchor: Option<usize>) -> PlayQueueUpNext {
        PlayQueueUpNext {
            entry_id: entry_id.to_string(),
            song_id: format!("song-{entry_id}"),
            sequence: 0,
            anchor_context_index: anchor.map(|a| a as i64),
        }
    }

    #[test]
    fn empty_up_next_keeps_context_positions() {
        let layout = UpNextLayout::new(vec![]);
        assert_eq!(layout.total(5), 5);
        assert_eq!(layout.current_display_index(2, None), 2);
        assert_eq!(
            layout.display_item_at(2, 5, 2),
            Some(QueueDisplayItem::Context(2))
        );
        assert_eq!(layout.upcoming_count(), 0);
    }

    #[test]
    fn upcoming_rows_sit_after_current_before_next_context() {
        let layout = UpNextLayout::new(vec![up_next("a", None), up_next("b", None)]);
        assert_eq!(layout.total(3), 5);
        assert_eq!(layout.current_display_index(1, None), 1);
        assert_eq!(layout.upcoming_count(), 2);
        assert_eq!(
            layout.display_item_at(2, 3, 1),
            Some(QueueDisplayItem::Upcoming { index: 0 })
        );
        assert_eq!(
            layout.display_item_at(3, 3, 1),
            Some(QueueDisplayItem::Upcoming { index: 1 })
        );
        assert_eq!(
            layout.display_item_at(4, 3, 1),
            Some(QueueDisplayItem::Context(2))
        );
    }

    #[test]
    fn played_up_next_rows_are_anchored_in_history() {
        let layout = UpNextLayout::new(vec![
            up_next("a0", Some(0)),
            up_next("b0", Some(0)),
            up_next("a1", Some(1)),
            up_next("next", None),
        ]);
        assert_eq!(layout.total(3), 7);
        assert_eq!(layout.current_display_index(1, None), 3);
        assert_eq!(layout.current_display_index(1, Some("a1")), 4);
        assert_eq!(
            layout.display_item_at(3, 3, 1),
            Some(QueueDisplayItem::Context(1))
        );
        assert_eq!(
            layout.display_item_at(4, 3, 1),
            Some(QueueDisplayItem::Anchored {
                anchor: 1,
                index: 0
            })
        );
        assert_eq!(
            layout.display_item_at(5, 3, 1),
            Some(QueueDisplayItem::Upcoming { index: 0 })
        );
        assert_eq!(
            layout.display_item_at(6, 3, 1),
            Some(QueueDisplayItem::Context(2))
        );
        assert_eq!(layout.upcoming_count(), 1);
    }

    #[test]
    fn current_manual_row_anchor_matches_its_display_position() {
        let layout = UpNextLayout::new(vec![up_next("a", Some(2)), up_next("b", None)]);
        // C0, C1, C2, A, B, C3
        assert_eq!(layout.current_display_index(2, Some("a")), 3);
        assert_eq!(
            layout.display_item_at(3, 4, 2),
            Some(QueueDisplayItem::Anchored {
                anchor: 2,
                index: 0
            })
        );
        assert_eq!(
            layout.display_item_at(4, 4, 2),
            Some(QueueDisplayItem::Upcoming { index: 0 })
        );
        assert_eq!(
            layout.display_item_at(5, 4, 2),
            Some(QueueDisplayItem::Context(3))
        );
    }

    #[test]
    fn remove_after_current_keeps_current_index() {
        assert_eq!(shifted_current_index_after_remove(3, 5, 7), 3);
    }

    #[test]
    fn remove_before_current_shifts_current_index_back() {
        assert_eq!(shifted_current_index_after_remove(3, 1, 7), 2);
    }

    #[test]
    fn remove_current_keeps_position_when_next_song_exists() {
        assert_eq!(shifted_current_index_after_remove(3, 3, 7), 3);
    }

    #[test]
    fn remove_current_last_song_clamps_to_new_end() {
        assert_eq!(shifted_current_index_after_remove(7, 7, 7), 6);
    }

    #[test]
    fn remove_only_song_resets_current_index() {
        assert_eq!(shifted_current_index_after_remove(0, 0, 0), 0);
    }
}
