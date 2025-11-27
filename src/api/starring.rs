use crate::api::auth::AuthenticatedUser;
use crate::api::browse::{AlbumResponse, ArtistResponse, SongResponse};
use crate::api::response::{format_ok_empty, FormatResponse};
use crate::api::xml::{XmlAlbum, XmlArtist, XmlSong, XmlStarred2Response, XmlStarredInner, XmlStarredResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct StarParams {
    id: Option<Vec<String>>,
    #[serde(rename = "albumId")]
    album_id: Option<Vec<String>>,
    #[serde(rename = "artistId")]
    artist_id: Option<Vec<String>>,
}

pub async fn star(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    let now = Utc::now();

    // Star songs
    if let Some(song_ids) = params.id {
        for id in song_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
                 VALUES (?, 'song', ?, ?)"
            )
            .bind(user.user_id)
            .bind(&id)
            .bind(now)
            .execute(&state.pool)
            .await?;
        }
    }

    // Star albums
    if let Some(album_ids) = params.album_id {
        for id in album_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
                 VALUES (?, 'album', ?, ?)"
            )
            .bind(user.user_id)
            .bind(&id)
            .bind(now)
            .execute(&state.pool)
            .await?;
        }
    }

    // Star artists
    if let Some(artist_ids) = params.artist_id {
        for id in artist_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
                 VALUES (?, 'artist', ?, ?)"
            )
            .bind(user.user_id)
            .bind(&id)
            .bind(now)
            .execute(&state.pool)
            .await?;
        }
    }

    Ok(format_ok_empty(user.format))
}

pub async fn unstar(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    // Unstar songs
    if let Some(song_ids) = params.id {
        for id in song_ids {
            sqlx::query(
                "DELETE FROM starred WHERE user_id = ? AND item_type = 'song' AND item_id = ?"
            )
            .bind(user.user_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
        }
    }

    // Unstar albums
    if let Some(album_ids) = params.album_id {
        for id in album_ids {
            sqlx::query(
                "DELETE FROM starred WHERE user_id = ? AND item_type = 'album' AND item_id = ?"
            )
            .bind(user.user_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
        }
    }

    // Unstar artists
    if let Some(artist_ids) = params.artist_id {
        for id in artist_ids {
            sqlx::query(
                "DELETE FROM starred WHERE user_id = ? AND item_type = 'artist' AND item_id = ?"
            )
            .bind(user.user_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
        }
    }

    Ok(format_ok_empty(user.format))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starred2Response {
    starred2: Starred2Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarredResponse {
    starred: Starred2Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starred2Content {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    song: Vec<SongResponse>,
}

/// Helper to fetch starred content (shared by getStarred and getStarred2)
async fn fetch_starred_content(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<(Vec<ArtistResponse>, Vec<AlbumResponse>, Vec<SongResponse>, Vec<XmlArtist>, Vec<XmlAlbum>, Vec<XmlSong>)> {
    // Get starred artists
    let starred_artist_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut json_artists = Vec::new();
    let mut xml_artists = Vec::new();
    for id in starred_artist_ids {
        if let Some(artist) = crate::db::queries::get_artist_by_id(pool, &id).await? {
            json_artists.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name.clone(),
                album_count: Some(artist.album_count),
                cover_art: artist.cover_art_id.clone(),
            });
            xml_artists.push(XmlArtist {
                id: artist.id,
                name: artist.name,
                album_count: Some(artist.album_count),
                cover_art: artist.cover_art_id,
            });
        }
    }

    // Get starred albums
    let starred_album_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred WHERE user_id = ? AND item_type = 'album' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut json_albums = Vec::new();
    let mut xml_albums = Vec::new();
    for id in starred_album_ids {
        if let Some(album) = crate::db::queries::get_album_by_id(pool, &id).await? {
            let created = album.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
            json_albums.push(AlbumResponse {
                id: album.id.clone(),
                name: album.name.clone(),
                artist: album.artist_name.clone(),
                artist_id: album.artist_id.clone(),
                cover_art: album.cover_art_id.clone(),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre.clone(),
                created: created.clone(),
            });
            xml_albums.push(XmlAlbum {
                id: album.id,
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: album.cover_art_id,
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
            });
        }
    }

    // Get starred songs
    let starred_song_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred WHERE user_id = ? AND item_type = 'song' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut json_songs = Vec::new();
    let mut xml_songs = Vec::new();
    for id in starred_song_ids {
        if let Some(song) = crate::db::queries::get_song_by_id(pool, &id).await? {
            let album = if let Some(album_id) = &song.album_id {
                crate::db::queries::get_album_by_id(pool, album_id).await?
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
                cover_art: song.cover_art_id.clone().or_else(|| album.as_ref().and_then(|a| a.cover_art_id.clone())),
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
                id: song.id,
                title: song.title,
                album: album.as_ref().map(|a| a.name.clone()),
                album_id: song.album_id,
                artist: "Unknown".to_string(),
                artist_id: song.artist_id,
                track: song.track_number,
                disc_number: Some(song.disc_number),
                year: song.year,
                genre: song.genre,
                cover_art: song.cover_art_id.or_else(|| album.as_ref().and_then(|a| a.cover_art_id.clone())),
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
    }

    Ok((json_artists, json_albums, json_songs, xml_artists, xml_albums, xml_songs))
}

pub async fn get_starred2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<Starred2Response, XmlStarred2Response>> {
    let (json_artists, json_albums, json_songs, xml_artists, xml_albums, xml_songs) = 
        fetch_starred_content(&state.pool, user.user_id).await?;

    let json_response = Starred2Response {
        starred2: Starred2Content {
            artist: json_artists,
            album: json_albums,
            song: json_songs,
        },
    };
    
    let xml_response = XmlStarred2Response::ok(XmlStarredInner {
        artist: xml_artists,
        album: xml_albums,
        song: xml_songs,
    });

    Ok(FormatResponse::new(user.format, json_response, xml_response))
}

/// GET /rest/getStarred - Old API, returns same as getStarred2 but with different wrapper
pub async fn get_starred(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<StarredResponse, XmlStarredResponse>> {
    let (json_artists, json_albums, json_songs, xml_artists, xml_albums, xml_songs) = 
        fetch_starred_content(&state.pool, user.user_id).await?;

    let json_response = StarredResponse {
        starred: Starred2Content {
            artist: json_artists,
            album: json_albums,
            song: json_songs,
        },
    };
    
    let xml_response = XmlStarredResponse::ok(XmlStarredInner {
        artist: xml_artists,
        album: xml_albums,
        song: xml_songs,
    });

    Ok(FormatResponse::new(user.format, json_response, xml_response))
}
