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
use std::net::IpAddr;
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
        client_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        position_ms: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        current_index: Option<usize>,
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
    VolumeChange {
        volume: f64,
        is_muted: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_id: Option<String>,
    },
    /// The connected client list changed (a client connected or disconnected)
    ClientListChanged,
    /// Session ownership changed to a different client (or cleared)
    #[serde(rename_all = "camelCase")]
    OwnerChanged {
        owner_client_id: Option<String>,
        owner_client_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resume_playback: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        position_ms: Option<i64>,
    },
}

/// A connected client (browser tab, app instance) in a session.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    pub client_id: String,
    pub client_name: String,
    pub network_address: Option<String>,
    pub hostname: Option<String>,
    pub device_label: Option<String>,
    #[serde(skip)]
    pub connected_at: Instant,
}

/// Optional metadata captured when a client opens an SSE connection.
#[derive(Clone, Debug, Default)]
pub struct ConnectedClientMetadata {
    pub remote_ip: Option<IpAddr>,
    pub hostname: Option<String>,
    pub device_label: Option<String>,
}

impl ConnectedClientMetadata {
    pub fn network_address(&self) -> Option<String> {
        self.remote_ip.map(|ip| ip.to_string())
    }
}

fn merge_client_metadata(client: &mut ConnectedClient, metadata: ConnectedClientMetadata) {
    if let Some(network_address) = metadata.network_address() {
        let address_changed = client.network_address.as_deref() != Some(network_address.as_str());
        client.network_address = Some(network_address);

        if address_changed || metadata.hostname.is_some() {
            client.hostname = metadata.hostname;
        }
    } else if metadata.hostname.is_some() {
        client.hostname = metadata.hostname;
    }

    if let Some(device_label) = metadata.device_label {
        client.device_label = Some(device_label);
    }
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
    pub async fn register_client(
        &self,
        session_id: &str,
        client_id: &str,
        client_name: &str,
        metadata: ConnectedClientMetadata,
    ) {
        // Ensure session state exists
        let _ = self.get_or_create_sender(session_id).await;
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.get_mut(session_id) {
            if let Some(existing) = state.clients.get_mut(client_id) {
                existing.connection_count += 1;
                existing.client.client_name = client_name.to_string();
                merge_client_metadata(&mut existing.client, metadata);
                return;
            }

            let mut client = ConnectedClient {
                client_id: client_id.to_string(),
                client_name: client_name.to_string(),
                network_address: None,
                hostname: None,
                device_label: None,
                connected_at: Instant::now(),
            };
            merge_client_metadata(&mut client, metadata);

            state.clients.insert(
                client_id.to_string(),
                ConnectedClientState {
                    client,
                    connection_count: 1,
                },
            );
        }
    }

    /// Update a connected client's reverse-DNS hostname if it still has the same IP.
    pub async fn update_client_hostname(
        &self,
        session_id: &str,
        client_id: &str,
        network_address: &str,
        hostname: String,
    ) -> bool {
        let mut sessions = self.sessions.write().await;
        let Some(state) = sessions.get_mut(session_id) else {
            return false;
        };
        let Some(existing) = state.clients.get_mut(client_id) else {
            return false;
        };
        if existing.client.network_address.as_deref() != Some(network_address) {
            return false;
        }
        if existing.client.hostname.as_deref() == Some(hostname.as_str()) {
            return false;
        }

        existing.client.hostname = Some(hostname);
        true
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

    /// Get the registered display client name for a connected client.
    pub async fn get_client_name(&self, session_id: &str, client_id: &str) -> Option<String> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .and_then(|state| state.clients.get(client_id))
            .map(|state| state.client.client_name.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{SessionEvent, SessionManager};
    use crate::api::ConnectedClientMetadata;
    use serde_json::json;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn volume_change_serializes_client_id_when_present() {
        let event = SessionEvent::VolumeChange {
            volume: 0.42,
            is_muted: false,
            client_id: Some("web-client".to_string()),
        };

        let serialized = serde_json::to_value(event).map_err(|error| error.to_string());

        assert_eq!(
            serialized,
            Ok(json!({
                "type": "volumeChange",
                "volume": 0.42,
                "isMuted": false,
                "clientId": "web-client",
            }))
        );
    }

    #[tokio::test]
    async fn duplicate_logical_client_connections_are_ref_counted() {
        let manager = SessionManager::new();

        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata {
                    remote_ip: Some(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10))),
                    hostname: Some("studio.local".to_string()),
                    device_label: None,
                },
            )
            .await;
        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-mobile",
                ConnectedClientMetadata {
                    remote_ip: Some(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10))),
                    hostname: None,
                    device_label: Some("Pixel 9".to_string()),
                },
            )
            .await;

        assert!(manager.is_client_connected("session-1", "client-1").await);
        let clients = manager.get_clients("session-1").await;
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].client_id, "client-1");
        assert_eq!(clients[0].client_name, "ferrotune-mobile");
        assert_eq!(clients[0].network_address.as_deref(), Some("192.168.1.10"));
        assert_eq!(clients[0].hostname.as_deref(), Some("studio.local"));
        assert_eq!(clients[0].device_label.as_deref(), Some("Pixel 9"));
        assert_eq!(
            manager
                .get_client_name("session-1", "client-1")
                .await
                .as_deref(),
            Some("ferrotune-mobile"),
        );

        assert!(!manager.unregister_client("session-1", "client-1").await);

        assert!(manager.is_client_connected("session-1", "client-1").await);
        assert_eq!(manager.get_clients("session-1").await.len(), 1);

        assert!(manager.unregister_client("session-1", "client-1").await);

        assert!(!manager.is_client_connected("session-1", "client-1").await);
        assert!(manager.get_clients("session-1").await.is_empty());
    }

    #[tokio::test]
    async fn reverse_dns_hostname_update_requires_matching_address() {
        let manager = SessionManager::new();

        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata {
                    remote_ip: Some(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 42))),
                    hostname: None,
                    device_label: None,
                },
            )
            .await;

        assert!(
            manager
                .update_client_hostname(
                    "session-1",
                    "client-1",
                    "10.0.0.42",
                    "listening-room.local".to_string(),
                )
                .await
        );
        assert!(
            !manager
                .update_client_hostname(
                    "session-1",
                    "client-1",
                    "10.0.0.99",
                    "wrong-host.local".to_string(),
                )
                .await
        );

        let clients = manager.get_clients("session-1").await;
        assert_eq!(clients[0].hostname.as_deref(), Some("listening-room.local"));
    }

    #[tokio::test]
    async fn unregistering_unknown_client_is_noop() {
        let manager = SessionManager::new();

        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata::default(),
            )
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
