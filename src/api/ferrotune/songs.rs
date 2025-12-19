//! Song management endpoints for the Ferrotune Admin API.
//!
//! This module provides endpoints for fetching song data optimized for
//! matching operations, including server-side fuzzy matching.

use crate::api::subsonic::auth::FerrotuneAuthenticatedUser;
use crate::api::AppState;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use strsim::normalized_levenshtein;
use ts_rs::TS;

type ApiError = (StatusCode, Json<super::ErrorResponse>);

/// A minimal song entry optimized for client-side matching.
/// Contains only the fields needed for matching algorithms.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongMatchEntry {
    /// Song ID
    pub id: String,
    /// Song title
    pub title: String,
    /// Artist name
    pub artist: String,
    /// Album name (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    /// Duration in seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub duration: Option<i64>,
}

/// Response containing all songs for matching.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongMatchListResponse {
    /// Total number of songs
    #[ts(type = "number")]
    pub total: i64,
    /// All songs in the library
    pub songs: Vec<SongMatchEntry>,
}

/// Query parameters for getting song match list.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSongMatchListParams {
    /// Optional library ID to filter by
    #[serde(default)]
    pub library_id: Option<i64>,
}

/// Get all songs in a minimal format optimized for client-side matching.
///
/// This endpoint returns all songs with only the fields needed for matching:
/// id, title, artist, album, and duration. This is significantly more efficient
/// than the full search endpoint for bulk matching operations.
///
/// GET /ferrotune/songs/match-list
pub async fn get_song_match_list(
    State(state): State<Arc<AppState>>,
    _user: FerrotuneAuthenticatedUser,
    Query(params): Query<GetSongMatchListParams>,
) -> Result<Json<SongMatchListResponse>, ApiError> {
    // Build query based on whether we're filtering by library
    // Always filter by enabled music folders
    let songs: Vec<SongMatchEntry> = if let Some(music_folder_id) = params.library_id {
        sqlx::query_as::<_, SongMatchEntry>(
            r#"
            SELECT 
                s.id,
                s.title,
                ar.name as artist,
                al.name as album,
                s.duration
            FROM songs s
            JOIN artists ar ON s.artist_id = ar.id
            LEFT JOIN albums al ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE s.music_folder_id = ? AND mf.enabled = 1
            ORDER BY ar.name, al.name, s.disc_number, s.track_number, s.title
            "#,
        )
        .bind(music_folder_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?
    } else {
        sqlx::query_as::<_, SongMatchEntry>(
            r#"
            SELECT 
                s.id,
                s.title,
                ar.name as artist,
                al.name as album,
                s.duration
            FROM songs s
            JOIN artists ar ON s.artist_id = ar.id
            LEFT JOIN albums al ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE mf.enabled = 1
            ORDER BY ar.name, al.name, s.disc_number, s.track_number, s.title
            "#,
        )
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(super::ErrorResponse::with_details(
                    "Database error",
                    e.to_string(),
                )),
            )
        })?
    };

    let total = songs.len() as i64;

    Ok(Json(SongMatchListResponse { total, songs }))
}

// =============================================================================
// Server-side fuzzy matching
// =============================================================================

/// A track to be matched against the library.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct TrackToMatch {
    /// Track title (if available)
    #[serde(default)]
    pub title: Option<String>,
    /// Artist name (if available)
    #[serde(default)]
    pub artist: Option<String>,
    /// Album name (if available)
    #[serde(default)]
    pub album: Option<String>,
    /// Duration in seconds (if available)
    #[serde(default)]
    #[ts(type = "number | null")]
    pub duration: Option<i64>,
    /// Raw string from playlist file (fallback for matching)
    #[serde(default)]
    pub raw: Option<String>,
}

