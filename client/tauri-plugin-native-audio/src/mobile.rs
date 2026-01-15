use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{
    error::Result,
    models::{PlaybackState, QueueItem, TrackInfo},
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.ferrotune.audio";

/// Access to the native-audio APIs.
pub struct NativeAudio<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeAudio<R> {
    /// Start or resume playback
    pub fn play(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("play", ())
            .map_err(Into::into)
    }

    /// Pause playback
    pub fn pause(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("pause", ())
            .map_err(Into::into)
    }

    /// Stop playback completely
    pub fn stop(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("stop", ())
            .map_err(Into::into)
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
        self.0
            .run_mobile_plugin("getState", ())
            .map_err(Into::into)
    }

    /// Set playback volume
    pub fn set_volume(&self, volume: f32) -> Result<()> {
        self.0
            .run_mobile_plugin("setVolume", serde_json::json!({ "volume": volume }))
            .map_err(Into::into)
    }

    /// Set the playback queue
    pub fn set_queue(&self, items: &[QueueItem], start_index: usize) -> Result<()> {
        self.0
            .run_mobile_plugin(
                "setQueue",
                serde_json::json!({
                    "items": items,
                    "startIndex": start_index
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

    /// Skip to previous track in queue
    pub fn previous_track(&self) -> Result<()> {
        self.0
            .run_mobile_plugin("previousTrack", ())
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
