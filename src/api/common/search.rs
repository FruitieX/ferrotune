//! Common search logic and utilities.
//!
//! This module provides shared search-related functionality used by both
//! the OpenSubsonic API and the Ferrotune Admin API.
//!
//! DB-bound functions route dialect-specific SQL through
//! [`crate::db::raw`]. SQLite uses FTS5 (`MATCH`), PostgreSQL uses
//! `to_tsvector` / `to_tsquery`. The two code paths share an identical
//! bind-value order so the result-set shapes deserialise into the same
//! `models::*` structs via `sea_orm::FromQueryResult`.

use crate::db::Database;
use sea_orm::Value;
use serde::{Deserialize, Serialize};
use strsim::normalized_levenshtein;
use ts_rs::TS;

/// Execute a SELECT whose SQL and bind-order have been built for the
/// backend `database` is currently using, deserialising every row into `T`.
async fn query_all_for_backend<T: sea_orm::FromQueryResult>(
    database: &Database,
    sql: &str,
    binds: Vec<Value>,
) -> Result<Vec<T>, sea_orm::DbErr> {
    use sea_orm::{ConnectionTrait, Statement, Values};
    let stmt = Statement::from_sql_and_values(database.sea_backend(), sql, Values(binds));
    let rows = database.conn().query_all(stmt).await?;
    rows.into_iter()
        .map(|row| T::from_query_result(&row, ""))
        .collect()
}

async fn query_one_for_backend<T: sea_orm::FromQueryResult>(
    database: &Database,
    sql: &str,
    binds: Vec<Value>,
) -> Result<Option<T>, sea_orm::DbErr> {
    use sea_orm::{ConnectionTrait, Statement, Values};
    let stmt = Statement::from_sql_and_values(database.sea_backend(), sql, Values(binds));
    database
        .conn()
        .query_one(stmt)
        .await?
        .map(|row| T::from_query_result(&row, ""))
        .transpose()
}

#[derive(sea_orm::FromQueryResult)]
struct CountRow {
    count: i64,
}

fn is_postgres(database: &Database) -> bool {
    matches!(database.sea_backend(), sea_orm::DbBackend::Postgres)
}

/// Append a dialect-appropriate placeholder (`?` or `$N`) to `sql` and
/// record the bind value. Returns the 1-based parameter index (useful
/// for re-referencing the same bind multiple times on Postgres).
fn push_bind(sql: &mut String, binds: &mut Vec<Value>, value: impl Into<Value>, pg: bool) -> usize {
    binds.push(value.into());
    if pg {
        sql.push('$');
        sql.push_str(&binds.len().to_string());
    } else {
        sql.push('?');
    }
    binds.len()
}

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

