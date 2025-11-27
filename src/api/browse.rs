use crate::api::auth::AuthenticatedUser;
use crate::api::response::FormatResponse;
use crate::api::xml::{
    XmlAlbum, XmlAlbumDetail, XmlAlbumDetailResponse, XmlArtist, XmlArtistDetail, XmlArtistIndex,
    XmlArtistWithAlbumsResponse, XmlArtistsInner, XmlArtistsResponse, XmlGenre, XmlGenresInner,
    XmlGenresResponse, XmlSong, XmlSongDetailResponse,
};
use crate::api::AppState;
use crate::db::models::{Album, Song};
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct IdParam {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolderParam {
    music_folder_id: Option<i64>,
}

// ===== getArtists =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistsResponse {
    artists: ArtistsIndex,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistsIndex {
    index: Vec<ArtistIndex>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistIndex {
    name: String,
    artist: Vec<ArtistResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
}

pub async fn get_artists(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(_params): Query<MusicFolderParam>,
) -> crate::error::Result<FormatResponse<ArtistsResponse, XmlArtistsResponse>> {
    let artists = crate::db::queries::get_artists(&state.pool).await?;

    // Group artists by first letter
    let mut grouped: HashMap<String, Vec<ArtistResponse>> = HashMap::new();
    let mut xml_grouped: HashMap<String, Vec<XmlArtist>> = HashMap::new();

    for artist in artists {
        let first_char = artist
            .sort_name
            .as_ref()
            .unwrap_or(&artist.name)
            .chars()
            .next()
            .unwrap_or('#')
            .to_uppercase()
            .to_string();

        let index_name = if first_char.chars().next().unwrap().is_alphabetic() {
            first_char
        } else {
            "#".to_string()
        };

        grouped
            .entry(index_name.clone())
            .or_insert_with(Vec::new)
            .push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name.clone(),
                album_count: Some(artist.album_count),
                cover_art: Some(artist.id.clone()),
            });

        xml_grouped
            .entry(index_name)
            .or_insert_with(Vec::new)
            .push(XmlArtist {
                id: artist.id.clone(),
                name: artist.name.clone(),
                album_count: Some(artist.album_count),
                cover_art: Some(artist.id),
            });
    }

    // Sort into index list
    let mut indexes: Vec<ArtistIndex> = grouped
        .into_iter()
        .map(|(name, mut artists)| {
            artists.sort_by(|a, b| a.name.cmp(&b.name));
            ArtistIndex {
                name,
                artist: artists,
            }
        })
        .collect();

    indexes.sort_by(|a, b| a.name.cmp(&b.name));

    let mut xml_indexes: Vec<XmlArtistIndex> = xml_grouped
        .into_iter()
        .map(|(name, mut artists)| {
            artists.sort_by(|a, b| a.name.cmp(&b.name));
            XmlArtistIndex {
                name,
                artist: artists,
            }
        })
        .collect();

    xml_indexes.sort_by(|a, b| a.name.cmp(&b.name));

    let json = ArtistsResponse {
        artists: ArtistsIndex { index: indexes },
    };

    let xml = XmlArtistsResponse::ok(XmlArtistsInner {
        ignored_articles: "The El La Los Las Le Les".to_string(),
        index: xml_indexes,
    });

    Ok(FormatResponse::new(user.format, json, xml))
}

// ===== getArtist =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetailResponse {
    artist: ArtistDetail,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art: Option<String>,
    album: Vec<AlbumResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumResponse {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    pub song_count: i64,
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub created: String,
}

pub async fn get_artist(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<IdParam>,
) -> crate::error::Result<FormatResponse<ArtistDetailResponse, XmlArtistWithAlbumsResponse>> {
    let artist = crate::db::queries::get_artist_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Artist {} not found", params.id)))?;

    let albums = crate::db::queries::get_albums_by_artist(&state.pool, &params.id).await?;

    let album_responses: Vec<AlbumResponse> = albums
        .iter()
        .map(|album| AlbumResponse {
            id: album.id.clone(),
            name: album.name.clone(),
            artist: album.artist_name.clone(),
            artist_id: album.artist_id.clone(),
            cover_art: Some(album.id.clone()),
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre.clone(),
            created: album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
        })
        .collect();

    let xml_albums: Vec<XmlAlbum> = albums
        .into_iter()
        .map(|album| {
            XmlAlbum {
                id: album.id.clone(),
                name: album.name,
                artist: album.artist_name,
                artist_id: album.artist_id,
                cover_art: Some(album.id),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created: album
                    .created_at
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
            }
        })
        .collect();

    let json = ArtistDetailResponse {
        artist: ArtistDetail {
            id: artist.id.clone(),
            name: artist.name.clone(),
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
            album: album_responses,
        },
    };

    let xml = XmlArtistWithAlbumsResponse::ok(XmlArtistDetail {
        id: artist.id.clone(),
        name: artist.name,
        album_count: Some(artist.album_count),
        cover_art: Some(artist.id),
        album: xml_albums,
    });

    Ok(FormatResponse::new(user.format, json, xml))
}

