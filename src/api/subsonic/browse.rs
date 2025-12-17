use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::response::FormatResponse;
use crate::api::AppState;
use crate::db::models::{Album, ItemType, Song};
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
pub struct IdParam {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFolderParam {
    #[allow(dead_code)]
    music_folder_id: Option<i64>,
}

// ===== getArtists =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistsResponse {
    pub artists: ArtistsIndex,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistsIndex {
    pub index: Vec<ArtistIndex>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistIndex {
    pub name: String,
    pub artist: Vec<ArtistResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistResponse {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

pub async fn get_artists(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(_params): Query<MusicFolderParam>,
) -> crate::error::Result<FormatResponse<ArtistsResponse>> {
    let artists = crate::db::queries::get_artists(&state.pool).await?;

    // Get starred status and ratings for all artists
    let artist_ids: Vec<String> = artists.iter().map(|a| a.id.clone()).collect();
    let starred_map =
        get_starred_map(&state.pool, user.user_id, ItemType::Artist, &artist_ids).await?;
    let ratings_map =
        get_ratings_map(&state.pool, user.user_id, ItemType::Artist, &artist_ids).await?;

    // Group artists by first letter
    let mut grouped: HashMap<String, Vec<ArtistResponse>> = HashMap::new();

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

        let starred = starred_map.get(&artist.id).cloned();
        let user_rating = ratings_map.get(&artist.id).copied();

        grouped.entry(index_name).or_default().push(ArtistResponse {
            id: artist.id.clone(),
            name: artist.name.clone(),
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id),
            cover_art_data: None,
            starred,
            user_rating,
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

    let response = ArtistsResponse {
        artists: ArtistsIndex { index: indexes },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getArtist =====

/// Query params for getArtist endpoint
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArtistParams {
    id: String,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    filter: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistDetailResponse {
    pub artist: ArtistDetail,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistDetail {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub album_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumResponse {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub created: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
}

pub async fn get_artist(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetArtistParams>,
) -> crate::error::Result<FormatResponse<ArtistDetailResponse>> {
    use super::sorting::filter_and_sort_songs;

    let artist = crate::db::queries::get_artist_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Artist {} not found", params.id)))?;

    let albums = crate::db::queries::get_albums_by_artist(&state.pool, &params.id).await?;

    // Get all songs by this artist (track artist, includes songs on compilations)
    let songs = crate::db::queries::get_songs_by_artist(&state.pool, &params.id).await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get starred status and ratings for albums
    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map =
        get_starred_map(&state.pool, user.user_id, ItemType::Album, &album_ids).await?;
    let ratings_map =
        get_ratings_map(&state.pool, user.user_id, ItemType::Album, &album_ids).await?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let song_starred_map =
        get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;
    let song_ratings_map =
        get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

    // Get starred status and rating for the artist itself
    let artist_starred_map = get_starred_map(
        &state.pool,
        user.user_id,
        ItemType::Artist,
        std::slice::from_ref(&params.id),
    )
    .await?;
    let artist_ratings_map = get_ratings_map(
        &state.pool,
        user.user_id,
        ItemType::Artist,
        std::slice::from_ref(&params.id),
    )
    .await?;

    let album_responses: Vec<AlbumResponse> = albums
        .iter()
        .map(|album| AlbumResponse {
            id: album.id.clone(),
            name: album.name.clone(),
            artist: album.artist_name.clone(),
            artist_id: album.artist_id.clone(),
            cover_art: Some(album.id.clone()),
            cover_art_data: None,
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre.clone(),
            created: album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            starred: starred_map.get(&album.id).cloned(),
            user_rating: ratings_map.get(&album.id).copied(),
        })
        .collect();

    // Convert songs to response format
    let song_responses: Vec<SongResponse> = songs
        .iter()
        .map(|song| {
            // Use play stats from the Song model (populated by get_songs_by_artist)
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song
                    .last_played
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
            };
            song_to_response_with_stats(
                song.clone(),
                None, // We don't have album info here, but song has album_id
                song_starred_map.get(&song.id).cloned(),
                song_ratings_map.get(&song.id).copied(),
                Some(play_stats),
                None,
                None,
            )
        })
        .collect();

    let response = ArtistDetailResponse {
        artist: ArtistDetail {
            id: artist.id.clone(),
            name: artist.name,
            album_count: Some(artist.album_count),
            cover_art: Some(artist.id.clone()),
            cover_art_data: None, // Detail endpoints don't use inline thumbnails
            starred: artist_starred_map.get(&artist.id).cloned(),
            user_rating: artist_ratings_map.get(&artist.id).copied(),
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getArtistInfo2 =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistInfoParams {
    id: String,
    #[allow(dead_code)]
    count: Option<u32>,
    #[allow(dead_code)]
    include_not_present: Option<bool>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistInfo2Response {
    pub artist_info2: ArtistInfo2,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ArtistInfo2 {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biography: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music_brainz_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fm_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub medium_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_image_url: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub similar_artist: Vec<ArtistResponse>,
}

pub async fn get_artist_info2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ArtistInfoParams>,
) -> crate::error::Result<FormatResponse<ArtistInfo2Response>> {
    // Verify the artist exists
    let _artist = crate::db::queries::get_artist_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Artist {} not found", params.id)))?;

    // Return empty artist info (we don't fetch external metadata yet)
    // In the future, this could be populated from MusicBrainz, Last.fm, etc.
    let response = ArtistInfo2Response {
        artist_info2: ArtistInfo2 {
            biography: None,
            music_brainz_id: None,
            last_fm_url: None,
            small_image_url: None,
            medium_image_url: None,
            large_image_url: None,
            similar_artist: Vec::new(),
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getAlbum =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumDetailResponse {
    pub album: AlbumDetail,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumDetail {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub artist_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art: Option<String>,
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub created: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub song: Vec<SongResponse>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
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
    /// Base64-encoded JPEG thumbnail (Ferrotune extension, when inlineImages is requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_art_data: Option<String>,
    #[ts(type = "number")]
    pub size: i64,
    pub content_type: String,
    pub suffix: String,
    #[ts(type = "number")]
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<i32>,
    pub path: String,
    /// Full filesystem path (Ferrotune extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_rating: Option<i32>,
    pub created: String,
    #[serde(rename = "type")]
    pub media_type: String,
    // Ferrotune extensions for play statistics
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub play_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<String>,
}

/// Query params for getAlbum endpoint
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAlbumParams {
    id: String,
    /// Sort field for songs: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    sort_dir: Option<String>,
    /// Filter text to match against song title, artist
    #[serde(default)]
    filter: Option<String>,
}

pub async fn get_album(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetAlbumParams>,
) -> crate::error::Result<FormatResponse<AlbumDetailResponse>> {
    use super::sorting::filter_and_sort_songs;

    let album = crate::db::queries::get_album_by_id(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Album {} not found", params.id)))?;

    let songs = crate::db::queries::get_songs_by_album(&state.pool, &params.id).await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, ItemType::Song, &song_ids).await?;

    // Get starred status and rating for the album itself
    let album_starred_map = get_starred_map(
        &state.pool,
        user.user_id,
        ItemType::Album,
        std::slice::from_ref(&params.id),
    )
    .await?;
    let album_ratings_map = get_ratings_map(
        &state.pool,
        user.user_id,
        ItemType::Album,
        std::slice::from_ref(&params.id),
    )
    .await?;

    let song_responses: Vec<SongResponse> = songs
        .iter()
        .map(|song| {
            // Use play stats from the Song model (populated by get_songs_by_album)
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song
                    .last_played
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
            };
            song_to_response_with_stats(
                song.clone(),
                Some(&album),
                starred_map.get(&song.id).cloned(),
                ratings_map.get(&song.id).copied(),
                Some(play_stats),
                None,
                None,
            )
        })
        .collect();

    let album_cover = Some(album.id.clone());

    let response = AlbumDetailResponse {
        album: AlbumDetail {
            id: album.id.clone(),
            name: album.name.clone(),
            artist: album.artist_name.clone(),
            artist_id: album.artist_id.clone(),
            cover_art: album_cover,
            cover_art_data: None, // Detail endpoints don't use inline thumbnails
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre,
            created: album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            starred: album_starred_map.get(&album.id).cloned(),
            user_rating: album_ratings_map.get(&album.id).copied(),
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getSong =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongDetailResponse {
    pub song: SongResponse,
}

pub async fn get_song(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<IdParam>,
) -> crate::error::Result<FormatResponse<SongDetailResponse>> {
    let song_with_folder = crate::db::queries::get_song_by_id_with_folder(&state.pool, &params.id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Song {} not found", params.id)))?;

    let folder_path = song_with_folder.folder_path.clone();
    let song = song_with_folder.into_song();

    // Get album info if available
    let album = if let Some(album_id) = &song.album_id {
        crate::db::queries::get_album_by_id(&state.pool, album_id).await?
    } else {
        None
    };

    // Get starred status and rating
    let starred_map = get_starred_map(
        &state.pool,
        user.user_id,
        ItemType::Song,
        std::slice::from_ref(&params.id),
    )
    .await?;
    let starred = starred_map.get(&params.id).cloned();
    let ratings_map = get_ratings_map(
        &state.pool,
        user.user_id,
        ItemType::Song,
        std::slice::from_ref(&params.id),
    )
    .await?;
    let user_rating = ratings_map.get(&params.id).copied();

    // Get play statistics (Ferrotune extension)
    let play_stats = get_song_play_stats(&state.pool, user.user_id, &params.id).await?;

    let response = SongDetailResponse {
        song: song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            folder_path.as_deref(),
            None,
        ),
    };

    Ok(FormatResponse::new(user.format, response))
}

// ===== getGenres =====

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenresResponse {
    pub genres: GenresList,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenresList {
    pub genre: Vec<GenreResponse>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct GenreResponse {
    #[serde(rename = "value")]
    pub name: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub album_count: i64,
}

pub async fn get_genres(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> crate::error::Result<FormatResponse<GenresResponse>> {
    let genres: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT 
            s.genre,
            COUNT(DISTINCT s.id) as song_count,
            COUNT(DISTINCT s.album_id) as album_count
         FROM songs s
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.genre IS NOT NULL AND mf.enabled = 1
         GROUP BY s.genre 
         ORDER BY s.genre",
    )
    .fetch_all(&state.pool)
    .await?;

    let json_genres: Vec<GenreResponse> = genres
        .into_iter()
        .map(|(name, song_count, album_count)| GenreResponse {
            name,
            song_count,
            album_count,
        })
        .collect();

    let response = GenresResponse {
        genres: GenresList { genre: json_genres },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// Play statistics for a song (Ferrotune extension)
#[derive(Default)]
pub struct SongPlayStats {
    pub play_count: Option<i64>,
    pub last_played: Option<String>,
}
/// Get play statistics for a song from scrobbles table
pub async fn get_song_play_stats(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    song_id: &str,
) -> crate::error::Result<SongPlayStats> {
    let row = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
        r#"
        SELECT 
            COUNT(*) as play_count,
            MAX(played_at) as last_played
        FROM scrobbles
        WHERE user_id = ? AND song_id = ?
        "#,
    )
    .bind(user_id)
    .bind(song_id)
    .fetch_one(pool)
    .await?;

    // Convert zero play count to None (never played)
    let (play_count, last_played) = if row.0 == Some(0) {
        (None, None)
    } else {
        (row.0, row.1)
    };

    Ok(SongPlayStats {
        play_count,
        last_played,
    })
}

// Helper function to convert Song model to API response
pub fn song_to_response(
    song: Song,
    album: Option<&Album>,
    starred: Option<String>,
    user_rating: Option<i32>,
) -> SongResponse {
    song_to_response_with_stats(song, album, starred, user_rating, None, None, None)
}

// Helper function to convert Song model to API response with optional play stats and folder path
pub fn song_to_response_with_stats(
    song: Song,
    album: Option<&Album>,
    starred: Option<String>,
    user_rating: Option<i32>,
    play_stats: Option<SongPlayStats>,
    folder_path: Option<&str>,
    cover_art_data: Option<String>,
) -> SongResponse {
    let content_type = match song.file_format.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };

    // Use song's artist name, fall back to album artist if empty
    let artist = if song.artist_name.is_empty() {
        album
            .map(|a| a.artist_name.clone())
            .unwrap_or_else(|| "Unknown Artist".to_string())
    } else {
        song.artist_name.clone()
    };

    let (play_count, last_played) = play_stats
        .map(|s| (s.play_count, s.last_played))
        .unwrap_or((None, None));

    // Use album ID for cover art (prefer album object, fall back to song's album_id, then song id)
    let cover_art = album
        .map(|a| a.id.clone())
        .or_else(|| song.album_id.clone())
        .unwrap_or_else(|| song.id.clone());

    // Use album name from Album object if provided, otherwise use song's album_name field
    let album_name = album
        .map(|a| a.name.clone())
        .or_else(|| song.album_name.clone());

    SongResponse {
        id: song.id.clone(),
        title: song.title,
        album: album_name,
        album_id: song.album_id,
        artist,
        artist_id: song.artist_id,
        track: song.track_number,
        disc_number: Some(song.disc_number),
        year: song.year,
        genre: song.genre,
        cover_art: Some(cover_art),
        cover_art_data,
        size: song.file_size,
        content_type: content_type.to_string(),
        suffix: song.file_format.clone(),
        duration: song.duration,
        bit_rate: song.bitrate,
        path: song.file_path.clone(),
        full_path: folder_path.map(|fp| format!("{}/{}", fp, song.file_path)),
        starred,
        user_rating,
        created: song.created_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        media_type: "music".to_string(),
        play_count,
        last_played,
    }
}

/// Get starred timestamps for multiple items of a given type for a user
pub async fn get_starred_map(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    item_type: crate::db::models::ItemType,
    item_ids: &[String],
) -> crate::error::Result<std::collections::HashMap<String, String>> {
    if item_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    // Build placeholders for the IN clause
    let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, chrono::DateTime<chrono::Utc>)>(&query)
        .bind(user_id)
        .bind(item_type.as_str());

    for id in item_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, chrono::DateTime<chrono::Utc>)> =
        query_builder.fetch_all(pool).await?;

    Ok(results
        .into_iter()
        .map(|(id, ts)| (id, ts.format("%Y-%m-%dT%H:%M:%SZ").to_string()))
        .collect())
}

/// Get ratings for multiple items of a given type for a user
pub async fn get_ratings_map(
    pool: &sqlx::SqlitePool,
    user_id: i64,
    item_type: crate::db::models::ItemType,
    item_ids: &[String],
) -> crate::error::Result<std::collections::HashMap<String, i32>> {
    if item_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    // Build placeholders for the IN clause
    let placeholders: Vec<&str> = item_ids.iter().map(|_| "?").collect();
    let query = format!(
        "SELECT item_id, rating FROM ratings WHERE user_id = ? AND item_type = ? AND item_id IN ({})",
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query_as::<_, (String, i32)>(&query)
        .bind(user_id)
        .bind(item_type.as_str());

    for id in item_ids {
        query_builder = query_builder.bind(id);
    }

    let results: Vec<(String, i32)> = query_builder.fetch_all(pool).await?;

    Ok(results.into_iter().collect())
}