/// Request body for matching tracks.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchTracksRequest {
    /// Tracks to match against the library
    pub tracks: Vec<TrackToMatch>,
    /// Whether to use title for matching (default: true)
    #[serde(default = "default_true")]
    pub use_title: bool,
    /// Whether to use artist for matching (default: true)
    #[serde(default = "default_true")]
    pub use_artist: bool,
    /// Whether to use album for matching (default: true)
    #[serde(default = "default_true")]
    pub use_album: bool,
}

fn default_true() -> bool {
    true
}

/// Result of matching a single track.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchResult {
    /// The matched song (if found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song: Option<SongMatchEntry>,
    /// Match confidence score (0.0 to 1.0, where 1.0 is perfect match)
    #[ts(type = "number")]
    pub score: f64,
}

/// Response containing match results for all tracks.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchTracksResponse {
    /// Match results in the same order as input tracks
    pub results: Vec<MatchResult>,
}

// =============================================================================
// Album and Artist Matching
// =============================================================================

/// A minimal album entry for matching.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumMatchEntry {
    /// Album ID
    pub id: String,
    /// Album name
    pub name: String,
    /// Artist name
    pub artist: String,
    /// Year (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | undefined")]
    pub year: Option<i32>,
}

/// A minimal artist entry for matching.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistMatchEntry {
    /// Artist ID
    pub id: String,
    /// Artist name
    pub name: String,
}

/// An album to be matched against the library.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumToMatch {
    /// Album name
    #[serde(default)]
    pub name: Option<String>,
    /// Artist name (if available)
    #[serde(default)]
    pub artist: Option<String>,
}

/// An artist to be matched against the library.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistToMatch {
    /// Artist name
    #[serde(default)]
    pub name: Option<String>,
}

/// Request body for matching albums.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchAlbumsRequest {
    /// Albums to match against the library
    pub albums: Vec<AlbumToMatch>,
    /// Whether to use artist for matching (default: true)
    #[serde(default = "default_true")]
    pub use_artist: bool,
}

/// Request body for matching artists.
#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchArtistsRequest {
    /// Artists to match against the library
    pub artists: Vec<ArtistToMatch>,
}

/// Result of matching a single album.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumMatchResult {
    /// The matched album (if found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<AlbumMatchEntry>,
    /// Match confidence score (0.0 to 1.0)
    #[ts(type = "number")]
    pub score: f64,
}

/// Result of matching a single artist.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistMatchResult {
    /// The matched artist (if found)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<ArtistMatchEntry>,
    /// Match confidence score (0.0 to 1.0)
    #[ts(type = "number")]
    pub score: f64,
}

/// Response containing match results for albums.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchAlbumsResponse {
    /// Match results in the same order as input albums
    pub results: Vec<AlbumMatchResult>,
}

/// Response containing match results for artists.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct MatchArtistsResponse {
    /// Match results in the same order as input artists
    pub results: Vec<ArtistMatchResult>,
}

/// Query parameters for the match endpoint.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchTracksParams {
    /// Optional library ID to filter by
    #[serde(default)]
    pub library_id: Option<i64>,
}

