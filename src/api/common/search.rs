//! Common search logic and utilities.
//!
//! This module provides shared search-related functionality used by both
//! the OpenSubsonic API and the Ferrotune Admin API.

use crate::db::DatabaseHandle;
use serde::{Deserialize, Serialize};
use strsim::normalized_levenshtein;
use ts_rs::TS;

/// Convert a user query into an FTS5-safe query with prefix matching.
///
/// Examples:
/// - "beat" -> "beat*" (matches "Beatles", "beat", "beats")
/// - "the beatles" -> "the* beatles*" (matches "the beatles", "Theatre Beatles")
/// - "rock & roll" -> "rock* roll*" (strips special chars, adds prefix wildcards)
/// - "24-7" -> "24* 7*" (prevents FTS5 interpreting as "24 NOT 7")
///
/// Returns None if the query is empty after processing.
pub fn build_fts_query(query: &str) -> Option<String> {
    // Split into words, filtering out empty strings and FTS5 operators
    let words: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        // Filter out FTS5 reserved words (case-insensitive)
        .filter(|s| !matches!(s.to_uppercase().as_str(), "AND" | "OR" | "NOT" | "NEAR"))
        .map(|s| format!("{}*", s))
        .collect();

    if words.is_empty() {
        None
    } else {
        // Join with spaces - FTS5 defaults to AND for multiple terms
        Some(words.join(" "))
    }
}

/// Convert a user query into a PostgreSQL `to_tsquery` string with prefix matching.
pub fn build_postgres_tsquery(query: &str) -> Option<String> {
    let tokens = parse_search_tokens(query);

    if tokens.is_empty() {
        None
    } else {
        Some(
            tokens
                .into_iter()
                .map(|token| format!("{}:*", token))
                .collect::<Vec<_>>()
                .join(" & "),
        )
    }
}

/// Parse a query string into search tokens.
/// Uses the same tokenization logic as FTS queries for consistency.
/// Returns lowercase tokens for case-insensitive matching.
pub fn parse_search_tokens(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        // Filter out reserved words for consistency with FTS
        .filter(|s| !matches!(s.to_uppercase().as_str(), "AND" | "OR" | "NOT" | "NEAR"))
        .map(|s| s.to_lowercase())
        .collect()
}

/// Check if a text matches all search tokens (prefix matching).
/// This provides the same matching logic as FTS but for in-memory filtering.
///
/// Example: `text_matches_query("Dire, Dire Docks", "dire dire")` returns true
/// because both "dire" tokens match (with prefix matching) words in the text.
pub fn text_matches_query(text: &str, query: &str) -> bool {
    let tokens = parse_search_tokens(query);
    if tokens.is_empty() {
        return true; // Empty query matches everything
    }

    let text_lower = text.to_lowercase();
    // Extract words from the text for prefix matching
    let text_words: Vec<&str> = text_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();

    // All query tokens must match at least one word in the text (prefix match)
    tokens
        .iter()
        .all(|token| text_words.iter().any(|word| word.starts_with(token)))
}

/// Score how well a text matches a query using normalized Levenshtein similarity.
/// Returns a score between 0.0 (no match) and 1.0 (exact match).
/// Compares each query token against each word in the text, taking the best match per token.
fn fuzzy_score(text: &str, query: &str) -> f64 {
    let tokens = parse_search_tokens(query);
    if tokens.is_empty() {
        return 1.0;
    }

    let text_lower = text.to_lowercase();
    let text_words: Vec<&str> = text_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();

    if text_words.is_empty() {
        return 0.0;
    }

    let mut total_score = 0.0;
    for token in &tokens {
        let best = text_words
            .iter()
            .map(|word| {
                // Exact prefix match scores highest
                if word.starts_with(token.as_str()) {
                    1.0
                } else {
                    normalized_levenshtein(token, word)
                }
            })
            .fold(0.0_f64, f64::max);
        total_score += best;
    }
    total_score / tokens.len() as f64
}

/// Build a SQL LIKE pattern from a query for fuzzy matching fallback.
/// Each token becomes `%token%` combined with AND.
/// Returns (WHERE clause fragment, bind values).
fn build_like_conditions(query: &str, columns: &[&str]) -> Option<(String, Vec<String>)> {
    let tokens = parse_search_tokens(query);
    if tokens.is_empty() {
        return None;
    }

    // For each token, at least one column must match
    let mut conditions = Vec::new();
    let mut bind_values = Vec::new();
    for token in &tokens {
        let col_conditions: Vec<String> = columns
            .iter()
            .map(|_col| format!("{} LIKE ? COLLATE NOCASE", _col))
            .collect();
        conditions.push(format!("({})", col_conditions.join(" OR ")));
        for _ in columns {
            bind_values.push(format!("%{}%", token));
        }
    }

    Some((conditions.join(" AND "), bind_values))
}

fn sqlite_case_insensitive_sql_to_postgres(fragment: &str) -> String {
    fragment
        .replace(" LIKE ", " ILIKE ")
        .replace(" COLLATE NOCASE", "")
}

fn sqlite_placeholders_to_postgres(fragment: &str) -> String {
    let mut result = String::with_capacity(fragment.len() + 8);
    let mut parameter_index = 1;

    for character in fragment.chars() {
        if character == '?' {
            result.push('$');
            result.push_str(&parameter_index.to_string());
            parameter_index += 1;
        } else {
            result.push(character);
        }
    }

    result
}

fn paginate_search_results<T>(items: Vec<T>, limit: i64, offset: i64) -> (Vec<T>, Option<i64>) {
    let total = items.len() as i64;
    let offset = offset.max(0) as usize;
    let limit = limit.max(0) as usize;
    let page = items.into_iter().skip(offset).take(limit).collect();
    (page, Some(total))
}

