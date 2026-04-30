use crate::api::common::browse::{get_song_play_stats, song_to_response_with_stats};
use crate::api::common::models::{AlbumResponse, SongResponse};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::ferrotune::smart_playlists::get_smart_playlist_songs_by_id;
use crate::api::subsonic::inline_thumbnails::{
    get_album_thumbnails_base64, get_song_thumbnails_base64,
};
use crate::db::models::ItemType;
use crate::db::repo::lists as lists_repo;
use crate::thumbnails::ThumbnailSize;
use chrono::{DateTime, Utc};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
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
    /// Random seed used for the Random list type (for reproducible ordering)
    pub seed: Option<i64>,
}

async fn fetch_albums_by_ids_in_order(
    database: &crate::db::Database,
    album_ids: &[String],
) -> crate::error::Result<Vec<crate::db::models::Album>> {
    lists_repo::fetch_albums_by_ids_in_order(database, album_ids).await
}

#[allow(clippy::too_many_arguments)]
pub async fn get_album_list_logic(
    database: &crate::db::Database,
    user_id: i64,
    list_type: AlbumListType,
    size: i64,
    offset: i64,
    from_year: Option<i32>,
    to_year: Option<i32>,
    genre: Option<String>,
    inline_image_size: Option<ThumbnailSize>,
    since: Option<String>,
    seed: Option<i64>,
) -> crate::error::Result<AlbumListResult> {
    let size = size.min(500);
    let mut result_seed: Option<i64> = None;
    // For the Recent list, capture (album_id -> last_played) from the repo so
    // we can populate the `played` field without a second query.
    let mut recent_played_map: std::collections::HashMap<String, DateTime<Utc>> =
        std::collections::HashMap::new();

    let albums: Vec<crate::db::models::Album> = match list_type {
        AlbumListType::Random => {
            // Use Rust-side Fisher-Yates shuffle with a deterministic seed
            // so that pagination returns consistent results and the client
            // can reproduce the same order for queue materialization.
            // Constrain seed to JS Number.MAX_SAFE_INTEGER to avoid precision loss during JSON round-trip
            let actual_seed =
                seed.unwrap_or_else(|| rand::thread_rng().gen_range(0..=9_007_199_254_740_991i64));
            result_seed = Some(actual_seed);

            let mut ids = lists_repo::visible_album_ids_for_user(database, user_id).await?;

            // Shuffle deterministically using the seed
            let mut rng = StdRng::seed_from_u64(actual_seed as u64);
            ids.shuffle(&mut rng);

            // Slice for pagination
            let start = (offset as usize).min(ids.len());
            let end = (start + size as usize).min(ids.len());
            let page_ids = &ids[start..end];

            if page_ids.is_empty() {
                Vec::new()
            } else {
                fetch_albums_by_ids_in_order(database, page_ids).await?
            }
        }
        AlbumListType::Newest => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_newest(database, user_id, size, offset).await?,
            )
            .await?
        }
        AlbumListType::Highest => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_name(database, user_id, size, offset)
                    .await?,
            )
            .await?
        }
        AlbumListType::Frequent => {
            let since_dt: Option<DateTime<Utc>> = since
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let ids =
                lists_repo::list_frequent_album_ids(database, user_id, size, offset, since_dt)
                    .await?;
            fetch_albums_by_ids_in_order(database, &ids).await?
        }
        AlbumListType::Recent => {
            let recent =
                lists_repo::list_recent_albums_for_user(database, user_id, size, offset).await?;
            let ids: Vec<String> = recent.iter().map(|r| r.album_id.clone()).collect();
            recent_played_map = recent
                .iter()
                .map(|r| (r.album_id.clone(), r.last_played))
                .collect();
            fetch_albums_by_ids_in_order(database, &ids).await?
        }
        AlbumListType::Starred => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_starred_album_ids(database, user_id, size, offset).await?,
            )
            .await?
        }
        AlbumListType::AlphabeticalByName => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_name(database, user_id, size, offset)
                    .await?,
            )
            .await?
        }
        AlbumListType::AlphabeticalByArtist => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_artist(database, user_id, size, offset)
                    .await?,
            )
            .await?
        }
        AlbumListType::ByYear => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_by_year(
                    database, user_id, size, offset, from_year, to_year,
                )
                .await?,
            )
            .await?
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                fetch_albums_by_ids_in_order(
                    database,
                    &lists_repo::list_album_ids_by_genre(database, user_id, size, offset, g)
                        .await?,
                )
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
        | AlbumListType::Frequent => Some(
            lists_repo::count_visible_albums_for_user(database, user_id, None, None, None).await?,
        ),
        AlbumListType::Starred => {
            Some(lists_repo::count_starred_albums_for_user(database, user_id).await?)
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                Some(
                    lists_repo::count_visible_albums_for_user(
                        database,
                        user_id,
                        Some(g),
                        None,
                        None,
                    )
                    .await?,
                )
            } else {
                None
            }
        }
        AlbumListType::ByYear => Some(
            lists_repo::count_visible_albums_for_user(database, user_id, None, from_year, to_year)
                .await?,
        ),
        AlbumListType::Random => Some(
            lists_repo::count_visible_albums_for_user(database, user_id, None, None, None).await?,
        ),
        AlbumListType::Recent => {
            Some(lists_repo::count_recent_albums_for_user(database, user_id).await?)
        }
    };

    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Album, &album_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Album, &album_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(size) = inline_image_size {
        get_album_thumbnails_base64(database, &album_ids, size).await
    } else {
        std::collections::HashMap::new()
    };

    // Get last played timestamps for "recent" list type (already captured
    // above when the Recent list was fetched).
    let played_map: std::collections::HashMap<String, String> = recent_played_map
        .into_iter()
        .map(|(id, dt)| (id, format_datetime_iso_ms(dt)))
        .collect();

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
            created: format_datetime_iso_ms(album.created_at),
            starred: starred_map.get(&album.id).cloned(),
            user_rating: ratings_map.get(&album.id).copied(),
            played: played_map.get(&album.id).cloned(),
        })
        .collect();

    Ok(AlbumListResult {
        albums: album_responses,
        total,
        seed: result_seed,
    })
}

