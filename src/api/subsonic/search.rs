use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{
    get_ratings_map, get_starred_map, song_to_response, AlbumResponse, ArtistResponse, SongResponse,
};
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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

    let search_term = format!("%{}%", params.query);
    let song_order =
        get_song_order_clause(params.song_sort.as_ref(), params.song_sort_dir.as_ref());
    let album_order =
        get_album_order_clause(params.album_sort.as_ref(), params.album_sort_dir.as_ref());

    // Search artists
    let artists: Vec<crate::db::models::Artist> = sqlx::query_as(
        "SELECT * FROM artists 
         WHERE name LIKE ? COLLATE NOCASE 
         ORDER BY name 
         LIMIT ? OFFSET ?",
    )
    .bind(&search_term)
    .bind(artist_count)
    .bind(artist_offset)
    .fetch_all(&state.pool)
    .await?;

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

    // Search albums with dynamic sorting
    let album_query = format!(
        "SELECT a.*, ar.name as artist_name 
         FROM albums a 
         INNER JOIN artists ar ON a.artist_id = ar.id 
         WHERE a.name LIKE ? COLLATE NOCASE 
         ORDER BY {album_order}
         LIMIT ? OFFSET ?"
    );
    let albums: Vec<crate::db::models::Album> = sqlx::query_as(&album_query)
        .bind(&search_term)
        .bind(album_count)
        .bind(album_offset)
        .fetch_all(&state.pool)
        .await?;

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

    // Search songs - handle wildcard query specially, with dynamic sorting
    let (songs, song_total): (Vec<crate::db::models::Song>, Option<i64>) = if params
        .query
        .is_empty()
        || params.query == "*"
    {
        // Return all songs with dynamic sorting
        // Join with scrobbles to get play count
        let needs_play_count = params.song_sort.as_deref() == Some("playCount");

        let query = if needs_play_count {
            format!(
                    "SELECT s.*, ar.name as artist_name, COALESCE(pc.play_count, 0) as play_count
                     FROM songs s 
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count FROM scrobbles GROUP BY song_id) pc ON s.id = pc.song_id
                     ORDER BY {song_order}
                     LIMIT ? OFFSET ?"
                )
        } else {
            format!(
                "SELECT s.*, ar.name as artist_name, 0 as play_count
                     FROM songs s 
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     ORDER BY {song_order}
                     LIMIT ? OFFSET ?"
            )
        };

        let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
            .bind(song_count)
            .bind(song_offset)
            .fetch_all(&state.pool)
            .await?;

        // Get total count
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM songs")
            .fetch_one(&state.pool)
            .await?;

        (songs, Some(total.0))
    } else {
        // Escape query for FTS5 - wrap in double quotes to make it a phrase query
        // and escape any internal double quotes. This prevents SQL injection and
        // FTS5 operator interpretation (e.g., "24-7" doesn't become "24 NOT 7")
        let escaped_query = format!("\"{}\"", params.query.replace("\"", "\"\""));

        // Use FTS5 for actual search queries with dynamic sorting
        let needs_play_count = params.song_sort.as_deref() == Some("playCount");

        let query = if needs_play_count {
            format!(
                    "SELECT s.*, ar.name as artist_name, COALESCE(pc.play_count, 0) as play_count
                     FROM songs s 
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     INNER JOIN songs_fts fts ON s.id = fts.song_id 
                     LEFT JOIN (SELECT song_id, COUNT(*) as play_count FROM scrobbles GROUP BY song_id) pc ON s.id = pc.song_id
                     WHERE songs_fts MATCH ? 
                     ORDER BY {song_order}
                     LIMIT ? OFFSET ?"
                )
        } else {
            format!(
                "SELECT s.*, ar.name as artist_name, 0 as play_count
                     FROM songs s 
                     INNER JOIN artists ar ON s.artist_id = ar.id
                     INNER JOIN songs_fts fts ON s.id = fts.song_id 
                     WHERE songs_fts MATCH ? 
                     ORDER BY {song_order}
                     LIMIT ? OFFSET ?"
            )
        };

        let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
            .bind(&escaped_query)
            .bind(song_count)
            .bind(song_offset)
            .fetch_all(&state.pool)
            .await?;

        // Get total count for FTS search
        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                .bind(&escaped_query)
                .fetch_one(&state.pool)
                .await?;

        (songs, Some(total.0))
    };

    // Get totals for artists and albums (only when offset is 0 for efficiency)
    let artist_total: Option<i64> = if artist_offset == 0 {
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM artists WHERE name LIKE ? COLLATE NOCASE")
                .bind(&search_term)
                .fetch_one(&state.pool)
                .await?;
        Some(count.0)
    } else {
        None
    };

    let album_total: Option<i64> = if album_offset == 0 {
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM albums WHERE name LIKE ? COLLATE NOCASE")
                .bind(&search_term)
                .fetch_one(&state.pool)
                .await?;
        Some(count.0)
    } else {
        None
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
        song_responses.push(song_to_response(song, album.as_ref(), starred, user_rating));
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