fn sort_artists_for_search(
    mut artists: Vec<crate::db::models::Artist>,
    sort: Option<&String>,
    sort_dir: Option<&String>,
) -> Vec<crate::db::models::Artist> {
    let field = sort.map(|value| value.as_str()).unwrap_or("name");

    artists.sort_by(|left, right| match field {
        "albumCount" => left
            .album_count
            .cmp(&right.album_count)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        "songCount" => left
            .song_count
            .cmp(&right.song_count)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    if matches!(sort_dir.map(|value| value.as_str()), Some("desc")) {
        artists.reverse();
    }

    artists
}

fn sort_albums_for_search(
    mut albums: Vec<crate::db::models::Album>,
    sort: Option<&String>,
    sort_dir: Option<&String>,
) -> Vec<crate::db::models::Album> {
    let field = sort.map(|value| value.as_str()).unwrap_or("name");

    albums.sort_by(|left, right| match field {
        "artist" => left
            .artist_name
            .to_lowercase()
            .cmp(&right.artist_name.to_lowercase())
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        "year" => left
            .year
            .unwrap_or(0)
            .cmp(&right.year.unwrap_or(0))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        "dateAdded" => left
            .created_at
            .cmp(&right.created_at)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        "songCount" => left
            .song_count
            .cmp(&right.song_count)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase())),
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    if matches!(sort_dir.map(|value| value.as_str()), Some("desc")) {
        albums.reverse();
    }

    albums
}

async fn search_songs_postgres(
    pool: &sqlx::PgPool,
    user_id: i64,
    ts_query: Option<&str>,
    params: &SearchParams,
    filter_conds: &SongFilterConditions,
) -> crate::error::Result<Vec<crate::db::models::Song>> {
    let postgres_conditions: Vec<String> = filter_conds
        .conditions
        .iter()
        .map(|condition| sqlite_case_insensitive_sql_to_postgres(condition))
        .collect();

    let mut query_builder = sqlx::QueryBuilder::<sqlx::Postgres>::new(
        r#"SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
           FROM songs s
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           INNER JOIN music_folders mf ON s.music_folder_id = mf.id
           INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
           LEFT JOIN (SELECT song_id, SUM(play_count)::BIGINT as play_count, MAX(played_at) as last_played
                      FROM scrobbles WHERE submission AND user_id = "#,
    );
    query_builder.push_bind(user_id);
    query_builder.push(" GROUP BY song_id) pc ON s.id = pc.song_id");

    if filter_conds.has_rating_filter {
        query_builder.push(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ",
        );
        query_builder.push_bind(user_id);
    }
    if filter_conds.has_starred_filter {
        query_builder.push(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = ",
        );
        query_builder.push_bind(user_id);
    }

    query_builder.push(" WHERE mf.enabled AND ula.user_id = ");
    query_builder.push_bind(user_id);
    if let Some(ts_query) = ts_query {
        query_builder
            .push(" AND (to_tsvector('simple', COALESCE(s.title, '')) @@ to_tsquery('simple', ");
        query_builder.push_bind(ts_query);
        query_builder
            .push(") OR to_tsvector('simple', COALESCE(ar.name, '')) @@ to_tsquery('simple', ");
        query_builder.push_bind(ts_query);
        query_builder
            .push(") OR to_tsvector('simple', COALESCE(al.name, '')) @@ to_tsquery('simple', ");
        query_builder.push_bind(ts_query);
        query_builder.push("))");
    }
    for condition in &postgres_conditions {
        query_builder.push(" AND ");
        query_builder.push(condition);
    }

    let songs: Vec<crate::db::models::Song> =
        query_builder.build_query_as().fetch_all(pool).await?;

    Ok(crate::api::common::sorting::sort_songs(
        songs,
        params.song_sort.as_deref().or(Some("name")),
        params.song_sort_dir.as_deref(),
    ))
}

/// Search parameters shared by both OpenSubsonic search3 and Ferrotune search endpoints.
#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SearchParams {
    #[serde(default)]
    pub query: String,
    pub artist_count: Option<u32>,
    pub artist_offset: Option<u32>,
    pub album_count: Option<u32>,
    pub album_offset: Option<u32>,
    pub song_count: Option<u32>,
    pub song_offset: Option<u32>,
    /// Ferrotune extension: sort field for songs (name, artist, album, year, duration, playCount, dateAdded)
    pub song_sort: Option<String>,
    /// Ferrotune extension: sort direction (asc, desc)
    pub song_sort_dir: Option<String>,
    /// Ferrotune extension: sort field for albums (name, artist, year, dateAdded)
    pub album_sort: Option<String>,
    /// Ferrotune extension: sort direction for albums (asc, desc)
    pub album_sort_dir: Option<String>,
    /// Ferrotune extension: sort field for artists (name, albumCount, songCount, recommended)
    pub artist_sort: Option<String>,
    /// Ferrotune extension: sort direction for artists (asc, desc)
    pub artist_sort_dir: Option<String>,
    /// Ferrotune extension: inline thumbnail size ("small" or "medium")
    pub inline_images: Option<String>,
    // ===== Advanced Filter Parameters (Ferrotune extension) =====
    /// Filter songs/albums by minimum year
    pub min_year: Option<i32>,
    /// Filter songs/albums by maximum year
    pub max_year: Option<i32>,
    /// Filter songs/albums by genre (exact match)
    pub genre: Option<String>,
    /// Filter songs by minimum duration in seconds
    pub min_duration: Option<i32>,
    /// Filter songs by maximum duration in seconds
    pub max_duration: Option<i32>,
    /// Filter songs/albums by minimum user rating (1-5)
    pub min_rating: Option<i32>,
    /// Filter songs/albums by maximum user rating (1-5)
    pub max_rating: Option<i32>,
    /// Filter to only starred items
    pub starred_only: Option<bool>,
    /// Filter songs by minimum play count
    pub min_play_count: Option<i32>,
    /// Filter songs by maximum play count
    pub max_play_count: Option<i32>,
    /// Filter to only shuffle-excluded songs
    pub shuffle_excluded_only: Option<bool>,
    /// Filter to only disabled songs
    pub disabled_only: Option<bool>,
    /// Filter songs by minimum bitrate in kbps
    pub min_bitrate: Option<i32>,
    /// Filter songs by maximum bitrate in kbps
    pub max_bitrate: Option<i32>,
    /// Filter songs added after this ISO 8601 date (e.g., "2024-01-01")
    pub added_after: Option<String>,
    /// Filter songs added before this ISO 8601 date (e.g., "2024-12-31")
    pub added_before: Option<String>,
    /// Filter to only songs missing embedded cover art
    pub missing_cover_art: Option<bool>,
    /// Filter songs by file format (e.g., "mp3", "flac", "opus")
    pub file_format: Option<String>,
    /// Filter songs by artist name (case-insensitive substring match)
    pub artist_filter: Option<String>,
    /// Filter songs by album name (case-insensitive substring match)
    pub album_filter: Option<String>,
    /// Filter songs by title (case-insensitive substring match)
    pub title_filter: Option<String>,
    /// Filter songs last played after this ISO 8601 date (e.g., "2024-01-01")
    pub last_played_after: Option<String>,
    /// Filter songs last played before this ISO 8601 date (e.g., "2024-12-31")
    pub last_played_before: Option<String>,
    /// Filter by music folder (library) ID
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
}

/// Generate an hourly-rotating seed for pseudo-random ordering.
/// Combines hour and day-of-year so the order changes every hour and varies across days.
fn hour_seed() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Divide by 3600 to get an hour-resolution counter
    (secs / 3600) as i64
}

/// Get ORDER BY clause for song sorting
pub fn get_song_order_clause(sort: Option<&String>, sort_dir: Option<&String>) -> String {
    get_song_order_clause_for_search(sort, sort_dir, false)
}

/// Get ORDER BY clause for song sorting with FTS rank support.
/// When `is_fts_query` is true and no explicit sort is specified, use FTS5 rank for relevance sorting.
pub fn get_song_order_clause_for_search(
    sort: Option<&String>,
    sort_dir: Option<&String>,
    is_fts_query: bool,
) -> String {
    let dir = match sort_dir.map(|s| s.as_str()) {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    match sort.map(|s| s.as_str()) {
        Some("artist") => format!("ar.name COLLATE NOCASE {dir}, s.title COLLATE NOCASE {dir}"),
        Some("album") => format!("s.album COLLATE NOCASE {dir}, s.title COLLATE NOCASE {dir}"),
        Some("year") => format!("s.year {dir}, s.title COLLATE NOCASE {dir}"),
        Some("duration") => format!("s.duration {dir}, s.title COLLATE NOCASE {dir}"),
        Some("playCount") => format!("COALESCE(play_count, 0) {dir}, s.title COLLATE NOCASE {dir}"),
        Some("lastPlayed") => format!("last_played {dir} NULLS LAST, s.title COLLATE NOCASE {dir}"),
        Some("dateAdded") => format!("s.created_at {dir}, s.title COLLATE NOCASE {dir}"),
        Some("recommended") => {
            let seed = hour_seed();
            // Personalized score: recency (0-40) + frequency (0-25) + freshness (0-15) + random (0-20)
            format!(
                "(CASE WHEN pc.last_played IS NOT NULL \
                  THEN MAX(0.0, (30.0 - (julianday('now') - julianday(pc.last_played))) / 30.0) * 40 \
                  ELSE 0 END \
                 + MIN(COALESCE(pc.play_count, 0) * 3, 25) \
                 + MAX(0.0, (30.0 - (julianday('now') - julianday(s.created_at))) / 30.0) * 15 \
                 + (ABS(s.id * {seed}) % 200) * 0.1) DESC"
            )
        }
        Some("relevance") => "fts.rank".to_string(), // explicit relevance sort
        None if is_fts_query => "fts.rank, s.title COLLATE NOCASE ASC".to_string(), // default to relevance for FTS
        _ => format!("s.title COLLATE NOCASE {dir}"),                               // default: name
    }
}

/// Result of album order clause generation, including any extra JOINs needed.
pub struct AlbumOrderClause {
    pub order_by: String,
    /// Extra JOIN clause to prepend (for pre-aggregated stats).
    pub extra_join: Option<String>,
    /// User IDs to bind for the extra JOIN (in order).
    pub extra_join_user_ids: Vec<i64>,
}

/// Get ORDER BY clause for album sorting.
/// `user_id` is required for the "recommended" sort (personalized scoring).
pub fn get_album_order_clause(
    sort: Option<&String>,
    sort_dir: Option<&String>,
    user_id: Option<i64>,
) -> AlbumOrderClause {
    let dir = match sort_dir.map(|s| s.as_str()) {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    match sort.map(|s| s.as_str()) {
        Some("artist") => AlbumOrderClause {
            order_by: format!("ar.name COLLATE NOCASE {dir}, a.name COLLATE NOCASE {dir}"),
            extra_join: None,
            extra_join_user_ids: vec![],
        },
        Some("year") => AlbumOrderClause {
            order_by: format!("a.year {dir}, a.name COLLATE NOCASE {dir}"),
            extra_join: None,
            extra_join_user_ids: vec![],
        },
        Some("dateAdded") => AlbumOrderClause {
            order_by: format!("a.created_at {dir}, a.name COLLATE NOCASE {dir}"),
            extra_join: None,
            extra_join_user_ids: vec![],
        },
        Some("songCount") => AlbumOrderClause {
            order_by: format!("a.song_count {dir}, a.name COLLATE NOCASE {dir}"),
            extra_join: None,
            extra_join_user_ids: vec![],
        },
        Some("recommended") => {
            let seed = hour_seed();
            let uid = user_id.unwrap_or(0);
            // Pre-aggregate album play stats in a JOIN instead of correlated subqueries
            let extra_join = "LEFT JOIN (\
                    SELECT si.album_id, \
                           MAX(sc.played_at) AS last_album_play, \
                           SUM(sc.play_count) AS total_album_plays \
                    FROM scrobbles sc \
                    JOIN songs si ON sc.song_id = si.id \
                    WHERE sc.user_id = ? AND sc.submission = 1 \
                    GROUP BY si.album_id\
                ) _album_stats ON _album_stats.album_id = a.id"
                .to_string();
            // Score: recent plays (0-40) + total plays (0-25) + freshness (0-15) + random (0-20)
            let order_by = format!(
                "(COALESCE(MAX(0.0, (30.0 - (julianday('now') - julianday(_album_stats.last_album_play))) / 30.0) * 40, 0) \
                 + MIN(COALESCE(_album_stats.total_album_plays, 0) * 2, 25) \
                 + MAX(0.0, (30.0 - (julianday('now') - julianday(a.created_at))) / 30.0) * 15 \
                 + (ABS(a.id * {seed}) % 200) * 0.1) DESC"
            );
            AlbumOrderClause {
                order_by,
                extra_join: Some(extra_join),
                extra_join_user_ids: vec![uid],
            }
        }
        _ => AlbumOrderClause {
            order_by: format!("a.name COLLATE NOCASE {dir}"),
            extra_join: None,
            extra_join_user_ids: vec![],
        },
    }
}

/// Get ORDER BY clause for artist sorting.
/// `user_id` is required for the "recommended" sort (personalized scoring).
pub fn get_artist_order_clause(
    sort: Option<&String>,
    sort_dir: Option<&String>,
    user_id: i64,
) -> String {
    let dir = match sort_dir.map(|s| s.as_str()) {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    match sort.map(|s| s.as_str()) {
        Some("albumCount") => format!("a.album_count {dir}, a.name COLLATE NOCASE {dir}"),
        Some("songCount") => format!("a.song_count {dir}, a.name COLLATE NOCASE {dir}"),
        Some("recommended") => {
            let seed = hour_seed();
            // Score: recent plays of artist songs (0-40) + total plays (0-25) + random (0-20)
            format!(
                "(COALESCE((SELECT MAX(0.0, (30.0 - (julianday('now') - julianday(MAX(sc.played_at)))) / 30.0) * 40 \
                            FROM scrobbles sc JOIN songs si ON sc.song_id = si.id \
                            WHERE si.artist_id = a.id AND sc.user_id = {user_id} AND sc.submission = 1), 0) \
                 + MIN(COALESCE((SELECT SUM(sc2.play_count) \
                                 FROM scrobbles sc2 JOIN songs si2 ON sc2.song_id = si2.id \
                                 WHERE si2.artist_id = a.id AND sc2.user_id = {user_id} AND sc2.submission = 1), 0) * 2, 25) \
                 + (ABS(a.id * {seed}) % 200) * 0.1) DESC"
            )
        }
        _ => format!("a.name COLLATE NOCASE {dir}"), // default: name
    }
}

/// Build WHERE clause conditions for song filters
pub struct SongFilterConditions {
    pub conditions: Vec<String>,
    pub has_rating_filter: bool,
    pub has_starred_filter: bool,
}

pub fn build_song_filter_conditions(params: &SearchParams, user_id: i64) -> SongFilterConditions {
    // Always exclude songs marked for deletion (in recycle bin)
    let mut conditions = vec!["s.marked_for_deletion_at IS NULL".to_string()];
    let has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();
    let has_starred_filter = params.starred_only.unwrap_or(false);
    let has_shuffle_exclude_filter = params.shuffle_excluded_only.unwrap_or(false);

    if let Some(min_year) = params.min_year {
        conditions.push(format!("s.year >= {}", min_year));
    }
    if let Some(max_year) = params.max_year {
        conditions.push(format!("s.year <= {}", max_year));
    }
    if let Some(ref genre) = params.genre {
        // Escape single quotes for SQL safety
        let escaped_genre = genre.replace('\'', "''");
        conditions.push(format!("s.genre = '{}'", escaped_genre));
    }
    if let Some(min_duration) = params.min_duration {
        conditions.push(format!("s.duration >= {}", min_duration));
    }
    if let Some(max_duration) = params.max_duration {
        conditions.push(format!("s.duration <= {}", max_duration));
    }
    if let Some(min_rating) = params.min_rating {
        conditions.push(format!("COALESCE(r.rating, 0) >= {}", min_rating));
    }
    if let Some(max_rating) = params.max_rating {
        conditions.push(format!("COALESCE(r.rating, 0) <= {}", max_rating));
    }
    if has_starred_filter {
        // starred table uses composite PK (user_id, item_type, item_id) - no 'id' column
        conditions.push("st.item_id IS NOT NULL".to_string());
    }
    if let Some(min_pc) = params.min_play_count {
        conditions.push(format!("COALESCE(pc.play_count, 0) >= {}", min_pc));
    }
    if let Some(max_pc) = params.max_play_count {
        conditions.push(format!("COALESCE(pc.play_count, 0) <= {}", max_pc));
    }
    if has_shuffle_exclude_filter {
        // Filter to only show songs that are in the shuffle_excludes table for this user
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM shuffle_excludes se WHERE se.song_id = s.id AND se.user_id = {})",
            user_id
        ));
    }
    // Disabled filter
    if params.disabled_only.unwrap_or(false) {
        // Filter to only show songs that are in the disabled_songs table for this user
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM disabled_songs ds WHERE ds.song_id = s.id AND ds.user_id = {})",
            user_id
        ));
    }
    // Bitrate filters
    if let Some(min_bitrate) = params.min_bitrate {
        conditions.push(format!("COALESCE(s.bitrate, 0) >= {}", min_bitrate));
    }
    if let Some(max_bitrate) = params.max_bitrate {
        conditions.push(format!("COALESCE(s.bitrate, 999999) <= {}", max_bitrate));
    }
    // Date added filters (ISO 8601 date strings)
    if let Some(ref added_after) = params.added_after {
        let escaped_date = added_after.replace('\'', "''");
        conditions.push(format!("date(s.created_at) >= '{}'", escaped_date));
    }
    if let Some(ref added_before) = params.added_before {
        let escaped_date = added_before.replace('\'', "''");
        conditions.push(format!("date(s.created_at) <= '{}'", escaped_date));
    }
    // Missing cover art filter - checks for songs without a thumbnail in the cache
    if params.missing_cover_art.unwrap_or(false) {
        conditions.push(
            "NOT EXISTS (SELECT 1 FROM thumbnails t WHERE t.item_id = s.id AND t.item_type = 'song')"
                .to_string(),
        );
    }
    // File format filter
    if let Some(ref format) = params.file_format {
        let escaped_format = format.replace('\'', "''").to_lowercase();
        conditions.push(format!("LOWER(s.file_format) = '{}'", escaped_format));
    }
    // Text field filters (case-insensitive substring match)
    if let Some(ref artist_filter) = params.artist_filter {
        let escaped = artist_filter.replace('\'', "''");
        conditions.push(format!("ar.name LIKE '%{}%' COLLATE NOCASE", escaped));
    }
    if let Some(ref album_filter) = params.album_filter {
        let escaped = album_filter.replace('\'', "''");
        conditions.push(format!("al.name LIKE '%{}%' COLLATE NOCASE", escaped));
    }
    if let Some(ref title_filter) = params.title_filter {
        let escaped = title_filter.replace('\'', "''");
        conditions.push(format!("s.title LIKE '%{}%' COLLATE NOCASE", escaped));
    }
    // Last played date filters
    if let Some(ref last_played_after) = params.last_played_after {
        let escaped_date = last_played_after.replace('\'', "''");
        conditions.push(format!("date(pc.last_played) >= '{}'", escaped_date));
    }
    if let Some(ref last_played_before) = params.last_played_before {
        let escaped_date = last_played_before.replace('\'', "''");
        conditions.push(format!("date(pc.last_played) <= '{}'", escaped_date));
    }
    // Music folder (library) filter
    if let Some(music_folder_id) = params.music_folder_id {
        conditions.push(format!("s.music_folder_id = {}", music_folder_id));
    }

    SongFilterConditions {
        conditions,
        has_rating_filter,
        has_starred_filter,
    }
}

