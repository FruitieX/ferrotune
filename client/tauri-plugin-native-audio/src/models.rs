use serde::{Deserialize, Serialize};

/// Represents the current playback state
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    #[default]
    Idle,
    Buffering,
    Playing,
    Paused,
    Ended,
    Error,
}

/// Information about the currently playing track
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    /// Unique identifier for the track
    pub id: String,
    /// Stream URL for the audio
    pub url: String,
    /// Track title
    pub title: String,
    /// Artist name
    pub artist: String,
    /// Album name
    pub album: String,
    /// Cover art URL (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_url: Option<String>,
    /// Track duration in milliseconds
    pub duration_ms: u64,
}

/// Session configuration for connecting to the Ferrotune server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub server_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// Playback settings that affect how tracks are prepared
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSettingsConfig {
    pub replay_gain_mode: String,
    pub replay_gain_offset: f32,
    pub scrobble_threshold: f32,
    pub transcoding_enabled: bool,
    pub transcoding_bitrate: u32,
}

/// Parameters for starting autonomous playback
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAutonomousPlaybackParams {
    pub total_count: usize,
    pub current_index: usize,
    pub is_shuffled: bool,
    pub repeat_mode: String,
    pub play_when_ready: bool,
    #[serde(default)]
    pub start_position_ms: u64,
}

/// Queue item for setting the playback queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_url: Option<String>,
    pub duration_ms: u64,
}

/// Full playback state returned by get_state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    /// Current playback status
    pub status: PlaybackStatus,
    /// Current playback position in milliseconds
    pub position_ms: u64,
    /// Total duration of current track in milliseconds
    pub duration_ms: u64,
    /// Current volume (0.0 to 1.0)
    pub volume: f32,
    /// Whether playback is muted
    pub muted: bool,
    /// Current track info (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackInfo>,
    /// Current index in the queue
    pub queue_index: i32,
    /// Total queue length
    pub queue_length: i32,
}

/// Safe area insets for edge-to-edge displays
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SafeAreaInsets {
    pub top: f64,
    pub bottom: f64,
}

/// Event payload for state change events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateChangeEvent {
    pub state: PlaybackState,
}

/// Event payload for progress updates
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub buffered_ms: u64,
}

/// Event payload for errors
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub message: String,
    pub track_id: Option<String>,
}

/// Event payload for track changes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackChangeEvent {
    pub track: Option<TrackInfo>,
    pub queue_index: i32,
}
