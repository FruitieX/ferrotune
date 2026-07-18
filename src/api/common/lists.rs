use crate::api::common::browse::{get_song_play_stats, song_to_response_with_stats};
use crate::api::common::models::{AlbumResponse, SongPlayStats, SongResponse};
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::format_datetime_iso_ms;
use crate::api::inline_thumbnails::{get_album_thumbnails_base64, get_song_thumbnails_base64};
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

#[derive(Debug, Clone, Copy, Default)]
pub struct ListViewOptions<'a> {
    pub filter: Option<&'a str>,
    pub sort: Option<&'a str>,
    pub sort_dir: Option<&'a str>,
}

fn has_text_filter(filter: Option<&str>) -> bool {
    filter.is_some_and(|value| !value.trim().is_empty())
}

fn matches_sort(sort: Option<&str>, sort_dir: Option<&str>, field: &str, direction: &str) -> bool {
    matches!(sort, Some(value) if value == field)
        && sort_dir.unwrap_or("asc").eq_ignore_ascii_case(direction)
}

fn is_default_album_list_sort(
    list_type: &AlbumListType,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> bool {
    if sort.is_none() {
        return true;
    }

    match list_type {
        AlbumListType::Random => matches!(sort, Some("recommended") | Some("custom")),
        AlbumListType::Newest => matches_sort(sort, sort_dir, "dateAdded", "desc"),
        AlbumListType::Frequent => matches_sort(sort, sort_dir, "playCount", "desc"),
        AlbumListType::Recent => matches_sort(sort, sort_dir, "lastPlayed", "desc"),
        AlbumListType::Starred => matches_sort(sort, sort_dir, "starred", "desc"),
        AlbumListType::AlphabeticalByName => matches_sort(sort, sort_dir, "name", "asc"),
        AlbumListType::AlphabeticalByArtist => matches_sort(sort, sort_dir, "artist", "asc"),
        AlbumListType::ByYear => matches_sort(sort, sort_dir, "year", "desc"),
        AlbumListType::ByGenre => matches_sort(sort, sort_dir, "name", "asc"),
        AlbumListType::Highest => matches_sort(sort, sort_dir, "name", "asc"),
    }
}

async fn count_album_list_candidates(
    database: &crate::db::Database,
    user_id: i64,
    list_type: &AlbumListType,
    from_year: Option<i32>,
    to_year: Option<i32>,
    genre: Option<&str>,
) -> crate::error::Result<i64> {
    match list_type {
        AlbumListType::Starred => {
            lists_repo::count_starred_albums_for_user(database, user_id).await
        }
        AlbumListType::Recent => lists_repo::count_recent_albums_for_user(database, user_id).await,
        AlbumListType::ByGenre => {
            if let Some(genre) = genre {
                lists_repo::count_visible_albums_for_user(
                    database,
                    user_id,
                    Some(genre),
                    None,
                    None,
                )
                .await
            } else {
                Ok(0)
            }
        }
        AlbumListType::ByYear => {
            lists_repo::count_visible_albums_for_user(database, user_id, None, from_year, to_year)
                .await
        }
        _ => lists_repo::count_visible_albums_for_user(database, user_id, None, None, None).await,
    }
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
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> crate::error::Result<AlbumListResult> {
    let size = size.min(500);
    let should_post_process =
        has_text_filter(filter) || !is_default_album_list_sort(&list_type, sort, sort_dir);
    let query_offset = if should_post_process { 0 } else { offset };
    let query_size = if should_post_process {
        count_album_list_candidates(
            database,
            user_id,
            &list_type,
            from_year,
            to_year,
            genre.as_deref(),
        )
        .await?
        .max(size)
    } else {
        size
    };
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
            let start = (query_offset as usize).min(ids.len());
            let end = (start + query_size as usize).min(ids.len());
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
                &lists_repo::list_album_ids_newest(database, user_id, query_size, query_offset)
                    .await?,
            )
            .await?
        }
        AlbumListType::Highest => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_name(
                    database,
                    user_id,
                    query_size,
                    query_offset,
                )
                .await?,
            )
            .await?
        }
        AlbumListType::Frequent => {
            let since_dt: Option<DateTime<Utc>> = since
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));
            let ids = lists_repo::list_frequent_album_ids(
                database,
                user_id,
                query_size,
                query_offset,
                since_dt,
            )
            .await?;
            fetch_albums_by_ids_in_order(database, &ids).await?
        }
        AlbumListType::Recent => {
            let recent = lists_repo::list_recent_albums_for_user(
                database,
                user_id,
                query_size,
                query_offset,
            )
            .await?;
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
                &lists_repo::list_starred_album_ids(database, user_id, query_size, query_offset)
                    .await?,
            )
            .await?
        }
        AlbumListType::AlphabeticalByName => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_name(
                    database,
                    user_id,
                    query_size,
                    query_offset,
                )
                .await?,
            )
            .await?
        }
        AlbumListType::AlphabeticalByArtist => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_alphabetical_by_artist(
                    database,
                    user_id,
                    query_size,
                    query_offset,
                )
                .await?,
            )
            .await?
        }
        AlbumListType::ByYear => {
            fetch_albums_by_ids_in_order(
                database,
                &lists_repo::list_album_ids_by_year(
                    database,
                    user_id,
                    query_size,
                    query_offset,
                    from_year,
                    to_year,
                )
                .await?,
            )
            .await?
        }
        AlbumListType::ByGenre => {
            if let Some(ref g) = genre {
                fetch_albums_by_ids_in_order(
                    database,
                    &lists_repo::list_album_ids_by_genre(
                        database,
                        user_id,
                        query_size,
                        query_offset,
                        g,
                    )
                    .await?,
                )
                .await?
            } else {
                Vec::new()
            }
        }
    };

    let (albums, post_processed_total) = if should_post_process {
        use crate::api::common::sorting::filter_and_sort_albums;

        let albums = filter_and_sort_albums(albums, filter, sort, sort_dir);
        let total = albums.len() as i64;
        let albums = albums
            .into_iter()
            .skip(offset.max(0) as usize)
            .take(size.max(0) as usize)
            .collect();
        (albums, Some(total))
    } else {
        (albums, None)
    };

    // Calculate total if needed (for pagination)
    let total: Option<i64> = if let Some(total) = post_processed_total {
        Some(total)
    } else {
        match list_type {
            AlbumListType::AlphabeticalByName
            | AlbumListType::AlphabeticalByArtist
            | AlbumListType::Newest
            | AlbumListType::Highest
            | AlbumListType::Frequent => Some(
                lists_repo::count_visible_albums_for_user(database, user_id, None, None, None)
                    .await?,
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
                lists_repo::count_visible_albums_for_user(
                    database, user_id, None, from_year, to_year,
                )
                .await?,
            ),
            AlbumListType::Random => Some(
                lists_repo::count_visible_albums_for_user(database, user_id, None, None, None)
                    .await?,
            ),
            AlbumListType::Recent => {
                Some(lists_repo::count_recent_albums_for_user(database, user_id).await?)
            }
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

        // For random songs we might want stats too? native API version called `get_song_play_stats`.
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

pub struct MostPlayedRecentlyResult {
    pub songs: Vec<SongResponse>,
    pub total: i64,
}

fn is_default_most_played_sort(sort: Option<&str>, sort_dir: Option<&str>) -> bool {
    sort.is_none() || matches_sort(sort, sort_dir, "playCount", "desc")
}

pub async fn get_most_played_recently_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    inline_image_size: Option<ThumbnailSize>,
    since: Option<String>,
    view_options: ListViewOptions<'_>,
) -> crate::error::Result<MostPlayedRecentlyResult> {
    let size = size.min(1000);
    let since_dt: Option<DateTime<Utc>> = since
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    let total = lists_repo::count_frequent_songs(database, user_id, since_dt).await?;
    let should_post_process = has_text_filter(view_options.filter)
        || !is_default_most_played_sort(view_options.sort, view_options.sort_dir);
    let aggregate_size = if should_post_process {
        total.max(size)
    } else {
        size
    };
    let aggregate_offset = if should_post_process { 0 } else { offset };

    let aggregates = lists_repo::list_frequent_song_aggregates(
        database,
        user_id,
        aggregate_size,
        aggregate_offset,
        since_dt,
    )
    .await?;

    if aggregates.is_empty() {
        return Ok(MostPlayedRecentlyResult {
            songs: Vec::new(),
            total: if should_post_process { 0 } else { total },
        });
    }

    let song_ids: Vec<String> = aggregates.iter().map(|row| row.song_id.clone()).collect();
    let mut songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, &song_ids, user_id).await?;

    let aggregate_map: std::collections::HashMap<String, lists_repo::FrequentSongAggregate> =
        aggregates
            .into_iter()
            .map(|row| (row.song_id.clone(), row))
            .collect();

    for song in &mut songs {
        if let Some(aggregate) = aggregate_map.get(&song.id) {
            song.play_count = Some(aggregate.play_count);
            song.last_played = aggregate.last_played;
        }
    }

    if should_post_process {
        use crate::api::common::sorting::filter_and_sort_songs;

        songs = filter_and_sort_songs(
            songs,
            view_options.filter,
            view_options.sort,
            view_options.sort_dir,
        );
    }

    let filtered_total = if should_post_process {
        songs.len() as i64
    } else {
        total
    };

    if should_post_process {
        songs = songs
            .into_iter()
            .skip(offset.max(0) as usize)
            .take(size.max(0) as usize)
            .collect();
    }

    let visible_song_ids: Vec<String> = songs.iter().map(|song| song.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &visible_song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &visible_song_ids).await?;
    let thumbnails = if let Some(thumb_size) = inline_image_size {
        let song_album_pairs: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|song| (song.id.clone(), song.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_album_pairs, thumb_size).await
    } else {
        std::collections::HashMap::new()
    };

    let responses = songs
        .drain(..)
        .map(|song| {
            let aggregate = aggregate_map.get(&song.id);
            let play_stats = SongPlayStats {
                play_count: aggregate.map(|row| row.play_count),
                last_played: aggregate
                    .and_then(|row| row.last_played)
                    .map(format_datetime_iso_ms),
            };
            let starred = starred_map.get(&song.id).cloned();
            let user_rating = ratings_map.get(&song.id).copied();
            let cover_art_data = thumbnails.get(&song.id).cloned();
            song_to_response_with_stats(
                song,
                None,
                starred,
                user_rating,
                Some(play_stats),
                None,
                cover_art_data,
            )
        })
        .collect();

    Ok(MostPlayedRecentlyResult {
        songs: responses,
        total: filtered_total,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn get_forgotten_favorites_song_models(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    min_plays: i64,
    not_played_since_days: i64,
    seed: Option<i64>,
    view_options: ListViewOptions<'_>,
) -> crate::error::Result<(Vec<crate::db::models::Song>, i64, i64)> {
    use crate::db::repo::lists::ForgottenFavoriteSort;

    let size = size.clamp(0, 500) as u64;
    let offset = offset.max(0) as u64;
    let actual_seed =
        seed.unwrap_or_else(|| rand::thread_rng().gen_range(0..=9_007_199_254_740_991i64));
    let cutoff = chrono::Utc::now() - chrono::Duration::days(not_played_since_days);
    let sort = match view_options.sort {
        None | Some("custom" | "recommended") => {
            let seed_bits = actual_seed as u64;
            let mixed = seed_bits
                .rotate_left(29)
                .wrapping_mul(0x9e37_79b9_7f4a_7c15);
            ForgottenFavoriteSort::Seeded(
                uuid::Uuid::from_u128(((seed_bits as u128) << 64) | mixed as u128).to_string(),
            )
        }
        Some("name" | "title") => ForgottenFavoriteSort::Name,
        Some("artist") => ForgottenFavoriteSort::Artist,
        Some("album") => ForgottenFavoriteSort::Album,
        Some("year") => ForgottenFavoriteSort::Year,
        Some("duration") => ForgottenFavoriteSort::Duration,
        Some("dateAdded" | "created") => ForgottenFavoriteSort::DateAdded,
        Some("playCount") => ForgottenFavoriteSort::PlayCount,
        Some("lastPlayed") => ForgottenFavoriteSort::LastPlayed,
        Some(value) => {
            return Err(crate::error::Error::InvalidRequest(format!(
                "unsupported forgotten-favorites sort field: {value}"
            )))
        }
    };
    let descending = match view_options.sort_dir.unwrap_or("asc") {
        "asc" => false,
        "desc" => true,
        value => {
            return Err(crate::error::Error::InvalidRequest(format!(
                "unsupported forgotten-favorites sort direction: {value}"
            )))
        }
    };
    let (summaries, total) = lists_repo::page_forgotten_favorite_song_summaries(
        database,
        user_id,
        min_plays,
        cutoff,
        view_options.filter,
        sort,
        descending,
        offset,
        size,
    )
    .await?;
    if summaries.is_empty() {
        return Ok((Vec::new(), total, actual_seed));
    }

    let stats_map: std::collections::HashMap<String, (i64, Option<DateTime<Utc>>)> = summaries
        .iter()
        .map(|summary| {
            (
                summary.song_id.clone(),
                (summary.play_count, summary.last_played),
            )
        })
        .collect();

    let ids = summaries
        .iter()
        .map(|summary| summary.song_id.clone())
        .collect::<Vec<_>>();
    let mut songs =
        crate::db::repo::browse::get_songs_by_ids_for_user(database, &ids, user_id).await?;
    for song in &mut songs {
        if let Some((play_count, last_played)) = stats_map.get(&song.id) {
            song.play_count = (*play_count > 0).then_some(*play_count);
            song.last_played = *last_played;
        }
    }

    Ok((songs, total, actual_seed))
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
    view_options: ListViewOptions<'_>,
) -> crate::error::Result<ForgottenFavoritesResult> {
    let (songs, total, actual_seed) = get_forgotten_favorites_song_models(
        database,
        user_id,
        size,
        offset,
        min_plays,
        not_played_since_days,
        seed,
        view_options,
    )
    .await?;

    if songs.is_empty() {
        return Ok(ForgottenFavoritesResult {
            songs: Vec::new(),
            total,
            seed: actual_seed,
        });
    }

    let song_ids: Vec<String> = songs.iter().map(|song| song.id.clone()).collect();
    let starred_map = get_starred_map(database, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(database, user_id, ItemType::Song, &song_ids).await?;
    let thumbnails = if let Some(thumb_size) = inline_image_size {
        let song_album_pairs: Vec<(String, Option<String>)> = songs
            .iter()
            .map(|song| (song.id.clone(), song.album_id.clone()))
            .collect();
        get_song_thumbnails_base64(database, &song_album_pairs, thumb_size).await
    } else {
        std::collections::HashMap::new()
    };

    let mut song_responses = Vec::with_capacity(songs.len());
    for song in songs {
        let play_stats = SongPlayStats {
            play_count: song.play_count,
            last_played: song.last_played.map(format_datetime_iso_ms),
        };
        let starred = starred_map.get(&song.id).cloned();
        let user_rating = ratings_map.get(&song.id).copied();
        let cover_art_data = thumbnails.get(&song.id).cloned();
        song_responses.push(song_to_response_with_stats(
            song,
            None,
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
/// Can be an album, playlist, smart playlist, or source-specific item like
/// song radio, album lists, favorites, history, or generated home sections.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningEntry {
    /// "album" | "playlist" | "smartPlaylist" | "songRadio" | "albumList" | "favorites" | "history" | "forgottenFavorites" | "mostPlayedRecently"
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
    /// Present when entry_type is a source-specific item.
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
    #[ts(type = "number | null")]
    pub song_count: Option<i64>,
    #[ts(type = "number | null")]
    pub duration: Option<i64>,
    pub cover_art: Option<String>,
}

/// Minimal non-playlist source info for continue listening entries.
#[derive(Debug, Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../client/src/lib/api/generated/")]
pub struct ContinueListeningSource {
    pub id: String,
    pub name: String,
    /// "songRadio", "albumList", "favorites", "history", "forgottenFavorites", or "mostPlayedRecently"
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

fn album_list_continue_listening_name(source_id: &str) -> String {
    match source_id {
        "random" => "Discover Something New".to_string(),
        "newest" => "Recently Added".to_string(),
        "highest" => "Top Rated Albums".to_string(),
        "frequent" => "Frequently Played Albums".to_string(),
        "recent" => "Recently Played Albums".to_string(),
        "starred" => "Favorite Albums".to_string(),
        "alphabeticalByName" => "Albums by Name".to_string(),
        "alphabeticalByArtist" => "Albums by Artist".to_string(),
        "byYear" => "Albums by Year".to_string(),
        "byGenre" => "Albums by Genre".to_string(),
        _ => format!("Album List: {source_id}"),
    }
}

fn virtual_continue_listening_source(
    source_type: &str,
    source_id: &str,
) -> Option<ContinueListeningSource> {
    let name = match source_type {
        "albumList" => album_list_continue_listening_name(source_id),
        "favorites" => "Favorites".to_string(),
        "history" => "Recently Played".to_string(),
        "forgottenFavorites" => "Forgotten Favorites".to_string(),
        "mostPlayedRecently" => "Most Played Recently".to_string(),
        _ => return None,
    };

    Some(ContinueListeningSource {
        id: source_id.to_string(),
        name,
        source_type: source_type.to_string(),
        cover_art: None,
    })
}

/// Get the "continue listening" list: recent playback sources grouped by
/// the actual source (album, playlist, smart playlist, or supported virtual sources).
///
/// Scrobbles from id-backed sources like playlists and song radio are grouped by
/// their source id. Stable singleton sources like favorites and history are
/// grouped into one named source entry. Everything else is grouped by the song's
/// album, except for explicitly excluded virtual sources like continue-listening
/// self-echo.
pub async fn get_continue_listening_logic(
    database: &crate::db::Database,
    user_id: i64,
    size: i64,
    offset: i64,
    inline_image_size: Option<ThumbnailSize>,
    view_options: ListViewOptions<'_>,
) -> crate::error::Result<ContinueListeningResult> {
    let size = size.min(500);
    let total = count_continue_listening_sources(database, user_id).await?;
    if has_text_filter(view_options.filter)
        || !(view_options.sort.is_none()
            || matches_sort(
                view_options.sort,
                view_options.sort_dir,
                "lastPlayed",
                "desc",
            ))
    {
        return Err(crate::error::Error::InvalidRequest(
            "continue-listening currently supports only lastPlayed descending without a text filter"
                .to_string(),
        ));
    }

    let sources = get_continue_listening_source_rows(database, user_id, size, offset).await?;

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
    let mut album_list_ids: Vec<String> = Vec::new();

    for source in &sources {
        match source.source_type.as_str() {
            "album" => album_ids.push(source.source_id.clone()),
            "playlist" => playlist_ids.push(source.source_id.clone()),
            "smartPlaylist" => smart_playlist_ids.push(source.source_id.clone()),
            "songRadio" => song_radio_ids.push(source.source_id.clone()),
            "albumList" => album_list_ids.push(source.source_id.clone()),
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
                            song_count: Some(row.song_count),
                            duration: Some(row.duration),
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
            rows.into_iter()
                .map(|row| {
                    let id = row.id;
                    (
                        id.clone(),
                        ContinueListeningPlaylist {
                            id: id.clone(),
                            name: row.name,
                            playlist_type: "smartPlaylist".to_string(),
                            song_count: None,
                            duration: None,
                            cover_art: Some(format!("sp-{id}")),
                        },
                    )
                })
                .collect()
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

    let album_list_map: std::collections::HashMap<String, ContinueListeningSource> = album_list_ids
        .into_iter()
        .filter_map(|id| {
            virtual_continue_listening_source("albumList", &id).map(|source| (id, source))
        })
        .collect();

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
                "albumList" => {
                    let source = album_list_map.get(&source_id).cloned()?;
                    Some(ContinueListeningEntry {
                        entry_type: source_type,
                        last_played,
                        album: None,
                        playlist: None,
                        source: Some(source),
                    })
                }
                "favorites" | "history" | "forgottenFavorites" | "mostPlayedRecently" => {
                    let source = virtual_continue_listening_source(&source_type, &source_id)?;
                    Some(ContinueListeningEntry {
                        entry_type: source_type,
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

#[cfg(test)]
mod tests {
    use super::{get_continue_listening_logic, ListViewOptions};
    use crate::db::{entity, Database};
    use chrono::{Duration, TimeZone, Utc};
    use sea_orm::{ActiveModelTrait, ActiveValue::Set};

    const USER_ID: i64 = 1;
    const MUSIC_FOLDER_ID: i64 = 1;

    async fn setup_database() -> Database {
        let database = Database::new_sqlite_in_memory()
            .await
            .expect("create sqlite memory db");
        let now = Utc.with_ymd_and_hms(2026, 5, 21, 12, 0, 0).unwrap();

        entity::users::ActiveModel {
            id: Set(USER_ID),
            username: Set("continue-listening-test".to_string()),
            password_hash: Set("x".to_string()),
            is_admin: Set(false),
            created_at: Set(now.fixed_offset()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert user");

        entity::music_folders::ActiveModel {
            id: Set(MUSIC_FOLDER_ID),
            name: Set("Music".to_string()),
            path: Set("/music".to_string()),
            enabled: Set(true),
            watch_enabled: Set(false),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert music folder");

        entity::user_library_access::ActiveModel {
            user_id: Set(USER_ID),
            music_folder_id: Set(MUSIC_FOLDER_ID),
            created_at: Set(now.fixed_offset()),
        }
        .insert(database.conn())
        .await
        .expect("insert library access");

        entity::artists::ActiveModel {
            id: Set("artist-1".to_string()),
            name: Set("Test Artist".to_string()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert artist");

        database
    }

    async fn insert_song(database: &Database, song_id: &str) {
        entity::songs::ActiveModel {
            id: Set(song_id.to_string()),
            title: Set(format!("Song {song_id}")),
            artist_id: Set("artist-1".to_string()),
            music_folder_id: Set(Some(MUSIC_FOLDER_ID)),
            file_path: Set(format!("/music/{song_id}.mp3")),
            file_size: Set(0),
            file_format: Set("mp3".to_string()),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert song");
    }

    async fn insert_source_scrobble(
        database: &Database,
        song_id: &str,
        source_type: &str,
        played_at: chrono::DateTime<Utc>,
    ) {
        insert_source_scrobble_with_id(database, song_id, source_type, None, played_at).await;
    }

    async fn insert_source_scrobble_with_id(
        database: &Database,
        song_id: &str,
        source_type: &str,
        source_id: Option<&str>,
        played_at: chrono::DateTime<Utc>,
    ) {
        entity::scrobbles::ActiveModel {
            user_id: Set(USER_ID),
            song_id: Set(song_id.to_string()),
            played_at: Set(Some(played_at.fixed_offset())),
            submission: Set(true),
            queue_source_type: Set(Some(source_type.to_string())),
            queue_source_id: Set(source_id.map(str::to_string)),
            ..Default::default()
        }
        .insert(database.conn())
        .await
        .expect("insert scrobble");
    }

    #[tokio::test]
    async fn continue_listening_groups_singleton_sources() {
        let database = setup_database().await;
        insert_song(&database, "song-1").await;
        insert_song(&database, "song-2").await;
        let first_play = Utc.with_ymd_and_hms(2026, 5, 21, 12, 0, 0).unwrap();

        insert_source_scrobble(&database, "song-1", "favorites", first_play).await;
        insert_source_scrobble(
            &database,
            "song-2",
            "favorites",
            first_play + Duration::minutes(1),
        )
        .await;
        insert_source_scrobble(
            &database,
            "song-1",
            "history",
            first_play + Duration::minutes(2),
        )
        .await;
        insert_source_scrobble(
            &database,
            "song-1",
            "forgottenFavorites",
            first_play + Duration::minutes(3),
        )
        .await;
        insert_source_scrobble(
            &database,
            "song-2",
            "mostPlayedRecently",
            first_play + Duration::minutes(4),
        )
        .await;
        insert_source_scrobble_with_id(
            &database,
            "song-1",
            "albumList",
            Some("random"),
            first_play + Duration::minutes(5),
        )
        .await;

        let result = get_continue_listening_logic(
            &database,
            USER_ID,
            10,
            0,
            None,
            ListViewOptions::default(),
        )
        .await
        .expect("get continue listening");

        assert_eq!(result.total, 5);
        assert_eq!(result.entries.len(), 5);

        let album_list = &result.entries[0];
        assert_eq!(album_list.entry_type, "albumList");
        assert_eq!(
            album_list.source.as_ref().map(|source| source.id.as_str()),
            Some("random")
        );
        assert_eq!(
            album_list
                .source
                .as_ref()
                .map(|source| source.name.as_str()),
            Some("Discover Something New")
        );

        let most_played_recently = &result.entries[1];
        assert_eq!(most_played_recently.entry_type, "mostPlayedRecently");
        assert_eq!(
            most_played_recently
                .source
                .as_ref()
                .map(|source| source.id.as_str()),
            Some("mostPlayedRecently")
        );
        assert_eq!(
            most_played_recently
                .source
                .as_ref()
                .map(|source| source.name.as_str()),
            Some("Most Played Recently")
        );

        let forgotten_favorites = &result.entries[2];
        assert_eq!(forgotten_favorites.entry_type, "forgottenFavorites");
        assert_eq!(
            forgotten_favorites
                .source
                .as_ref()
                .map(|source| source.id.as_str()),
            Some("forgottenFavorites")
        );
        assert_eq!(
            forgotten_favorites
                .source
                .as_ref()
                .map(|source| source.name.as_str()),
            Some("Forgotten Favorites")
        );

        let history = &result.entries[3];
        assert_eq!(history.entry_type, "history");
        assert_eq!(
            history.source.as_ref().map(|source| source.id.as_str()),
            Some("history")
        );
        assert_eq!(
            history.source.as_ref().map(|source| source.name.as_str()),
            Some("Recently Played")
        );

        let favorites = &result.entries[4];
        assert_eq!(favorites.entry_type, "favorites");
        assert_eq!(
            favorites.source.as_ref().map(|source| source.id.as_str()),
            Some("favorites")
        );
        assert_eq!(
            favorites.source.as_ref().map(|source| source.name.as_str()),
            Some("Favorites")
        );
    }
}
