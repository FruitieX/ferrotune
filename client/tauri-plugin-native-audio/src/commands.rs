use tauri::{command, AppHandle, Runtime};

use crate::{
    error::Result,
    models::{PlaybackState, QueueItem, TrackInfo},
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
) -> Result<()> {
    #[cfg(mobile)]
    {
        app.native_audio().set_queue(&items, start_index)
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, items, start_index);
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
