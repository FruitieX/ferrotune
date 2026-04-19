//! Match Dictionary API
//!
//! Provides endpoints for retrieving and saving the user's match dictionary — a collection of
//! previously matched track entries that can be reused for future imports across all import types
//! (playlists, favorites, play counts).

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use crate::db::models::MissingEntryData;
use crate::db::retry::with_retry;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

use crate::error::FerrotuneApiResult;

/// Row type for match dictionary entries from the database.
type DictRow = (
    Option<String>, // original_title
    Option<String>, // original_artist
    Option<String>, // original_album
    Option<i32>,    // original_duration_ms
    String,         // song_id
);

/// An entry in the match dictionary representing a previously matched track.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchDictionaryEntry {
    /// Original track title from import
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Original artist name from import
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    /// Original album name from import
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    /// Original duration in milliseconds from import
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub duration: Option<i32>,
    /// The matched song ID
    pub song_id: String,
}

/// Response containing the user's match dictionary.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchDictionaryResponse {
    /// All previously matched entries for the user
    pub entries: Vec<MatchDictionaryEntry>,
}

/// Request to save matches to the dictionary.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveMatchDictionaryRequest {
    /// Entries to save to the dictionary
    pub entries: Vec<MatchDictionaryEntry>,
}

/// Response after saving matches.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SaveMatchDictionaryResponse {
    /// Number of entries saved (new or updated)
    pub saved: usize,
}

/// Get the current user's match dictionary.
///
/// Returns all previously matched entries from:
/// 1. The dedicated match_dictionary table (from all import types)
/// 2. Legacy playlist entries (for backward compatibility)
///
/// GET /ferrotune/match-dictionary
pub async fn get_match_dictionary(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
) -> FerrotuneApiResult<Json<MatchDictionaryResponse>> {
    // Query entries from the dedicated match_dictionary table
    let dict_rows: Vec<DictRow> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as(
            r#"
            SELECT
                original_title,
                original_artist,
                original_album,
                original_duration_ms,
                song_id
            FROM match_dictionary
            WHERE user_id = ?
            "#,
        )
        .bind(user.user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT
                original_title,
                original_artist,
                original_album,
                original_duration_ms,
                song_id
            FROM match_dictionary
            WHERE user_id = $1
            "#,
        )
        .bind(user.user_id)
        .fetch_all(state.database.postgres_pool()?)
        .await?
    };

    // Query legacy entries from playlists owned by the user
    // An entry is "matched" if it has both missing_entry_data (from import) and song_id (matched)
    let legacy_rows: Vec<(String, String)> = if let Ok(pool) = state.database.sqlite_pool() {
        sqlx::query_as(
            r#"
        SELECT DISTINCT
            ps.missing_entry_data,
            ps.song_id
        FROM playlist_songs ps
        INNER JOIN playlists p ON ps.playlist_id = p.id
        WHERE p.owner_id = ?
          AND ps.missing_entry_data IS NOT NULL
          AND ps.song_id IS NOT NULL
        "#,
        )
        .bind(user.user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
        SELECT DISTINCT
            ps.missing_entry_data,
            ps.song_id
        FROM playlist_songs ps
        INNER JOIN playlists p ON ps.playlist_id = p.id
        WHERE p.owner_id = $1
          AND ps.missing_entry_data IS NOT NULL
          AND ps.song_id IS NOT NULL
        "#,
        )
        .bind(user.user_id)
        .fetch_all(state.database.postgres_pool()?)
        .await?
    };

    // Build entries from the dedicated table
    let mut entries: Vec<MatchDictionaryEntry> = dict_rows
        .into_iter()
        .map(
            |(title, artist, album, duration, song_id)| MatchDictionaryEntry {
                title,
                artist,
                album,
                duration,
                song_id,
            },
        )
        .collect();

    // Parse and add legacy entries (deduplicating by normalized key)
    let existing_keys: std::collections::HashSet<_> = entries
        .iter()
        .filter_map(|e| {
            DictionaryKey::new(e.title.as_deref(), e.artist.as_deref(), e.album.as_deref())
        })
        .collect();

    for (missing_data_json, song_id) in legacy_rows {
        if let Ok(data) = serde_json::from_str::<MissingEntryData>(&missing_data_json) {
            // Skip if we already have this entry from the dedicated table
            if let Some(key) = DictionaryKey::new(
                data.title.as_deref(),
                data.artist.as_deref(),
                data.album.as_deref(),
            ) {
                if existing_keys.contains(&key) {
                    continue;
                }
            }

            entries.push(MatchDictionaryEntry {
                title: data.title,
                artist: data.artist,
                album: data.album,
                duration: data.duration,
                song_id,
            });
        }
    }

    Ok(Json(MatchDictionaryResponse { entries }))
}

