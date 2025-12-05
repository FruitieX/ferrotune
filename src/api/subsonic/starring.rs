use crate::api::first_string_or_none;
use crate::api::string_or_seq;
use crate::api::subsonic::auth::AuthenticatedUser;
use crate::api::subsonic::browse::{get_ratings_map, AlbumResponse, ArtistResponse, SongResponse};
use crate::api::subsonic::query::first_i32;
use crate::api::subsonic::response::{format_ok_empty, FormatResponse};
use crate::api::AppState;
use crate::api::QsQuery;
use crate::error::Result;
use axum::extract::State;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use ts_rs::TS;

#[derive(Deserialize)]
pub struct RatingParams {
    #[serde(default, deserialize_with = "first_string_or_none")]
    id: Option<String>,
    #[serde(deserialize_with = "first_i32")]
    rating: i32,
}

pub async fn set_rating(
    user: AuthenticatedUser,
    State(state): State<Arc<AppState>>,
    QsQuery(params): QsQuery<RatingParams>,
) -> Result<impl axum::response::IntoResponse> {
    let id = params.id.ok_or_else(|| {
        crate::error::Error::InvalidRequest("Missing required parameter: id".to_string())
    })?;

    if params.rating < 0 || params.rating > 5 {
        return Err(crate::error::Error::InvalidRequest(
            "Rating must be between 0 and 5".to_string(),
        ));
    }

    // Determine item type by checking which table contains this ID
    let item_type = if crate::db::queries::get_song_by_id(&state.pool, &id)
        .await?
        .is_some()
    {
        "song"
    } else if crate::db::queries::get_album_by_id(&state.pool, &id)
        .await?
        .is_some()
    {
        "album"
    } else if crate::db::queries::get_artist_by_id(&state.pool, &id)
        .await?
        .is_some()
    {
        "artist"
    } else {
        return Err(crate::error::Error::NotFound(format!(
            "Item {} not found",
            id
        )));
    };

    if params.rating == 0 {
        // Remove rating
        sqlx::query("DELETE FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?")
            .bind(user.user_id)
            .bind(item_type)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    } else {
        // Insert or update rating
        sqlx::query(
            "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at) 
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET rating = ?, rated_at = ?",
        )
        .bind(user.user_id)
        .bind(item_type)
        .bind(&id)
        .bind(params.rating)
        .bind(Utc::now())
        .bind(params.rating)
        .bind(Utc::now())
        .execute(&state.pool)
        .await?;
    }

    Ok(format_ok_empty(user.format))
}

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

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct Starred2Response {
    pub starred2: Starred2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct StarredResponse {
    pub starred: Starred2Content,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
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
    // Get starred artists with their starred_at timestamps
    let starred_artists: Vec<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'artist' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Get ratings for starred artists
    let artist_ids: Vec<String> = starred_artists.iter().map(|(id, _)| id.clone()).collect();
    let artist_ratings = get_ratings_map(pool, user_id, "artist", &artist_ids).await?;

    let mut artist_responses = Vec::new();
    for (id, starred_at) in starred_artists {
        if let Some(artist) = crate::db::queries::get_artist_by_id(pool, &id).await? {
            artist_responses.push(ArtistResponse {
                id: artist.id.clone(),
                name: artist.name,
                album_count: Some(artist.album_count),
                cover_art: Some(artist.id.clone()),
                starred: Some(starred_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                user_rating: artist_ratings.get(&artist.id).copied(),
            });
        }
    }

    // Get starred albums with their starred_at timestamps
    let starred_albums: Vec<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT item_id, starred_at FROM starred WHERE user_id = ? AND item_type = 'album' ORDER BY starred_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Get ratings for starred albums
    let album_ids: Vec<String> = starred_albums.iter().map(|(id, _)| id.clone()).collect();
    let album_ratings = get_ratings_map(pool, user_id, "album", &album_ids).await?;

    let mut album_responses = Vec::new();
    for (id, starred_at) in starred_albums {
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
                cover_art: Some(album.id.clone()),
                song_count: album.song_count,
                duration: album.duration,
                year: album.year,
                genre: album.genre,
                created,
                starred: Some(starred_at.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
                user_rating: album_ratings.get(&album.id).copied(),
            });
        }
    }

    // Get starred songs with play counts via join
    let starred_songs: Vec<crate::db::models::Song> = sqlx::query_as(
        r#"SELECT s.id, s.title, s.album_id, al.name as album_name, s.artist_id, ar.name as artist_name,
                  s.track_number, s.disc_number, s.year, s.genre, s.duration,
                  s.bitrate, s.file_path, s.file_size, s.file_format, 
                  s.created_at, s.updated_at,
                  pc.play_count,
                  pc.last_played,
                  st.starred_at
           FROM starred st
           INNER JOIN songs s ON st.item_id = s.id
           INNER JOIN artists ar ON s.artist_id = ar.id
           LEFT JOIN albums al ON s.album_id = al.id
           LEFT JOIN (
               SELECT song_id, COUNT(*) as play_count, MAX(played_at) as last_played
               FROM scrobbles WHERE submission = 1
               GROUP BY song_id
           ) pc ON s.id = pc.song_id
           WHERE st.user_id = ? AND st.item_type = 'song'
           ORDER BY st.starred_at DESC"#
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Get ratings for starred songs
    let song_ids: Vec<String> = starred_songs.iter().map(|s| s.id.clone()).collect();
    let song_ratings = get_ratings_map(pool, user_id, "song", &song_ids).await?;

    use crate::api::subsonic::browse::{song_to_response_with_stats, SongPlayStats};
    let mut song_responses = Vec::new();
    for song in starred_songs {
        let song_id = song.id.clone();
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(pool, album_id).await?
        } else {
            None
        };
        let starred = song
            .starred_at
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
        let user_rating = song_ratings.get(&song_id).copied();
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
