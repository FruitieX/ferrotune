//! Ferrotune Admin API.
//!
//! This module provides administrative endpoints for managing the Ferrotune server.
//! Unlike the OpenSubsonic API, this API uses modern REST conventions with JSON
//! request/response bodies and proper HTTP methods.
//!
//! ## Authentication
//!
//! All endpoints require authentication using the same credentials as the
//! OpenSubsonic API. Pass credentials via HTTP Basic Auth or as query parameters
//! (`u` for username, `p` for password).
//!
//! ## Endpoints
//!
//! - `GET /ferrotune/health` - Health check
//! - `GET /ferrotune/stats` - Get server statistics (song/album/artist counts, total duration, etc.)
//! - `POST /ferrotune/scan` - Trigger a library scan
//! - `GET /ferrotune/scan/status` - Get current scan status (placeholder for future async scanning)
//! - `GET /ferrotune/duplicates` - Get duplicate files detected during scanning
//!
//! ## Music Folder Endpoints
//!
//! - `GET /ferrotune/music-folders` - List all music folders with stats
//! - `POST /ferrotune/music-folders` - Add a new music folder
//! - `GET /ferrotune/music-folders/:id` - Get a music folder with stats
//! - `PATCH /ferrotune/music-folders/:id` - Update a music folder (name, enabled)
//! - `DELETE /ferrotune/music-folders/:id` - Delete a music folder (cascades to songs)
//! - `GET /ferrotune/music-folders/:id/stats` - Get detailed stats for a music folder
//!
//! ## Playlist Folder Endpoints
//!
//! - `GET /ferrotune/playlist-folders` - Get all playlist folders and playlists
//! - `POST /ferrotune/playlist-folders` - Create a new playlist folder
//! - `PATCH /ferrotune/playlist-folders/:id` - Update a playlist folder
//! - `DELETE /ferrotune/playlist-folders/:id` - Delete a playlist folder
//! - `PATCH /ferrotune/playlists/:id/move` - Move a playlist to a folder
//! - `PUT /ferrotune/playlists/:id/reorder` - Reorder songs in a playlist
//!
//! ## Song Management Endpoints
//!
//! - `GET /ferrotune/songs/ids` - Get all song IDs matching search/filter criteria (for bulk selection)
//! - `DELETE /ferrotune/songs/:id` - Delete a song from the database
//! - `GET /ferrotune/songs/:id/tags` - Get all tags from a song file
//! - `PATCH /ferrotune/songs/:id/tags` - Update tags in a song file
//!
//! ## User Preferences Endpoints
//!
//! - `GET /ferrotune/preferences` - Get user preferences
//! - `PUT /ferrotune/preferences` - Update user preferences
//!
//! ## Playback Endpoints
//!
//! - `POST /ferrotune/play-queue` - Save play queue (JSON body, scalable alternative to OpenSubsonic)
//! - `POST /ferrotune/listening` - Log a listening session
//! - `GET /ferrotune/listening/stats` - Get listening statistics
//! - `GET /ferrotune/songs/:id/waveform/stream` - Get waveform data as SSE stream
//! - `GET /ferrotune/songs/:id/shuffle-exclude` - Get shuffle exclude status for a song
//! - `PUT /ferrotune/songs/:id/shuffle-exclude` - Set shuffle exclude status for a song
//! - `GET /ferrotune/shuffle-excludes` - Get all songs excluded from shuffle
//!
//! ## Server-Side Queue Endpoints
//!
//! - `POST /ferrotune/queue/start` - Start a new queue from a source (album, artist, playlist, etc.)
//! - `GET /ferrotune/queue` - Get current queue state with pagination
//! - `DELETE /ferrotune/queue` - Clear the entire queue
//! - `GET /ferrotune/queue/current-window` - Get songs around current position
//! - `POST /ferrotune/queue/add` - Add songs to queue at position
//! - `DELETE /ferrotune/queue/:position` - Remove song at position
//! - `POST /ferrotune/queue/move` - Move song from one position to another
//! - `POST /ferrotune/queue/shuffle` - Toggle shuffle mode
//! - `POST /ferrotune/queue/position` - Update current playback position
//! - `POST /ferrotune/queue/repeat` - Update repeat mode
//!
//! ## Directory Browsing Endpoints
//!
//! - `GET /ferrotune/directory` - Get paginated directory contents with sorting, filtering, and folder sizes
//!
//! ## Server Configuration Endpoints
//!
//! - `GET /ferrotune/config` - Get server configuration
//! - `PUT /ferrotune/config` - Update server configuration
//! - `GET /ferrotune/config/all` - Get all configuration as key-value pairs