/// Match tracks against the library using server-side fuzzy matching.
///
/// This endpoint performs fuzzy matching using token-based similarity,
/// which is more accurate than FTS5 for playlist matching scenarios
/// (handles extra words like "feat.", "remix", etc.).
///
/// POST /ferrotune/songs/match
pub async fn match_tracks(
    State(state): State<Arc<AppState>>,
    _user: FerrotuneAuthenticatedUser,
    Query(params): Query<MatchTracksParams>,
    Json(request): Json<MatchTracksRequest>,
) -> Result<Json<MatchTracksResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    // Fetch all songs from enabled music folders
    let songs: Vec<SongMatchEntry> = if let Some(music_folder_id) = params.library_id {
        sqlx::query_as::<_, SongMatchEntry>(
            r#"
            SELECT 
                s.id,
                s.title,
                ar.name as artist,
                al.name as album,
                s.duration
            FROM songs s
            JOIN artists ar ON s.artist_id = ar.id
            LEFT JOIN albums al ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE s.music_folder_id = ? AND mf.enabled = 1
            "#,
        )
        .bind(music_folder_id)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, SongMatchEntry>(
            r#"
            SELECT 
                s.id,
                s.title,
                ar.name as artist,
                al.name as album,
                s.duration
            FROM songs s
            JOIN artists ar ON s.artist_id = ar.id
            LEFT JOIN albums al ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE mf.enabled = 1
            "#,
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Pre-tokenize all songs for efficient matching
    let tokenized_songs: Vec<TokenizedSong> = songs
        .par_iter()
        .map(|song| TokenizedSong {
            song,
            title_tokens: tokenize(&song.title),
            artist_tokens: tokenize(&song.artist),
            album_tokens: song.album.as_deref().map(tokenize),
            all_tokens: {
                let mut all = tokenize(&song.title);
                all.extend(tokenize(&song.artist));
                if let Some(album) = &song.album {
                    all.extend(tokenize(album));
                }
                all
            },
            core_title: extract_core_title(&song.title),
            full_title: song.title.to_lowercase(),
        })
        .collect();

    // Match each track in parallel
    let results: Vec<MatchResult> = request
        .tracks
        .par_iter()
        .map(|track| {
            match_single_track(
                track,
                &tokenized_songs,
                request.use_title,
                request.use_artist,
                request.use_album,
            )
        })
        .collect();

    Ok(Json(MatchTracksResponse { results }))
}

/// Pre-tokenized song for efficient matching.
struct TokenizedSong<'a> {
    song: &'a SongMatchEntry,
    title_tokens: HashSet<String>,
    artist_tokens: HashSet<String>,
    album_tokens: Option<HashSet<String>>,
    all_tokens: HashSet<String>,
    /// Core title for primary matching (stripped of suffixes like "Original Mix")
    core_title: String,
    /// Full title normalized to lowercase for secondary similarity check
    full_title: String,
}

/// Tokenize a string into normalized words.
/// Removes punctuation, converts to lowercase, and splits on whitespace.
fn tokenize(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| word.len() >= 2) // Skip very short words
        .map(String::from)
        .collect()
}

/// Calculate Jaccard similarity between two token sets.
/// Returns a value between 0.0 and 1.0.
fn jaccard_similarity(set_a: &HashSet<String>, set_b: &HashSet<String>) -> f64 {
    if set_a.is_empty() || set_b.is_empty() {
        return 0.0;
    }
    let intersection = set_a.intersection(set_b).count();
    let union = set_a.union(set_b).count();
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

/// Calculate weighted token overlap score.
/// Gives bonus points for exact word matches and considers coverage.
fn weighted_token_score(query_tokens: &HashSet<String>, song_tokens: &HashSet<String>) -> f64 {
    if query_tokens.is_empty() || song_tokens.is_empty() {
        return 0.0;
    }

    let matched_tokens = query_tokens.intersection(song_tokens).count();
    let query_coverage = matched_tokens as f64 / query_tokens.len() as f64;
    let song_coverage = matched_tokens as f64 / song_tokens.len() as f64;

    // Weighted average: prioritize query coverage (did we find what we're looking for?)
    // but also consider song coverage (is this a specific match vs generic?)
    0.7 * query_coverage + 0.3 * song_coverage
}

/// Extract the "core" title by stripping common suffixes in parentheses/brackets.
/// This helps with matching tracks like "Sunset (Original Mix)" to "Sunset".
///
/// Examples:
///   "Sunset (Original Mix)" -> "sunset"
///   "Dancing (feat. Someone)" -> "dancing"
///   "Midnight (From \"Movie Title\")" -> "midnight"
///   "Dreaming - Remix" -> "dreaming"
///   "[bonus] something" -> "[bonus] something" (no stripping if title starts with bracket)
fn extract_core_title(title: &str) -> String {
    // Find first occurrence of ( or [ and take everything before it
    let core = title.split(&['(', '['][..]).next().unwrap_or(title).trim();

    // If the result is empty (title started with [ or (), use the full title
    // This prevents titles like "[bonus] song" from having empty core
    if core.is_empty() {
        return title.to_lowercase();
    }

    // Also handle " - " suffix patterns (e.g., "Song - Remix")
    let core = core.split(" - ").next().unwrap_or(core).trim();

    // If still empty after splitting on " - ", use original
    if core.is_empty() {
        return title.to_lowercase();
    }

    core.to_lowercase()
}

/// Calculate similarity between two core titles using normalized Levenshtein distance.
/// Returns 0.0-1.0 where 1.0 is exact match.
fn core_title_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    normalized_levenshtein(a, b)
}

