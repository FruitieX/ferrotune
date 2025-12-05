use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{
    get_ratings_map, get_starred_map, song_to_response, AlbumResponse, SongResponse,
};
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

/// Album list types for getAlbumList2
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub enum AlbumListType {
    Random,
    Newest,
    Highest,
    Frequent,
    Recent,
    Starred,
    AlphabeticalByName,
    AlphabeticalByArtist,
    ByYear,
    ByGenre,
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumListParams {
    /// List type (serializes as "type" for API compatibility)
    #[serde(rename = "type")]
    pub list_type: AlbumListType,
    pub size: Option<u32>,
    pub offset: Option<u32>,
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
    pub genre: Option<String>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumList2Response {
    pub album_list2: AlbumList2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct AlbumList2Content {
    pub album: Vec<AlbumResponse>,
    /// Total count of albums (Ferrotune extension for pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub total: Option<i64>,
}

pub async fn get_album_list2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AlbumListParams>,
) -> Result<FormatResponse<AlbumList2Response>> {
    let size = params.size.unwrap_or(10).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let albums: Vec<crate::db::models::Album> = match params.list_type {
        AlbumListType::Random => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 ORDER BY RANDOM() 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::Newest => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 ORDER BY a.created_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::Highest => {
            // Would need rating system
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 ORDER BY a.name 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::Frequent => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 LEFT JOIN scrobbles sc ON sc.song_id IN (SELECT id FROM songs WHERE album_id = a.id)
                 GROUP BY a.id 
                 ORDER BY COUNT(sc.id) DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::Recent => {
            sqlx::query_as(
                "SELECT DISTINCT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN songs s ON s.album_id = a.id 
                 INNER JOIN scrobbles sc ON sc.song_id = s.id 
                 ORDER BY sc.played_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::Starred => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' 
                 ORDER BY st.starred_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::AlphabeticalByName => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 ORDER BY a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::AlphabeticalByArtist => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 ORDER BY ar.name COLLATE NOCASE, a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::ByYear => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE (? IS NULL OR a.year >= ?) AND (? IS NULL OR a.year <= ?)
                 ORDER BY a.year DESC, a.name 
                 LIMIT ? OFFSET ?"
            )
            .bind(params.from_year)
            .bind(params.from_year)
            .bind(params.to_year)
            .bind(params.to_year)
            .bind(size)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        AlbumListType::ByGenre => {
            if let Some(ref genre) = params.genre {
                sqlx::query_as(
                    "SELECT a.*, ar.name as artist_name 
                     FROM albums a 
                     INNER JOIN artists ar ON a.artist_id = ar.id 
                     WHERE a.genre = ? 
                     ORDER BY a.name 
                     LIMIT ? OFFSET ?"
                )
                .bind(genre)
                .bind(size)
                .bind(offset)
                .fetch_all(&state.pool)
                .await?
            } else {
                Vec::new()
            }
        }
    };

    // Get total count for pagination (only for list types that support it)
    let total: Option<i64> = match params.list_type {
        AlbumListType::AlphabeticalByName
        | AlbumListType::AlphabeticalByArtist
        | AlbumListType::Newest
        | AlbumListType::Highest
        | AlbumListType::Frequent => {
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM albums")
                .fetch_one(&state.pool)
                .await?;
            Some(count.0)
        }
        AlbumListType::Starred => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM starred WHERE item_type = 'album' AND user_id = ?",
            )
            .bind(user.user_id)
            .fetch_one(&state.pool)
            .await?;
            Some(count.0)
        }
        AlbumListType::ByGenre => {
            if let Some(ref genre) = params.genre {
                let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM albums WHERE genre = ?")
                    .bind(genre)
                    .fetch_one(&state.pool)
                    .await?;
                Some(count.0)
            } else {
                None
            }
        }
        AlbumListType::ByYear => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM albums 
                 WHERE (? IS NULL OR year >= ?) AND (? IS NULL OR year <= ?)",
            )
            .bind(params.from_year)
            .bind(params.from_year)
            .bind(params.to_year)
            .bind(params.to_year)
            .fetch_one(&state.pool)
            .await?;
            Some(count.0)
        }
        AlbumListType::Random | AlbumListType::Recent => None, // random, recent don't need total
    };

    // Get starred status and ratings for albums
    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "album", &album_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "album", &album_ids).await?;

    let album_responses: Vec<AlbumResponse> = albums
        .into_iter()
        .map(|album| AlbumResponse {
            id: album.id.clone(),
            name: album.name,
            artist: album.artist_name,
            artist_id: album.artist_id,
            cover_art: Some(album.id.clone()),
            song_count: album.song_count,
            duration: album.duration,
            year: album.year,
            genre: album.genre,
            created: album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
            starred: starred_map.get(&album.id).cloned(),
            user_rating: ratings_map.get(&album.id).copied(),
        })
        .collect();

    let response = AlbumList2Response {
        album_list2: AlbumList2Content {
            album: album_responses,
            total,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsParams {
    pub size: Option<u32>,
    pub genre: Option<String>,
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsResponse {
    pub random_songs: RandomSongsContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct RandomSongsContent {
    pub song: Vec<SongResponse>,
}

pub async fn get_random_songs(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<RandomSongsParams>,
) -> Result<FormatResponse<RandomSongsResponse>> {
    let size = params.size.unwrap_or(10).min(500) as i64;

    // Use parameterized queries to prevent SQL injection
    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE (? IS NULL OR s.genre = ?)
           AND (? IS NULL OR s.year >= ?)
           AND (? IS NULL OR s.year <= ?)
         ORDER BY RANDOM() 
         LIMIT ?",
    )
    .bind(&params.genre)
    .bind(&params.genre)
    .bind(params.from_year)
    .bind(params.from_year)
    .bind(params.to_year)
    .bind(params.to_year)
    .bind(size)
    .fetch_all(&state.pool)
    .await?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        song_responses.push(song_to_response(song, album.as_ref(), starred, user_rating));
    }

    let response = RandomSongsResponse {
        random_songs: RandomSongsContent {
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

// getSongsByGenre endpoint
#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreParams {
    pub genre: String,
    pub count: Option<u32>,
    pub offset: Option<u32>,
    #[ts(type = "number | null")]
    pub music_folder_id: Option<i64>,
    /// Sort field: name, artist, album, year, dateAdded, playCount, duration, custom
    #[serde(default)]
    pub sort: Option<String>,
    /// Sort direction: asc or desc
    #[serde(default)]
    pub sort_dir: Option<String>,
    /// Filter text to match against song title, artist, album
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreResponse {
    pub songs_by_genre: SongsByGenreContent,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct SongsByGenreContent {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

pub async fn get_songs_by_genre(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<SongsByGenreParams>,
) -> Result<FormatResponse<SongsByGenreResponse>> {
    use super::sorting::filter_and_sort_songs;

    let count = params.count.unwrap_or(10).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         WHERE s.genre = ?
         ORDER BY s.title COLLATE NOCASE
         LIMIT ? OFFSET ?",
    )
    .bind(&params.genre)
    .bind(count)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(
        songs,
        params.filter.as_deref(),
        params.sort.as_deref(),
        params.sort_dir.as_deref(),
    );

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(&state.pool, user.user_id, "song", &song_ids).await?;
    let ratings_map = get_ratings_map(&state.pool, user.user_id, "song", &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        song_responses.push(song_to_response(song, album.as_ref(), starred, user_rating));
    }

    let response = SongsByGenreResponse {
        songs_by_genre: SongsByGenreContent {
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

#[derive(Deserialize)]
pub struct ScrobbleParams {
    id: String,
    time: Option<i64>,
    submission: Option<bool>,
}

pub async fn scrobble(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ScrobbleParams>,
) -> Result<impl axum::response::IntoResponse> {
    let submission = params.submission.unwrap_or(true);
    let played_at = if let Some(timestamp) = params.time {
        chrono::DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now)
    } else {
        Utc::now()
    };

    sqlx::query(
        "INSERT INTO scrobbles (user_id, song_id, played_at, submission) 
         VALUES (?, ?, ?, ?)",
    )
    .bind(user.user_id)
    .bind(&params.id)
    .bind(played_at)
    .bind(submission)
    .execute(&state.pool)
    .await?;

    Ok(format_ok_empty(user.format))
}