/// Build WHERE clause conditions for album filters
pub fn build_album_filter_conditions(params: &SearchParams) -> Vec<String> {
    let mut conditions = Vec::new();

    if let Some(min_year) = params.min_year {
        conditions.push(format!("a.year >= {}", min_year));
    }
    if let Some(max_year) = params.max_year {
        conditions.push(format!("a.year <= {}", max_year));
    }
    if let Some(ref genre) = params.genre {
        let escaped_genre = genre.replace('\'', "''");
        conditions.push(format!("a.genre = '{}'", escaped_genre));
    }
    if params.min_rating.is_some() || params.max_rating.is_some() {
        if let Some(min_rating) = params.min_rating {
            conditions.push(format!("COALESCE(r.rating, 0) >= {}", min_rating));
        }
        if let Some(max_rating) = params.max_rating {
            conditions.push(format!("COALESCE(r.rating, 0) <= {}", max_rating));
        }
    }
    if params.starred_only.unwrap_or(false) {
        // starred table uses composite PK (user_id, item_type, item_id) - no 'id' column
        conditions.push("st.item_id IS NOT NULL".to_string());
    }
    // Music folder (library) filter - albums have songs from a specific folder
    if let Some(music_folder_id) = params.music_folder_id {
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM songs s_mf WHERE s_mf.album_id = a.id AND s_mf.music_folder_id = {})",
            music_folder_id
        ));
    }
    // Artist name filter (case-insensitive substring match on album artist)
    if let Some(ref artist_filter) = params.artist_filter {
        let escaped = artist_filter.replace('\'', "''");
        conditions.push(format!("ar.name LIKE '%{}%' COLLATE NOCASE", escaped));
    }

    conditions
}

