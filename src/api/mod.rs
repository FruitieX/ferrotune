//! API modules for Ferrotune.
//!
//! All HTTP API routes are mounted below `/api` at the application boundary.

pub mod auth;
mod auth_routes;
mod browse;
pub mod client_ip;
pub mod common;
pub mod cover_art;
pub mod directory;
mod disabled_songs;
mod discovery;
mod duplicates;
pub mod embedded_ui;
mod filesystem;
pub mod history;
mod history_admin;
mod home;
pub mod inline_thumbnails;
pub mod lastfm;
mod listening;
mod lists;
mod match_dictionary;
mod media;
pub mod media_stream;
pub mod music_folders;
pub mod playlists;
mod playqueue;
mod preferences;
pub mod query;
mod queue;
pub mod recycle_bin;
mod routes;
mod scan;
pub mod scan_state;
mod scrobbles;
mod search;
pub mod server_config;
mod sessions;
mod setup;
mod shuffle_exclude;
pub mod smart_playlists;
mod songs;
mod starring;
mod stats;
pub mod tagger;
pub mod tagger_session;
pub mod tags;
mod testing;
pub mod transcode_cache;
pub mod transcoding;
pub mod users;
mod waveform;

pub use duplicates::{
    get_duplicates as ferrotune_get_duplicates, DuplicateFile, DuplicateGroup, DuplicatesResponse,
};
pub use history_admin::{
    delete_history_entries, delete_matching_history_entries, list_history_entries,
    DeleteManagedHistoryEntriesRequest, DeleteManagedHistoryEntriesResponse,
    DeleteMatchingManagedHistoryEntriesRequest, ManagedHistoryEntriesResponse, ManagedHistoryEntry,
    ManagedHistoryEntryKind, ManagedHistoryFilter,
};
pub use home::{
    get_continue_listening, get_home, ContinueListeningParams, HomeContinueListeningSection,
    HomePageParams, HomePageResponse,
};
pub use listening::{
    get_listening_stats as ferrotune_get_listening_stats,
    get_period_review as ferrotune_get_period_review, log_listening as ferrotune_log_listening,
    LogListeningRequest, LogListeningResponse, PeriodReviewQuery, PeriodReviewResponse,
};
pub use lists::{
    get_album_list, get_forgotten_favorites, get_most_played_recently, get_random_songs,
    get_songs_by_genre, AlbumListParams, AlbumListType, FerrotuneAlbumListResponse,
    FerrotuneRandomSongsResponse, FerrotuneSongsByGenreResponse, ForgottenFavoritesParams,
    ForgottenFavoritesResponse, MostPlayedRecentlyParams, MostPlayedRecentlyResponse,
    RandomSongsParams, SongsByGenreParams,
};
pub use match_dictionary::{
    get_match_dictionary, save_match_dictionary, MatchDictionaryEntry, MatchDictionaryResponse,
    SaveMatchDictionaryRequest, SaveMatchDictionaryResponse,
};
pub use playqueue::{
    save_play_queue as ferrotune_save_play_queue, SavePlayQueueRequest, SavePlayQueueResponse,
};
pub use preferences::{
    delete_preference as ferrotune_delete_preference, get_preference as ferrotune_get_preference,
    get_preferences as ferrotune_get_preferences, set_preference as ferrotune_set_preference,
    update_preferences as ferrotune_update_preferences, GetPreferenceResponse, PreferencesResponse,
    SetPreferenceRequest, UpdatePreferencesRequest,
};
pub use queue::{
    get_lazy_queue_count, materialize_lazy_queue_page, start_queue, StartQueueRequest,
};
pub use routes::ErrorResponse;
pub use scrobbles::{
    check_import_duplicate, get_play_counts, import_scrobbles, import_with_timestamps,
    scrobble as ferrotune_scrobble, CheckDuplicateParams, GetPlayCountsRequest, ImportMode,
    ImportScrobbleEntry, ImportScrobblesRequest, ImportSongWithPlays, ImportWithTimestampsRequest,
    PlayEvent, ScrobbleParams as FerrotuneScrobbleParams,
};
pub use setup::{complete_setup, get_setup_status, SetupStatusResponse};
pub use stats::{get_stats as ferrotune_get_stats, StatsResponse};
pub use waveform::{get_waveform as ferrotune_get_waveform, WaveformResponse};

pub use query::first_string;
pub use query::first_string_or_none;
pub use query::string_or_seq;
pub use query::QsQuery;

use axum::{response::IntoResponse, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};

pub use scan_state::{create_scan_state, ScanState};

/// How long a client entry stays alive after its last SSE stream drops, as long
/// as it keeps receiving heartbeats. The web client sends heartbeats every 30s
/// while visible or playing, so 90s (3×) gives plenty of slack. After this
/// grace period with no further heartbeat, the background sweep reaps the
/// entry.
const HEARTBEAT_GRACE: Duration = Duration::from_secs(90);