pub async fn get_random_songs_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    genre: Option<String>,
    from_year: Option<i32>,
    to_year: Option<i32>,
) -> crate::error::Result<Vec<SongResponse>> {
    let size = size.min(500);

    let mut song_ids = lists_repo::visible_song_ids_for_user(
        database,
        user_id,
        genre.as_deref(),
        from_year,
        to_year,
    )
    .await?;
    song_ids.shuffle(&mut rand::thread_rng());
    song_ids.truncate(size as usize);

    let songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?;

    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };

        // For random songs we might want stats too? Subsonic version called `get_song_play_stats`.
        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;

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
    database: &crate::db::Database,
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

    let song_ids =
        lists_repo::song_ids_by_genre_for_user(database, user_id, genre, count, offset).await?;
    let songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(songs, filter, sort, sort_dir);

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    let mut song_responses = Vec::new();

    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };

        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;

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

pub struct ForgottenFavoritesResult {
    pub songs: Vec<SongResponse>,
    pub total: i64,
    pub seed: i64,
}

#[allow(clippy::too_many_arguments)]
pub async fn get_forgotten_favorites_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    min_plays: i64,
    not_played_since_days: i64,
    inline_image_size: Option<ThumbnailSize>,
    seed: Option<i64>,
) -> crate::error::Result<ForgottenFavoritesResult> {
    let size = size.min(1000);
    // Constrain seed to JS Number.MAX_SAFE_INTEGER to avoid precision loss during JSON round-trip
    let actual_seed =
        seed.unwrap_or_else(|| rand::thread_rng().gen_range(0..=9_007_199_254_740_991i64));

    // Find songs with high play counts that haven't been played recently
    let cutoff = chrono::Utc::now() - chrono::Duration::days(not_played_since_days);
    let mut ids: Vec<String> =
        lists_repo::list_forgotten_favorite_song_ids(database, user_id, min_plays, cutoff).await?;
    let total = ids.len() as i64;

    // Seeded shuffle for deterministic pagination with randomness per session
    let mut rng = StdRng::seed_from_u64(actual_seed as u64);
    ids.shuffle(&mut rng);

    // Paginate
    let start = (offset as usize).min(ids.len());
    let end = (start + size as usize).min(ids.len());
    let page_ids = &ids[start..end];

    if page_ids.is_empty() {
        return Ok(ForgottenFavoritesResult {
            songs: Vec::new(),
            total,
            seed: actual_seed,
        });
    }

    let songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, page_ids, user_id).await?;

    // Get starred/rating maps and play stats
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;

    // Get inline thumbnails if requested
    let thumbnails = if let Some(thumb_size) = inline_image_size {
        let song_album_pairs: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|s| (s.id.clone(), s.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_album_pairs, thumb_size).await
    } else {
        std::collections::HashMap::new()
    };

    let mut song_responses = Vec::new();
    for song in songs {
        let album = if let Some(album_id) = &song.album_id {
            crate::db::repo::browse::get_album_by_id(database, album_id).await?
        } else {
            None
        };
        let play_stats = get_song_play_stats(database, user_id, &song.id).await?;
        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        let cover_art_data = thumbnails.get(&song.id).cloned();
        song_responses.push(song_to_response_with_stats(
            song,
            album.as_ref(),
            starred,
            user_rating,
            Some(play_stats),
            None,
            cover_art_data,
        ));
    }

    Ok(ForgottenFavoritesResult {
        songs: song_responses,
        total,
        seed: actual_seed,
    })
}