/// Match a single track against the tokenized song library.
///
/// Uses a hybrid approach:
/// 1. Core title similarity (Levenshtein distance on stripped title) as a gate
/// 2. Token-based scoring for fine-grained ranking
///
/// This prevents false positives where suffix tokens like "Original Mix" match wrong songs.
/// E.g., prevents "Sunset (Original Mix)" from matching "Thunder (Original Mix)"
/// instead of "Sunset".
fn match_single_track(
    track: &TrackToMatch,
    songs: &[TokenizedSong],
    use_title: bool,
    use_artist: bool,
    use_album: bool,
) -> MatchResult {
    // Build query tokens from track info
    let mut query_tokens = HashSet::new();
    let mut title_tokens = HashSet::new();
    let mut artist_tokens = HashSet::new();
    let mut album_tokens = HashSet::new();

    // Extract core title and full title for matching
    let query_core_title = if use_title {
        track.title.as_ref().map(|t| extract_core_title(t))
    } else {
        None
    };
    let query_full_title = if use_title {
        track.title.as_ref().map(|t| t.to_lowercase())
    } else {
        None
    };

    if use_title {
        if let Some(title) = &track.title {
            let tokens = tokenize(title);
            query_tokens.extend(tokens.clone());
            title_tokens = tokens;
        }
    }

    if use_artist {
        if let Some(artist) = &track.artist {
            let tokens = tokenize(artist);
            query_tokens.extend(tokens.clone());
            artist_tokens = tokens;
        }
    }

    if use_album {
        if let Some(album) = &track.album {
            let tokens = tokenize(album);
            query_tokens.extend(tokens.clone());
            album_tokens = tokens;
        }
    }

    // If no tokens from structured fields, try raw string
    if query_tokens.is_empty() {
        if let Some(raw) = &track.raw {
            query_tokens = tokenize(raw);
        }
    }

    if query_tokens.is_empty() {
        return MatchResult {
            song: None,
            score: 0.0,
        };
    }

    // Find best matching song
    let mut best_match: Option<(&SongMatchEntry, f64)> = None;

    for tokenized in songs {
        // CORE TITLE GATE: If using title matching, check core similarity first
        // This prevents "Sunset (Original Mix)" from matching "Thunder (Original Mix)"
        // just because they share "Original Mix" tokens
        let core_sim = if let Some(ref query_core) = query_core_title {
            if !query_core.is_empty() && !tokenized.core_title.is_empty() {
                let sim = core_title_similarity(query_core, &tokenized.core_title);
                // Reject candidates where core titles are too different
                // Threshold of 0.5 allows for typos but rejects completely different titles
                if sim < 0.5 {
                    continue; // Skip this candidate entirely
                }
                sim
            } else {
                // If either core is empty, fall back to full title token matching
                // Don't give a free pass - use token similarity instead
                let title_sim = weighted_token_score(&title_tokens, &tokenized.title_tokens);
                if title_sim < 0.3 {
                    continue; // Title tokens don't match well enough
                }
                title_sim
            }
        } else {
            1.0 // Not using title matching, skip core check
        };

        // ARTIST GATE: If using artist matching and artist tokens are provided,
        // require some artist overlap to prevent title-only matches with wrong artists
        // E.g., "Tears" by JK Soul shouldn't match "Tears" by FM-84
        if use_artist && !artist_tokens.is_empty() {
            let artist_sim = weighted_token_score(&artist_tokens, &tokenized.artist_tokens);
            // Require at least some artist token overlap (30% threshold)
            // This allows for variations like "feat." additions but rejects completely different artists
            if artist_sim < 0.3 {
                continue; // Artist doesn't match well enough
            }
        }

        // ALBUM GATE: If using album matching and album tokens are provided,
        // require some album overlap to prevent matches with wrong albums
        if use_album && !album_tokens.is_empty() {
            if let Some(song_album_tokens) = &tokenized.album_tokens {
                let album_sim = weighted_token_score(&album_tokens, song_album_tokens);
                // Require at least some album token overlap (30% threshold)
                if album_sim < 0.3 {
                    continue; // Album doesn't match well enough
                }
            }
            // If song has no album, don't reject it - album metadata may be incomplete
        }

        // Calculate field-specific token scores with weights
        let mut score = 0.0;
        let mut weight_sum = 0.0;

        // Title match (highest weight)
        if use_title && !title_tokens.is_empty() {
            let title_score = weighted_token_score(&title_tokens, &tokenized.title_tokens);
            score += title_score * 3.0;
            weight_sum += 3.0;
        }

        // Artist match (medium weight)
        if use_artist && !artist_tokens.is_empty() {
            let artist_score = weighted_token_score(&artist_tokens, &tokenized.artist_tokens);
            score += artist_score * 2.0;
            weight_sum += 2.0;
        }

        // Album match (lower weight)
        if use_album && !album_tokens.is_empty() {
            if let Some(song_album_tokens) = &tokenized.album_tokens {
                let album_score = weighted_token_score(&album_tokens, song_album_tokens);
                score += album_score * 1.0;
                weight_sum += 1.0;
            }
        }

        // If we had structured fields, use weighted field scores
        // Otherwise, fall back to overall Jaccard similarity
        let token_score = if weight_sum > 0.0 {
            score / weight_sum
        } else {
            jaccard_similarity(&query_tokens, &tokenized.all_tokens)
        };

        // Combine core similarity, full title similarity, and token score
        // - Core similarity (40%): matches essential song identity
        // - Full title similarity (30%): catches remix/version differences
        // - Token score (30%): field-specific weighted matching
        let combined_score = if let Some(ref query_full) = query_full_title {
            let full_title_sim = normalized_levenshtein(query_full, &tokenized.full_title);
            0.4 * core_sim + 0.3 * full_title_sim + 0.3 * token_score
        } else if query_core_title.is_some() {
            // No full title but have core - use original formula
            0.6 * core_sim + 0.4 * token_score
        } else {
            token_score
        };

        // Duration bonus: if durations match within 5 seconds, add bonus
        let duration_bonus =
            if let (Some(track_dur), Some(song_dur)) = (track.duration, tokenized.song.duration) {
                let diff = (track_dur - song_dur).abs();
                if diff <= 2 {
                    0.1 // Strong bonus for exact match
                } else if diff <= 5 {
                    0.05 // Moderate bonus for close match
                } else if diff <= 10 {
                    0.02 // Small bonus for approximate match
                } else {
                    0.0
                }
            } else {
                0.0
            };

        let total_score = (combined_score + duration_bonus).min(1.0);

        if total_score > best_match.map(|(_, s)| s).unwrap_or(0.0) {
            best_match = Some((tokenized.song, total_score));
        }
    }

    // Only return matches above threshold (50%)
    match best_match {
        Some((song, score)) if score >= 0.5 => MatchResult {
            song: Some(song.clone()),
            score,
        },
        _ => MatchResult {
            song: None,
            score: 0.0,
        },
    }
}