/// Create the API router with a single global `/api` prefix.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new().nest("/api", routes::create_router(state))
}

/// Fallback handler for unknown API or application endpoints.
pub async fn fallback_handler(uri: axum::http::Uri) -> impl IntoResponse {
    tracing::warn!(path = %uri.path(), "Unknown endpoint requested");

    (
        axum::http::StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({
            "error": format!("Endpoint not found: {}", uri.path())
        })),
    )
}

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
///
/// `connection_count` tracks live SSE streams. When it reaches zero the client
/// is only kept alive while its heartbeat is still fresh (see
/// `HEARTBEAT_GRACE`). The background sweep in `main.rs` removes entries whose
/// SSE has been gone (`connection_count == 0`) and whose `last_heartbeat_at` is
/// stale, so a tab whose SSE was silently torn down by a proxy/browser but
/// that is still playing (and therefore still heartbeating) stays in the
/// connected-clients list — playback itself uses a separate streaming path and
/// does not depend on SSE.
struct ConnectedClientState {
    client: ConnectedClient,
    connection_count: usize,
    last_heartbeat_at: Option<Instant>,
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
                    last_heartbeat_at: None,
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

    /// Record a heartbeat for a client.
    ///
    /// Returns `true` if a new entry was created (i.e. the client was missing
    /// from the in-memory map), so the caller can broadcast `ClientListChanged`
    /// to other tabs/clients. Returns `false` if the client already existed
    /// (just refreshed its `last_heartbeat_at`).
    ///
    /// This is the key liveness signal that lets a tab stay in the
    /// connected-clients list even when its SSE stream has been silently
    /// torn down by a proxy/browser: the backend's `ClientCleanupGuard`
    /// keeps the entry alive for [`HEARTBEAT_GRACE`] after the SSE drops, and
    /// as long as heartbeats keep landing the entry is refreshed and the
    /// background sweep won't reap it.
    pub async fn record_heartbeat(
        &self,
        session_id: &str,
        client_id: &str,
        client_name: Option<&str>,
    ) -> bool {
        let _ = self.get_or_create_sender(session_id).await;
        let now = Instant::now();
        let mut sessions = self.sessions.write().await;
        let Some(state) = sessions.get_mut(session_id) else {
            return false;
        };

        if let Some(existing) = state.clients.get_mut(client_id) {
            existing.last_heartbeat_at = Some(now);
            if let Some(name) = client_name {
                existing.client.client_name = name.to_string();
            }
            return false;
        }

        let client = ConnectedClient {
            client_id: client_id.to_string(),
            client_name: client_name.unwrap_or("ferrotune-web").to_string(),
            network_address: None,
            hostname: None,
            device_label: None,
            connected_at: now,
        };
        state.clients.insert(
            client_id.to_string(),
            ConnectedClientState {
                client,
                connection_count: 0,
                last_heartbeat_at: Some(now),
            },
        );
        true
    }

    /// Sweep clients whose SSE has been gone (`connection_count == 0`) and
    /// whose heartbeat is stale (or never received) past the grace period.
    ///
    /// Returns the list of session IDs that had at least one client removed,
    /// so the caller can broadcast `ClientListChanged` to remaining clients.
    pub async fn sweep_stale_clients(&self) -> Vec<String> {
        let now = Instant::now();
        let grace = HEARTBEAT_GRACE;
        let mut changed_sessions = Vec::new();
        let mut sessions = self.sessions.write().await;
        for (session_id, state) in sessions.iter_mut() {
            let before = state.clients.len();
            state.clients.retain(|_, c| {
                if c.connection_count > 0 {
                    return true;
                }
                match c.last_heartbeat_at {
                    Some(t) => now.duration_since(t) < grace,
                    None => false,
                }
            });
            if state.clients.len() != before {
                changed_sessions.push(session_id.clone());
            }
        }
        changed_sessions
    }

    /// Unregister a client from a session.
    ///
    /// Returns true only when the logical client was fully removed. Duplicate
    /// connections for the same client_id are reference-counted and return
    /// false until the final stream disconnects.
    ///
    /// When the final SSE stream drops but the client has a fresh heartbeat,
    /// the entry is *kept* (with `connection_count == 0`) so a tab whose SSE
    /// was silently torn down by a proxy/browser but that is still playing
    /// (and therefore still heartbeating) stays in the connected-clients list.
    /// The background sweep in `main.rs` reaps it once the heartbeat also
    /// goes stale.
    pub async fn unregister_client(&self, session_id: &str, client_id: &str) -> bool {
        self.unregister_client_impl(session_id, client_id, true)
            .await
    }