/// Create a lookup key for the match dictionary table.
fn create_lookup_key(title: Option<&str>, artist: Option<&str>) -> Option<String> {
    let title_norm = title.map(normalize_for_dictionary).unwrap_or_default();
    let artist_norm = artist.map(normalize_for_dictionary).unwrap_or_default();

    if title_norm.is_empty() || artist_norm.is_empty() {
        return None;
    }

    Some(format!("{}|{}", title_norm, artist_norm))
}

/// Save matches to the user's dictionary.
///
/// Stores or updates match entries for future reuse across all import types.
/// Uses UPSERT to handle duplicates — newer matches overwrite older ones.
///
/// POST /ferrotune/match-dictionary
pub async fn save_match_dictionary(
    State(state): State<Arc<AppState>>,
    user: FerrotuneAuthenticatedUser,
    Json(request): Json<SaveMatchDictionaryRequest>,
) -> FerrotuneApiResult<(StatusCode, Json<SaveMatchDictionaryResponse>)> {
    let mut saved = 0;

    for entry in request.entries {
        // Create lookup key from title + artist
        let lookup_key = match create_lookup_key(entry.title.as_deref(), entry.artist.as_deref()) {
            Some(key) => key,
            None => continue, // Skip entries without title/artist
        };

        // Use UPSERT to insert or update
        let result = with_retry(|| async {
            if let Ok(pool) = state.database.sqlite_pool() {
                sqlx::query(
                    r#"
                INSERT INTO match_dictionary (user_id, lookup_key, original_title, original_artist, original_album, original_duration_ms, song_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, lookup_key) DO UPDATE SET
                    original_title = excluded.original_title,
                    original_artist = excluded.original_artist,
                    original_album = excluded.original_album,
                    original_duration_ms = excluded.original_duration_ms,
                    song_id = excluded.song_id,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                )
                .bind(user.user_id)
                .bind(&lookup_key)
                .bind(&entry.title)
                .bind(&entry.artist)
                .bind(&entry.album)
                .bind(entry.duration)
                .bind(&entry.song_id)
                .execute(pool)
                .await
                .map(|r| r.rows_affected())
            } else {
                sqlx::query(
                    r#"
                INSERT INTO match_dictionary (user_id, lookup_key, original_title, original_artist, original_album, original_duration_ms, song_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id, lookup_key) DO UPDATE SET
                    original_title = EXCLUDED.original_title,
                    original_artist = EXCLUDED.original_artist,
                    original_album = EXCLUDED.original_album,
                    original_duration_ms = EXCLUDED.original_duration_ms,
                    song_id = EXCLUDED.song_id,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                )
                .bind(user.user_id)
                .bind(&lookup_key)
                .bind(&entry.title)
                .bind(&entry.artist)
                .bind(&entry.album)
                .bind(entry.duration)
                .bind(&entry.song_id)
                .execute(state.database.postgres_pool().map_err(|e| sqlx::Error::Configuration(e.to_string().into()))?)
                .await
                .map(|r| r.rows_affected())
            }
        }, None)
        .await?;

        if result > 0 {
            saved += 1;
        }
    }

    Ok((StatusCode::OK, Json(SaveMatchDictionaryResponse { saved })))
}

// =============================================================================
// Dictionary Matching Utilities
// =============================================================================