async fn search_songs_unified(
    database: &Database,
    user_id: i64,
    ts_query: Option<&str>,
    fts_query: Option<&str>,
    filter_conds: &SongFilterConditions,
    song_order: &str,
    limit_offset: Option<(i64, i64)>,
) -> crate::error::Result<Vec<crate::db::models::Song>> {
    let pg = is_postgres(database);
    let mut sql = String::new();
    let mut binds: Vec<Value> = Vec::new();

    sql.push_str(
        "SELECT s.*, ar.name AS artist_name, al.name AS album_name, pc.play_count, pc.last_played, ",
    );
    sql.push_str(if pg {
        "NULL::TIMESTAMPTZ AS starred_at"
    } else {
        "NULL AS starred_at"
    });
    sql.push_str(
        " FROM songs s \
         INNER JOIN artists ar ON s.artist_id = ar.id \
         LEFT JOIN albums al ON s.album_id = al.id \
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id \
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id \
         LEFT JOIN (SELECT song_id, ",
    );
    sql.push_str(if pg {
        "SUM(play_count)::BIGINT AS play_count"
    } else {
        "SUM(play_count) AS play_count"
    });
    sql.push_str(", MAX(played_at) AS last_played FROM scrobbles WHERE ");
    sql.push_str(if pg { "submission" } else { "submission = 1" });
    sql.push_str(" AND user_id = ");
    push_bind(&mut sql, &mut binds, user_id, pg);
    sql.push_str(" GROUP BY song_id) pc ON s.id = pc.song_id");

    if filter_conds.has_rating_filter {
        sql.push_str(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ",
        );
        push_bind(&mut sql, &mut binds, user_id, pg);
    }
    if filter_conds.has_starred_filter {
        sql.push_str(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = ",
        );
        push_bind(&mut sql, &mut binds, user_id, pg);
    }
    if !pg && fts_query.is_some() {
        sql.push_str(" INNER JOIN songs_fts fts ON s.id = fts.song_id");
    }

    sql.push_str(" WHERE ");
    sql.push_str(if pg { "mf.enabled" } else { "mf.enabled = 1" });
    sql.push_str(" AND ula.user_id = ");
    push_bind(&mut sql, &mut binds, user_id, pg);

    if let Some(ts) = ts_query {
        if pg {
            let idx = push_bind(&mut sql.clone(), &mut Vec::new(), ts, true); // dummy to get next idx
                                                                              // Actually: push the ts bind once, reference it three times.
            binds.push(Value::from(ts));
            let n = binds.len();
            let _ = idx;
            sql.push_str(&format!(
                " AND (to_tsvector('simple', COALESCE(s.title, '')) @@ to_tsquery('simple', ${n}) \
                 OR to_tsvector('simple', COALESCE(ar.name, '')) @@ to_tsquery('simple', ${n}) \
                 OR to_tsvector('simple', COALESCE(al.name, '')) @@ to_tsquery('simple', ${n}))"
            ));
        }
    }
    if !pg {
        if let Some(fts) = fts_query {
            sql.push_str(" AND songs_fts MATCH ");
            push_bind(&mut sql, &mut binds, fts, false);
        }
    }

    for condition in &filter_conds.conditions {
        sql.push_str(" AND ");
        if pg {
            sql.push_str(&sqlite_case_insensitive_sql_to_postgres(condition));
        } else {
            sql.push_str(condition);
        }
    }

    sql.push_str(" ORDER BY ");
    if pg {
        sql.push_str(&sqlite_case_insensitive_sql_to_postgres(song_order));
    } else {
        sql.push_str(song_order);
    }

    if let Some((limit, offset)) = limit_offset {
        sql.push_str(" LIMIT ");
        push_bind(&mut sql, &mut binds, limit, pg);
        sql.push_str(" OFFSET ");
        push_bind(&mut sql, &mut binds, offset, pg);
    }

    let songs = query_all_for_backend::<crate::db::models::Song>(database, &sql, binds).await?;
    Ok(songs)
}