/// Search songs with filters and sorting, returning the raw Song models.
/// This is a reusable function for materializing search-based queues.
///
/// If `query` is empty or "*", returns all songs matching the filters.
pub async fn search_songs_for_queue(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    params: &SearchParams,
) -> crate::error::Result<Vec<crate::db::models::Song>> {
    // Check for wildcard query
    // Note: Handle query="" (literal quotes) same as empty string
    let trimmed_query = query.trim_matches('"');
    let is_wildcard = trimmed_query.is_empty() || trimmed_query == "*";

    // Build FTS query with prefix wildcards
    let fts_query = if !is_wildcard {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };

    // If the FTS query is None after processing, treat as wildcard
    let is_wildcard = is_wildcard || fts_query.is_none();

    let filter_conds = build_song_filter_conditions(params, user_id);

    if let Ok(pool) = database.postgres_pool() {
        return search_songs_postgres(
            pool,
            user_id,
            postgres_ts_query.as_deref(),
            params,
            &filter_conds,
        )
        .await;
    }

    let pool = database.sqlite_pool()?;

    let song_order =
        get_song_order_clause(params.song_sort.as_ref(), params.song_sort_dir.as_ref());

    // Filter to only include songs from enabled music folders the user has access to
    let enabled_folder_condition = "mf.enabled = 1 AND ula.user_id = ?".to_string();

    // Build JOIN clauses based on filter requirements
    let mut joins = format!(
        "INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id{}",
        crate::db::queries::scrobble_stats_join_for_user()
    );
    let mut join_user_ids = vec![user_id, user_id];
    if filter_conds.has_rating_filter {
        joins.push_str(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ?",
        );
        join_user_ids.push(user_id);
    }
    if filter_conds.has_starred_filter {
        joins.push_str(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = ?",
        );
        join_user_ids.push(user_id);
    }

    let songs: Vec<crate::db::models::Song> = if is_wildcard {
        // Build WHERE clause for filters - always include enabled folder check
        let mut all_conditions = vec![enabled_folder_condition.clone()];
        all_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

        let query_str = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             {where_clause}
             ORDER BY {song_order}"
        );

        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder.fetch_all(pool).await?
    } else if let Some(ref fts_q) = fts_query {
        // Build WHERE clause combining FTS and filters - always include enabled folder check
        let mut where_conditions = vec![
            enabled_folder_condition.clone(),
            "songs_fts MATCH ?".to_string(),
        ];
        where_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query_str = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             INNER JOIN songs_fts fts ON s.id = fts.song_id 
             {where_clause}
             ORDER BY {song_order}"
        );

        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder.bind(fts_q).fetch_all(pool).await?
    } else {
        // Empty query after processing
        vec![]
    };

    Ok(songs)
}

