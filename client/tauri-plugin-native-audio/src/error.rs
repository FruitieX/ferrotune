use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Error types for the native audio plugin
#[derive(Debug, Error)]
pub enum Error {
    #[error("Playback error: {0}")]
    Playback(String),

    #[error("Invalid track: {0}")]
    InvalidTrack(String),

    #[error("Service not available")]
    ServiceNotAvailable,

    #[error("Seek error: position {position}ms is out of bounds (duration: {duration}ms)")]
    SeekOutOfBounds { position: u64, duration: u64 },

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[cfg(mobile)]
    #[error("Plugin invoke error: {0}")]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),

    #[cfg(target_os = "android")]
    #[error("JNI error: {0}")]
    Jni(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Error {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(Error::Plugin(s))
    }
}

pub type Result<T> = std::result::Result<T, Error>;