// =============================================================================
// Album Matching
// =============================================================================

/// Pre-tokenized album for efficient matching.
struct TokenizedAlbum<'a> {
    album: &'a AlbumMatchEntry,
    name_tokens: HashSet<String>,
    artist_tokens: HashSet<String>,
    normalized_name: String,
}

/// Match albums against the library using server-side fuzzy matching.
///
/// POST /ferrotune/albums/match
pub async fn match_albums(
    State(state): State<Arc<AppState>>,
    _user: FerrotuneAuthenticatedUser,
    Query(params): Query<MatchTracksParams>,
    Json(request): Json<MatchAlbumsRequest>,
) -> Result<Json<MatchAlbumsResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    // Fetch all albums from enabled music folders
    let albums: Vec<AlbumMatchEntry> = if let Some(music_folder_id) = params.library_id {
        sqlx::query_as::<_, AlbumMatchEntry>(
            r#"
            SELECT DISTINCT
                al.id,
                al.name,
                ar.name as artist,
                al.year
            FROM albums al
            JOIN artists ar ON al.artist_id = ar.id
            JOIN songs s ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE s.music_folder_id = ? AND mf.enabled = 1
            "#,
        )
        .bind(music_folder_id)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, AlbumMatchEntry>(
            r#"
            SELECT DISTINCT
                al.id,
                al.name,
                ar.name as artist,
                al.year
            FROM albums al
            JOIN artists ar ON al.artist_id = ar.id
            JOIN songs s ON s.album_id = al.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE mf.enabled = 1
            "#,
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Pre-tokenize all albums for efficient matching
    let tokenized_albums: Vec<TokenizedAlbum> = albums
        .par_iter()
        .map(|album| TokenizedAlbum {
            album,
            name_tokens: tokenize(&album.name),
            artist_tokens: tokenize(&album.artist),
            normalized_name: album.name.to_lowercase(),
        })
        .collect();

    // Match each album in parallel
    let results: Vec<AlbumMatchResult> = request
        .albums
        .par_iter()
        .map(|album| match_single_album(album, &tokenized_albums, request.use_artist))
        .collect();

    Ok(Json(MatchAlbumsResponse { results }))
}

/// Match a single album against the tokenized album library.
fn match_single_album(
    album: &AlbumToMatch,
    albums: &[TokenizedAlbum],
    use_artist: bool,
) -> AlbumMatchResult {
    let query_name = match &album.name {
        Some(name) if !name.trim().is_empty() => name.trim(),
        _ => {
            return AlbumMatchResult {
                album: None,
                score: 0.0,
            }
        }
    };

    let query_name_tokens = tokenize(query_name);
    let query_name_normalized = query_name.to_lowercase();
    let query_artist_tokens = album.artist.as_deref().map(tokenize);

    let mut best_match: Option<(&AlbumMatchEntry, f64)> = None;

    for tokenized in albums {
        // Calculate name similarity
        let name_sim = normalized_levenshtein(&query_name_normalized, &tokenized.normalized_name);
        let name_token_score = weighted_token_score(&query_name_tokens, &tokenized.name_tokens);

        // Combined name score (mix of levenshtein and token matching)
        let name_score = 0.6 * name_sim + 0.4 * name_token_score;

        // Skip if name doesn't match well enough
        if name_score < 0.4 {
            continue;
        }

        // Artist matching (if enabled and provided)
        let artist_score = if use_artist {
            if let Some(ref query_artist) = query_artist_tokens {
                let artist_sim = weighted_token_score(query_artist, &tokenized.artist_tokens);
                // Require at least some artist overlap
                if artist_sim < 0.3 {
                    continue;
                }
                artist_sim
            } else {
                1.0 // No artist provided, don't penalize
            }
        } else {
            1.0 // Artist matching disabled
        };

        // Combined score: name is more important than artist
        let total_score = if use_artist && query_artist_tokens.is_some() {
            0.7 * name_score + 0.3 * artist_score
        } else {
            name_score
        };

        if total_score > best_match.map(|(_, s)| s).unwrap_or(0.0) {
            best_match = Some((tokenized.album, total_score));
        }
    }

    // Only return matches above threshold (50%)
    match best_match {
        Some((album, score)) if score >= 0.5 => AlbumMatchResult {
            album: Some(album.clone()),
            score,
        },
        _ => AlbumMatchResult {
            album: None,
            score: 0.0,
        },
    }
}

// =============================================================================
// Artist Matching
// =============================================================================

/// Pre-tokenized artist for efficient matching.
struct TokenizedArtist<'a> {
    artist: &'a ArtistMatchEntry,
    name_tokens: HashSet<String>,
    normalized_name: String,
}

