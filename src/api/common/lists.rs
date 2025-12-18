use crate::api::common::browse::{get_song_play_stats, song_to_response_with_stats};
use crate::api::common::models::{AlbumResponse, SongResponse};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::subsonic::inline_thumbnails::get_album_thumbnails_base64;
use crate::db::models::ItemType;
use crate::thumbnails::ThumbnailSize;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

/// Album list types
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

pub struct AlbumListResult {
    pub albums: Vec<AlbumResponse>,
    pub total: Option<i64>,
}

#[allow(clippy::too_many_arguments)]
pub async fn get_album_list_logic(
    pool: &SqlitePool,
    user_id: i64,
    list_type: AlbumListType,
    size: i64,
    offset: i64,
    from_year: Option<i32>,
    to_year: Option<i32>,
    genre: Option<String>,
    inline_image_size: Option<ThumbnailSize>,
) -> crate::error::Result<AlbumListResult> {
    let size = size.min(500);

    let albums: Vec<crate::db::models::Album> = match list_type {
        AlbumListType::Random => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY RANDOM() 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::Newest => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY a.created_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::Highest => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY a.name 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::Frequent => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 LEFT JOIN scrobbles sc ON sc.song_id IN (SELECT id FROM songs WHERE album_id = a.id)
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 GROUP BY a.id 
                 ORDER BY COUNT(sc.id) DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::Recent => {
            sqlx::query_as(
                "SELECT DISTINCT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN songs s ON s.album_id = a.id 
                 INNER JOIN music_folders mf ON s.music_folder_id = mf.id
                 INNER JOIN scrobbles sc ON sc.song_id = s.id 
                 WHERE mf.enabled = 1
                 ORDER BY sc.played_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::Starred => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 INNER JOIN starred st ON st.item_id = a.id AND st.item_type = 'album' 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY st.starred_at DESC 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::AlphabeticalByName => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::AlphabeticalByArtist => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                 ORDER BY ar.name COLLATE NOCASE, a.name COLLATE NOCASE 
                 LIMIT ? OFFSET ?"
            )
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::ByYear => {
            sqlx::query_as(
                "SELECT a.*, ar.name as artist_name 
                 FROM albums a 
                 INNER JOIN artists ar ON a.artist_id = ar.id 
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                   AND (? IS NULL OR a.year >= ?) AND (? IS NULL OR a.year <= ?)
                 ORDER BY a.year DESC, a.name 
                 LIMIT ? OFFSET ?"
            )
            .bind(from_year)
            .bind(from_year)
            .bind(to_year)
            .bind(to_year)
            .bind(size)
            .bind(offset)
            .fetch_all(pool)
            .await?
        }
        AlbumListType::ByGenre => {
             if let Some(ref g) = genre {
                sqlx::query_as(
                    "SELECT a.*, ar.name as artist_name 
                     FROM albums a 
                     INNER JOIN artists ar ON a.artist_id = ar.id 
                     WHERE a.genre = ? 
                       AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                     ORDER BY a.name 
                     LIMIT ? OFFSET ?"
                )
                .bind(g)
                .bind(size)
                .bind(offset)
                .fetch_all(pool)
                .await?
            } else {
                Vec::new()
            }
        }
    };

    // Calculate total if needed (for pagination)
    let total: Option<i64> = match list_type {
        AlbumListType::AlphabeticalByName
        | AlbumListType::AlphabeticalByArtist
        | AlbumListType::Newest
        | AlbumListType::Highest
        | AlbumListType::Frequent => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM albums a WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)"
            )
                .fetch_one(pool)
                .await?;
            Some(count.0)
        }
        AlbumListType::Starred => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM starred st INNER JOIN albums a ON st.item_id = a.id 
                 WHERE st.item_type = 'album' AND st.user_id = ?
                   AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)",
            )
            .bind(user_id)
            .fetch_one(pool)
            .await?;
            Some(count.0)
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                let count: (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM albums a WHERE a.genre = ? AND EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)"
                )
                    .bind(g)
                    .fetch_one(pool)
                    .await?;
                Some(count.0)
            } else {
                None
            }
        }
        AlbumListType::ByYear => {
            let count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM albums a
                 WHERE EXISTS (SELECT 1 FROM songs s JOIN music_folders mf ON s.music_folder_id = mf.id WHERE s.album_id = a.id AND mf.enabled = 1)
                   AND (? IS NULL OR a.year >= ?) AND (? IS NULL OR a.year <= ?)",
            )
            .bind(from_year)
            .bind(from_year)
            .bind(to_year)
            .bind(to_year)
            .fetch_one(pool)
            .await?;
            Some(count.0)
        }
        AlbumListType::Random | AlbumListType::Recent => None,
    };

    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Album, &album_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Album, &album_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_image_size {
        get_album_thumbnails_base64(pool, &album_ids, size).await
    } else {
        std::collections::HashMap::new()
    };

    let album_responses: Vec<AlbumResponse> = albums
        .into_iter()
        .map(|album| AlbumResponse {
            id: album.id.clone(),
            name: album.name,
            artist: album.artist_name,
            artist_id: album.artist_id,
            cover_art: Some(album.id.clone()),
            cover_art_data: thumbnails.get(&album.id).cloned(),
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

    Ok(AlbumListResult {
        albums: album_responses,
        total,
    })
}

pub async fn get_random_songs_logic(
    pool: &SqlitePool,
    user_id: i64,
    size: i64,
    genre: Option<String>,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> crate::error::Result<Vec<SongResponse>> {
    let size = size.min(500);

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE mf.enabled = 1
           AND (? IS NULL OR s.genre = ?)
           AND (? IS NULL OR s.year >= ?)
           AND (? IS NULL OR s.year <= ?)
         ORDER BY RANDOM() 
         LIMIT ?",
    )
    .bind(&genre)
    .bind(&genre)
    .bind(from_year)
    .bind(from_year)
    .bind(to_year)
    .bind(to_year)
    .bind(size)
    .fetch_all(pool)
    .await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(pool, album_id).await?
        } else {
            None
        };

        // For random songs we might want stats too? Subsonic version called `get_song_play_stats`.
        let play_stats = get_song_play_stats(pool, user_id, &song.id).await?;

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();

        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            None,
        ));
    }

    Ok(song_responses)
}

#[allow(clippy::too_many_arguments)]
pub async fn get_songs_by_genre_logic(
    pool: &SqlitePool,
    user_id: i64,
    genre: &str,
    count: i64,
    offset: i64,
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> crate::error::Result<Vec<SongResponse>> {
    use crate::api::common::sorting::filter_and_sort_songs;

    let count = count.min(500);

    let songs: Vec<crate::db::models::Song> = sqlx::query_as(
        "SELECT s.*, ar.name as artist_name, al.name as album_name 
         FROM songs s 
         INNER JOIN artists ar ON s.artist_id = ar.id 
         LEFT JOIN albums al ON s.album_id = al.id
         INNER JOIN music_folders mf ON s.music_folder_id = mf.id
         WHERE s.genre = ? AND mf.enabled = 1
         ORDER BY s.title COLLATE NOCASE
         LIMIT ? OFFSET ?",
    )
    .bind(genre)
    .bind(count)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(songs, filter, sort, sort_dir);

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::queries::get_album_by_id(pool, album_id).await?
        } else {
            None
        };

        let play_stats = get_song_play_stats(pool, user_id, &song.id).await?;

        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            None,
        ));
    }

    Ok(song_responses)
}
