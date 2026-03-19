use tauri::{command, AppHandle, Runtime};

use crate::{
    error::Result,
    models::{
        PlaybackSettingsConfig, PlaybackState, QueueItem, SafeAreaInsets, SessionConfig,
        StartAutonomousPlaybackParams, TrackInfo,
    },
};

#[cfg(mobile)]
use crate::NativeAudioExt;

/// Start or resume playback
#[command]
pub async fn play<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().play()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("play() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Request that the next setQueue() call auto-starts playback.
/// Called from JS atom writes to decouple the play decision from React effects.
#[command]
pub async fn request_playback<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().request_playback()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("request_playback() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Pause playback
#[command]
pub async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().pause()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("pause() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Stop playback completely
#[command]
pub async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().stop()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("stop() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Seek to a specific position in milliseconds
#[command]
pub async fn seek<R: Runtime>(app: AppHandle<R>, position_ms: u64) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().seek(position_ms)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, position_ms);
        log::warn!("seek() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Set the current track to play
#[command]
pub async fn set_track<R: Runtime>(app: AppHandle<R>, track: TrackInfo) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().set_track(&track)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, track);
        log::warn!("set_track() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Get current playback state
#[command]
pub async fn get_state<R: Runtime>(app: AppHandle<R>) -> Result<PlaybackState> {
    #[cfg(mobile)]
    {
        app.native_audio().get_state()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("get_state() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Set playback volume (0.0 to 1.0)
#[command]
pub async fn set_volume<R: Runtime>(app: AppHandle<R>, volume: f32) -> Result<()> {
    let volume = volume.clamp(0.0, 1.0);

    #[cfg(mobile)]
    {
        app.native_audio().set_volume(volume)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, volume);
        log::warn!("set_volume() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Set ReplayGain in millibels (can be negative for attenuation or positive for boost)
#[command]
pub async fn set_replay_gain<R: Runtime>(app: AppHandle<R>, gain_mb: i32) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().set_replay_gain(gain_mb)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, gain_mb);
        log::warn!("set_replay_gain() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Set the playback queue
#[command]
pub async fn set_queue<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<QueueItem>,
    start_index: usize,
    queue_offset: Option<usize>,
    start_position_ms: Option<u64>,
    play_when_ready: Option<bool>,
) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().set_queue(
            &items,
            start_index,
            queue_offset.unwrap_or(0),
            start_position_ms.unwrap_or(0),
            play_when_ready.unwrap_or(false),
        )
    }

    #[cfg(not(mobile))]
    {
        let _ = (
            app,
            items,
            start_index,
            queue_offset,
            start_position_ms,
            play_when_ready,
        );
        log::warn!("set_queue() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Skip to next track in queue
#[command]
pub async fn next_track<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().next_track()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("next_track() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Skip to previous track in queue
#[command]
pub async fn previous_track<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().previous_track()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("previous_track() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Set repeat mode
#[command]
pub async fn set_repeat_mode<R: Runtime>(app: AppHandle<R>, mode: String) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().set_repeat_mode(&mode)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, mode);
        log::warn!("set_repeat_mode() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Append items to the playback queue
#[command]
pub async fn append_to_queue<R: Runtime>(app: AppHandle<R>, items: Vec<QueueItem>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().append_to_queue(&items)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, items);
        log::warn!("append_to_queue() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Update the starred state of the current track
#[command]
pub async fn update_starred_state<R: Runtime>(app: AppHandle<R>, starred: bool) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().update_starred_state(starred)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, starred);
        log::warn!(
            "update_starred_state() called on desktop - native audio only available on mobile"
        );
        Err(Error::ServiceNotAvailable)
    }
}

/// Get safe area insets for edge-to-edge display
#[command]
pub async fn get_safe_area_insets<R: Runtime>(app: AppHandle<R>) -> Result<SafeAreaInsets> {
    #[cfg(mobile)]
    {
        app.native_audio().get_safe_area_insets()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!(
            "get_safe_area_insets() called on desktop - native audio only available on mobile"
        );
        Err(Error::ServiceNotAvailable)
    }
}

/// Initialize session configuration for direct API calls from native side
#[command]
pub async fn init_session<R: Runtime>(
    app: AppHandle<R>,
    server_url: String,
    username: Option<String>,
    password: Option<String>,
    api_key: Option<String>,
) -> Result<()> {
    log::info!("init_session command reached");
    let config = SessionConfig {
        server_url,
        username,
        password,
        api_key,
    };

    #[cfg(mobile)]
    {
        app.native_audio().init_session(&config)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, config);
        log::warn!("init_session() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Update playback settings (ReplayGain, transcoding, scrobble threshold)
#[command]
pub async fn update_settings<R: Runtime>(
    app: AppHandle<R>,
    replay_gain_mode: String,
    replay_gain_offset: f32,
    scrobble_threshold: f32,
    transcoding_enabled: bool,
    transcoding_bitrate: u32,
) -> Result<()> {
    log::info!(
        "update_settings command reached: mode={}, offset={}, transcoding={}",
        replay_gain_mode,
        replay_gain_offset,
        transcoding_enabled
    );
    let settings = PlaybackSettingsConfig {
        replay_gain_mode,
        replay_gain_offset,
        scrobble_threshold,
        transcoding_enabled,
        transcoding_bitrate,
    };

    #[cfg(mobile)]
    {
        app.native_audio().update_settings(&settings)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, settings);
        log::warn!("update_settings() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Start autonomous playback: Kotlin takes over queue management
#[command]
pub async fn start_autonomous_playback<R: Runtime>(
    app: AppHandle<R>,
    total_count: usize,
    current_index: usize,
    is_shuffled: bool,
    repeat_mode: String,
    play_when_ready: bool,
    start_position_ms: Option<u64>,
) -> Result<()> {
    log::info!(
        "start_autonomous_playback command reached: total={}, index={}, shuffled={}",
        total_count,
        current_index,
        is_shuffled
    );
    let params = StartAutonomousPlaybackParams {
        total_count,
        current_index,
        is_shuffled,
        repeat_mode,
        play_when_ready,
        start_position_ms: start_position_ms.unwrap_or(0),
    };

    #[cfg(mobile)]
    {
        app.native_audio().start_autonomous_playback(&params)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, params);
        log::warn!(
            "start_autonomous_playback() called on desktop - native audio only available on mobile"
        );
        Err(Error::ServiceNotAvailable)
    }
}

/// Invalidate the queue window and refetch from server
#[command]
pub async fn invalidate_queue<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().invalidate_queue()
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        log::warn!("invalidate_queue() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Soft invalidate: update total count and prefetch without rebuilding ExoPlayer playlist
#[command]
pub async fn soft_invalidate_queue<R: Runtime>(app: AppHandle<R>, total_count: i32) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().soft_invalidate_queue(total_count)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, total_count);
        log::warn!("soft_invalidate_queue() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Toggle shuffle in autonomous mode
#[command]
pub async fn toggle_shuffle<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().toggle_shuffle(enabled)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, enabled);
        log::warn!("toggle_shuffle() called on desktop - native audio only available on mobile");
        Err(Error::ServiceNotAvailable)
    }
}

/// Debug log: send a message from JS to native logcat
#[command]
pub async fn debug_log<R: Runtime>(app: AppHandle<R>, message: String) -> Result<()> {
    log::info!("[JS] {}", message);

    #[cfg(mobile)]
    {
        app.native_audio().debug_log(&message)
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(())
    }
}