// ============================================================================
// Continue Listening
// ============================================================================

/// A single entry in the "continue listening" section.
/// Can be an album, playlist, smart playlist, or source-specific item like song radio.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningEntry {
    /// "album" | "playlist" | "smartPlaylist" | "songRadio"
    #[serde(rename = "type")]
    pub entry_type: String,
    /// ISO 8601 timestamp of the last scrobble from this source
    pub last_played: String,
    /// Present when entry_type = "album"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<AlbumResponse>,
    /// Present when entry_type = "playlist" or "smartPlaylist"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist: Option<ContinueListeningPlaylist>,
    /// Present when entry_type = "songRadio"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ContinueListeningSource>,
}

/// Minimal playlist info for continue listening entries.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningPlaylist {
    pub id: String,
    pub name: String,
    /// "playlist" or "smartPlaylist"
    pub playlist_type: String,
    #[ts(type = "number")]
    pub song_count: i64,
    #[ts(type = "number")]
    pub duration: i64,
    pub cover_art: Option<String>,
}

/// Minimal non-playlist source info for continue listening entries.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningSource {
    pub id: String,
    pub name: String,
    /// "songRadio"
    pub source_type: String,
    pub cover_art: Option<String>,
}

pub struct ContinueListeningResult {
    pub entries: Vec<ContinueListeningEntry>,
    pub total: i64,
}

#[derive(Debug, Clone)]
pub struct ContinueListeningSourceRef {
    pub source_type: String,
    pub source_id: String,
}