async fn count_songs_unified(
    database: &Database,
    user_id: i64,
    ts_query: Option<&str>,
    fts_query: Option<&str>,
    filter_conds: &SongFilterConditions,
) -> crate::error::Result<i64> {
    let pg = is_postgres(database);
    let mut sql = String::new();
    let mut binds: Vec<Value> = Vec::new();

    sql.push_str(
        "SELECT COUNT(*) AS count FROM songs s \
         INNER JOIN artists ar ON s.artist_id = ar.id \
         LEFT JOIN albums al ON s.album_id = al.id \
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id \
         INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id \
         LEFT JOIN (SELECT song_id, ",
    );
    sql.push_str(if pg {
        "SUM(play_count)::BIGINT AS play_count"
    } else {
        "SUM(play_count) AS play_count"
    });
    sql.push_str(", MAX(played_at) AS last_played FROM scrobbles WHERE ");
    sql.push_str(if pg { "submission" } else { "submission = 1" });
    sql.push_str(" AND user_id = ");
    push_bind(&mut sql, &mut binds, user_id, pg);
    sql.push_str(" GROUP BY song_id) pc ON s.id = pc.song_id");

    if filter_conds.has_rating_filter {
        sql.push_str(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = ",
        );
        push_bind(&mut sql, &mut binds, user_id, pg);
    }
    if filter_conds.has_starred_filter {
        sql.push_str(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = ",
        );
        push_bind(&mut sql, &mut binds, user_id, pg);
    }
    if !pg && fts_query.is_some() {
        sql.push_str(" INNER JOIN songs_fts fts ON s.id = fts.song_id");
    }

    sql.push_str(" WHERE ");
    sql.push_str(if pg { "mf.enabled" } else { "mf.enabled = 1" });
    sql.push_str(" AND ula.user_id = ");
    push_bind(&mut sql, &mut binds, user_id, pg);

    if let Some(ts) = ts_query {
        if pg {
            binds.push(Value::from(ts));
            let n = binds.len();
            sql.push_str(&format!(
                " AND (to_tsvector('simple', COALESCE(s.title, '')) @@ to_tsquery('simple', ${n}) \
                 OR to_tsvector('simple', COALESCE(ar.name, '')) @@ to_tsquery('simple', ${n}) \
                 OR to_tsvector('simple', COALESCE(al.name, '')) @@ to_tsquery('simple', ${n}))"
            ));
        }
    }
    if !pg {
        if let Some(fts) = fts_query {
            sql.push_str(" AND songs_fts MATCH ");
            push_bind(&mut sql, &mut binds, fts, false);
        }
    }

    for condition in &filter_conds.conditions {
        sql.push_str(" AND ");
        if pg {
            sql.push_str(&sqlite_case_insensitive_sql_to_postgres(condition));
        } else {
            sql.push_str(condition);
        }
    }

    let row = query_one_for_backend::<CountRow>(database, &sql, binds).await?;
    Ok(row.map(|r| r.count).unwrap_or(0))
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
    database: &Database,
    user_id: i64,
    query: &str,
    params: &SearchParams,
) -> crate::error::Result<Vec<crate::db::models::Song>> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard_input = trimmed_query.is_empty() || trimmed_query == "*";

    let fts_query = if !is_wildcard_input {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard_input {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };

    // If tokenisation produced no tokens, treat as wildcard (no predicate).
    let is_wildcard = is_wildcard_input || fts_query.is_none();

    let filter_conds = build_song_filter_conditions(params, user_id);
    let pg = is_postgres(database);
    let song_order = if pg {
        // Rust-side sort handles ordering; avoid referencing the SQLite-only
        // `fts.rank` alias that the default clause may produce.
        "s.title".to_string()
    } else {
        get_song_order_clause(params.song_sort.as_ref(), params.song_sort_dir.as_ref())
    };

    // When not wildcard and tokenisation yielded no usable query, return empty.
    if !is_wildcard_input && fts_query.is_none() {
        return Ok(vec![]);
    }

    let songs = search_songs_unified(
        database,
        user_id,
        if is_wildcard {
            None
        } else {
            postgres_ts_query.as_deref()
        },
        if is_wildcard {
            None
        } else {
            fts_query.as_deref()
        },
        &filter_conds,
        &song_order,
        None,
    )
    .await?;

    // Match previous behaviour: the Postgres path sorted via sort_songs() with
    // default "name" when no sort was provided. The SQLite path used ORDER BY
    // directly. We now always apply the server-side ORDER BY, but keep the
    // post-sort for Postgres parity in case future logic relies on it.
    if is_postgres(database) {
        Ok(crate::api::common::sorting::sort_songs(
            songs,
            params.song_sort.as_deref().or(Some("name")),
            params.song_sort_dir.as_deref(),
        ))
    } else {
        Ok(songs)
    }
}

/// Result type for artist search
pub struct ArtistSearchResult {
    pub artists: Vec<crate::db::models::Artist>,
    pub total: Option<i64>,
}