/// Normalize a string for dictionary key matching.
/// Converts to lowercase, removes punctuation, collapses whitespace.
pub fn normalize_for_dictionary(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A normalized key for dictionary lookup.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct DictionaryKey {
    pub title: String,
    pub artist: String,
    /// Album is optional — if both entries have album, they must match
    pub album: Option<String>,
}

impl DictionaryKey {
    /// Create a new dictionary key from raw strings.
    /// Returns None if title or artist is empty after normalization.
    pub fn new(title: Option<&str>, artist: Option<&str>, album: Option<&str>) -> Option<Self> {
        let title = title.map(normalize_for_dictionary).unwrap_or_default();
        let artist = artist.map(normalize_for_dictionary).unwrap_or_default();

        // Must have at least title and artist for a valid key
        if title.is_empty() || artist.is_empty() {
            return None;
        }

        let album = album
            .map(normalize_for_dictionary)
            .filter(|a| !a.is_empty());

        Some(Self {
            title,
            artist,
            album,
        })
    }
}

/// A value stored in the dictionary (song ID + duration for optional duration matching).
#[derive(Debug, Clone)]
pub struct DictionaryValue {
    pub song_id: String,
    /// Duration in milliseconds from the original import
    pub duration: Option<i32>,
}

/// Match dictionary for fast lookup of previously matched tracks.
pub struct MatchDictionary {
    entries: std::collections::HashMap<DictionaryKey, DictionaryValue>,
}

impl MatchDictionary {
    /// Create a new empty dictionary.
    pub fn new() -> Self {
        Self {
            entries: std::collections::HashMap::new(),
        }
    }

    /// Build a dictionary from a list of entries.
    pub fn from_entries(entries: Vec<MatchDictionaryEntry>) -> Self {
        let mut dict = Self::new();
        for entry in entries {
            if let Some(key) = DictionaryKey::new(
                entry.title.as_deref(),
                entry.artist.as_deref(),
                entry.album.as_deref(),
            ) {
                dict.entries.insert(
                    key,
                    DictionaryValue {
                        song_id: entry.song_id,
                        duration: entry.duration,
                    },
                );
            }
        }
        dict
    }

    /// Look up a track in the dictionary.
    /// Returns Some((song_id, score)) if found, where score is 1.0 for exact match.
    /// Duration matching provides additional confidence but is not required.
    pub fn lookup(
        &self,
        title: Option<&str>,
        artist: Option<&str>,
        album: Option<&str>,
        duration: Option<i64>,
    ) -> Option<(&str, f64)> {
        let key = DictionaryKey::new(title, artist, album)?;

        // Look for exact key match first
        if let Some(value) = self.entries.get(&key) {
            let score = self.calculate_score(duration, value.duration);
            return Some((&value.song_id, score));
        }

        // Try matching without album if the query has album but no exact match
        if key.album.is_some() {
            let key_no_album = DictionaryKey {
                title: key.title.clone(),
                artist: key.artist.clone(),
                album: None,
            };

            // Search for any entry with same title/artist
            for (dict_key, value) in &self.entries {
                if dict_key.title == key_no_album.title && dict_key.artist == key_no_album.artist {
                    let score = self.calculate_score(duration, value.duration) * 0.95; // Slight penalty for album mismatch
                    return Some((&value.song_id, score));
                }
            }
        }

        None
    }

    /// Calculate match score based on duration.
    /// Base score is 1.0, with small bonus for duration match.
    fn calculate_score(&self, query_duration: Option<i64>, dict_duration: Option<i32>) -> f64 {
        match (query_duration, dict_duration) {
            (Some(q), Some(d)) => {
                // Convert dict duration from ms to seconds if needed
                // Import data stores duration in ms, but query may be in seconds
                let d_seconds = if d > 10000 { d / 1000 } else { d };
                let diff = (q - d_seconds as i64).abs();

                if diff <= 2 {
                    1.0 // Perfect match
                } else if diff <= 5 {
                    0.98 // Very close
                } else if diff <= 10 {
                    0.95 // Close enough
                } else {
                    0.90 // Duration mismatch but title/artist match
                }
            }
            _ => 0.97, // No duration to compare, still good match
        }
    }
}

impl Default for MatchDictionary {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_for_dictionary() {
        assert_eq!(normalize_for_dictionary("Hello World"), "hello world");
        assert_eq!(normalize_for_dictionary("  Hello   World  "), "hello world");
        assert_eq!(
            normalize_for_dictionary("Hello (feat. Someone)"),
            "hello feat someone"
        );
        assert_eq!(normalize_for_dictionary("Don't Stop"), "don t stop");
    }

    #[test]
    fn test_dictionary_key_creation() {
        let key = DictionaryKey::new(Some("Hello"), Some("Artist"), None);
        assert!(key.is_some());

        let key = DictionaryKey::new(Some(""), Some("Artist"), None);
        assert!(key.is_none());

        let key = DictionaryKey::new(Some("Hello"), Some(""), None);
        assert!(key.is_none());
    }

    #[test]
    fn test_dictionary_lookup() {
        let entries = vec![MatchDictionaryEntry {
            title: Some("Hello World".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            duration: Some(180000), // 3 minutes in ms
            song_id: "song-123".to_string(),
        }];

        let dict = MatchDictionary::from_entries(entries);

        // Exact match
        let result = dict.lookup(
            Some("Hello World"),
            Some("Test Artist"),
            Some("Test Album"),
            Some(180),
        );
        assert!(result.is_some());
        let (song_id, score) = result.unwrap();
        assert_eq!(song_id, "song-123");
        assert!(score >= 0.95);

        // Different album should still match (with slightly lower score)
        let result = dict.lookup(
            Some("Hello World"),
            Some("Test Artist"),
            Some("Different Album"),
            Some(180),
        );
        assert!(result.is_some());

        // Different artist should not match
        let result = dict.lookup(
            Some("Hello World"),
            Some("Different Artist"),
            Some("Test Album"),
            Some(180),
        );
        assert!(result.is_none());
    }
}
