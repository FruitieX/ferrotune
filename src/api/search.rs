use crate::api::auth::AuthenticatedUser;
use crate::api::browse::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::response::FormatResponse;
use crate::api::xml::{
    XmlAlbum, XmlArtist, XmlSearchResult3Inner, XmlSearchResult3Response, XmlSong,
};
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
    search_result3: SearchContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    song: Vec<SongResponse>,
}

pub async fn search3(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SearchParams>,
) -> Result<FormatResponse<SearchResult3, XmlSearchResult3Response>> {
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

    let mut json_artists = Vec::new();
    let mut xml_artists = Vec::new();
    for artist in artists {
        json_artists.push(ArtistResponse {
            id: artist.id.clone(),
            name: artist.name.clone(),
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
        });
        xml_artists.push(XmlArtist {
            id: artist.id.clone(),
            name: artist.name,
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id),
        });
    }

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

    let mut json_albums = Vec::new();
    let mut xml_albums = Vec::new();
    for album in albums {
        let created = album
            .created_at
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        json_albums.push(AlbumResponse {
            id: album.id.clone(),
            name: album.name.clone(),
            artist: album.artist_name.clone(),
            artist_id: album.artist_id.clone(),
            cover_art: Some(album.id.clone()),
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre.clone(),
            created: created.clone(),
        });
        xml_albums.push(XmlAlbum {
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
        });
    }

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

    let mut json_songs = Vec::new();
    let mut xml_songs = Vec::new();
    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };

        let content_type = match song.file_format.as_str() {
            "mp3" => "audio/mpeg",
            "flac" => "audio/flac",
            "ogg" | "opus" => "audio/ogg",
            "m4a" | "mp4" | "aac" => "audio/mp4",
            "wav" => "audio/wav",
            _ => "application/octet-stream",
        };

        let created = song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        json_songs.push(SongResponse {
            id: song.id.clone(),
            title: song.title.clone(),
            album: album.as_ref().map(|a| a.name.clone()),
            album_id: song.album_id.clone(),
            artist: "Unknown".to_string(),
            artist_id: song.artist_id.clone(),
            track: song.track_number,
            disc_number: Some(song.disc_number),
            year: song.year,
            genre: song.genre.clone(),
            cover_art: Some(
                album
                    .as_ref()
                    .map(|a| a.id.clone())
                    .unwrap_or_else(|| song.id.clone()),
            ),
            size: song.file_size,
            content_type: content_type.to_string(),
            suffix: song.file_format.clone(),
            duration: song.duration,
            bit_rate: song.bitrate,
            path: song.file_path.clone(),
            created: created.clone(),
            media_type: "music".to_string(),
        });

        xml_songs.push(XmlSong {
            id: song.id.clone(),
            title: song.title,
            album: album.as_ref().map(|a| a.name.clone()),
            album_id: song.album_id,
            artist: "Unknown".to_string(),
            artist_id: song.artist_id,
            track: song.track_number,
            disc_number: Some(song.disc_number),
            year: song.year,
            genre: song.genre,
            cover_art: Some(album.as_ref().map(|a| a.id.clone()).unwrap_or(song.id)),
            size: song.file_size,
            content_type: content_type.to_string(),
            suffix: song.file_format,
            duration: song.duration,
            bit_rate: song.bitrate,
            path: song.file_path,
            created,
            media_type: "music".to_string(),
        });
    }

    let json_response = SearchResult3 {
        search_result3: SearchContent {
            artist: json_artists,
            album: json_albums,
            song: json_songs,
        },
    };

    let xml_response = XmlSearchResult3Response::ok(XmlSearchResult3Inner {
        artist: xml_artists,
        album: xml_albums,
        song: xml_songs,
    });

    Ok(FormatResponse::new(
        user.format,
        json_response,
        xml_response,
    ))
}
