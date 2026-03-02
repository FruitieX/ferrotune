//! Shared sorting utilities for songs, albums, and artists.
//!
//! This module provides server-side sorting to match client expectations.
//! All sorting should be done server-side to ensure queue materialization
//! uses the same order as the displayed list.

use crate::db::models::Song;
use serde::Deserialize;

/// Sort configuration passed from client
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SortParams {
    /// Sort field: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
}

/// Filter configuration passed from client
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct FilterParams {
    /// Text filter to match against title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

/// Combined sort and filter params
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SortFilterParams {
    /// Sort field: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Text filter to match against title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

/// Sort songs by the specified field and direction.
/// This matches the client-side sorting logic in sort-songs.ts.
pub fn sort_songs(mut songs: Vec<Song>, sort: Option<&str>, sort_dir: Option<&str>) -> Vec<Song> {
    let field = sort.unwrap_or("custom");
    let direction = sort_dir.unwrap_or("asc");

    // "custom" means preserve original order (no sorting)
    if field == "custom" {
        if direction == "desc" {
            songs.reverse();
        }
        return songs;
    }

    songs.sort_by(|a, b| {
        let cmp = match field {
            "name" | "title" => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
            "artist" => a
                .artist_name
                .to_lowercase()
                .cmp(&b.artist_name.to_lowercase()),
            "album" => {
                let a_album = a.album_name.as_deref().unwrap_or("");
                let b_album = b.album_name.as_deref().unwrap_or("");
                a_album.to_lowercase().cmp(&b_album.to_lowercase())
            }
            "year" => a.year.unwrap_or(0).cmp(&b.year.unwrap_or(0)),
            "dateAdded" | "created" => a.created_at.cmp(&b.created_at),
            "playCount" => a.play_count.unwrap_or(0).cmp(&b.play_count.unwrap_or(0)),
            "lastPlayed" => match (&a.last_played, &b.last_played) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater, // NULLs last
                (Some(_), None) => std::cmp::Ordering::Less,    // NULLs last
                (Some(a_lp), Some(b_lp)) => a_lp.cmp(b_lp),
            },
            "duration" => a.duration.cmp(&b.duration),
            "size" => a.file_size.cmp(&b.file_size),
            "genre" => {
                let a_genre = a.genre.as_deref().unwrap_or("");
                let b_genre = b.genre.as_deref().unwrap_or("");
                a_genre.to_lowercase().cmp(&b_genre.to_lowercase())
            }
            "bitRate" | "bitrate" => a.bitrate.unwrap_or(0).cmp(&b.bitrate.unwrap_or(0)),
            "format" => a
                .file_format
                .to_lowercase()
                .cmp(&b.file_format.to_lowercase()),
            "starred" => match (&a.starred_at, &b.starred_at) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(a_s), Some(b_s)) => a_s.cmp(b_s),
            },
            "rating" => {
                // Rating uses user_rating which is not on the Song model directly.
                // Songs without ratings sort last.
                std::cmp::Ordering::Equal
            }
            // Track number sort: by disc number first, then track number
            "trackNumber" => {
                let disc_cmp = a.disc_number.cmp(&b.disc_number);
                if disc_cmp != std::cmp::Ordering::Equal {
                    disc_cmp
                } else {
                    a.track_number
                        .unwrap_or(0)
                        .cmp(&b.track_number.unwrap_or(0))
                }
            }
            _ => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
        };
        cmp
    });

    if direction == "desc" {
        songs.reverse();
    }

    songs
}

/// Filter songs by a text query (matches title, artist, album).
pub fn filter_songs(songs: Vec<Song>, filter: Option<&str>) -> Vec<Song> {
    match filter {
        Some(query) if !query.trim().is_empty() => {
            let query = query.to_lowercase();
            songs
                .into_iter()
                .filter(|song| {
                    song.title.to_lowercase().contains(&query)
                        || song.artist_name.to_lowercase().contains(&query)
                        || song
                            .album_name
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&query)
                })
                .collect()
        }
        _ => songs,
    }
}

