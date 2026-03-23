//! API modules for Ferrotune.
//!
//! This module provides two separate APIs:
//!
//! - **`subsonic`**: OpenSubsonic-compatible API for music player clients (port 4040 by default)
//! - **`ferrotune`**: Admin/management API for Ferrotune-specific features (port 4041 by default)
//!
//! Additionally, when built with embedded UI assets (client/out exists at compile time),
//! the subsonic API will also serve the web client at the root path.

pub mod common;
pub mod embedded_ui;
pub mod ferrotune;
pub mod subsonic;

// Re-export commonly used items from subsonic for backward compatibility
pub use subsonic::first_string;
pub use subsonic::first_string_or_none;
pub use subsonic::string_or_seq;
pub use subsonic::QsQuery;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub use ferrotune::scan_state::{create_scan_state, ScanState};

/// Cached shuffle indices keyed by (user_id, shuffle_seed).
pub type ShuffleIndicesCache = RwLock<HashMap<(i64, i64), Arc<Vec<usize>>>>;

// ============================================================================
// Session Manager — in-memory per-session broadcast channels for SSE
// ============================================================================

/// Events broadcast to SSE subscribers of a playback session.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionEvent {
    /// Queue contents changed AND playback should start (new queue / play at index)
    QueueChanged,
    /// Queue metadata updated (shuffle/repeat/add/remove/move) — no playback change
    QueueUpdated,
    /// Playback command from a remote controller
    #[serde(rename_all = "camelCase")]
    PlaybackCommand {
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        position_ms: Option<i64>,
    },
    /// Position/playback state update from the session owner
    #[serde(rename_all = "camelCase")]
    PositionUpdate {
        current_index: usize,
        position_ms: i64,
        is_playing: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_song_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_song_title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_song_artist: Option<String>,
    },
    /// Session ended (owner disconnected or timed out)
    SessionEnded,
    /// Volume change command from a remote controller
    #[serde(rename_all = "camelCase")]
    VolumeChange { volume: f64, is_muted: bool },
    /// The session list changed (a session was created or deleted)
    SessionListChanged,
}

/// Manages per-session broadcast channels for real-time SSE updates.
pub struct SessionManager {
    /// Map of session_id -> broadcast sender
    channels: RwLock<HashMap<String, broadcast::Sender<SessionEvent>>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            channels: RwLock::new(HashMap::new()),
        }
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get or create a broadcast channel for a session.
    pub async fn get_or_create_sender(&self, session_id: &str) -> broadcast::Sender<SessionEvent> {
        {
            let channels = self.channels.read().await;
            if let Some(tx) = channels.get(session_id) {
                return tx.clone();
            }
        }
        let mut channels = self.channels.write().await;
        // Double-check after acquiring write lock
        if let Some(tx) = channels.get(session_id) {
            return tx.clone();
        }
        let (tx, _) = broadcast::channel(64);
        channels.insert(session_id.to_string(), tx.clone());
        tx
    }

    /// Subscribe to a session's event stream.
    pub async fn subscribe(&self, session_id: &str) -> broadcast::Receiver<SessionEvent> {
        let tx = self.get_or_create_sender(session_id).await;
        tx.subscribe()
    }

    /// Broadcast an event to all subscribers of a session.
    pub async fn broadcast(&self, session_id: &str, event: SessionEvent) {
        let channels = self.channels.read().await;
        if let Some(tx) = channels.get(session_id) {
            let _ = tx.send(event);
        }
    }

    /// Remove a session's channel (on session end/cleanup).
    pub async fn remove(&self, session_id: &str) {
        let mut channels = self.channels.write().await;
        channels.remove(session_id);
    }

    /// Broadcast an event to multiple sessions.
    pub async fn broadcast_to_sessions(&self, session_ids: &[String], event: SessionEvent) {
        let channels = self.channels.read().await;
        for session_id in session_ids {
            if let Some(tx) = channels.get(session_id) {
                let _ = tx.send(event.clone());
            }
        }
    }

    /// Get the number of active SSE receivers for a session.
    pub async fn receiver_count(&self, session_id: &str) -> usize {
        let channels = self.channels.read().await;
        channels
            .get(session_id)
            .map(|tx| tx.receiver_count())
            .unwrap_or(0)
    }
}

/// Shared application state for all API handlers.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: crate::config::Config,
    pub scan_state: Arc<ScanState>,
    /// Cache of parsed shuffle indices.
    /// Avoids re-parsing large JSON arrays on every queue window request.
    pub shuffle_cache: ShuffleIndicesCache,
    /// Manages per-session broadcast channels for real-time playback sync.
    pub session_manager: Arc<SessionManager>,
}

/// Common query parameters for OpenSubsonic API requests.
#[derive(Debug, Deserialize)]
pub struct CommonParams {
    pub u: Option<String>,
    pub p: Option<String>,
    pub t: Option<String>,
    pub s: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(default = "default_version")]
    pub v: String,
    #[serde(default = "default_client")]
    pub c: String,
    #[serde(default = "default_format")]
    pub f: String,
}

fn default_version() -> String {
    "1.16.1".to_string()
}

fn default_client() -> String {
    "unknown".to_string()
}

fn default_format() -> String {
    "xml".to_string()
}
