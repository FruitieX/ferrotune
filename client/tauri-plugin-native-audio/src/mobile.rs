use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{
    error::Result,
    models::{
        PlaybackSettingsConfig, PlaybackState, QueueItem, SafeAreaInsets, SessionConfig,
        StartAutonomousPlaybackParams, TrackInfo,
    },
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.ferrotune.audio";

/// Access to the native-audio APIs.
pub struct NativeAudio<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeAudio<R> {
    /// Start or resume playback
    pub fn play(&self) -> Result<()> {
        self.0.run_mobile_plugin("play", ()).map_err(Into::into)
    }

    /// Request that the next setQueue() call auto-starts playback
    pub fn request_playback(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("requestPlayback", ())
            .map_err(Into::into)
    }

    /// Pause playback
    pub fn pause(&self) -> Result<()> {
        self.0.run_mobile_plugin("pause", ()).map_err(Into::into)
    }

    /// Stop playback completely
    pub fn stop(&self) -> Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }

    /// Seek to a specific position
    pub fn seek(&self, position_ms: u64) -> Result<()> {
        self.0
            .run_mobile_plugin("seek", serde_json::json!({ "positionMs": position_ms }))
            .map_err(Into::into)
    }

    /// Set the current track
    pub fn set_track(&self, track: &TrackInfo) -> Result<()> {
        self.0
            .run_mobile_plugin("setTrack", track)
            .map_err(Into::into)
    }

    /// Get current playback state
    pub fn get_state(&self) -> Result<PlaybackState> {
        self.0.run_mobile_plugin("getState", ()).map_err(Into::into)
    }

    /// Set playback volume
    pub fn set_volume(&self, volume: f32) -> Result<()> {
        self.0
            .run_mobile_plugin("setVolume", serde_json::json!({ "volume": volume }))
            .map_err(Into::into)
    }

    /// Set ReplayGain boost/attenuation in millibels
    pub fn set_replay_gain(&self, gain_mb: i32) -> Result<()> {
        self.0
            .run_mobile_plugin("setReplayGain", serde_json::json!({ "gainMb": gain_mb }))
            .map_err(Into::into)
    }

    /// Set the playback queue
    pub fn set_queue(
        &self,
        items: &[QueueItem],
        start_index: usize,
        queue_offset: usize,
        start_position_ms: u64,
        play_when_ready: bool,
    ) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "setQueue",
                serde_json::json!({
                    "items": items,
                    "startIndex": start_index,
                    "queueOffset": queue_offset,
                    "startPositionMs": start_position_ms,
                    "playWhenReady": play_when_ready
                }),
            )
            .map_err(Into::into)
    }

    /// Skip to next track in queue
    pub fn next_track(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("nextTrack", ())
            .map_err(Into::into)
    }

    /// Jump to a specific queue index and start playback
    pub fn play_at_index(&self, index: i32) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "playAtIndex",
                serde_json::json!({
                    "index": index
                }),
            )
            .map_err(Into::into)
    }

    /// Skip to previous track in queue
    pub fn previous_track(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("previousTrack", ())
            .map_err(Into::into)
    }

    /// Get safe area insets for edge-to-edge display
    pub fn get_safe_area_insets(&self) -> Result<SafeAreaInsets> {
        self.0
            .run_mobile_plugin("getSafeAreaInsets", ())
            .map_err(Into::into)
    }

    /// Set repeat mode
    pub fn set_repeat_mode(&self, mode: &str) -> Result<()> {
        self.0
            .run_mobile_plugin("setRepeatMode", serde_json::json!({ "mode": mode }))
            .map_err(Into::into)
    }

    /// Append items to the playback queue
    pub fn append_to_queue(&self, items: &[QueueItem]) -> Result<()> {
        self.0
            .run_mobile_plugin("appendToQueue", serde_json::json!({ "items": items }))
            .map_err(Into::into)
    }

    /// Update the starred state of the current track
    pub fn update_starred_state(&self, starred: bool) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "updateStarredState",
                serde_json::json!({ "starred": starred }),
            )
            .map_err(Into::into)
    }

    /// Initialize session configuration for direct API calls
    pub fn init_session(&self, config: &SessionConfig) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "initSession",
                serde_json::json!({
                    "serverUrl": config.server_url,
                    "username": config.username,
                    "password": config.password,
                    "apiKey": config.api_key,
                    "sessionId": config.session_id,
                    "clientId": config.client_id,
                }),
            )
            .map_err(Into::into)
    }

    /// Update playback settings
    pub fn update_settings(&self, settings: &PlaybackSettingsConfig) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "updateSettings",
                serde_json::json!({
                    "replayGainMode": settings.replay_gain_mode,
                    "replayGainOffset": settings.replay_gain_offset,
                    "scrobbleThreshold": settings.scrobble_threshold,
                    "transcodingEnabled": settings.transcoding_enabled,
                    "transcodingBitrate": settings.transcoding_bitrate,
                }),
            )
            .map_err(Into::into)
    }

    /// Start autonomous playback mode
    pub fn start_autonomous_playback(&self, params: &StartAutonomousPlaybackParams) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "startAutonomousPlayback",
                serde_json::json!({
                    "totalCount": params.total_count,
                    "currentIndex": params.current_index,
                    "isShuffled": params.is_shuffled,
                    "repeatMode": params.repeat_mode,
                    "playWhenReady": params.play_when_ready,
                    "startPositionMs": params.start_position_ms,
                    "sessionId": params.session_id,
                }),
            )
            .map_err(Into::into)
    }

    /// Invalidate queue window and refetch from server
    pub fn invalidate_queue(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("invalidateQueue", ())
            .map_err(Into::into)
    }

    /// Soft invalidate: update total count and prefetch without rebuilding
    pub fn soft_invalidate_queue(&self, total_count: i32) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "softInvalidateQueue",
                serde_json::json!({ "totalCount": total_count }),
            )
            .map_err(Into::into)
    }

    /// Toggle shuffle in autonomous mode
    pub fn toggle_shuffle(&self, enabled: bool) -> Result<()> {
        self.0
            .run_mobile_plugin("toggleShuffle", serde_json::json!({ "enabled": enabled }))
            .map_err(Into::into)
    }

    /// Debug log: forward a message from JS to native logcat
    pub fn debug_log(&self, message: &str) -> Result<()> {
        self.0
            .run_mobile_plugin("debugLog", serde_json::json!({ "message": message }))
            .map_err(Into::into)
    }
}

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the native-audio APIs.
pub trait NativeAudioExt<R: Runtime> {
    fn native_audio(&self) -> &NativeAudio<R>;
}

impl<R: Runtime, T: tauri::Manager<R>> crate::NativeAudioExt<R> for T {
    fn native_audio(&self) -> &NativeAudio<R> {
        self.state::<NativeAudio<R>>().inner()
    }
}

/// Initializes the mobile plugin.
#[cfg(target_os = "android")]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<NativeAudio<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "NativeAudioPlugin")?;
    Ok(NativeAudio(handle))
}

/// Initializes the mobile plugin (iOS).
#[cfg(target_os = "ios")]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<NativeAudio<R>> {
    // iOS not yet implemented
    Err(crate::error::Error::ServiceNotAvailable)
}
