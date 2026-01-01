//! Common play queue utilities.
//!
//! This module provides shared functionality for play queue operations,
//! used by both Subsonic and Ferrotune APIs.

/// Find the index of a song ID in a list of song IDs
/// Returns the index as i64, or 0 if not found
pub fn find_current_index(song_ids: &[String], current_song_id: Option<&str>) -> i64 {
    current_song_id
        .and_then(|current_id| {
            song_ids
                .iter()
                .position(|id| id == current_id)
                .map(|i| i as i64)
        })
        .unwrap_or(0)
}