/// Match artists against the library using server-side fuzzy matching.
///
/// POST /ferrotune/artists/match
pub async fn match_artists(
    State(state): State<Arc<AppState>>,
    _user: FerrotuneAuthenticatedUser,
    Query(params): Query<MatchTracksParams>,
    Json(request): Json<MatchArtistsRequest>,
) -> Result<Json<MatchArtistsResponse>, (StatusCode, Json<super::ErrorResponse>)> {
    // Fetch all artists from enabled music folders
    let artists: Vec<ArtistMatchEntry> = if let Some(music_folder_id) = params.library_id {
        sqlx::query_as::<_, ArtistMatchEntry>(
            r#"
            SELECT DISTINCT
                ar.id,
                ar.name
            FROM artists ar
            JOIN songs s ON s.artist_id = ar.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE s.music_folder_id = ? AND mf.enabled = 1
            "#,
        )
        .bind(music_folder_id)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, ArtistMatchEntry>(
            r#"
            SELECT DISTINCT
                ar.id,
                ar.name
            FROM artists ar
            JOIN songs s ON s.artist_id = ar.id
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            WHERE mf.enabled = 1
            "#,
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(super::ErrorResponse::with_details(
                "Database error",
                e.to_string(),
            )),
        )
    })?;

    // Pre-tokenize all artists for efficient matching
    let tokenized_artists: Vec<TokenizedArtist> = artists
        .par_iter()
        .map(|artist| TokenizedArtist {
            artist,
            name_tokens: tokenize(&artist.name),
            normalized_name: artist.name.to_lowercase(),
        })
        .collect();

    // Match each artist in parallel
    let results: Vec<ArtistMatchResult> = request
        .artists
        .par_iter()
        .map(|artist| match_single_artist(artist, &tokenized_artists))
        .collect();

    Ok(Json(MatchArtistsResponse { results }))
}

