use tauri::{command, AppHandle, Runtime};

use crate::{
    error::{Error, Result},
    models::{PlaybackState, QueueItem, SafeAreaInsets, TrackInfo},
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
