use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{
    get_ratings_map, get_starred_map, song_to_response_with_stats, AlbumResponse, ArtistResponse,
    SongPlayStats, SongResponse,
};
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Convert a user query into an FTS5-safe query with prefix matching.
///
/// Examples:
/// - "beat" -> "beat*" (matches "Beatles", "beat", "beats")
/// - "the beatles" -> "the* beatles*" (matches "the beatles", "Theatre Beatles")
/// - "rock & roll" -> "rock* roll*" (strips special chars, adds prefix wildcards)
/// - "24-7" -> "24* 7*" (prevents FTS5 interpreting as "24 NOT 7")
///
/// Returns None if the query is empty after processing.
fn build_fts_query(query: &str) -> Option<String> {
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    query: String,
    artist_count: Option<u32>,
    artist_offset: Option<u32>,
    album_count: Option<u32>,
    album_offset: Option<u32>,
    song_count: Option<u32>,
    song_offset: Option<u32>,
    /// Ferrotune extension: sort field for songs (name, artist, album, year, duration, playCount, dateAdded)
    song_sort: Option<String>,
    /// Ferrotune extension: sort direction (asc, desc)
    song_sort_dir: Option<String>,
    /// Ferrotune extension: sort field for albums (name, artist, year, dateAdded)
    album_sort: Option<String>,
    /// Ferrotune extension: sort direction for albums (asc, desc)
    album_sort_dir: Option<String>,
    // ===== Advanced Filter Parameters (Ferrotune extension) =====
    /// Filter songs/albums by minimum year
    min_year: Option<i32>,
    /// Filter songs/albums by maximum year
    max_year: Option<i32>,
    /// Filter songs/albums by genre (exact match)
    genre: Option<String>,
    /// Filter songs by minimum duration in seconds
    min_duration: Option<i32>,
    /// Filter songs by maximum duration in seconds
    max_duration: Option<i32>,
    /// Filter songs/albums by minimum user rating (1-5)
    min_rating: Option<i32>,
    /// Filter songs/albums by maximum user rating (1-5)
    max_rating: Option<i32>,
    /// Filter to only starred items
    starred_only: Option<bool>,
    /// Filter songs by minimum play count
    min_play_count: Option<i32>,
    /// Filter songs by maximum play count
    max_play_count: Option<i32>,
    /// Filter to only shuffle-excluded songs
    shuffle_excluded_only: Option<bool>,
    /// Filter songs by minimum bitrate in kbps
    min_bitrate: Option<i32>,
    /// Filter songs by maximum bitrate in kbps
    max_bitrate: Option<i32>,
    /// Filter songs added after this ISO 8601 date (e.g., "2024-01-01")
    added_after: Option<String>,
    /// Filter songs added before this ISO 8601 date (e.g., "2024-12-31")
    added_before: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult3 {
    pub search_result3: SearchContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
    /// Total count of matching artists (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_total: Option<i64>,
    /// Total count of matching albums (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_total: Option<i64>,
    /// Total count of matching songs (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song_total: Option<i64>,
}

/// Get ORDER BY clause for song sorting
fn get_song_order_clause(sort: Option<&String>, sort_dir: Option<&String>) -> String {
    let dir = match sort_dir.map(|s| s.as_str()) {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    match sort.map(|s| s.as_str()) {
        Some("artist") => format!("ar.name COLLATE NOCASE {dir}, s.title COLLATE NOCASE {dir}"),
        Some("album") => format!("s.album COLLATE NOCASE {dir}, s.title COLLATE NOCASE {dir}"),
        Some("year") => format!("s.year {dir}, s.title COLLATE NOCASE {dir}"),
        Some("duration") => format!("s.duration {dir}, s.title COLLATE NOCASE {dir}"),
        Some("playCount") => format!("play_count {dir}, s.title COLLATE NOCASE {dir}"),
        Some("dateAdded") => format!("s.created_at {dir}, s.title COLLATE NOCASE {dir}"),
        _ => format!("s.title COLLATE NOCASE {dir}"), // default: name
    }
}

/// Get ORDER BY clause for album sorting  
fn get_album_order_clause(sort: Option<&String>, sort_dir: Option<&String>) -> String {
    let dir = match sort_dir.map(|s| s.as_str()) {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    match sort.map(|s| s.as_str()) {
        Some("artist") => format!("ar.name COLLATE NOCASE {dir}, a.name COLLATE NOCASE {dir}"),
        Some("year") => format!("a.year {dir}, a.name COLLATE NOCASE {dir}"),
        Some("dateAdded") => format!("a.created_at {dir}, a.name COLLATE NOCASE {dir}"),
        _ => format!("a.name COLLATE NOCASE {dir}"), // default: name
    }
}

/// Build WHERE clause conditions for song filters
struct SongFilterConditions {
    conditions: Vec<String>,
    has_rating_filter: bool,
    has_starred_filter: bool,
}

fn build_song_filter_conditions(params: &SearchParams, user_id: i64) -> SongFilterConditions {
    let mut conditions = Vec::new();
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

    SongFilterConditions {
        conditions,
        has_rating_filter,
        has_starred_filter,
    }
}

/// Build WHERE clause conditions for album filters
fn build_album_filter_conditions(params: &SearchParams) -> Vec<String> {
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

    conditions
}

pub async fn search3(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> Result<FormatResponse<SearchResult3>> {
    let artist_count = params.artist_count.unwrap_or(20).min(500) as i64;
    let artist_offset = params.artist_offset.unwrap_or(0) as i64;
    let album_count = params.album_count.unwrap_or(20).min(500) as i64;
    let album_offset = params.album_offset.unwrap_or(0) as i64;
    let song_count = params.song_count.unwrap_or(20).min(500) as i64;
    let song_offset = params.song_offset.unwrap_or(0) as i64;

    let song_order =
        get_song_order_clause(params.song_sort.as_ref(), params.song_sort_dir.as_ref());
    let album_order =
        get_album_order_clause(params.album_sort.as_ref(), params.album_sort_dir.as_ref());

    // Check for wildcard query
    let is_wildcard = params.query.is_empty() || params.query == "*";

    // Build FTS query with prefix wildcards
    let fts_query = if !is_wildcard {
        build_fts_query(&params.query)
    } else {
        None
    };

    // ========================================================================
    // Search artists using FTS5 with filtering support
    // ========================================================================
    let artist_has_starred_filter = params.starred_only.unwrap_or(false);
    let artist_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();

    // Build artist JOIN clauses
    let mut artist_joins = String::new();
    if artist_has_rating_filter {
        artist_joins.push_str(&format!(
            " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'artist' AND r.user_id = {}",
            user.user_id
        ));
    }
    if artist_has_starred_filter {
        artist_joins.push_str(&format!(
            " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist' AND st.user_id = {}",
            user.user_id
        ));
    }

    // Build artist filter conditions
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
    let has_artist_filters = !artist_filter_conds.is_empty();

    let (artists, artist_total): (Vec<crate::db::models::Artist>, Option<i64>) = if is_wildcard {
        let where_clause = if has_artist_filters {
            format!("WHERE {}", artist_filter_conds.join(" AND "))
        } else {
            String::new()
        };

        let query = format!(
            "SELECT a.* FROM artists a {artist_joins} {where_clause} ORDER BY a.name COLLATE NOCASE LIMIT ? OFFSET ?"
        );
        let artists: Vec<crate::db::models::Artist> = sqlx::query_as(&query)
            .bind(artist_count)
            .bind(artist_offset)
            .fetch_all(&state.pool)
            .await?;

        let count_query = format!("SELECT COUNT(*) FROM artists a {artist_joins} {where_clause}");
        let total: (i64,) = sqlx::query_as(&count_query).fetch_one(&state.pool).await?;

        (artists, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        let mut where_conditions = vec!["artists_fts MATCH ?".to_string()];
        where_conditions.extend(artist_filter_conds.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query = format!(
            "SELECT a.* FROM artists a
             {artist_joins}
             INNER JOIN artists_fts fts ON a.id = fts.artist_id
             {where_clause}
             ORDER BY a.name COLLATE NOCASE
             LIMIT ? OFFSET ?"
        );
        let artists: Vec<crate::db::models::Artist> = sqlx::query_as(&query)
            .bind(fts_q)
            .bind(artist_count)
            .bind(artist_offset)
            .fetch_all(&state.pool)
            .await?;

        let count_query = format!(
            "SELECT COUNT(*) FROM artists a {artist_joins} INNER JOIN artists_fts fts ON a.id = fts.artist_id {where_clause}"
        );
        let total: (i64,) = sqlx::query_as(&count_query)
            .bind(fts_q)
            .fetch_one(&state.pool)
            .await?;

        (artists, Some(total.0))
    } else {
        // Empty query after processing
        (vec![], Some(0))
    };

    // Get starred status and ratings for artists
    let artist_ids: Vec<String> = artists.iter().map(|a| a.id.clone()).collect();
    let artist_starred_map =
        get_starred_map(&state.pool, user.user_id, "artist", &artist_ids).await?;
    let artist_ratings_map =
        get_ratings_map(&state.pool, user.user_id, "artist", &artist_ids).await?;

    let artist_responses: Vec<ArtistResponse> = artists
        .into_iter()
        .map(|artist| ArtistResponse {
            id: artist.id.clone(),
            name: artist.name,
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
            starred: artist_starred_map.get(&artist.id).cloned(),
            user_rating: artist_ratings_map.get(&artist.id).copied(),
        })
        .collect();

    // ========================================================================
    // Search albums using FTS5 with filtering support
    // ========================================================================
    let album_filter_conds = build_album_filter_conditions(&params);
    let has_album_filters = !album_filter_conds.is_empty();
    let album_has_rating_filter = params.min_rating.is_some() || params.max_rating.is_some();
    let album_has_starred_filter = params.starred_only.unwrap_or(false);

    // Build album JOIN clauses
    let mut album_joins = String::from("INNER JOIN artists ar ON a.artist_id = ar.id");
    if album_has_rating_filter {
        album_joins.push_str(&format!(
            " LEFT JOIN ratings r ON r.item_id = a.id AND r.item_type = 'album' AND r.user_id = {}",
            user.user_id
        ));
    }
    if album_has_starred_filter {
        album_joins.push_str(&format!(
            " LEFT JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' AND st.user_id = {}",
            user.user_id
        ));
    }

    let (albums, album_total): (Vec<crate::db::models::Album>, Option<i64>) = if is_wildcard {
        let where_clause = if has_album_filters {
            format!("WHERE {}", album_filter_conds.join(" AND "))
        } else {
            String::new()
        };

        let album_query = format!(
            "SELECT a.*, ar.name as artist_name 
             FROM albums a 
             {album_joins}
             {where_clause}
             ORDER BY {album_order}
             LIMIT ? OFFSET ?"
        );
        let albums: Vec<crate::db::models::Album> = sqlx::query_as(&album_query)
            .bind(album_count)
            .bind(album_offset)
            .fetch_all(&state.pool)
            .await?;

        let count_query = format!("SELECT COUNT(*) FROM albums a {album_joins} {where_clause}");
        let total: (i64,) = sqlx::query_as(&count_query).fetch_one(&state.pool).await?;

        (albums, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        let mut where_conditions = vec!["albums_fts MATCH ?".to_string()];
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
        let albums: Vec<crate::db::models::Album> = sqlx::query_as(&album_query)
            .bind(fts_q)
            .bind(album_count)
            .bind(album_offset)
            .fetch_all(&state.pool)
            .await?;

        let count_query = format!(
            "SELECT COUNT(*) FROM albums a {album_joins} INNER JOIN albums_fts fts ON a.id = fts.album_id {where_clause}"
        );
        let total: (i64,) = sqlx::query_as(&count_query)
            .bind(fts_q)
            .fetch_one(&state.pool)
            .await?;

        (albums, Some(total.0))
    } else {
        // Empty query after processing
        (vec![], Some(0))
    };

    // Get starred status and ratings for albums
    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let album_starred_map = get_starred_map(&state.pool, user.user_id, "album", &album_ids).await?;
    let album_ratings_map = get_ratings_map(&state.pool, user.user_id, "album", &album_ids).await?;

    let album_responses: Vec<AlbumResponse> = albums
        .into_iter()
        .map(|album| {
            let created = album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
            AlbumResponse {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id.clone()),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: album_starred_map.get(&album.id).cloned(),
                user_rating: album_ratings_map.get(&album.id).copied(),
            }
        })
        .collect();

    // ========================================================================
    // Search songs using FTS5 with filtering support
    // ========================================================================
    let filter_conds = build_song_filter_conditions(&params, user.user_id);
    let has_filters = !filter_conds.conditions.is_empty();

    // Build JOIN clauses based on filter requirements
    // Always include play_count and last_played for the response
    let mut joins = String::from(
        "INNER JOIN artists ar ON s.artist_id = ar.id
         LEFT JOIN albums al ON s.album_id = al.id
         LEFT JOIN (SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played FROM scrobbles WHERE submission = 1 GROUP BY song_id) pc ON s.id = pc.song_id",
    );
    if filter_conds.has_rating_filter {
        joins.push_str(&format!(
            " LEFT JOIN ratings r ON r.item_id = s.id AND r.item_type = 'song' AND r.user_id = {}",
            user.user_id
        ));
    }
    if filter_conds.has_starred_filter {
        joins.push_str(&format!(
            " LEFT JOIN starred st ON st.item_id = s.id AND st.item_type = 'song' AND st.user_id = {}",
            user.user_id
        ));
    }

    let (songs, song_total): (Vec<crate::db::models::Song>, Option<i64>) = if is_wildcard {
        // Build WHERE clause for filters
        let where_clause = if has_filters {
            format!("WHERE {}", filter_conds.conditions.join(" AND "))
        } else {
            String::new()
        };

        let query = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             {where_clause}
             ORDER BY {song_order}
             LIMIT ? OFFSET ?"
        );

        let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
            .bind(song_count)
            .bind(song_offset)
            .fetch_all(&state.pool)
            .await?;

        // Get total count with same filters
        let count_query = format!("SELECT COUNT(*) FROM songs s {joins} {where_clause}");
        let total: (i64,) = sqlx::query_as(&count_query).fetch_one(&state.pool).await?;

        (songs, Some(total.0))
    } else if let Some(ref fts_q) = fts_query {
        // Build WHERE clause combining FTS and filters
        let mut where_conditions = vec!["songs_fts MATCH ?".to_string()];
        where_conditions.extend(filter_conds.conditions.clone());
        let where_clause = format!("WHERE {}", where_conditions.join(" AND "));

        let query = format!(
            "SELECT s.*, ar.name as artist_name, al.name as album_name, pc.play_count, pc.last_played, NULL as starred_at
             FROM songs s 
             {joins}
             INNER JOIN songs_fts fts ON s.id = fts.song_id 
             {where_clause}
             ORDER BY {song_order}
             LIMIT ? OFFSET ?"
        );

        let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
            .bind(fts_q)
            .bind(song_count)
            .bind(song_offset)
            .fetch_all(&state.pool)
            .await?;

        // Get total count with same filters
        let count_query = format!(
            "SELECT COUNT(*) FROM songs s {joins} INNER JOIN songs_fts fts ON s.id = fts.song_id {where_clause}"
        );
        let total: (i64,) = sqlx::query_as(&count_query)
            .bind(fts_q)
            .fetch_one(&state.pool)
            .await?;

        (songs, Some(total.0))
    } else {
        // Empty query after processing
        (vec![], Some(0))
    };

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let song_starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let song_ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    let mut song_responses = Vec::new();
    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };
        let starred = song_starred_map.get(&song.id).cloned();
        let user_rating = song_ratings_map.get(&song.id).copied();
        let play_stats = SongPlayStats {
            play_count: song.play_count,
            last_played: song
                .last_played
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        };
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
        ));
    }

    let response = SearchResult3 {
        search_result3: SearchContent {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
            artist_total,
            album_total,
            song_total,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
