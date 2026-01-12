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

mod browse;
mod directory;
mod disabled_songs;
mod duplicates;
mod filesystem;
mod history;
mod listening;
mod lists;
mod match_dictionary;
mod media;
pub mod music_folders;
mod playlists;
mod playqueue;
mod preferences;
mod queue;
mod recycle_bin;
mod scan;
pub mod scan_state;
mod scrobbles;
mod search;
mod server_config;
mod setup;
mod shuffle_exclude;
mod smart_playlists;
mod songs;
mod starring;
mod stats;
mod tagger;
mod tagger_session;
pub mod tags;
pub mod users;
mod waveform;

use crate::api::AppState;
use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post},
    Router,
};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

/// Create the Ferrotune Admin API router.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ferrotune/health", get(health))
        // Browse endpoints (migrated from OpenSubsonic)
        .route("/ferrotune/ping", get(browse::ping))
        .route("/ferrotune/artists", get(browse::get_artists))
        .route("/ferrotune/artists/{id}", get(browse::get_artist))
        .route("/ferrotune/albums/{id}", get(browse::get_album))
        // .route("/ferrotune/songs/{id}", get(browse::get_song)) <- Moved to combined route below
        .route("/ferrotune/genres", get(browse::get_genres))
        .route("/ferrotune/indexes", get(browse::get_indexes))
        // List endpoints (migrated from OpenSubsonic)
        .route("/ferrotune/albums", get(lists::get_album_list))
        .route("/ferrotune/songs/random", get(lists::get_random_songs))
        .route("/ferrotune/songs/by-genre", get(lists::get_songs_by_genre))
        // Search endpoint (migrated from OpenSubsonic)
        .route("/ferrotune/search", get(search::search))
        // Media endpoints (migrated from OpenSubsonic)
        .route("/ferrotune/stream", get(media::stream))
        .route("/ferrotune/cover-art", get(media::get_cover_art))
        .route("/ferrotune/download", get(media::download))
        // Starring endpoints (migrated from OpenSubsonic)
        .route("/ferrotune/star", post(starring::star))
        .route("/ferrotune/unstar", post(starring::unstar))
        .route("/ferrotune/rating", post(starring::set_rating))
        .route("/ferrotune/starred", get(starring::get_starred))
        // History endpoint (migrated from OpenSubsonic)
        .route("/ferrotune/history", get(history::get_play_history))
        // Setup endpoint (unauthenticated - for first-run detection)
        .route("/ferrotune/setup/status", get(setup::get_setup_status))
        .route("/ferrotune/setup/complete", post(setup::complete_setup))
        .route("/ferrotune/stats", get(stats::get_stats))
        .route("/ferrotune/scan", post(scan::start_scan))
        .route("/ferrotune/scan/status", get(scan::scan_status))
        .route("/ferrotune/scan/progress", get(scan::scan_progress_stream))
        .route("/ferrotune/scan/logs", get(scan::scan_logs))
        .route("/ferrotune/scan/full", get(scan::full_scan_status))
        .route("/ferrotune/scan/details", get(scan::scan_details))
        .route("/ferrotune/scan/cancel", post(scan::cancel_scan))
        .route("/ferrotune/duplicates", get(duplicates::get_duplicates))
        // Directory browsing endpoints
        .route("/ferrotune/libraries", get(directory::get_libraries))
        .route("/ferrotune/directory", get(directory::get_directory_paged))
        // Filesystem browsing endpoints (for setup)
        .route("/ferrotune/filesystem", get(filesystem::browse_filesystem))
        .route(
            "/ferrotune/filesystem/validate",
            get(filesystem::validate_path),
        )
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
            "/ferrotune/playlists/{id}/unmatch",
            post(playlists::unmatch_entry),
        )
        .route(
            "/ferrotune/playlists/{id}/batch-match",
            post(playlists::batch_match_entries),
        )
        .route(
            "/ferrotune/playlists/{id}/move-entry",
            post(playlists::move_playlist_entry),
        )
        .route(
            "/ferrotune/playlists/{id}/songs",
            get(playlists::get_playlist_songs)
                .post(playlists::add_playlist_songs)
                .delete(playlists::remove_playlist_songs),
        )
        .route("/ferrotune/playlists", post(playlists::import_playlist))
        .route(
            "/ferrotune/playlists/{id}",
            get(playlists::get_playlist_songs)
                .put(playlists::update_playlist)
                .delete(playlists::delete_playlist),
        )
        .route(
            "/ferrotune/playlists/import",
            post(playlists::import_playlist),
        )
        .route(
            "/ferrotune/playlists/containing-songs",
            get(playlists::get_playlists_for_songs),
        )
        // Song ID query endpoint (for bulk selection)
        .route("/ferrotune/songs/ids", get(media::get_song_ids))
        // Song match list endpoint (for client-side matching)
        .route(
            "/ferrotune/songs/match-list",
            get(songs::get_song_match_list),
        )
        // Server-side fuzzy matching endpoint
        .route("/ferrotune/songs/match", post(songs::match_tracks))
        // Match dictionary endpoint (for reusing prior matches)
        .route(
            "/ferrotune/match-dictionary",
            get(match_dictionary::get_match_dictionary),
        )
        // Album and artist matching endpoints (for favorites import)
        .route("/ferrotune/albums/match", post(songs::match_albums))
        .route("/ferrotune/artists/match", post(songs::match_artists))
        // Media management endpoints
        .route(
            "/ferrotune/songs/{id}",
            get(browse::get_song).delete(media::delete_song),
        )
        // Delete song files (from disk and database)
        .route(
            "/ferrotune/songs/delete-files",
            post(media::delete_song_files),
        )
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
        // Scrobbles import endpoints
        .route("/ferrotune/scrobbles", post(scrobbles::scrobble))
        .route(
            "/ferrotune/scrobbles/import",
            post(scrobbles::import_scrobbles),
        )
        .route(
            "/ferrotune/scrobbles/counts",
            post(scrobbles::get_play_counts),
        )
        .route(
            "/ferrotune/scrobbles/check-duplicate",
            get(scrobbles::check_import_duplicate),
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
        // Disabled songs endpoints
        .route(
            "/ferrotune/songs/{id}/disabled",
            get(disabled_songs::get_disabled).put(disabled_songs::set_disabled),
        )
        .route(
            "/ferrotune/disabled-songs",
            get(disabled_songs::get_all_disabled),
        )
        .route(
            "/ferrotune/disabled-songs/bulk",
            post(disabled_songs::bulk_set_disabled),
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
        // Recycle bin endpoints (soft delete)
        .route("/ferrotune/recycle-bin", get(recycle_bin::list_recycle_bin))
        .route(
            "/ferrotune/recycle-bin/mark",
            post(recycle_bin::mark_for_deletion),
        )
        .route(
            "/ferrotune/recycle-bin/restore",
            post(recycle_bin::restore_songs),
        )
        .route(
            "/ferrotune/recycle-bin/delete-permanently",
            post(recycle_bin::delete_permanently),
        )
        .route(
            "/ferrotune/recycle-bin/empty",
            post(recycle_bin::empty_recycle_bin),
        )
        .route(
            "/ferrotune/recycle-bin/purge-expired",
            post(recycle_bin::purge_expired),
        )
        // Smart playlist endpoints
        .route(
            "/ferrotune/smart-playlists",
            get(smart_playlists::list_smart_playlists).post(smart_playlists::create_smart_playlist),
        )
        .route(
            "/ferrotune/smart-playlists/{id}",
            get(smart_playlists::get_smart_playlist)
                .put(smart_playlists::update_smart_playlist)
                .delete(smart_playlists::delete_smart_playlist),
        )
        .route(
            "/ferrotune/smart-playlists/{id}/songs",
            get(smart_playlists::get_smart_playlist_songs),
        )
        .route(
            "/ferrotune/smart-playlists/{id}/materialize",
            post(smart_playlists::materialize_smart_playlist),
        )
        // Tagger endpoints
        .route("/ferrotune/tagger/upload", post(tagger::upload_files))
        .route("/ferrotune/tagger/staged", get(tagger::list_staged_files))
        .route(
            "/ferrotune/tagger/orphaned",
            get(tagger::discover_orphaned_files),
        )
        .route(
            "/ferrotune/tagger/staged/{id}",
            delete(tagger::delete_staged_file),
        )
        .route(
            "/ferrotune/tagger/staged/{id}/stream",
            get(tagger::stream_staged_file),
        )
        .route(
            "/ferrotune/tagger/staged/{id}/cover",
            get(tagger::get_staged_cover_art),
        )
        .route(
            "/ferrotune/tagger/stage-library",
            post(tagger::stage_library_tracks),
        )
        .route(
            "/ferrotune/tagger/batch-tags",
            get(tagger::batch_get_tags).patch(tagger::batch_update_tags),
        )
        .route("/ferrotune/tagger/save", post(tagger::save_staged_files))
        .route("/ferrotune/tagger/rescan", post(tagger::rescan_files))
        .route("/ferrotune/tagger/rename", post(tagger::rename_files))
        .route(
            "/ferrotune/tagger/check-conflicts",
            post(tagger::check_path_conflicts),
        )
        // Tagger session endpoints (database-backed state)
        .route(
            "/ferrotune/tagger/session",
            get(tagger_session::get_session)
                .patch(tagger_session::update_session)
                .delete(tagger_session::clear_session),
        )
        // Track CRUD endpoints
        .route(
            "/ferrotune/tagger/session/tracks",
            axum::routing::put(tagger_session::set_session_tracks).post(tagger_session::add_tracks),
        )
        .route(
            "/ferrotune/tagger/session/tracks/remove",
            post(tagger_session::remove_tracks),
        )
        .route(
            "/ferrotune/tagger/session/tracks/{track_id}",
            delete(tagger_session::remove_track),
        )
        // Edit CRUD endpoints (batch - GET all, DELETE all)
        .route(
            "/ferrotune/tagger/session/edits",
            get(tagger_session::get_pending_edits).delete(tagger_session::clear_pending_edits),
        )
        // Edit CRUD endpoints (individual)
        .route(
            "/ferrotune/tagger/session/edits/{track_id}",
            axum::routing::put(tagger_session::update_edit).delete(tagger_session::delete_edit),
        )
        // Cover art endpoints (multipart upload)
        .route(
            "/ferrotune/tagger/session/edits/{track_id}/cover",
            get(tagger_session::get_cover_art)
                .put(tagger_session::upload_cover_art)
                .delete(tagger_session::delete_cover_art),
        )
        // Replacement audio endpoints (multipart upload)
        .route(
            "/ferrotune/tagger/session/edits/{track_id}/replacement-audio",
            axum::routing::put(tagger_session::upload_replacement_audio)
                .delete(tagger_session::delete_replacement_audio),
        )
        .route(
            "/ferrotune/tagger/session/edits/{track_id}/replacement-audio/stream",
            get(tagger_session::stream_replacement_audio),
        )
        // Save endpoint - reads from database and applies to files
        .route(
            "/ferrotune/tagger/session/save",
            post(tagger_session::save_pending_edits),
        )
        // Save endpoint with streaming progress
        .route(
            "/ferrotune/tagger/session/save-stream",
            post(tagger_session::save_pending_edits_stream),
        )
        // Scripts endpoints
        .route(
            "/ferrotune/tagger/scripts",
            get(tagger_session::get_scripts).put(tagger_session::save_scripts),
        )
        .route(
            "/ferrotune/tagger/scripts/{id}",
            delete(tagger_session::delete_script),
        )
        // Apply larger body limit to allow large payloads like cover art data in preferences
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024))
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