/// Apply both filtering and sorting to songs.
pub fn filter_and_sort_songs(
    songs: Vec<Song>,
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> Vec<Song> {
    let filtered = filter_songs(songs, filter);
    sort_songs(filtered, sort, sort_dir)
}

/// Sort songs using SortFilterParams struct
#[allow(dead_code)]
pub fn apply_sort_filter(songs: Vec<Song>, params: &SortFilterParams) -> Vec<Song> {
    filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    )
}

/// Convert JSON sort object to sort params (for queue materialization)
pub fn parse_sort_from_json(sort: Option<&serde_json::Value>) -> (Option<String>, Option<String>) {
    match sort {
        Some(s) => {
            let obj = s.as_object();
            let field = obj
                .and_then(|o| o.get("field"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let direction = obj
                .and_then(|o| o.get("direction"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            (field, direction)
        }
        None => (None, None),
    }
}

/// Sort songs using JSON sort configuration (for queue materialization)
#[allow(dead_code)]
pub fn sort_songs_from_json(songs: Vec<Song>, sort: Option<&serde_json::Value>) -> Vec<Song> {
    let (field, direction) = parse_sort_from_json(sort);
    sort_songs(songs, field.as_deref(), direction.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_song(id: &str, title: &str, artist: &str, album: &str, year: Option<i32>) -> Song {
        Song {
            id: id.to_string(),
            title: title.to_string(),
            album_id: Some("album1".to_string()),
            album_name: Some(album.to_string()),
            artist_id: "artist1".to_string(),
            artist_name: artist.to_string(),
            track_number: Some(1),
            disc_number: 1,
            year,
            genre: None,
            duration: 180,
            bitrate: Some(320),
            file_path: "/music/test.mp3".to_string(),
            file_size: 5000000,
            file_format: "mp3".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            cover_art_hash: None,
            cover_art_width: None,
            cover_art_height: None,
            original_replaygain_track_gain: None,
            original_replaygain_track_peak: None,
            computed_replaygain_track_gain: None,
            computed_replaygain_track_peak: None,
            play_count: Some(0),
            last_played: None,
            starred_at: None,
        }
    }

    #[test]
    fn test_sort_by_name() {
        let songs = vec![
            make_song("1", "Zebra", "Artist", "Album", None),
            make_song("2", "Apple", "Artist", "Album", None),
            make_song("3", "Mango", "Artist", "Album", None),
        ];

        let sorted = sort_songs(songs, Some("name"), Some("asc"));
        assert_eq!(sorted[0].title, "Apple");
        assert_eq!(sorted[1].title, "Mango");
        assert_eq!(sorted[2].title, "Zebra");
    }

    #[test]
    fn test_sort_by_year_desc() {
        let songs = vec![
            make_song("1", "Song1", "Artist", "Album", Some(2020)),
            make_song("2", "Song2", "Artist", "Album", Some(2023)),
            make_song("3", "Song3", "Artist", "Album", Some(2021)),
        ];

        let sorted = sort_songs(songs, Some("year"), Some("desc"));
        assert_eq!(sorted[0].year, Some(2023));
        assert_eq!(sorted[1].year, Some(2021));
        assert_eq!(sorted[2].year, Some(2020));
    }

    #[test]
    fn test_filter_songs() {
        let songs = vec![
            make_song("1", "Hello World", "Artist1", "Album1", None),
            make_song("2", "Goodbye", "Artist2", "Album2", None),
            make_song("3", "World Tour", "Artist3", "Hello Album", None),
        ];

        let filtered = filter_songs(songs, Some("hello"));
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().any(|s| s.title == "Hello World"));
        assert!(filtered
            .iter()
            .any(|s| s.album_name.as_deref() == Some("Hello Album")));
    }
}
