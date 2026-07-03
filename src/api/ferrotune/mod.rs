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
//! - `GET /api/health` - Health check
//! - `GET /api/stats` - Get server statistics (song/album/artist counts, total duration, etc.)
//! - `POST /api/scan` - Trigger a library scan
//! - `GET /api/scan/status` - Get current scan status (placeholder for future async scanning)
//! - `GET /api/duplicates` - Get duplicate files detected during scanning
//!
//! ## Music Folder Endpoints
//!
//! - `GET /api/music-folders` - List all music folders with stats
//! - `POST /api/music-folders` - Add a new music folder
//! - `GET /api/music-folders/:id` - Get a music folder with stats
//! - `PATCH /api/music-folders/:id` - Update a music folder (name, enabled)
//! - `DELETE /api/music-folders/:id` - Delete a music folder (cascades to songs)
//! - `GET /api/music-folders/:id/stats` - Get detailed stats for a music folder
//!
//! ## Playlist Folder Endpoints
//!
//! - `GET /api/playlist-folders` - Get all playlist folders and playlists
//! - `POST /api/playlist-folders` - Create a new playlist folder
//! - `PATCH /api/playlist-folders/:id` - Update a playlist folder
//! - `DELETE /api/playlist-folders/:id` - Delete a playlist folder
//! - `PATCH /api/playlists/:id/move` - Move a playlist to a folder
//! - `PUT /api/playlists/:id/reorder` - Reorder songs in a playlist
//! - `POST /api/playlists/membership` - Sync visible playlist membership for a set of song IDs
//!
//! ## Song Management Endpoints
//!
//! - `GET /api/songs/ids` - Get all song IDs matching search/filter criteria (for bulk selection)
//! - `DELETE /api/songs/:id` - Delete a song from the database
//! - `GET /api/songs/:id/tags` - Get all tags from a song file
//! - `PATCH /api/songs/:id/tags` - Update tags in a song file
//!
//! ## User Preferences Endpoints
//!
//! - `GET /api/preferences` - Get user preferences
//! - `PUT /api/preferences` - Update user preferences
//!
//! ## Playback Endpoints
//!
//! - `POST /api/play-queue` - Save play queue (JSON body, scalable alternative to OpenSubsonic)
//! - `POST /api/listening` - Log a listening session
//! - `GET /api/listening/stats` - Get listening statistics
//! - `GET /api/songs/:id/waveform` - Get pre-computed waveform data for a song
//! - `GET /api/songs/:id/shuffle-exclude` - Get shuffle exclude status for a song
//! - `PUT /api/songs/:id/shuffle-exclude` - Set shuffle exclude status for a song
//! - `GET /api/shuffle-excludes` - Get all songs excluded from shuffle
//!
//! ## Server-Side Queue Endpoints
//!
//! - `POST /api/queue/start` - Start a new queue from a source (album, artist, playlist, etc.)
//! - `GET /api/queue` - Get current queue state with pagination
//! - `DELETE /api/queue` - Clear the entire queue
//! - `GET /api/queue/current-window` - Get songs around current position
//! - `POST /api/queue/add` - Add songs to queue at position
//! - `DELETE /api/queue/:position` - Remove song at position
//! - `POST /api/queue/move` - Move song from one position to another
//! - `POST /api/queue/shuffle` - Toggle shuffle mode
//! - `POST /api/queue/position` - Update current playback position
//! - `POST /api/queue/repeat` - Update repeat mode
//!
//! ## Directory Browsing Endpoints
//!
//! - `GET /api/directory` - Get paginated directory contents with sorting, filtering, and folder sizes
//!
//! ## Server Configuration Endpoints
//!
//! - `GET /api/config` - Get server configuration
//! - `PUT /api/config` - Update server configuration
//! - `GET /api/config/all` - Get all configuration as key-value pairs