mod directory;
mod duplicates;
mod filesystem;
mod listening;
mod media;
pub mod music_folders;
mod playlists;
mod playqueue;
mod preferences;
mod queue;
mod scan;
pub mod scan_state;
mod server_config;
mod setup;
mod shuffle_exclude;
mod stats;
mod tags;
pub mod users;
mod waveform;

use crate::api::AppState;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post, put},
    Router,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// Create the Ferrotune Admin API router.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ferrotune/health", get(health))
        // Setup endpoint (unauthenticated - for first-run detection)
        .route("/ferrotune/setup/status", get(setup::get_setup_status))
        .route("/ferrotune/setup/complete", post(setup::complete_setup))
        .route("/ferrotune/stats", get(stats::get_stats))
        .route("/ferrotune/scan", post(scan::start_scan))
        .route("/ferrotune/scan/status", get(scan::scan_status))
        .route("/ferrotune/scan/progress", get(scan::scan_progress_stream))
        .route("/ferrotune/scan/logs", get(scan::scan_logs))
        .route("/ferrotune/scan/full", get(scan::full_scan_status))
        .route("/ferrotune/scan/cancel", post(scan::cancel_scan))
        .route("/ferrotune/duplicates", get(duplicates::get_duplicates))
        // Directory browsing endpoints
        .route("/ferrotune/libraries", get(directory::get_libraries))
        .route("/ferrotune/directory", get(directory::get_directory_paged))
        // Filesystem browsing endpoints (for setup)
        .route("/ferrotune/filesystem", get(filesystem::browse_filesystem))
        .route("/ferrotune/filesystem/validate", get(filesystem::validate_path))
        // Music folder management endpoints
        .route(
            "/ferrotune/music-folders",
            get(music_folders::list_music_folders).post(music_folders::create_music_folder),
        )
        .route(
            "/ferrotune/music-folders/{id}",
            get(music_folders::get_music_folder)
                .patch(music_folders::update_music_folder)
                .delete(music_folders::delete_music_folder),
        )
        .route(
            "/ferrotune/music-folders/{id}/stats",
            get(music_folders::get_music_folder_stats),
        )
        // Playlist folder endpoints
        .route(
            "/ferrotune/playlist-folders",
            get(playlists::get_playlist_folders),
        )
        .route(
            "/ferrotune/playlist-folders",
            post(playlists::create_playlist_folder),
        )
        .route(
            "/ferrotune/playlist-folders/{id}",
            patch(playlists::update_playlist_folder),
        )
        .route(
            "/ferrotune/playlist-folders/{id}",
            delete(playlists::delete_playlist_folder),
        )
        .route(
            "/ferrotune/playlists/{id}/move",
            patch(playlists::move_playlist),
        )
        .route(
            "/ferrotune/playlists/{id}/reorder",
            axum::routing::put(playlists::reorder_playlist_songs),
        )
        .route(
            "/ferrotune/playlists/{id}/match-missing",
            post(playlists::match_missing_entry),
        )
        .route(
            "/ferrotune/playlists/{id}/move-entry",
            post(playlists::move_playlist_entry),
        )
        .route(
            "/ferrotune/playlists/{id}/songs",
            get(playlists::get_playlist_songs),
        )
        .route(
            "/ferrotune/playlists/import",
            post(playlists::import_playlist),
        )
        // Song ID query endpoint (for bulk selection)
        .route("/ferrotune/songs/ids", get(media::get_song_ids))
        // Media management endpoints
        .route("/ferrotune/songs/{id}", delete(media::delete_song))
        // Tag management endpoints
        .route(
            "/ferrotune/songs/{id}/tags",
            get(tags::get_tags).patch(tags::update_tags),
        )
        // User preferences endpoints
        .route(
            "/ferrotune/preferences",
            get(preferences::get_preferences).put(preferences::update_preferences),
        )
        .route(
            "/ferrotune/preferences/{key}",
            get(preferences::get_preference)
                .put(preferences::set_preference)
                .delete(preferences::delete_preference),
        )
        // Play queue endpoints
        .route("/ferrotune/play-queue", post(playqueue::save_play_queue))
        // Listening statistics endpoints
        .route("/ferrotune/listening", post(listening::log_listening))
        .route(
            "/ferrotune/listening/stats",
            get(listening::get_listening_stats),
        )
        .route(
            "/ferrotune/listening/review",
            get(listening::get_period_review),
        )
        // Waveform generation endpoint (streaming only)
        .route(
            "/ferrotune/songs/{id}/waveform/stream",
            get(waveform::get_waveform_stream),
        )
        // Shuffle exclude endpoints
        .route(
            "/ferrotune/songs/{id}/shuffle-exclude",
            get(shuffle_exclude::get_shuffle_exclude).put(shuffle_exclude::set_shuffle_exclude),
        )
        .route(
            "/ferrotune/shuffle-excludes",
            get(shuffle_exclude::get_all_shuffle_excludes),
        )
        .route(
            "/ferrotune/shuffle-excludes/bulk",
            post(shuffle_exclude::bulk_set_shuffle_excludes),
        )
        // Server-side queue endpoints
        .route("/ferrotune/queue/start", post(queue::start_queue))
        .route(
            "/ferrotune/queue",
            get(queue::get_queue).delete(queue::clear_queue),
        )
        .route(
            "/ferrotune/queue/current-window",
            get(queue::get_current_window),
        )
        .route("/ferrotune/queue/add", post(queue::add_to_queue))
        .route(
            "/ferrotune/queue/{position}",
            delete(queue::remove_from_queue),
        )
        .route("/ferrotune/queue/move", post(queue::move_in_queue))
        .route("/ferrotune/queue/shuffle", post(queue::toggle_shuffle))
        .route("/ferrotune/queue/position", post(queue::update_position))
        .route("/ferrotune/queue/repeat", post(queue::update_repeat_mode))
        // User management endpoints (admin only)
        .route("/ferrotune/users/me", get(users::get_current_user))
        .route(
            "/ferrotune/users",
            get(users::list_users).post(users::create_user),
        )
        .route(
            "/ferrotune/users/{id}",
            get(users::get_user)
                .patch(users::update_user)
                .delete(users::delete_user),
        )
        .route(
            "/ferrotune/users/{id}/library-access",
            get(users::get_library_access).put(users::set_library_access),
        )
        .route(
            "/ferrotune/users/{id}/api-keys",
            get(users::list_api_keys).post(users::create_api_key),
        )
        .route(
            "/ferrotune/users/{id}/api-keys/{name}",
            delete(users::delete_api_key),
        )
        // Server configuration endpoints (admin only)
        .route(
            "/ferrotune/config",
            get(server_config::get_server_config).put(server_config::update_server_config),
        )
        .route("/ferrotune/config/all", get(server_config::get_all_config))
        .with_state(state)
}

/// Health check response.
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// Simple health check endpoint.
async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Standard error response for the admin API.
#[derive(Serialize, TS)]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl ErrorResponse {
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: None,
        }
    }

    pub fn with_details(error: impl Into<String>, details: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            details: Some(details.into()),
        }
    }
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}
