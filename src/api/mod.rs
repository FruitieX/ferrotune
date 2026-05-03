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
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
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
        #[serde(skip_serializing_if = "Option::is_none")]
        volume: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_muted: Option<bool>,
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
    /// Volume change command from a remote controller
    #[serde(rename_all = "camelCase")]
    VolumeChange { volume: f64, is_muted: bool },
    /// The connected client list changed (a client connected or disconnected)
    ClientListChanged,
    /// Session ownership changed to a different client (or cleared)
    #[serde(rename_all = "camelCase")]
    OwnerChanged {
        owner_client_id: Option<String>,
        owner_client_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resume_playback: Option<bool>,
    },
}

/// A connected client (browser tab, app instance) in a session.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    pub client_id: String,
    pub client_name: String,
    #[serde(skip)]
    pub connected_at: Instant,
}

/// Internal connection state for a logical client.
///
/// A single logical client can open more than one SSE stream. Android does this
/// intentionally: the foreground WebView keeps UI state current while the
/// native PlaybackService keeps background media controls alive. Track the
/// number of live streams so dropping one stream does not make the whole device
/// look disconnected.
struct ConnectedClientState {
    client: ConnectedClient,
    connection_count: usize,
}

/// Per-session state: broadcast channel + connected clients.
struct SessionState {
    sender: broadcast::Sender<SessionEvent>,
    clients: HashMap<String, ConnectedClientState>,
}

/// Manages per-session broadcast channels and connected clients for real-time SSE updates.
pub struct SessionManager {
    /// Map of session_id -> session state
    sessions: RwLock<HashMap<String, SessionState>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
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
            let sessions = self.sessions.read().await;
            if let Some(state) = sessions.get(session_id) {
                return state.sender.clone();
            }
        }
        let mut sessions = self.sessions.write().await;
        // Double-check after acquiring write lock
        if let Some(state) = sessions.get(session_id) {
            return state.sender.clone();
        }
        let (tx, _) = broadcast::channel(64);
        sessions.insert(
            session_id.to_string(),
            SessionState {
                sender: tx.clone(),
                clients: HashMap::new(),
            },
        );
        tx
    }

    /// Subscribe to a session's event stream.
    pub async fn subscribe(&self, session_id: &str) -> broadcast::Receiver<SessionEvent> {
        let tx = self.get_or_create_sender(session_id).await;
        tx.subscribe()
    }

    /// Broadcast an event to all subscribers of a session.
    pub async fn broadcast(&self, session_id: &str, event: SessionEvent) {
        let sessions = self.sessions.read().await;
        if let Some(state) = sessions.get(session_id) {
            let _ = state.sender.send(event);
        }
    }

    /// Broadcast an event to multiple sessions.
    pub async fn broadcast_to_sessions(&self, session_ids: &[String], event: SessionEvent) {
        let sessions = self.sessions.read().await;
        for session_id in session_ids {
            if let Some(state) = sessions.get(session_id) {
                let _ = state.sender.send(event.clone());
            }
        }
    }

    /// Get the number of active SSE receivers for a session.
    pub async fn receiver_count(&self, session_id: &str) -> usize {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .map(|state| state.sender.receiver_count())
            .unwrap_or(0)
    }

    /// Register a client as connected to a session.
    pub async fn register_client(&self, session_id: &str, client_id: &str, client_name: &str) {
        // Ensure session state exists
        let _ = self.get_or_create_sender(session_id).await;
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.get_mut(session_id) {
            if let Some(existing) = state.clients.get_mut(client_id) {
                existing.connection_count += 1;
                existing.client.client_name = client_name.to_string();
                return;
            }

            state.clients.insert(
                client_id.to_string(),
                ConnectedClientState {
                    client: ConnectedClient {
                        client_id: client_id.to_string(),
                        client_name: client_name.to_string(),
                        connected_at: Instant::now(),
                    },
                    connection_count: 1,
                },
            );
        }
    }

    /// Unregister a client from a session.
    ///
    /// Returns true only when the logical client was fully removed. Duplicate
    /// connections for the same client_id are reference-counted and return
    /// false until the final stream disconnects.
    pub async fn unregister_client(&self, session_id: &str, client_id: &str) -> bool {
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.get_mut(session_id) {
            if let Some(existing) = state.clients.get_mut(client_id) {
                if existing.connection_count > 1 {
                    existing.connection_count -= 1;
                    return false;
                } else {
                    state.clients.remove(client_id);
                    return true;
                }
            }
        }
        false
    }

    /// Get all connected clients for a session.
    pub async fn get_clients(&self, session_id: &str) -> Vec<ConnectedClient> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .map(|state| {
                state
                    .clients
                    .values()
                    .map(|state| state.client.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Check if a specific client is currently connected to a session.
    pub async fn is_client_connected(&self, session_id: &str, client_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .map(|state| state.clients.contains_key(client_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::SessionManager;

    #[tokio::test]
    async fn duplicate_logical_client_connections_are_ref_counted() {
        let manager = SessionManager::new();

        manager
            .register_client("session-1", "client-1", "ferrotune-web")
            .await;
        manager
            .register_client("session-1", "client-1", "ferrotune-mobile")
            .await;

        assert!(manager.is_client_connected("session-1", "client-1").await);
        let clients = manager.get_clients("session-1").await;
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].client_id, "client-1");
        assert_eq!(clients[0].client_name, "ferrotune-mobile");

        assert!(!manager.unregister_client("session-1", "client-1").await);

        assert!(manager.is_client_connected("session-1", "client-1").await);
        assert_eq!(manager.get_clients("session-1").await.len(), 1);

        assert!(manager.unregister_client("session-1", "client-1").await);

        assert!(!manager.is_client_connected("session-1", "client-1").await);
        assert!(manager.get_clients("session-1").await.is_empty());
    }

    #[tokio::test]
    async fn unregistering_unknown_client_is_noop() {
        let manager = SessionManager::new();

        manager
            .register_client("session-1", "client-1", "ferrotune-web")
            .await;
        assert!(!manager.unregister_client("session-1", "missing").await);

        assert!(manager.is_client_connected("session-1", "client-1").await);
        assert_eq!(manager.get_clients("session-1").await.len(), 1);
    }
}

/// Shared application state for all API handlers.
pub struct AppState {
    pub database: crate::db::Database,
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
