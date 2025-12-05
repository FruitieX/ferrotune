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
//! - `GET /ferrotune/playlist-folders` - Get all playlist folders and playlists
//! - `POST /ferrotune/playlist-folders` - Create a new playlist folder
//! - `PATCH /ferrotune/playlist-folders/:id` - Update a playlist folder
//! - `DELETE /ferrotune/playlist-folders/:id` - Delete a playlist folder
//! - `PATCH /ferrotune/playlists/:id/move` - Move a playlist to a folder//! - `PUT /ferrotune/playlists/:id/reorder` - Reorder songs in a playlist//! - `DELETE /ferrotune/songs/:id` - Delete a song from the database
//! - `GET /ferrotune/songs/:id/tags` - Get all tags from a song file
//! - `PATCH /ferrotune/songs/:id/tags` - Update tags in a song file
//! - `GET /ferrotune/preferences` - Get user preferences
//! - `PUT /ferrotune/preferences` - Update user preferences
//! - `POST /ferrotune/play-queue` - Save play queue (JSON body, scalable alternative to OpenSubsonic)
//! - `POST /ferrotune/listening` - Log a listening session
//! - `GET /ferrotune/listening/stats` - Get listening statistics
//! - `GET /ferrotune/songs/:id/waveform` - Get waveform data for a song
//! - `GET /ferrotune/songs/:id/waveform/stream` - Get waveform data as SSE stream
//! - `GET /ferrotune/songs/:id/shuffle-exclude` - Get shuffle exclude status for a song
//! - `PUT /ferrotune/songs/:id/shuffle-exclude` - Set shuffle exclude status for a song
//! - `GET /ferrotune/shuffle-excludes` - Get all songs excluded from shuffle

mod duplicates;
mod listening;
mod media;
mod playlists;
mod playqueue;
mod preferences;
mod scan;
mod shuffle_exclude;
mod stats;
mod tags;
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
        .route("/ferrotune/stats", get(stats::get_stats))
        .route("/ferrotune/scan", post(scan::start_scan))
        .route("/ferrotune/scan/status", get(scan::scan_status))
        .route("/ferrotune/duplicates", get(duplicates::get_duplicates))
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
        // Waveform generation endpoint
        .route(
            "/ferrotune/songs/{id}/waveform",
            get(waveform::get_waveform),
        )
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