/// Result type for artist search
pub struct ArtistSearchResult {
    pub artists: Vec<crate::db::models::Artist>,
    pub total: Option<i64>,
}

/// Search artists using FTS5 with filtering support.
/// Returns artists along with optional total count for pagination.
pub async fn search_artists(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<ArtistSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard || fts_query.is_none();

    let artist_has_starred_filter = params.starred_only.unwrap_or(false);
    let artist_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();

    // Build JOIN clauses
    let mut artist_joins = String::new();
    let mut artist_join_user_ids = Vec::new();
    if artist_has_rating_filter {
        artist_joins.push_str(
            " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'artist' AND r.user_id = ?",
        );
        artist_join_user_ids.push(user_id);
    }
    if artist_has_starred_filter {
        artist_joins.push_str(
            " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist' AND st.user_id = ?",
        );
        artist_join_user_ids.push(user_id);
    }

    // Build filter conditions
    let mut artist_filter_conds: Vec<String> = Vec::new();
    if artist_has_starred_filter {
        artist_filter_conds.push("st.item_id IS NOT NULL".to_string());
    }
    if let Some(min_rating) = params.min_rating {
        artist_filter_conds.push(format!("COALESCE(r.rating, 0) >= {}", min_rating));
    }
    if let Some(max_rating) = params.max_rating {
        artist_filter_conds.push(format!("COALESCE(r.rating, 0) <= {}", max_rating));
    }
    // Music folder (library) filter - artists have songs from a specific folder
    if let Some(music_folder_id) = params.music_folder_id {
        artist_filter_conds.push(format!(
            "EXISTS (SELECT 1 FROM songs s_mf WHERE s_mf.artist_id = a.id AND s_mf.music_folder_id = {})",
            music_folder_id
        ));
    }
    // Artist name filter (case-insensitive substring match)
    if let Some(ref artist_filter) = params.artist_filter {
        let escaped = artist_filter.replace('\'', "''");
        artist_filter_conds.push(format!("a.name LIKE '%{}%' COLLATE NOCASE", escaped));
    }

    // Filter to only include artists with songs from enabled music folders
    let artist_enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)";

    if let Ok(pool) = database.postgres_pool() {
        let postgres_filter_conds: Vec<String> = artist_filter_conds
            .iter()
            .map(|condition| sqlite_case_insensitive_sql_to_postgres(condition))
            .collect();

        let mut query_builder =
            sqlx::QueryBuilder::<sqlx::Postgres>::new("SELECT a.* FROM artists a");
        if artist_has_rating_filter {
            query_builder.push(
                " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'artist' AND r.user_id = ",
            );
            query_builder.push_bind(user_id);
        }
        if artist_has_starred_filter {
            query_builder.push(
                " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist' AND st.user_id = ",
            );
            query_builder.push_bind(user_id);
        }

        query_builder.push(
            " WHERE EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled AND ula_check.user_id = ",
        );
        query_builder.push_bind(user_id);
        query_builder.push(")");
        if let Some(ts_query) = postgres_ts_query.as_deref() {
            query_builder.push(
                " AND to_tsvector('simple', COALESCE(a.name, '') || ' ' || COALESCE(a.sort_name, '')) @@ to_tsquery('simple', ",
            );
            query_builder.push_bind(ts_query);
            query_builder.push(")");
        }
        for condition in &postgres_filter_conds {
            query_builder.push(" AND ");
            query_builder.push(condition);
        }

        let artists: Vec<crate::db::models::Artist> =
            query_builder.build_query_as().fetch_all(pool).await?;

        let artists = sort_artists_for_search(
            artists,
            params.artist_sort.as_ref(),
            params.artist_sort_dir.as_ref(),
        );
        let total = Some(artists.len() as i64);
        let artists = if !is_wildcard && offset == 0 && (artists.len() as i64) < limit {
            match fuzzy_supplement_artists(
                database,
                user_id,
                trimmed_query,
                &artists,
                limit,
                &artist_joins,
                &artist_join_user_ids,
                &artist_filter_conds,
            )
            .await
            {
                Ok(supplemented) => supplemented,
                Err(_) => artists,
            }
        } else {
            artists
        };
        let (artists, _) = paginate_search_results(artists, limit, offset);
        return Ok(ArtistSearchResult { artists, total });
    }

    // Determine artist sort order (supports \"recommended\" personalized sort)
    let artist_order = get_artist_order_clause(
        params.artist_sort.as_ref(),
        params.artist_sort_dir.as_ref(),
        user_id,
    );
    let pool = database.sqlite_pool()?;

    let (artists, total) = if is_wildcard {
        let mut all_conditions = vec![artist_enabled_condition.to_string()];
        all_conditions.extend(artist_filter_conds.clone());
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

        let query_str = format!(
            "SELECT a.* FROM artists a {artist_joins} {where_clause} ORDER BY {artist_order} LIMIT ? OFFSET ?"
        );
        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &artist_join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder = query_builder.bind(user_id);
        let artists: Vec<crate::db::models::Artist> = query_builder
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!("SELECT COUNT(*) FROM artists a {artist_joins} {where_clause}");
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &artist_join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        count_query_builder = count_query_builder.bind(user_id);
        let total: (i64,) = count_query_builder.fetch_one(pool).await?;

        (artists, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        let mut where_conditions = vec![
            artist_enabled_condition.to_string(),
            "artists_fts MATCH ?".to_string(),
        ];
        where_conditions.extend(artist_filter_conds.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query_str = format!(
            "SELECT a.* FROM artists a
             {artist_joins}
             INNER JOIN artists_fts fts ON a.id = fts.artist_id
             {where_clause}
             ORDER BY {artist_order}
             LIMIT ? OFFSET ?"
        );
        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &artist_join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder = query_builder.bind(user_id);
        let artists: Vec<crate::db::models::Artist> = query_builder
            .bind(fts_q)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!(
            "SELECT COUNT(*) FROM artists a {artist_joins} INNER JOIN artists_fts fts ON a.id = fts.artist_id {where_clause}"
        );
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &artist_join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        count_query_builder = count_query_builder.bind(user_id);
        let total: (i64,) = count_query_builder.bind(fts_q).fetch_one(pool).await?;

        (artists, Some(total.0))
    } else {
        (vec![], Some(0))
    };

    // Fuzzy fallback: if FTS returned fewer results than requested and we're on the first page,
    // supplement with LIKE-based matches scored by edit distance
    let artists = if !is_wildcard && offset == 0 && (artists.len() as i64) < limit {
        match fuzzy_supplement_artists(
            database,
            user_id,
            trimmed_query,
            &artists,
            limit,
            &artist_joins,
            &artist_join_user_ids,
            &artist_filter_conds,
        )
        .await
        {
            Ok(supplemented) => supplemented,
            Err(_) => artists,
        }
    } else {
        artists
    };

    Ok(ArtistSearchResult { artists, total })
}

/// Result type for album search
pub struct AlbumSearchResult {
    pub albums: Vec<crate::db::models::Album>,
    pub total: Option<i64>,
}

/// Search albums using FTS5 with filtering support.
/// Returns albums along with optional total count for pagination.
pub async fn search_albums(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<AlbumSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard || fts_query.is_none();

    let album_order_clause = get_album_order_clause(
        params.album_sort.as_ref(),
        params.album_sort_dir.as_ref(),
        Some(user_id),
    );
    let album_order = &album_order_clause.order_by;

    let album_filter_conds = build_album_filter_conditions(params);
    let album_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();
    let album_has_starred_filter = params.starred_only.unwrap_or(false);

    // Build JOIN clauses - always need artists for artist_name
    let mut album_joins = String::from("INNER JOIN artists ar ON a.artist_id = ar.id");
    let mut album_join_user_ids = Vec::new();
    // Add pre-aggregated stats JOIN for recommended sort
    if let Some(ref extra_join) = album_order_clause.extra_join {
        album_joins.push(' ');
        album_joins.push_str(extra_join);
        album_join_user_ids.extend(&album_order_clause.extra_join_user_ids);
    }
    if album_has_rating_filter {
        album_joins.push_str(
            " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'album' AND r.user_id = ?",
        );
        album_join_user_ids.push(user_id);
    }
    if album_has_starred_filter {
        album_joins.push_str(
            " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' AND st.user_id = ?",
        );
        album_join_user_ids.push(user_id);
    }

    // Filter to only include albums with songs from enabled music folders
    let album_enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)";

    if let Ok(pool) = database.postgres_pool() {
        let postgres_filter_conds: Vec<String> = album_filter_conds
            .iter()
            .map(|condition| sqlite_case_insensitive_sql_to_postgres(condition))
            .collect();

        let mut query_builder = sqlx::QueryBuilder::<sqlx::Postgres>::new(
            "SELECT a.*, ar.name as artist_name FROM albums a INNER JOIN artists ar ON a.artist_id = ar.id",
        );
        if album_has_rating_filter {
            query_builder.push(
                " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'album' AND r.user_id = ",
            );
            query_builder.push_bind(user_id);
        }
        if album_has_starred_filter {
            query_builder.push(
                " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' AND st.user_id = ",
            );
            query_builder.push_bind(user_id);
        }

        query_builder.push(
            " WHERE EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled AND ula_check.user_id = ",
        );
        query_builder.push_bind(user_id);
        query_builder.push(")");
        if let Some(ts_query) = postgres_ts_query.as_deref() {
            query_builder
                .push(" AND (to_tsvector('simple', COALESCE(a.name, '')) @@ to_tsquery('simple', ");
            query_builder.push_bind(ts_query);
            query_builder
                .push(") OR to_tsvector('simple', COALESCE(ar.name, '')) @@ to_tsquery('simple', ");
            query_builder.push_bind(ts_query);
            query_builder.push("))");
        }
        for condition in &postgres_filter_conds {
            query_builder.push(" AND ");
            query_builder.push(condition);
        }

        let albums: Vec<crate::db::models::Album> =
            query_builder.build_query_as().fetch_all(pool).await?;

        let albums = sort_albums_for_search(
            albums,
            params.album_sort.as_ref(),
            params.album_sort_dir.as_ref(),
        );
        let total = Some(albums.len() as i64);
        let albums = if !is_wildcard && offset == 0 && (albums.len() as i64) < limit {
            match fuzzy_supplement_albums(database, user_id, trimmed_query, &albums, limit).await {
                Ok(supplemented) => supplemented,
                Err(_) => albums,
            }
        } else {
            albums
        };
        let (albums, _) = paginate_search_results(albums, limit, offset);
        return Ok(AlbumSearchResult { albums, total });
    }

    let pool = database.sqlite_pool()?;

    let (albums, total) = if is_wildcard {
        let mut all_conditions = vec![album_enabled_condition.to_string()];
        all_conditions.extend(album_filter_conds.clone());
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

        let album_query = format!(
            "SELECT a.*, ar.name as artist_name 
             FROM albums a 
             {album_joins}
             {where_clause}
             ORDER BY {album_order}
             LIMIT ? OFFSET ?"
        );
        let mut query_builder = sqlx::query_as(&album_query);
        for join_user_id in &album_join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder = query_builder.bind(user_id);
        let albums: Vec<crate::db::models::Album> = query_builder
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!("SELECT COUNT(*) FROM albums a {album_joins} {where_clause}");
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &album_join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        count_query_builder = count_query_builder.bind(user_id);
        let total: (i64,) = count_query_builder.fetch_one(pool).await?;

        (albums, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        let mut where_conditions = vec![
            album_enabled_condition.to_string(),
            "albums_fts MATCH ?".to_string(),
        ];
        where_conditions.extend(album_filter_conds.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let album_query = format!(
            "SELECT a.*, ar.name as artist_name 
             FROM albums a 
             {album_joins}
             INNER JOIN albums_fts fts ON a.id = fts.album_id
             {where_clause}
             ORDER BY {album_order}
             LIMIT ? OFFSET ?"
        );
        let mut query_builder = sqlx::query_as(&album_query);
        for join_user_id in &album_join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        query_builder = query_builder.bind(user_id);
        let albums: Vec<crate::db::models::Album> = query_builder
            .bind(fts_q)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!(
            "SELECT COUNT(*) FROM albums a {album_joins} INNER JOIN albums_fts fts ON a.id = fts.album_id {where_clause}"
        );
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &album_join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        count_query_builder = count_query_builder.bind(user_id);
        let total: (i64,) = count_query_builder.bind(fts_q).fetch_one(pool).await?;

        (albums, Some(total.0))
    } else {
        (vec![], Some(0))
    };

    // Fuzzy fallback for albums
    let albums = if !is_wildcard && offset == 0 && (albums.len() as i64) < limit {
        match fuzzy_supplement_albums(database, user_id, trimmed_query, &albums, limit).await {
            Ok(supplemented) => supplemented,
            Err(_) => albums,
        }
    } else {
        albums
    };

    Ok(AlbumSearchResult { albums, total })
}

/// Result type for song search
pub struct SongSearchResult {
    pub songs: Vec<crate::db::models::Song>,
    pub total: Option<i64>,
}

/// Search songs using FTS5 with filtering and sorting support.
/// Returns songs along with optional total count for pagination.
pub async fn search_songs(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<SongSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard || fts_query.is_none();

    // Use relevance-based sorting when this is an FTS query and no explicit sort is specified
    let song_order = get_song_order_clause_for_search(
        params.song_sort.as_ref(),
        params.song_sort_dir.as_ref(),
        !is_wildcard, // is_fts_query
    );

    let filter_conds = build_song_filter_conditions(params, user_id);

    if let Ok(pool) = database.postgres_pool() {
        let songs = search_songs_postgres(
            pool,
            user_id,
            postgres_ts_query.as_deref(),
            params,
            &filter_conds,
        )
        .await?;
        let songs = crate::api::common::sorting::sort_songs(
            songs,
            params.song_sort.as_deref().or(Some("name")),
            params.song_sort_dir.as_deref(),
        );
        let total = Some(songs.len() as i64);
        let songs = if !is_wildcard && offset == 0 && (songs.len() as i64) < limit {
            match fuzzy_supplement_songs(database, user_id, trimmed_query, &songs, limit).await {
                Ok(supplemented) => supplemented,
                Err(_) => songs,
            }
        } else {
            songs
        };
        let (songs, _) = paginate_search_results(songs, limit, offset);
        return Ok(SongSearchResult { songs, total });
    }

    // Filter to only include songs from enabled music folders the user has access to
    let enabled_folder_condition = "mf.enabled = 1 AND ula.user_id = ?".to_string();

    // Build JOIN clauses based on filter requirements
    let mut joins = format!(
        "INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id{}",
        crate::db::queries::scrobble_stats_join_for_user()
    );
    let mut join_user_ids = vec![user_id, user_id];
    if filter_conds.has_rating_filter {
        joins.push_str(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ?",
        );
        join_user_ids.push(user_id);
    }
    if filter_conds.has_starred_filter {
        joins.push_str(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = ?",
        );
        join_user_ids.push(user_id);
    }

    let pool = database.sqlite_pool()?;

    let (songs, total) = if is_wildcard {
        let mut all_conditions = vec![enabled_folder_condition.clone()];
        all_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

        let query_str = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             {where_clause}
             ORDER BY {song_order}
             LIMIT ? OFFSET ?"
        );

        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        let songs: Vec<crate::db::models::Song> = query_builder
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!("SELECT COUNT(*) FROM songs s {joins} {where_clause}");
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        let total: (i64,) = count_query_builder.fetch_one(pool).await?;

        (songs, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        let mut where_conditions = vec![
            enabled_folder_condition.clone(),
            "songs_fts MATCH ?".to_string(),
        ];
        where_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query_str = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             INNER JOIN songs_fts fts ON s.id = fts.song_id 
             {where_clause}
             ORDER BY {song_order}
             LIMIT ? OFFSET ?"
        );

        let mut query_builder = sqlx::query_as(&query_str);
        for join_user_id in &join_user_ids {
            query_builder = query_builder.bind(*join_user_id);
        }
        let songs: Vec<crate::db::models::Song> = query_builder
            .bind(fts_q)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await?;

        let count_query = format!(
            "SELECT COUNT(*) FROM songs s {joins} INNER JOIN songs_fts fts ON s.id = fts.song_id {where_clause}"
        );
        let mut count_query_builder = sqlx::query_as(&count_query);
        for join_user_id in &join_user_ids {
            count_query_builder = count_query_builder.bind(*join_user_id);
        }
        let total: (i64,) = count_query_builder.bind(fts_q).fetch_one(pool).await?;

        (songs, Some(total.0))
    } else {
        (vec![], Some(0))
    };

    // Fuzzy fallback for songs
    let songs = if !is_wildcard && offset == 0 && (songs.len() as i64) < limit {
        match fuzzy_supplement_songs(database, user_id, trimmed_query, &songs, limit).await {
            Ok(supplemented) => supplemented,
            Err(_) => songs,
        }
    } else {
        songs
    };

    Ok(SongSearchResult { songs, total })
}

/// Minimum fuzzy score threshold for including a LIKE-based fallback result.
const FUZZY_THRESHOLD: f64 = 0.5;

/// Supplement artist results with LIKE-based fuzzy matches.
#[allow(clippy::too_many_arguments)]
async fn fuzzy_supplement_artists(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    existing: &[crate::db::models::Artist],
    limit: i64,
    joins: &str,
    join_user_ids: &[i64],
    filter_conds: &[String],
) -> crate::error::Result<Vec<crate::db::models::Artist>> {
    let (like_clause, like_binds) = match build_like_conditions(query, &["a.name", "a.sort_name"]) {
        Some(v) => v,
        None => return Ok(existing.to_vec()),
    };

    let candidates = if let Ok(pool) = database.sqlite_pool() {
        let enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)";

        let mut all_conditions = vec![enabled_condition.to_string(), like_clause];
        all_conditions.extend(filter_conds.iter().cloned());
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

        let query_str = format!("SELECT a.* FROM artists a {joins} {where_clause} LIMIT ?");
        let mut qb = sqlx::query_as::<_, crate::db::models::Artist>(&query_str);
        for uid in join_user_ids {
            qb = qb.bind(*uid);
        }
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    } else {
        let pool = database.postgres_pool()?;
        let enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled AND ula_check.user_id = ?)";
        let mut all_conditions = vec![
            enabled_condition.to_string(),
            sqlite_case_insensitive_sql_to_postgres(&like_clause),
        ];
        all_conditions.extend(
            filter_conds
                .iter()
                .map(|condition| sqlite_case_insensitive_sql_to_postgres(condition)),
        );
        let where_clause = format!("WHERE {}", all_conditions.join(" AND "));
        let query_str = sqlite_placeholders_to_postgres(&format!(
            "SELECT a.* FROM artists a {joins} {where_clause} LIMIT ?"
        ));
        let mut qb = sqlx::query_as::<_, crate::db::models::Artist>(&query_str);
        for uid in join_user_ids {
            qb = qb.bind(*uid);
        }
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    };

    merge_results(existing, candidates, query, limit, |a| &a.name, |a| &a.id)
}