/// Match a single artist against the tokenized artist library.
fn match_single_artist(artist: &ArtistToMatch, artists: &[TokenizedArtist]) -> ArtistMatchResult {
    let query_name = match &artist.name {
        Some(name) if !name.trim().is_empty() => name.trim(),
        _ => {
            return ArtistMatchResult {
                artist: None,
                score: 0.0,
            }
        }
    };

    let query_name_tokens = tokenize(query_name);
    let query_name_normalized = query_name.to_lowercase();

    let mut best_match: Option<(&ArtistMatchEntry, f64)> = None;

    for tokenized in artists {
        // Calculate name similarity using both Levenshtein and token matching
        let name_sim = normalized_levenshtein(&query_name_normalized, &tokenized.normalized_name);
        let name_token_score = weighted_token_score(&query_name_tokens, &tokenized.name_tokens);

        // Combined score (mix of levenshtein and token matching)
        let total_score = 0.6 * name_sim + 0.4 * name_token_score;

        if total_score > best_match.map(|(_, s)| s).unwrap_or(0.0) {
            best_match = Some((tokenized.artist, total_score));
        }
    }

    // Only return matches above threshold (50%)
    match best_match {
        Some((artist, score)) if score >= 0.5 => ArtistMatchResult {
            artist: Some(artist.clone()),
            score,
        },
        _ => ArtistMatchResult {
            artist: None,
            score: 0.0,
        },
    }
}