/// Search artists using FTS5 with filtering support.
/// Returns artists along with optional total count for pagination.
pub async fn search_artists(
    database: &Database,
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<ArtistSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard_input = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard_input {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard_input {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard_input || fts_query.is_none();

    let artist_has_starred_filter = params.starred_only.unwrap_or(false);
    let artist_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();

    // Filter conditions (reused across primary + count + fuzzy supplement).
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
    if let Some(music_folder_id) = params.music_folder_id {
        artist_filter_conds.push(format!(
            "EXISTS (SELECT 1 FROM songs s_mf WHERE s_mf.artist_id = a.id AND s_mf.music_folder_id = {})",
            music_folder_id
        ));
    }
    if let Some(ref artist_filter) = params.artist_filter {
        let escaped = artist_filter.replace('\'', "''");
        artist_filter_conds.push(format!("a.name LIKE '%{}%' COLLATE NOCASE", escaped));
    }

    // Preserve helper signatures expected by fuzzy_supplement_artists below.
    let mut artist_joins = String::new();
    let mut artist_join_user_ids: Vec<i64> = Vec::new();
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

    let artist_order = get_artist_order_clause(
        params.artist_sort.as_ref(),
        params.artist_sort_dir.as_ref(),
        user_id,
    );

    // Returns SQL+binds for the primary query (when `count_only` = false)
    // or its COUNT(*) equivalent.
    let build_query = |count_only: bool| -> (String, Vec<Value>) {
        let pg = is_postgres(database);
        let mut sql = String::new();
        let mut binds: Vec<Value> = Vec::new();

        if count_only {
            sql.push_str("SELECT COUNT(*) AS count FROM artists a");
        } else {
            sql.push_str("SELECT a.* FROM artists a");
        }

        if artist_has_rating_filter {
            sql.push_str(
                " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'artist' AND r.user_id = ",
            );
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        if artist_has_starred_filter {
            sql.push_str(
                " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist' AND st.user_id = ",
            );
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        if !pg && fts_query.is_some() {
            sql.push_str(" INNER JOIN artists_fts fts ON a.id = fts.artist_id");
        }

        // Enabled-library EXISTS predicate.
        sql.push_str(" WHERE EXISTS (SELECT 1 FROM songs s_check \
                       JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id \
                       JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id \
                       WHERE s_check.artist_id = a.id AND ");
        sql.push_str(if pg {
            "mf_check.enabled"
        } else {
            "mf_check.enabled = 1"
        });
        sql.push_str(" AND ula_check.user_id = ");
        push_bind(&mut sql, &mut binds, user_id, pg);
        sql.push(')');

        // Full-text predicate.
        if pg {
            if let Some(ref ts) = postgres_ts_query {
                binds.push(Value::from(ts.clone()));
                let n = binds.len();
                sql.push_str(&format!(
                    " AND to_tsvector('simple', COALESCE(a.name, '') || ' ' || COALESCE(a.sort_name, '')) \
                       @@ to_tsquery('simple', ${n})"
                ));
            }
        } else if let Some(ref fts) = fts_query {
            sql.push_str(" AND artists_fts MATCH ");
            push_bind(&mut sql, &mut binds, fts.clone(), false);
        }

        for condition in &artist_filter_conds {
            sql.push_str(" AND ");
            if pg {
                sql.push_str(&sqlite_case_insensitive_sql_to_postgres(condition));
            } else {
                sql.push_str(condition);
            }
        }

        if !count_only {
            sql.push_str(" ORDER BY ");
            if pg {
                sql.push_str(&sqlite_case_insensitive_sql_to_postgres(&artist_order));
            } else {
                sql.push_str(&artist_order);
            }
            sql.push_str(" LIMIT ");
            push_bind(&mut sql, &mut binds, limit, pg);
            sql.push_str(" OFFSET ");
            push_bind(&mut sql, &mut binds, offset, pg);
        }
        (sql, binds)
    };

    // On Postgres, the legacy code post-sorted via `sort_artists_for_search`.
    // We reproduce that behaviour to keep search parity.
    let pg = is_postgres(database);

    let (artists, total) = if pg {
        // Postgres: fetch all without LIMIT/OFFSET, sort/paginate in Rust
        // (matches previous post-sort behaviour).
        let mut sql = String::new();
        let mut binds: Vec<Value> = Vec::new();
        sql.push_str("SELECT a.* FROM artists a");
        if artist_has_rating_filter {
            sql.push_str(" LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'artist' AND r.user_id = ");
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        if artist_has_starred_filter {
            sql.push_str(" LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist' AND st.user_id = ");
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        sql.push_str(" WHERE EXISTS (SELECT 1 FROM songs s_check \
                       JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id \
                       JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id \
                       WHERE s_check.artist_id = a.id AND mf_check.enabled AND ula_check.user_id = ");
        push_bind(&mut sql, &mut binds, user_id, pg);
        sql.push(')');
        if let Some(ref ts) = postgres_ts_query {
            binds.push(Value::from(ts.clone()));
            let n = binds.len();
            sql.push_str(&format!(
                " AND to_tsvector('simple', COALESCE(a.name, '') || ' ' || COALESCE(a.sort_name, '')) \
                   @@ to_tsquery('simple', ${n})"
            ));
        }
        for condition in &artist_filter_conds {
            sql.push_str(" AND ");
            sql.push_str(&sqlite_case_insensitive_sql_to_postgres(condition));
        }

        let artists =
            query_all_for_backend::<crate::db::models::Artist>(database, &sql, binds).await?;
        let artists = sort_artists_for_search(
            artists,
            params.artist_sort.as_ref(),
            params.artist_sort_dir.as_ref(),
        );
        let total = Some(artists.len() as i64);
        (artists, total)
    } else if is_wildcard || fts_query.is_some() {
        let (sql, binds) = build_query(false);
        let artists =
            query_all_for_backend::<crate::db::models::Artist>(database, &sql, binds).await?;

        let (count_sql, count_binds) = build_query(true);
        let count_row =
            query_one_for_backend::<CountRow>(database, &count_sql, count_binds).await?;
        let total = Some(count_row.map(|r| r.count).unwrap_or(0));
        (artists, total)
    } else {
        (vec![], Some(0))
    };

    // Fuzzy fallback (only when not wildcard, on first page).
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

    // On Postgres we fetched all rows; paginate now. SQLite already paginated via LIMIT/OFFSET.
    let artists = if pg {
        let (paged, _) = paginate_search_results(artists, limit, offset);
        paged
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
    database: &Database,
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<AlbumSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard_input = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard_input {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard_input {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard_input || fts_query.is_none();

    let album_order_clause = get_album_order_clause(
        params.album_sort.as_ref(),
        params.album_sort_dir.as_ref(),
        Some(user_id),
    );
    let album_order = &album_order_clause.order_by;

    let album_filter_conds = build_album_filter_conditions(params);
    let album_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();
    let album_has_starred_filter = params.starred_only.unwrap_or(false);
    let pg = is_postgres(database);

    // Helper to build the primary or count query.
    let build_query = |count_only: bool| -> (String, Vec<Value>) {
        let mut sql = String::new();
        let mut binds: Vec<Value> = Vec::new();

        if count_only {
            sql.push_str("SELECT COUNT(*) AS count FROM albums a INNER JOIN artists ar ON a.artist_id = ar.id");
        } else {
            sql.push_str("SELECT a.*, ar.name AS artist_name FROM albums a INNER JOIN artists ar ON a.artist_id = ar.id");
        }

        // Recommended-sort stats join (SQLite only — the clause itself uses `julianday`
        // which is SQLite-specific).
        if !pg && !count_only {
            if let Some(ref extra_join) = album_order_clause.extra_join {
                sql.push(' ');
                // The extra_join has one `?` placeholder per user_id.
                let mut remaining = extra_join.as_str();
                for uid in &album_order_clause.extra_join_user_ids {
                    if let Some(pos) = remaining.find('?') {
                        sql.push_str(&remaining[..pos]);
                        push_bind(&mut sql, &mut binds, *uid, false);
                        remaining = &remaining[pos + 1..];
                    }
                }
                sql.push_str(remaining);
            }
        }

        if album_has_rating_filter {
            sql.push_str(
                " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'album' AND r.user_id = ",
            );
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        if album_has_starred_filter {
            sql.push_str(
                " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' AND st.user_id = ",
            );
            push_bind(&mut sql, &mut binds, user_id, pg);
        }
        if !pg && fts_query.is_some() {
            sql.push_str(" INNER JOIN albums_fts fts ON a.id = fts.album_id");
        }

        sql.push_str(" WHERE EXISTS (SELECT 1 FROM songs s_check \
                       JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id \
                       JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id \
                       WHERE s_check.album_id = a.id AND ");
        sql.push_str(if pg {
            "mf_check.enabled"
        } else {
            "mf_check.enabled = 1"
        });
        sql.push_str(" AND ula_check.user_id = ");
        push_bind(&mut sql, &mut binds, user_id, pg);
        sql.push(')');

        if pg {
            if let Some(ref ts) = postgres_ts_query {
                binds.push(Value::from(ts.clone()));
                let n = binds.len();
                sql.push_str(&format!(
                    " AND (to_tsvector('simple', COALESCE(a.name, '')) @@ to_tsquery('simple', ${n}) \
                       OR to_tsvector('simple', COALESCE(ar.name, '')) @@ to_tsquery('simple', ${n}))"
                ));
            }
        } else if let Some(ref fts) = fts_query {
            sql.push_str(" AND albums_fts MATCH ");
            push_bind(&mut sql, &mut binds, fts.clone(), false);
        }

        for condition in &album_filter_conds {
            sql.push_str(" AND ");
            if pg {
                sql.push_str(&sqlite_case_insensitive_sql_to_postgres(condition));
            } else {
                sql.push_str(condition);
            }
        }

        if !count_only && !pg {
            sql.push_str(" ORDER BY ");
            sql.push_str(album_order);
            sql.push_str(" LIMIT ");
            push_bind(&mut sql, &mut binds, limit, pg);
            sql.push_str(" OFFSET ");
            push_bind(&mut sql, &mut binds, offset, pg);
        }
        (sql, binds)
    };

    let (albums, total) = if pg {
        let (sql, binds) = build_query(false);
        let albums =
            query_all_for_backend::<crate::db::models::Album>(database, &sql, binds).await?;
        let albums = sort_albums_for_search(
            albums,
            params.album_sort.as_ref(),
            params.album_sort_dir.as_ref(),
        );
        let total = Some(albums.len() as i64);
        (albums, total)
    } else if is_wildcard || fts_query.is_some() {
        let (sql, binds) = build_query(false);
        let albums =
            query_all_for_backend::<crate::db::models::Album>(database, &sql, binds).await?;

        let (count_sql, count_binds) = build_query(true);
        let count_row =
            query_one_for_backend::<CountRow>(database, &count_sql, count_binds).await?;
        let total = Some(count_row.map(|r| r.count).unwrap_or(0));
        (albums, total)
    } else {
        (vec![], Some(0))
    };

    let albums = if !is_wildcard && offset == 0 && (albums.len() as i64) < limit {
        match fuzzy_supplement_albums(database, user_id, trimmed_query, &albums, limit).await {
            Ok(supplemented) => supplemented,
            Err(_) => albums,
        }
    } else {
        albums
    };

    let albums = if pg {
        let (paged, _) = paginate_search_results(albums, limit, offset);
        paged
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
    database: &Database,
    user_id: i64,
    query: &str,
    params: &SearchParams,
    limit: i64,
    offset: i64,
) -> crate::error::Result<SongSearchResult> {
    let trimmed_query = query.trim_matches('"');
    let is_wildcard_input = trimmed_query.is_empty() || trimmed_query == "*";
    let fts_query = if !is_wildcard_input {
        build_fts_query(trimmed_query)
    } else {
        None
    };
    let postgres_ts_query = if !is_wildcard_input {
        build_postgres_tsquery(trimmed_query)
    } else {
        None
    };
    let is_wildcard = is_wildcard_input || fts_query.is_none();

    let song_order = get_song_order_clause_for_search(
        params.song_sort.as_ref(),
        params.song_sort_dir.as_ref(),
        !is_wildcard,
    );

    let filter_conds = build_song_filter_conditions(params, user_id);
    let pg = is_postgres(database);

    if pg {
        // Postgres path: fetch all with a neutral ORDER BY (Rust-side sort
        // handles the real ordering), then sort/paginate in Rust to match
        // legacy behaviour. This avoids referencing the SQLite-only FTS
        // alias (`fts.rank`) that the sort clause may produce for FTS
        // queries.
        let pg_song_order = "s.title".to_string();
        let songs = search_songs_unified(
            database,
            user_id,
            if is_wildcard {
                None
            } else {
                postgres_ts_query.as_deref()
            },
            None,
            &filter_conds,
            &pg_song_order,
            None,
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

    // SQLite path.
    let (songs, total) = if is_wildcard {
        let songs = search_songs_unified(
            database,
            user_id,
            None,
            None,
            &filter_conds,
            &song_order,
            Some((limit, offset)),
        )
        .await?;
        let count = count_songs_unified(database, user_id, None, None, &filter_conds).await?;
        (songs, Some(count))
    } else if let Some(ref fts_q) = fts_query {
        let songs = search_songs_unified(
            database,
            user_id,
            None,
            Some(fts_q.as_str()),
            &filter_conds,
            &song_order,
            Some((limit, offset)),
        )
        .await?;
        let count =
            count_songs_unified(database, user_id, None, Some(fts_q.as_str()), &filter_conds)
                .await?;
        (songs, Some(count))
    } else {
        (vec![], Some(0))
    };

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
    database: &Database,
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

    let pg = is_postgres(database);
    let enabled_condition = if pg {
        "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled AND ula_check.user_id = ?)"
    } else {
        "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.artist_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)"
    };

    let like_final = if pg {
        sqlite_case_insensitive_sql_to_postgres(&like_clause)
    } else {
        like_clause.clone()
    };
    let filter_clauses: Vec<String> = if pg {
        filter_conds
            .iter()
            .map(|c| sqlite_case_insensitive_sql_to_postgres(c))
            .collect()
    } else {
        filter_conds.to_vec()
    };

    let mut all_conditions = vec![enabled_condition.to_string(), like_final];
    all_conditions.extend(filter_clauses);
    let where_clause = format!("WHERE {}", all_conditions.join(" AND "));

    let sqlite_sql = format!("SELECT a.* FROM artists a {joins} {where_clause} LIMIT ?");
    let sql = if pg {
        sqlite_placeholders_to_postgres(&sqlite_sql)
    } else {
        sqlite_sql
    };

    let mut binds: Vec<Value> = Vec::new();
    for uid in join_user_ids {
        binds.push(Value::from(*uid));
    }
    binds.push(Value::from(user_id));
    for val in &like_binds {
        binds.push(Value::from(val.clone()));
    }
    binds.push(Value::from(limit * 3));

    let candidates =
        query_all_for_backend::<crate::db::models::Artist>(database, &sql, binds).await?;

    merge_results(existing, candidates, query, limit, |a| &a.name, |a| &a.id)
}

/// Supplement album results with LIKE-based fuzzy matches.
async fn fuzzy_supplement_albums(
    database: &Database,
    user_id: i64,
    query: &str,
    existing: &[crate::db::models::Album],
    limit: i64,
) -> crate::error::Result<Vec<crate::db::models::Album>> {
    let (like_clause, like_binds) = match build_like_conditions(query, &["a.name", "ar.name"]) {
        Some(v) => v,
        None => return Ok(existing.to_vec()),
    };

    let pg = is_postgres(database);
    let enabled_condition = if pg {
        "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled AND ula_check.user_id = ?)"
    } else {
        "EXISTS (SELECT 1 FROM songs s_check JOIN music_folders mf_check ON s_check.music_folder_id = mf_check.id JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE s_check.album_id = a.id AND mf_check.enabled = 1 AND ula_check.user_id = ?)"
    };
    let like_final = if pg {
        sqlite_case_insensitive_sql_to_postgres(&like_clause)
    } else {
        like_clause.clone()
    };

    let where_clause = format!("WHERE {} AND {}", enabled_condition, like_final);
    let sqlite_sql = format!(
        "SELECT a.*, ar.name as artist_name FROM albums a LEFT JOIN artists ar ON a.artist_id = ar.id {where_clause} LIMIT ?"
    );
    let sql = if pg {
        sqlite_placeholders_to_postgres(&sqlite_sql)
    } else {
        sqlite_sql
    };

    let mut binds: Vec<Value> = Vec::new();
    binds.push(Value::from(user_id));
    for val in &like_binds {
        binds.push(Value::from(val.clone()));
    }
    binds.push(Value::from(limit * 3));

    let candidates =
        query_all_for_backend::<crate::db::models::Album>(database, &sql, binds).await?;

    merge_results(existing, candidates, query, limit, |a| &a.name, |a| &a.id)
}

/// Supplement song results with LIKE-based fuzzy matches.
async fn fuzzy_supplement_songs(
    database: &Database,
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

    let pg = is_postgres(database);
    let enabled_condition = if pg {
        "EXISTS (SELECT 1 FROM music_folders mf_check JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE mf_check.id = s.music_folder_id AND mf_check.enabled AND ula_check.user_id = ?)"
    } else {
        "EXISTS (SELECT 1 FROM music_folders mf_check JOIN user_library_access ula_check ON ula_check.music_folder_id = mf_check.id WHERE mf_check.id = s.music_folder_id AND mf_check.enabled = 1 AND ula_check.user_id = ?)"
    };
    let like_final = if pg {
        sqlite_case_insensitive_sql_to_postgres(&like_clause)
    } else {
        like_clause.clone()
    };

    let where_clause = format!("WHERE {} AND {}", enabled_condition, like_final);
    let starred_null = if pg {
        "NULL::TIMESTAMPTZ AS starred_at"
    } else {
        "NULL AS starred_at"
    };
    let play_count_null = if pg {
        "NULL::BIGINT AS play_count"
    } else {
        "NULL AS play_count"
    };
    let last_played_null = if pg {
        "NULL::TIMESTAMPTZ AS last_played"
    } else {
        "NULL AS last_played"
    };

    let sqlite_sql = format!(
        "SELECT s.*, ar.name as artist_name, al.name as album_name, {play_count_null}, {last_played_null}, {starred_null}
         FROM songs s
         LEFT JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         {where_clause}
         LIMIT ?"
    );
    let sql = if pg {
        sqlite_placeholders_to_postgres(&sqlite_sql)
    } else {
        sqlite_sql
    };

    let mut binds: Vec<Value> = Vec::new();
    binds.push(Value::from(user_id));
    for val in &like_binds {
        binds.push(Value::from(val.clone()));
    }
    binds.push(Value::from(limit * 3));

    let candidates =
        query_all_for_backend::<crate::db::models::Song>(database, &sql, binds).await?;

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
