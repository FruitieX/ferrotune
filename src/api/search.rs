use crate::api::auth::AuthenticatedUser;
use crate::api::browse::{song_to_response, AlbumResponse, ArtistResponse, SongResponse};
use crate::api::response::FormatResponse;
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

    let artist_responses: Vec<ArtistResponse> = artists
        .into_iter()
        .map(|artist| ArtistResponse {
            id: artist.id.clone(),
            name: artist.name,
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id),
        })
        .collect();

    // Search albums
    let albums: Vec<crate::db::models::Album> = sqlx::query_as(
        "SELECT a.*, ar.name as artist_name 
         FROM albums a 
         INNER JOIN artists ar ON a.artist_id = ar.id 
         WHERE a.name LIKE ? COLLATE NOCASE 
         ORDER BY a.name 
         LIMIT ? OFFSET ?",
    )
    .bind(&search_term)
    .bind(album_count)
    .bind(album_offset)
    .fetch_all(&state.pool)
    .await?;

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
                cover_art: Some(album.id),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
            }
        })
        .collect();

    // Search songs using FTS5 (only if query is not empty)
    let songs: Vec<crate::db::models::Song> = if params.query.is_empty() {
        vec![]
    } else {
        sqlx::query_as(
            "SELECT s.* FROM songs s 
             INNER JOIN songs_fts fts ON s.id = fts.song_id 
             WHERE songs_fts MATCH ? 
             ORDER BY s.title 
             LIMIT ? OFFSET ?",
        )
        .bind(&params.query)
        .bind(song_count)
        .bind(song_offset)
        .fetch_all(&state.pool)
        .await?
    };

    let mut song_responses = Vec::new();
    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };
        song_responses.push(song_to_response(song, album.as_ref()));
    }

    let response = SearchResult3 {
        search_result3: SearchContent {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
