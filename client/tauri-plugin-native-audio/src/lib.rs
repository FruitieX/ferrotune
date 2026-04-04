//! Native audio playback plugin for Tauri with Android MediaSession support.
//!
//! This plugin provides native audio playback on Android with:
//! - Background playback (screen off, app minimized)
//! - Lock screen media controls
//! - Notification media controls
//! - Bluetooth metadata and controls
//!
//! On desktop platforms, the plugin returns an error for all commands,
//! as the web UI uses the HTML5 Audio API directly.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

mod commands;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};
pub use models::*;

// Re-export the extension trait
#[cfg(mobile)]
pub use mobile::NativeAudioExt;

/// Event names emitted by the plugin
pub mod events {
    /// Emitted when playback state changes (play/pause/stop/etc)
    pub const STATE_CHANGE: &str = "native-audio://state-change";
    /// Emitted periodically with playback progress
    pub const PROGRESS: &str = "native-audio://progress";
    /// Emitted when an error occurs
    pub const ERROR: &str = "native-audio://error";
    /// Emitted when the current track changes
    pub const TRACK_CHANGE: &str = "native-audio://track-change";
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-audio")
        .invoke_handler(tauri::generate_handler![
            commands::play,
            commands::request_playback,
            commands::pause,
            commands::stop,
            commands::seek,
            commands::set_track,
            commands::get_state,
            commands::set_volume,
            commands::set_replay_gain,
            commands::set_queue,
            commands::next_track,
            commands::play_at_index,
            commands::previous_track,
            commands::set_repeat_mode,
            commands::append_to_queue,
            commands::update_starred_state,
            commands::get_safe_area_insets,
            commands::init_session,
            commands::update_settings,
            commands::start_playback,
            commands::invalidate_queue,
            commands::soft_invalidate_queue,
            commands::toggle_shuffle,
            commands::debug_log,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            {
                use tauri::Manager;
                let native_audio = mobile::init(app, api)?;
                app.manage(native_audio);
            }
            #[cfg(not(mobile))]
            {
                let _ = (app, api);
                log::info!("Native audio plugin initialized (desktop mode - no-op)");
            }
            Ok(())
        })
        .build()
}
