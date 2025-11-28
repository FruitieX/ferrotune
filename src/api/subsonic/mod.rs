//! OpenSubsonic-compatible API handlers.
//!
//! This module implements the OpenSubsonic API specification for compatibility
//! with existing Subsonic/Navidrome/etc music player clients.

pub mod auth;
pub mod browse;
pub mod coverart;
pub mod lists;
pub mod playlists;
pub mod playqueue;
pub mod query;
pub mod response;
pub mod search;
pub mod starring;
pub mod stream;
pub mod system;
pub mod xml;

pub use query::first_string;
pub use query::first_string_or_none;
pub use query::string_or_seq;
pub use query::QsQuery;

use crate::api::AppState;
use axum::{routing::get, Router};
use std::sync::Arc;

/// Create the OpenSubsonic API router.
///
/// All routes are prefixed with `/rest/` to match the Subsonic API specification.
pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        // System endpoints
        .route("/rest/ping", get(system::ping))
        .route("/rest/getLicense", get(system::get_license))
        .route(
            "/rest/getOpenSubsonicExtensions",
            get(system::get_opensubsonic_extensions),
        )
        .route("/rest/getMusicFolders", get(system::get_music_folders))
        // Browse endpoints
        .route("/rest/getArtists", get(browse::get_artists))
        .route("/rest/getArtist", get(browse::get_artist))
        .route("/rest/getArtistInfo2", get(browse::get_artist_info2))
        .route("/rest/getAlbum", get(browse::get_album))
        .route("/rest/getSong", get(browse::get_song))
        .route("/rest/getGenres", get(browse::get_genres))
        // Media endpoints
        .route("/rest/stream", get(stream::stream))
        .route("/rest/download", get(stream::download))
        .route("/rest/getCoverArt", get(coverart::get_cover_art))
        // Annotation/starring endpoints
        .route("/rest/star", get(starring::star))
        .route("/rest/unstar", get(starring::unstar))
        .route("/rest/setRating", get(starring::set_rating))
        .route("/rest/getStarred", get(starring::get_starred))
        .route("/rest/getStarred2", get(starring::get_starred2))
        .route("/rest/scrobble", get(lists::scrobble))
        // Play queue endpoints
        .route("/rest/savePlayQueue", get(playqueue::save_play_queue))
        .route("/rest/getPlayQueue", get(playqueue::get_play_queue))
        // List endpoints
        .route("/rest/getAlbumList2", get(lists::get_album_list2))
        .route("/rest/getRandomSongs", get(lists::get_random_songs))
        // Search endpoints
        .route("/rest/search3", get(search::search3))
        // Playlist endpoints
        .route("/rest/getPlaylists", get(playlists::get_playlists))
        .route("/rest/getPlaylist", get(playlists::get_playlist))
        .route("/rest/createPlaylist", get(playlists::create_playlist))
        .route("/rest/updatePlaylist", get(playlists::update_playlist))
        .route("/rest/deletePlaylist", get(playlists::delete_playlist))
        // Fallback for unknown endpoints
        .fallback(fallback_handler)
        .with_state(state)
}

async fn fallback_handler(uri: axum::http::Uri) -> impl axum::response::IntoResponse {
    tracing::warn!(path = %uri.path(), "Unknown endpoint requested");
    crate::error::Error::InvalidRequest(format!("Endpoint not implemented: {}", uri.path()))
}