async fn get_continue_listening_source_rows(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> crate::error::Result<Vec<lists_repo::ContinueListeningSource>> {
    lists_repo::list_continue_listening_sources(database, user_id, size, offset).await
}

async fn count_continue_listening_sources(
    database: &crate::db::Database,
    user_id: i64,
) -> crate::error::Result<i64> {
    lists_repo::count_continue_listening_sources(database, user_id).await
}

pub async fn get_continue_listening_source_refs(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
) -> crate::error::Result<Vec<ContinueListeningSourceRef>> {
    let size = size.min(500);

    let rows = get_continue_listening_source_rows(database, user_id, size, offset).await?;

    Ok(rows
        .into_iter()
        .map(|row| ContinueListeningSourceRef {
            source_type: row.source_type,
            source_id: row.source_id,
        })
        .collect())
}

/// Get the "continue listening" list: recent playback sources grouped by
/// the actual source (album, playlist, smart playlist, or supported virtual sources).
///
/// Scrobbles with `queue_source_type` in ("playlist", "smartPlaylist", "songRadio")
/// that have a valid `queue_source_id` are grouped by that source. Everything
/// else is grouped by the song's album, except for explicitly excluded virtual
/// sources like forgotten favorites and continue-listening self-echo.
pub async fn get_continue_listening_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    inline_image_size: Option<ThumbnailSize>,
) -> crate::error::Result<ContinueListeningResult> {
    let size = size.min(500);

    let sources = get_continue_listening_source_rows(database, user_id, size, offset).await?;
    let total = count_continue_listening_sources(database, user_id).await?;

    if sources.is_empty() {
        return Ok(ContinueListeningResult {
            entries: Vec::new(),
            total,
        });
    }

    // Step 3: Collect IDs by type for batch fetching
    let mut album_ids: Vec<String> = Vec::new();
    let mut playlist_ids: Vec<String> = Vec::new();
    let mut smart_playlist_ids: Vec<String> = Vec::new();
    let mut song_radio_ids: Vec<String> = Vec::new();

    for source in &sources {
        match source.source_type.as_str() {
            "album" => album_ids.push(source.source_id.clone()),
            "playlist" => playlist_ids.push(source.source_id.clone()),
            "smartPlaylist" => smart_playlist_ids.push(source.source_id.clone()),
            "songRadio" => song_radio_ids.push(source.source_id.clone()),
            _ => {}
        }
    }

    // Step 4: Batch-fetch album details
    let album_map: std::collections::HashMap<String, AlbumResponse> = if !album_ids.is_empty() {
        let albums = fetch_albums_by_ids_in_order(database, &album_ids).await?;

        let ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
        let starred_map = get_starred_map(database, user_id, ItemType::Album, &ids).await?;
        let ratings_map = get_ratings_map(database, user_id, ItemType::Album, &ids).await?;
        let thumbnails = if let Some(size) = inline_image_size {
            get_album_thumbnails_base64(database, &ids, size).await
        } else {
            std::collections::HashMap::new()
        };

        albums
            .into_iter()
            .map(|album| {
                let id = album.id.clone();
                let response = AlbumResponse {
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
                    created: format_datetime_iso_ms(album.created_at),
                    starred: starred_map.get(&album.id).cloned(),
                    user_rating: ratings_map.get(&album.id).copied(),
                    played: None, // will be set from source data
                };
                (id, response)
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    // Step 5: Batch-fetch regular playlist details
    let playlist_map: std::collections::HashMap<String, ContinueListeningPlaylist> =
        if !playlist_ids.is_empty() {
            lists_repo::list_playlist_summaries(database, &playlist_ids)
                .await?
                .into_iter()
                .map(|row| {
                    let id = row.id;
                    (
                        id.clone(),
                        ContinueListeningPlaylist {
                            cover_art: Some(id.clone()),
                            id,
                            name: row.name,
                            playlist_type: "playlist".to_string(),
                            song_count: row.song_count,
                            duration: row.duration,
                        },
                    )
                })
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    // Step 6: Batch-fetch smart playlist details
    let smart_playlist_map: std::collections::HashMap<String, ContinueListeningPlaylist> =
        if !smart_playlist_ids.is_empty() {
            let rows =
                lists_repo::list_smart_playlist_named_ids(database, &smart_playlist_ids).await?;
            let mut map = std::collections::HashMap::with_capacity(rows.len());
            for row in rows {
                let id = row.id;
                let songs =
                    get_smart_playlist_songs_by_id(database, &id, user_id, None, None, None)
                        .await?;
                let duration = songs.iter().map(|song| song.duration).sum();
                map.insert(
                    id.clone(),
                    ContinueListeningPlaylist {
                        id: id.clone(),
                        name: row.name,
                        playlist_type: "smartPlaylist".to_string(),
                        song_count: songs.len() as i64,
                        duration,
                        cover_art: Some(format!("sp-{}", id)),
                    },
                );
            }
            map
        } else {
            std::collections::HashMap::new()
        };

    // Step 7: Batch-fetch source-specific details for song radio entries.
    let song_radio_map: std::collections::HashMap<String, ContinueListeningSource> =
        if !song_radio_ids.is_empty() {
            crate::db::repo::browse::get_songs_by_ids_for_user(database, &song_radio_ids, user_id)
                .await?
                .into_iter()
                .map(|song| {
                    let id = song.id.clone();
                    (
                        id.clone(),
                        ContinueListeningSource {
                            id,
                            name: format!("{} Radio", song.title),
                            source_type: "songRadio".to_string(),
                            cover_art: song.album_id.clone().or_else(|| Some(song.id.clone())),
                        },
                    )
                })
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    // Step 8: Assemble entries in source order (already sorted by last_played DESC)
    let entries: Vec<ContinueListeningEntry> = sources
        .into_iter()
        .filter_map(|source| {
            let source_type = source.source_type;
            let source_id = source.source_id;
            let last_played = format_datetime_iso_ms(source.last_played);

            match source_type.as_str() {
                "album" => {
                    let mut album = album_map.get(&source_id).cloned()?;
                    album.played = Some(last_played.clone());
                    Some(ContinueListeningEntry {
                        entry_type: "album".to_string(),
                        last_played,
                        album: Some(album),
                        playlist: None,
                        source: None,
                    })
                }
                "playlist" => {
                    let playlist = playlist_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "playlist".to_string(),
                        last_played,
                        album: None,
                        playlist: Some(playlist),
                        source: None,
                    })
                }
                "smartPlaylist" => {
                    let playlist = smart_playlist_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "smartPlaylist".to_string(),
                        last_played,
                        album: None,
                        playlist: Some(playlist),
                        source: None,
                    })
                }
                "songRadio" => {
                    let source = song_radio_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: "songRadio".to_string(),
                        last_played,
                        album: None,
                        playlist: None,
                        source: Some(source),
                    })
                }
                _ => None,
            }
        })
        .collect();

    Ok(ContinueListeningResult { entries, total })
}