/// Supplement album results with LIKE-based fuzzy matches.
async fn fuzzy_supplement_albums(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    existing: &[crate::db::models::Album],
    limit: i64,
) -> crate::error::Result<Vec<crate::db::models::Album>> {
    let (like_clause, like_binds) = match build_like_conditions(query, &["a.name", "ar.name"]) {
        Some(v) => v,
        None => return Ok(existing.to_vec()),
    };

    let candidates = if let Ok(pool) = database.sqlite_pool() {
        let enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)";

        let where_clause = format!("WHERE {} AND {}", enabled_condition, like_clause);

        let query_str = format!(
            "SELECT a.*, ar.name as artist_name FROM albums a LEFT JOIN artists ar ON a.artist_id = ar.id {where_clause} LIMIT ?"
        );
        let mut qb = sqlx::query_as::<_, crate::db::models::Album>(&query_str);
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    } else {
        let pool = database.postgres_pool()?;
        let enabled_condition = "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled AND ula_check.user_id = ?)";

        let where_clause = format!(
            "WHERE {} AND {}",
            enabled_condition,
            sqlite_case_insensitive_sql_to_postgres(&like_clause)
        );

        let query_str = sqlite_placeholders_to_postgres(&format!(
            "SELECT a.*, ar.name as artist_name FROM albums a LEFT JOIN artists ar ON a.artist_id = ar.id {where_clause} LIMIT ?"
        ));
        let mut qb = sqlx::query_as::<_, crate::db::models::Album>(&query_str);
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    };

    merge_results(existing, candidates, query, limit, |a| &a.name, |a| &a.id)
}

