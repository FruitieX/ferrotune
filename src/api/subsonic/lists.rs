use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{song_to_response, AlbumResponse, SongResponse};
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::error::Result;
use axum::extract::{Query, State};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumListParams {
    #[serde(rename = "type")]
    list_type: String,
    size: Option<u32>,
    offset: Option<u32>,
    from_year: Option<i32>,
    to_year: Option<i32>,
    genre: Option<String>,
    music_folder_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumList2Response {
    pub album_list2: AlbumList2Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumList2Content {
    pub album: Vec<AlbumResponse>,
}

pub async fn get_album_list2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<AlbumListParams>,
) -> Result<FormatResponse<AlbumList2Response>> {
    let size = params.size.unwrap_or(10).min(500) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let albums: Vec<crate::db::models::Album> = match params.list_type.as_str() {
        "random" => {
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
        "newest" => {
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
        "highest" => {
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
        "frequent" => {
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
        "recent" => {
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
        "starred" => {
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
        "alphabeticalByName" => {
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
        "alphabeticalByArtist" => {
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
        "byYear" => {
            let mut query = "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE 1=1".to_string();

            if let Some(from_year) = params.from_year {
                query.push_str(&format!(" AND a.year >= {}", from_year));
            }
            if let Some(to_year) = params.to_year {
                query.push_str(&format!(" AND a.year <= {}", to_year));
            }

            query.push_str(" ORDER BY a.year DESC, a.name LIMIT ? OFFSET ?");

            sqlx::query_as(&query)
                .bind(size)
                .bind(offset)
                .fetch_all(&state.pool)
                .await?
        }
        "byGenre" => {
            if let Some(genre) = params.genre {
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
        _ => Vec::new(),
    };

    let album_responses: Vec<AlbumResponse> = albums
        .into_iter()
        .map(|album| AlbumResponse {
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
        })
        .collect();

    let response = AlbumList2Response {
        album_list2: AlbumList2Content { album: album_responses },
    };

    Ok(FormatResponse::new(user.format, response))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomSongsParams {
    size: Option<u32>,
    genre: Option<String>,
    from_year: Option<i32>,
    to_year: Option<i32>,
    music_folder_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomSongsResponse {
    pub random_songs: RandomSongsContent,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomSongsContent {
    pub song: Vec<SongResponse>,
}

pub async fn get_random_songs(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<RandomSongsParams>,
) -> Result<FormatResponse<RandomSongsResponse>> {
    let size = params.size.unwrap_or(10).min(500) as i64;

    let mut query = "SELECT * FROM songs WHERE 1=1".to_string();

    if let Some(genre) = params.genre {
        query.push_str(&format!(" AND genre = '{}'", genre.replace('\'', "''")));
    }
    if let Some(from_year) = params.from_year {
        query.push_str(&format!(" AND year >= {}", from_year));
    }
    if let Some(to_year) = params.to_year {
        query.push_str(&format!(" AND year <= {}", to_year));
    }

    query.push_str(" ORDER BY RANDOM() LIMIT ?");

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(&query)
        .bind(size)
        .fetch_all(&state.pool)
        .await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(&state.pool, album_id).await?
        } else {
            None
        };

        song_responses.push(song_to_response(song, album.as_ref()));
    }

    let response = RandomSongsResponse {
        random_songs: RandomSongsContent { song: song_responses },
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
