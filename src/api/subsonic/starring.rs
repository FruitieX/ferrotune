use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{song_to_response, AlbumResponse, ArtistResponse, SongResponse};
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::string_or_seq;
use crate::api::AppState;
use crate::api::QsQuery;
use crate::error::Result;
use axum::extract::State;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
pub struct StarParams {
    #[serde(default, deserialize_with = "string_or_seq")]
    id: Vec<String>,
    #[serde(default, rename = "albumId", deserialize_with = "string_or_seq")]
    album_id: Vec<String>,
    #[serde(default, rename = "artistId", deserialize_with = "string_or_seq")]
    artist_id: Vec<String>,
}

pub async fn star(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    let now = Utc::now();

    // Star songs
    for id in &params.id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'song', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    // Star albums
    for id in &params.album_id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'album', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    // Star artists
    for id in &params.artist_id {
        sqlx::query(
            "INSERT OR IGNORE INTO starred (user_id, item_type, item_id, starred_at) 
             VALUES (?, 'artist', ?, ?)",
        )
        .bind(user.user_id)
        .bind(id)
        .bind(now)
        .execute(&state.pool)
        .await?;
    }

    Ok(format_ok_empty(user.format))
}

pub async fn unstar(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<StarParams>,
) -> Result<impl axum::response::IntoResponse> {
    // Unstar songs
    for id in &params.id {
        sqlx::query("DELETE FROM starred WHERE user_id = ? AND item_type = 'song' AND item_id = ?")
            .bind(user.user_id)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }

    // Unstar albums
    for id in &params.album_id {
        sqlx::query(
            "DELETE FROM starred WHERE user_id = ? AND item_type = 'album' AND item_id = ?",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    }

    // Unstar artists
    for id in &params.artist_id {
        sqlx::query(
            "DELETE FROM starred WHERE user_id = ? AND item_type = 'artist' AND item_id = ?",
        )
        .bind(user.user_id)
        .bind(id)
        .execute(&state.pool)
        .await?;
    }

    Ok(format_ok_empty(user.format))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starred2Response {
    pub starred2: Starred2Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarredResponse {
    pub starred: Starred2Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Starred2Content {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub artist: Vec<ArtistResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub album: Vec<AlbumResponse>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub song: Vec<SongResponse>,
}

/// Helper to fetch starred content (shared by getStarred and getStarred2)
async fn fetch_starred_content(
    pool: &sqlx::SqlitePool,
    user_id: i64,
) -> Result<(Vec<ArtistResponse>, Vec<AlbumResponse>, Vec<SongResponse>)> {
    // Get starred artists
    let starred_artist_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut artist_responses = Vec::new();
    for id in starred_artist_ids {
        if let Some(artist) = crate::db::queries::get_artist_by_id(pool, &id).await? {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                cover_art: Some(artist.id),
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

    let mut album_responses = Vec::new();
    for id in starred_album_ids {
        if let Some(album) = crate::db::queries::get_album_by_id(pool, &id).await? {
            let created = album
                .created_at
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string();
            album_responses.push(AlbumResponse {
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
    }

    // Get starred songs
    let starred_song_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred WHERE user_id = ? AND item_type = 'song' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut song_responses = Vec::new();
    for id in starred_song_ids {
        if let Some(song) = crate::db::queries::get_song_by_id(pool, &id).await? {
            let album = if let Some(album_id) = &song.album_id {
                crate::db::queries::get_album_by_id(pool, album_id).await?
            } else {
                None
            };
            song_responses.push(song_to_response(song, album.as_ref()));
        }
    }

    Ok((artist_responses, album_responses, song_responses))
}

pub async fn get_starred2(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<Starred2Response>> {
    let (artist_responses, album_responses, song_responses) =
        fetch_starred_content(&state.pool, user.user_id).await?;

    let response = Starred2Response {
        starred2: Starred2Content {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}

/// GET /rest/getStarred - Old API, returns same as getStarred2 but with different wrapper
pub async fn get_starred(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
) -> Result<FormatResponse<StarredResponse>> {
    let (artist_responses, album_responses, song_responses) =
        fetch_starred_content(&state.pool, user.user_id).await?;

    let response = StarredResponse {
        starred: Starred2Content {
            artist: artist_responses,
            album: album_responses,
            song: song_responses,
        },
    };

    Ok(FormatResponse::new(user.format, response))
}