/// Supplement song results with LIKE-based fuzzy matches.
async fn fuzzy_supplement_songs(
    database: &(impl DatabaseHandle + ?Sized),
    user_id: i64,
    query: &str,
    existing: &[crate::db::models::Song],
    limit: i64,
) -> crate::error::Result<Vec<crate::db::models::Song>> {
    let (like_clause, like_binds) =
        match build_like_conditions(query, &["s.title", "ar.name", "al.name"]) {
            Some(v) => v,
            None => return Ok(existing.to_vec()),
        };

    let candidates = if let Ok(pool) = database.sqlite_pool() {
        let enabled_condition = "EXISTS (SELECT 1 FROM music_folders mf_check JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE mf_check.id = s.music_folder_id AND mf_check.enabled = 1 AND ula_check.user_id = ?)";

        let where_clause = format!("WHERE {} AND {}", enabled_condition, like_clause);

        let query_str = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, NULL as play_count, NULL as last_played, NULL as starred_at
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             {where_clause}
             LIMIT ?"
        );
        let mut qb = sqlx::query_as::<_, crate::db::models::Song>(&query_str);
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    } else {
        let pool = database.postgres_pool()?;
        let enabled_condition = "EXISTS (SELECT 1 FROM music_folders mf_check JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE mf_check.id = s.music_folder_id AND mf_check.enabled AND ula_check.user_id = ?)";

        let where_clause = format!(
            "WHERE {} AND {}",
            enabled_condition,
            sqlite_case_insensitive_sql_to_postgres(&like_clause)
        );

        let query_str = sqlite_placeholders_to_postgres(&format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, NULL as play_count, NULL as last_played, NULL as starred_at
             FROM songs s
             LEFT JOIN artists ar ON s.artist_id = ar.id
             LEFT JOIN albums al ON s.album_id = al.id
             {where_clause}
             LIMIT ?"
        ));
        let mut qb = sqlx::query_as::<_, crate::db::models::Song>(&query_str);
        qb = qb.bind(user_id);
        for val in &like_binds {
            qb = qb.bind(val);
        }
        qb.bind(limit * 3).fetch_all(pool).await?
    };

    merge_results(existing, candidates, query, limit, |s| &s.title, |s| &s.id)
}

/// Merge FTS results with LIKE-based fuzzy candidates, deduplicating and ranking by fuzzy score.
fn merge_results<T: Clone>(
    existing: &[T],
    candidates: Vec<T>,
    query: &str,
    limit: i64,
    get_name: impl Fn(&T) -> &str,
    get_id: impl Fn(&T) -> &str,
) -> crate::error::Result<Vec<T>> {
    use std::collections::HashSet;

    let existing_ids: HashSet<&str> = existing.iter().map(&get_id).collect();

    // Score and filter new candidates
    let mut scored: Vec<(T, f64)> = candidates
        .into_iter()
        .filter(|item| !existing_ids.contains(get_id(item)))
        .filter_map(|item| {
            let score = fuzzy_score(get_name(&item), query);
            if score >= FUZZY_THRESHOLD {
                Some((item, score))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Append fuzzy results after FTS results (FTS results are more relevant)
    let mut result: Vec<T> = existing.to_vec();
    let remaining = (limit as usize).saturating_sub(result.len());
    result.extend(scored.into_iter().take(remaining).map(|(item, _)| item));

    Ok(result)
}