    /// Unregister one SSE transport without heartbeat grace.
    ///
    /// Followers do not need heartbeat grace after their final stream drops,
    /// but Android can have both WebView and native-service streams for the
    /// same logical client. Reference counting must still keep the logical
    /// client until both transports are gone.
    pub async fn unregister_client_without_grace(&self, session_id: &str, client_id: &str) -> bool {
        self.unregister_client_impl(session_id, client_id, false)
            .await
    }

    /// Forcefully remove a client from a session, ignoring the heartbeat grace
    /// period.
    ///
    /// Used when a logical client explicitly signals that it is closing (via
    /// the `DELETE /api/sessions/:id/clients/:clientId` endpoint). A client ID
    /// identifies one browser tab or one mobile app installation, so teardown
    /// removes the entire logical client regardless of how many reconnecting
    /// SSE transports are currently reference-counted beneath it.
    pub async fn force_remove_client(&self, session_id: &str, client_id: &str) -> bool {
        let mut sessions = self.sessions.write().await;
        sessions
            .get_mut(session_id)
            .is_some_and(|state| state.clients.remove(client_id).is_some())
    }

    async fn unregister_client_impl(
        &self,
        session_id: &str,
        client_id: &str,
        preserve_heartbeat: bool,
    ) -> bool {
        let now = Instant::now();
        let grace = HEARTBEAT_GRACE;
        let mut sessions = self.sessions.write().await;
        if let Some(state) = sessions.get_mut(session_id) {
            if let Some(existing) = state.clients.get_mut(client_id) {
                if existing.connection_count > 1 {
                    existing.connection_count -= 1;
                    return false;
                }
                // Last SSE stream is gone: keep the entry alive while the
                // heartbeat is fresh, so the tab stays controllable remotely
                // even if its SSE was silently dropped. Followers use the
                // no-grace variant, but still get the refcount behavior above.
                if preserve_heartbeat {
                    let heartbeat_alive = existing
                        .last_heartbeat_at
                        .is_some_and(|t| now.duration_since(t) < grace);
                    if heartbeat_alive {
                        existing.connection_count = 0;
                        return false;
                    }
                }
                state.clients.remove(client_id);
                return true;
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

    #[tokio::test]
    async fn force_remove_client_bypasses_heartbeat_grace() {
        // A tab that closes itself sends an explicit disconnect beacon. The
        // server must remove it from the connected-clients list immediately,
        // even if the heartbeat would otherwise keep it alive for the grace
        // period.
        let manager = SessionManager::new();

        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata::default(),
            )
            .await;
        // A fresh heartbeat would normally keep the entry alive after the
        // SSE stream drops. Force-removing should bypass that.
        assert!(
            !manager
                .record_heartbeat("session-1", "client-1", None)
                .await
        );

        assert!(manager.force_remove_client("session-1", "client-1").await);
        assert!(!manager.is_client_connected("session-1", "client-1").await);
        assert!(manager.get_clients("session-1").await.is_empty());
    }

    #[tokio::test]
    async fn unregister_without_grace_still_refcounts_android_streams() {
        let manager = SessionManager::new();

        for _ in 0..2 {
            manager
                .register_client(
                    "session-1",
                    "mobile-client",
                    "ferrotune-mobile",
                    ConnectedClientMetadata::default(),
                )
                .await;
        }
        assert!(
            !manager
                .record_heartbeat("session-1", "mobile-client", None)
                .await
        );

        // The WebView stream can disappear while the native-service stream is
        // still live, even when this device is a follower.
        assert!(
            !manager
                .unregister_client_without_grace("session-1", "mobile-client")
                .await
        );
        assert!(
            manager
                .is_client_connected("session-1", "mobile-client")
                .await
        );

        // No heartbeat grace is applied once the final transport is gone.
        assert!(
            manager
                .unregister_client_without_grace("session-1", "mobile-client")
                .await
        );
        assert!(
            !manager
                .is_client_connected("session-1", "mobile-client")
                .await
        );
    }

    #[tokio::test]
    async fn force_remove_client_removes_all_refcounted_transports() {
        // Reconnect overlap can temporarily leave multiple SSE transports for
        // one logical tab/device. An explicit logical-client teardown must be
        // idempotent and remove all of them at once; their later cleanup guards
        // must not resurrect or double-remove the entry.
        let manager = SessionManager::new();

        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata::default(),
            )
            .await;
        manager
            .register_client(
                "session-1",
                "client-1",
                "ferrotune-web",
                ConnectedClientMetadata::default(),
            )
            .await;

        assert!(manager.force_remove_client("session-1", "client-1").await);
        assert!(!manager.is_client_connected("session-1", "client-1").await);
        assert!(!manager.force_remove_client("session-1", "client-1").await);
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

/// Common query parameters for native API API requests.
#[derive(Debug, Deserialize)]
pub struct CommonParams {
    pub u: Option<String>,
    pub p: Option<String>,
    pub t: Option<String>,
    pub s: Option<String>,
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