mod auth;
mod browse;
pub mod directory;
mod disabled_songs;
mod duplicates;
mod filesystem;
pub mod history;
mod history_admin;
mod home;
pub mod lastfm;
mod listening;
mod lists;
mod match_dictionary;
mod media;
pub mod music_folders;
pub mod playlists;
mod playqueue;
mod preferences;
mod queue;
pub mod recycle_bin;
mod scan;
pub mod scan_state;
mod scrobbles;
mod search;
pub mod server_config;
mod sessions;
mod setup;
mod shuffle_exclude;
pub mod smart_playlists;
mod songs;
mod starring;
mod stats;
pub mod tagger;
pub mod tagger_session;
pub mod tags;
mod testing;
pub mod users;
mod waveform;

pub use duplicates::{
    get_duplicates as ferrotune_get_duplicates, DuplicateFile, DuplicateGroup, DuplicatesResponse,
};
pub use history_admin::{
    delete_history_entries, delete_matching_history_entries, list_history_entries,
    DeleteManagedHistoryEntriesRequest, DeleteManagedHistoryEntriesResponse,
    DeleteMatchingManagedHistoryEntriesRequest, ManagedHistoryEntriesResponse, ManagedHistoryEntry,
    ManagedHistoryEntryKind, ManagedHistoryFilter,
};
pub use home::{
    get_continue_listening, get_home, ContinueListeningParams, HomeContinueListeningSection,
    HomePageParams, HomePageResponse,
};
pub use listening::{
    get_listening_stats as ferrotune_get_listening_stats,
    get_period_review as ferrotune_get_period_review, log_listening as ferrotune_log_listening,
    LogListeningRequest, LogListeningResponse, PeriodReviewQuery, PeriodReviewResponse,
};
pub use lists::{
    get_album_list, get_forgotten_favorites, get_most_played_recently, get_random_songs,
    get_songs_by_genre, AlbumListParams, AlbumListType, FerrotuneAlbumListResponse,
    FerrotuneRandomSongsResponse, FerrotuneSongsByGenreResponse, ForgottenFavoritesParams,
    ForgottenFavoritesResponse, MostPlayedRecentlyParams, MostPlayedRecentlyResponse,
    RandomSongsParams, SongsByGenreParams,
};
pub use match_dictionary::{
    get_match_dictionary, save_match_dictionary, MatchDictionaryEntry, MatchDictionaryResponse,
    SaveMatchDictionaryRequest, SaveMatchDictionaryResponse,
};
pub use playqueue::{
    save_play_queue as ferrotune_save_play_queue, SavePlayQueueRequest, SavePlayQueueResponse,
};
pub use preferences::{
    delete_preference as ferrotune_delete_preference, get_preference as ferrotune_get_preference,
    get_preferences as ferrotune_get_preferences, set_preference as ferrotune_set_preference,
    update_preferences as ferrotune_update_preferences, GetPreferenceResponse, PreferencesResponse,
    SetPreferenceRequest, UpdatePreferencesRequest,
};
pub use queue::{
    get_lazy_queue_count, materialize_lazy_queue_page, start_queue, StartQueueRequest,
};
pub use scrobbles::{
    check_import_duplicate, get_play_counts, import_scrobbles, import_with_timestamps,
    scrobble as ferrotune_scrobble, CheckDuplicateParams, GetPlayCountsRequest, ImportMode,
    ImportScrobbleEntry, ImportScrobblesRequest, ImportSongWithPlays, ImportWithTimestampsRequest,
    PlayEvent, ScrobbleParams as FerrotuneScrobbleParams,
};
pub use setup::{complete_setup, get_setup_status, SetupStatusResponse};
pub use stats::{get_stats as ferrotune_get_stats, StatsResponse};
pub use waveform::{get_waveform as ferrotune_get_waveform, WaveformResponse};

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
        .route("/health", get(health))
        .route("/features", get(features))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/url-token", post(auth::create_url_token))
        // Home page batch endpoint
        .route("/home", get(home::get_home))
        .route("/continue-listening", get(home::get_continue_listening))
        // Browse endpoints (migrated from OpenSubsonic)
        .route("/ping", get(browse::ping))
        .route("/artists", get(browse::get_artists))
        .route("/artists/{id}", get(browse::get_artist))
        .route("/albums/{id}", get(browse::get_album))
        // .route("/songs/{id}", get(browse::get_song)) <- Moved to combined route below
        .route("/genres", get(browse::get_genres))
        .route("/indexes", get(browse::get_indexes))
        // List endpoints (migrated from OpenSubsonic)
        .route("/albums", get(lists::get_album_list))
        .route("/songs/random", get(lists::get_random_songs))
        .route("/songs/by-genre", get(lists::get_songs_by_genre))
        .route(
            "/songs/most-played-recently",
            get(lists::get_most_played_recently),
        )
        .route(
            "/songs/forgotten-favorites",
            get(lists::get_forgotten_favorites),
        )
        // Search endpoint (migrated from OpenSubsonic)
        .route("/search", get(search::search))
        // Media endpoints (migrated from OpenSubsonic)
        .route("/stream", get(media::stream))
        .route("/cover-art", get(media::get_cover_art))
        .route("/download", get(media::download))
        // Starring endpoints (migrated from OpenSubsonic)
        .route("/star", post(starring::star))
        .route("/unstar", post(starring::unstar))
        .route("/rating", post(starring::set_rating))
        .route("/starred", get(starring::get_starred))
        // History endpoint (migrated from OpenSubsonic)
        .route("/history", get(history::get_play_history))
        .route("/history/entries", get(history_admin::list_history_entries))
        .route(
            "/history/delete",
            post(history_admin::delete_history_entries),
        )
        .route(
            "/history/delete-matching",
            post(history_admin::delete_matching_history_entries),
        )
        // Setup endpoint (unauthenticated - for first-run detection)
        .route("/setup/status", get(setup::get_setup_status))
        .route("/setup/complete", post(setup::complete_setup))
        // Testing endpoint (requires FERROTUNE_TESTING=true env var)
        .route("/testing/reset", post(testing::reset_state))
        .route("/stats", get(stats::get_stats))
        .route("/scan", post(scan::start_scan))
        .route("/scan/status", get(scan::scan_status))
        .route("/scan/progress", get(scan::scan_progress_stream))
        .route("/scan/logs", get(scan::scan_logs))
        .route("/scan/full", get(scan::full_scan_status))
        .route("/scan/details", get(scan::scan_details))
        .route("/scan/cancel", post(scan::cancel_scan))
        .route("/duplicates", get(duplicates::get_duplicates))
        // Directory browsing endpoints
        .route("/libraries", get(directory::get_libraries))
        .route("/directory", get(directory::get_directory_paged))
        // Filesystem browsing endpoints (for setup)
        .route("/filesystem", get(filesystem::browse_filesystem))
        .route("/filesystem/validate", get(filesystem::validate_path))
        // Music folder management endpoints
        .route(
            "/music-folders",
            get(music_folders::list_music_folders).post(music_folders::create_music_folder),
        )
        .route(
            "/music-folders/{id}",
            get(music_folders::get_music_folder)
                .patch(music_folders::update_music_folder)
                .delete(music_folders::delete_music_folder),
        )
        .route(
            "/music-folders/{id}/stats",
            get(music_folders::get_music_folder_stats),
        )
        // Playlist folder endpoints
        .route("/playlist-folders", get(playlists::get_playlist_folders))
        .route("/playlist-folders", post(playlists::create_playlist_folder))
        .route(
            "/playlist-folders/{id}",
            patch(playlists::update_playlist_folder),
        )
        .route(
            "/playlist-folders/{id}",
            delete(playlists::delete_playlist_folder),
        )
        .route(
            "/playlist-folders/{id}/cover",
            axum::routing::put(playlists::upload_playlist_folder_cover)
                .delete(playlists::delete_playlist_folder_cover),
        )
        .route("/playlists/{id}/move", patch(playlists::move_playlist))
        .route(
            "/playlists/{id}/reorder",
            axum::routing::put(playlists::reorder_playlist_songs),
        )
        .route(
            "/playlists/{id}/match-missing",
            post(playlists::match_missing_entry),
        )
        .route("/playlists/{id}/unmatch", post(playlists::unmatch_entry))
        .route(
            "/playlists/{id}/batch-match",
            post(playlists::batch_match_entries),
        )
        .route(
            "/playlists/{id}/move-entry",
            post(playlists::move_playlist_entry),
        )
        .route(
            "/playlists/{id}/shares",
            get(playlists::get_playlist_shares).put(playlists::set_playlist_shares),
        )
        .route(
            "/playlists/{id}/transfer-ownership",
            post(playlists::transfer_playlist_ownership),
        )
        .route(
            "/playlists/{id}/songs",
            get(playlists::get_playlist_songs)
                .post(playlists::add_playlist_songs)
                .delete(playlists::remove_playlist_songs),
        )
        .route("/playlists", post(playlists::import_playlist))
        .route(
            "/playlists/membership",
            post(playlists::get_playlist_memberships_for_songs),
        )
        .route(
            "/playlists/{id}",
            get(playlists::get_playlist_songs)
                .put(playlists::update_playlist)
                .delete(playlists::delete_playlist),
        )
        .route("/playlists/import", post(playlists::import_playlist))
        .route(
            "/playlists/containing-songs",
            get(playlists::get_playlists_for_songs),
        )
        .route(
            "/playlists/recently-played",
            get(playlists::get_recently_played_playlists),
        )
        // Song ID query endpoint (for bulk selection)
        .route("/songs/ids", get(media::get_song_ids))
        // Song match list endpoint (for client-side matching)
        .route("/songs/match-list", get(songs::get_song_match_list))
        // Server-side fuzzy matching endpoint
        .route("/songs/match", post(songs::match_tracks))
        // Match dictionary endpoint (for reusing prior matches)
        .route(
            "/match-dictionary",
            get(match_dictionary::get_match_dictionary)
                .post(match_dictionary::save_match_dictionary),
        )
        // Album and artist matching endpoints (for favorites import)
        .route("/albums/match", post(songs::match_albums))
        .route("/artists/match", post(songs::match_artists))
        // Media management endpoints
        .route(
            "/songs/{id}",
            get(browse::get_song).delete(media::delete_song),
        )
        .route("/songs/{id}/similar", get(browse::get_similar_songs))
        // Delete song files (from disk and database)
        .route("/songs/delete-files", post(media::delete_song_files))
        // Tag management endpoints
        .route(
            "/songs/{id}/tags",
            get(tags::get_tags).patch(tags::update_tags),
        )
        // User preferences endpoints
        .route(
            "/preferences",
            get(preferences::get_preferences).put(preferences::update_preferences),
        )
        .route(
            "/preferences/{key}",
            get(preferences::get_preference)
                .put(preferences::set_preference)
                .delete(preferences::delete_preference),
        )
        // Play queue endpoints
        .route("/play-queue", post(playqueue::save_play_queue))
        // Listening statistics endpoints
        .route("/listening", post(listening::log_listening))
        .route("/listening/stats", get(listening::get_listening_stats))
        .route("/listening/review", get(listening::get_period_review))
        // Scrobbles import endpoints
        .route("/scrobbles", post(scrobbles::scrobble))
        .route("/scrobbles/import", post(scrobbles::import_scrobbles))
        .route(
            "/scrobbles/import-with-timestamps",
            post(scrobbles::import_with_timestamps),
        )
        .route("/scrobbles/counts", post(scrobbles::get_play_counts))
        .route(
            "/scrobbles/check-duplicate",
            get(scrobbles::check_import_duplicate),
        )
        // Last.fm integration endpoints
        .route("/lastfm/auth-url", get(lastfm::get_auth_url))
        .route("/lastfm/callback", post(lastfm::callback))
        .route("/lastfm/status", get(lastfm::status))
        .route("/lastfm/disconnect", post(lastfm::disconnect))
        .route(
            "/lastfm/config",
            get(lastfm::get_config).put(lastfm::save_config),
        )
        // Waveform endpoints
        .route("/songs/{id}/waveform", get(waveform::get_waveform))
        // Shuffle exclude endpoints
        .route(
            "/songs/{id}/shuffle-exclude",
            get(shuffle_exclude::get_shuffle_exclude).put(shuffle_exclude::set_shuffle_exclude),
        )
        .route(
            "/shuffle-excludes",
            get(shuffle_exclude::get_all_shuffle_excludes),
        )
        .route(
            "/shuffle-excludes/bulk",
            post(shuffle_exclude::bulk_set_shuffle_excludes),
        )
        // Disabled songs endpoints
        .route(
            "/songs/{id}/disabled",
            get(disabled_songs::get_disabled).put(disabled_songs::set_disabled),
        )
        .route("/disabled-songs", get(disabled_songs::get_all_disabled))
        .route(
            "/disabled-songs/bulk",
            post(disabled_songs::bulk_set_disabled),
        )
        // Server-side queue endpoints
        .route("/queue/start", post(queue::start_queue))
        .route("/queue", get(queue::get_queue).delete(queue::clear_queue))
        .route("/queue/current-window", get(queue::get_current_window))
        .route("/queue/add", post(queue::add_to_queue))
        .route("/queue/{position}", delete(queue::remove_from_queue))
        .route("/queue/move", post(queue::move_in_queue))
        .route("/queue/shuffle", post(queue::toggle_shuffle))
        .route("/queue/position", post(queue::update_position))
        .route("/queue/repeat", post(queue::update_repeat_mode))
        // Playback session endpoints
        .route(
            "/sessions",
            get(sessions::get_session_info).post(sessions::connect_session),
        )
        .route("/sessions/clients", get(sessions::list_clients))
        .route(
            "/sessions/{id}/heartbeat",
            post(sessions::session_heartbeat),
        )
        .route("/sessions/{id}/events", get(sessions::session_events))
        .route("/sessions/{id}/command", post(sessions::session_command))
        .route(
            "/sessions/{id}/clients/{client_id}",
            delete(sessions::disconnect_client).post(sessions::disconnect_client),
        )
        // User management endpoints (admin only)
        .route("/users/me", get(users::get_current_user))
        .route("/users/shareable", get(users::list_shareable_users))
        .route("/users", get(users::list_users).post(users::create_user))
        .route(
            "/users/{id}",
            get(users::get_user)
                .patch(users::update_user)
                .delete(users::delete_user),
        )
        .route(
            "/users/{id}/library-access",
            get(users::get_library_access).put(users::set_library_access),
        )
        // Server configuration endpoints (admin only)
        .route(
            "/config",
            get(server_config::get_server_config).put(server_config::update_server_config),
        )
        .route("/config/all", get(server_config::get_all_config))
        // Recycle bin endpoints (soft delete)
        .route("/recycle-bin", get(recycle_bin::list_recycle_bin))
        .route("/recycle-bin/mark", post(recycle_bin::mark_for_deletion))
        .route("/recycle-bin/restore", post(recycle_bin::restore_songs))
        .route(
            "/recycle-bin/delete-permanently",
            post(recycle_bin::delete_permanently),
        )
        .route("/recycle-bin/empty", post(recycle_bin::empty_recycle_bin))
        .route(
            "/recycle-bin/purge-expired",
            post(recycle_bin::purge_expired),
        )
        // Smart playlist endpoints
        .route(
            "/smart-playlists",
            get(smart_playlists::list_smart_playlists).post(smart_playlists::create_smart_playlist),
        )
        .route(
            "/smart-playlists/{id}",
            get(smart_playlists::get_smart_playlist)
                .put(smart_playlists::update_smart_playlist)
                .delete(smart_playlists::delete_smart_playlist),
        )
        .route(
            "/smart-playlists/{id}/songs",
            get(smart_playlists::get_smart_playlist_songs),
        )
        .route(
            "/smart-playlists/{id}/materialize",
            post(smart_playlists::materialize_smart_playlist),
        )
        // Tagger endpoints
        .route("/tagger/upload", post(tagger::upload_files))
        .route("/tagger/staged", get(tagger::list_staged_files))
        .route("/tagger/orphaned", get(tagger::discover_orphaned_files))
        .route("/tagger/staged/{id}", delete(tagger::delete_staged_file))
        .route(
            "/tagger/staged/{id}/stream",
            get(tagger::stream_staged_file),
        )
        .route(
            "/tagger/staged/{id}/cover",
            get(tagger::get_staged_cover_art),
        )
        .route("/tagger/stage-library", post(tagger::stage_library_tracks))
        .route(
            "/tagger/batch-tags",
            get(tagger::batch_get_tags).patch(tagger::batch_update_tags),
        )
        .route("/tagger/save", post(tagger::save_staged_files))
        .route("/tagger/rescan", post(tagger::rescan_files))
        .route("/tagger/rename", post(tagger::rename_files))
        .route(
            "/tagger/check-conflicts",
            post(tagger::check_path_conflicts),
        )
        .route("/tagger/song-paths", get(tagger::get_song_paths))
        // Tagger session endpoints (database-backed state)
        .route(
            "/tagger/session",
            get(tagger_session::get_session)
                .patch(tagger_session::update_session)
                .delete(tagger_session::clear_session),
        )
        // Track CRUD endpoints
        .route(
            "/tagger/session/tracks",
            axum::routing::put(tagger_session::set_session_tracks).post(tagger_session::add_tracks),
        )
        .route(
            "/tagger/session/tracks/remove",
            post(tagger_session::remove_tracks),
        )
        .route(
            "/tagger/session/tracks/{track_id}",
            delete(tagger_session::remove_track),
        )
        // Edit CRUD endpoints (batch - GET all, DELETE all)
        .route(
            "/tagger/session/edits",
            get(tagger_session::get_pending_edits).delete(tagger_session::clear_pending_edits),
        )
        // Edit CRUD endpoints (individual)
        .route(
            "/tagger/session/edits/{track_id}",
            axum::routing::put(tagger_session::update_edit).delete(tagger_session::delete_edit),
        )
        // Cover art endpoints (multipart upload)
        .route(
            "/tagger/session/edits/{track_id}/cover",
            get(tagger_session::get_cover_art)
                .put(tagger_session::upload_cover_art)
                .delete(tagger_session::delete_cover_art),
        )
        // Replacement audio endpoints (multipart upload)
        .route(
            "/tagger/session/edits/{track_id}/replacement-audio",
            axum::routing::put(tagger_session::upload_replacement_audio)
                .delete(tagger_session::delete_replacement_audio),
        )
        .route(
            "/tagger/session/edits/{track_id}/replacement-audio/stream",
            get(tagger_session::stream_replacement_audio),
        )
        // Save endpoint - reads from database and applies to files
        .route(
            "/tagger/session/save",
            post(tagger_session::save_pending_edits),
        )
        // Save endpoint with streaming progress
        .route(
            "/tagger/session/save-stream",
            post(tagger_session::save_pending_edits_stream),
        )
        // Scripts endpoints
        .route(
            "/tagger/scripts",
            get(tagger_session::get_scripts).put(tagger_session::save_scripts),
        )
        .route(
            "/tagger/scripts/{id}",
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

/// Server feature flags exposed to the frontend.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ServerFeatures {
    /// Whether bliss audio analysis (song similarity) is available.
    pub bliss: bool,
}

/// Returns which optional features are compiled into this server build.
async fn features() -> impl IntoResponse {
    Json(ServerFeatures {
        bliss: cfg!(feature = "bliss"),
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