// ===== getAlbum =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetailResponse {
    album: AlbumDetail,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetail {
    id: String,
    name: String,
    artist: String,
    artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art: Option<String>,
    song_count: i64,
    duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    genre: Option<String>,
    created: String,
    song: Vec<SongResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongResponse {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disc_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    pub size: i64,
    pub content_type: String,
    pub suffix: String,
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    pub path: String,
    pub created: String,
    #[serde(rename = "type")]
    pub media_type: String,
}

pub async fn get_album(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<IdParam>,
) -> crate::error::Result<FormatResponse<AlbumDetailResponse, XmlAlbumDetailResponse>> {
    let album = crate::db::queries::get_album_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Album {} not found", params.id)))?;

    let songs = crate::db::queries::get_songs_by_album(&state.pool, &params.id).await?;

    let song_responses: Vec<SongResponse> = songs
        .iter()
        .map(|song| song_to_response(song.clone(), Some(&album)))
        .collect();

    let xml_songs: Vec<XmlSong> = songs
        .into_iter()
        .map(|song| song_to_xml(song, Some(&album)))
        .collect();

    let album_cover = Some(album.id.clone());

    let json = AlbumDetailResponse {
        album: AlbumDetail {
            id: album.id.clone(),
            name: album.name.clone(),
            artist: album.artist_name.clone(),
            artist_id: album.artist_id.clone(),
            cover_art: album_cover.clone(),
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre.clone(),
            created: album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            song: song_responses,
        },
    };

    let xml = XmlAlbumDetailResponse::ok(XmlAlbumDetail {
        id: album.id.clone(),
        name: album.name.clone(),
        artist: album.artist_name.clone(),
        artist_id: album.artist_id.clone(),
        cover_art: album_cover,
        song_count: album.song_count,
        duration: album.duration,
        year: album.year,
        genre: album.genre,
        created: album
            .created_at
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
        song: xml_songs,
    });

    Ok(FormatResponse::new(user.format, json, xml))
}

// ===== getSong =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongDetailResponse {
    song: SongResponse,
}

pub async fn get_song(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<IdParam>,
) -> crate::error::Result<FormatResponse<SongDetailResponse, XmlSongDetailResponse>> {
    let song = crate::db::queries::get_song_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Song {} not found", params.id)))?;

    // Get album info if available
    let album = if let Some(album_id) = &song.album_id {
        crate::db::queries::get_album_by_id(&state.pool, album_id).await?
    } else {
        None
    };

    let json = SongDetailResponse {
        song: song_to_response(song.clone(), album.as_ref()),
    };

    let xml = XmlSongDetailResponse::ok(song_to_xml(song, album.as_ref()));

    Ok(FormatResponse::new(user.format, json, xml))
}

// ===== getGenres =====

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenresResponse {
    genres: GenresList,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenresList {
    genre: Vec<GenreResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreResponse {
    #[serde(rename = "value")]
    name: String,
    song_count: i64,
    album_count: i64,
}

pub async fn get_genres(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<GenresResponse, XmlGenresResponse>> {
    let genres: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT 
            genre,
            COUNT(DISTINCT id) as song_count,
            COUNT(DISTINCT album_id) as album_count
         FROM songs 
         WHERE genre IS NOT NULL 
         GROUP BY genre 
         ORDER BY genre",
    )
    .fetch_all(&state.pool)
    .await?;

    let json_genres: Vec<GenreResponse> = genres
        .iter()
        .map(|(name, song_count, album_count)| GenreResponse {
            name: name.clone(),
            song_count: *song_count,
            album_count: *album_count,
        })
        .collect();

    let xml_genres: Vec<XmlGenre> = genres
        .into_iter()
        .map(|(name, song_count, album_count)| XmlGenre {
            name,
            song_count,
            album_count,
        })
        .collect();

    let json = GenresResponse {
        genres: GenresList { genre: json_genres },
    };

    let xml = XmlGenresResponse::ok(XmlGenresInner { genre: xml_genres });

    Ok(FormatResponse::new(user.format, json, xml))
}

// Helper function to convert Song model to API response
fn song_to_response(song: Song, album: Option<&Album>) -> SongResponse {
    let content_type = match song.file_format.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    SongResponse {
        id: song.id.clone(),
        title: song.title,
        album: album.map(|a| a.name.clone()),
        album_id: song.album_id,
        artist: "Unknown".to_string(), // Will be fetched separately if needed
        artist_id: song.artist_id,
        track: song.track_number,
        disc_number: Some(song.disc_number),
        year: song.year,
        genre: song.genre,
        cover_art: Some(album.map(|a| a.id.clone()).unwrap_or(song.id)),
        size: song.file_size,
        content_type: content_type.to_string(),
        suffix: song.file_format.clone(),
        duration: song.duration,
        bit_rate: song.bitrate,
        path: song.file_path,
        created: song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        media_type: "music".to_string(),
    }
}

// Helper function to convert Song model to XML response
fn song_to_xml(song: Song, album: Option<&Album>) -> XmlSong {
    let content_type = match song.file_format.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    XmlSong {
        id: song.id.clone(),
        title: song.title,
        album: album.map(|a| a.name.clone()),
        album_id: song.album_id.clone(),
        artist: "Unknown".to_string(),
        artist_id: song.artist_id,
        track: song.track_number,
        disc_number: Some(song.disc_number),
        year: song.year,
        genre: song.genre,
        cover_art: Some(album.map(|a| a.id.clone()).unwrap_or(song.id)),
        size: song.file_size,
        content_type: content_type.to_string(),
        suffix: song.file_format.clone(),
        duration: song.duration,
        bit_rate: song.bitrate,
        path: song.file_path,
        created: song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        media_type: "music".to_string(),
    }
}
