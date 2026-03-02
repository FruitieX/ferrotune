use crate::api::common::models::*;
use crate::api::common::starring::{get_ratings_map, get_starred_map};
use crate::api::common::utils::{
    format_datetime_iso, format_datetime_iso_ms, get_content_type_for_format,
};
use crate::db::models::{Album, ItemType, Song};
use sqlx::SqlitePool;
use std::collections::HashMap;

// ===================================
// Core Logic Functions
// ===================================

/// Get all artists grouped by first letter (for getArtists endpoint)
pub async fn get_artists_logic(
    pool: &SqlitePool,
    user_id: i64,
) -> crate::error::Result<ArtistsIndex> {
    let artists = crate::db::queries::get_artists_for_user(pool, user_id).await?;

    // Get starred status and ratings for all artists
    let artist_ids: Vec<String> = artists.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Artist, &artist_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Artist, &artist_ids).await?;

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

    Ok(ArtistsIndex { index: indexes })
}

/// Get artist details with albums and songs (for getArtist endpoint)
pub async fn get_artist_logic(
    pool: &SqlitePool,
    user_id: i64,
    artist_id: &str,
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> crate::error::Result<ArtistDetail> {
    use crate::api::common::sorting::filter_and_sort_songs;

    let artist = crate::db::queries::get_artist_by_id(pool, artist_id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Artist {} not found", artist_id)))?;

    let albums =
        crate::db::queries::get_albums_by_artist_for_user(pool, artist_id, user_id).await?;

    // Get all songs by this artist (track artist, includes songs on compilations)
    let songs = crate::db::queries::get_songs_by_artist_for_user(pool, artist_id, user_id).await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(songs, filter, sort, sort_dir);

    // Get starred status and ratings for albums
    let album_ids: Vec<String> = albums.iter().map(|a| a.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Album, &album_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Album, &album_ids).await?;

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let song_starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let song_ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    // Get starred status and rating for the artist itself
    let artist_ids_vec = vec![artist_id.to_string()];
    let artist_starred_map =
        get_starred_map(pool, user_id, ItemType::Artist, &artist_ids_vec).await?;
    let artist_ratings_map =
        get_ratings_map(pool, user_id, ItemType::Artist, &artist_ids_vec).await?;

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
            created: format_datetime_iso_ms(album.created_at),
            starred: starred_map.get(&album.id).cloned(),
            user_rating: ratings_map.get(&album.id).copied(),
            played: None,
        })
        .collect();

    // Convert songs to response format
    let song_responses: Vec<SongResponse> = songs
        .iter()
        .map(|song| {
            // Use play stats from the Song model (populated by get_songs_by_artist)
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song.last_played.map(format_datetime_iso),
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

    Ok(ArtistDetail {
        id: artist.id.clone(),
        name: artist.name,
        album_count: Some(artist.album_count),
        cover_art: Some(artist.id.clone()),
        cover_art_data: None,
        starred: artist_starred_map.get(&artist.id).cloned(),
        user_rating: artist_ratings_map.get(&artist.id).copied(),
        album: album_responses,
        song: song_responses,
    })
}

/// Get album details with songs (for getAlbum endpoint)
pub async fn get_album_logic(
    pool: &SqlitePool,
    user_id: i64,
    album_id: &str,
    filter: Option<&str>,
    sort: Option<&str>,
    sort_dir: Option<&str>,
) -> crate::error::Result<AlbumDetail> {
    use crate::api::common::sorting::filter_and_sort_songs;

    let album = crate::db::queries::get_album_by_id(pool, album_id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Album {} not found", album_id)))?;

    let songs = crate::db::queries::get_songs_by_album(pool, album_id).await?;

    // Apply server-side filtering and sorting
    let songs = filter_and_sort_songs(songs, filter, sort, sort_dir);

    // Get starred status and ratings for songs
    let song_ids: Vec<String> = songs.iter().map(|s| s.id.clone()).collect();
    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids).await?;
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids).await?;

    // Get starred status and rating for the album itself
    let album_ids_vec = vec![album_id.to_string()];
    let album_starred_map = get_starred_map(pool, user_id, ItemType::Album, &album_ids_vec).await?;
    let album_ratings_map = get_ratings_map(pool, user_id, ItemType::Album, &album_ids_vec).await?;

    let song_responses: Vec<SongResponse> = songs
        .iter()
        .map(|song| {
            // Use play stats from the Song model (populated by get_songs_by_album)
            let play_stats = SongPlayStats {
                play_count: song.play_count,
                last_played: song.last_played.map(format_datetime_iso),
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

    Ok(AlbumDetail {
        id: album.id.clone(),
        name: album.name.clone(),
        artist: album.artist_name.clone(),
        artist_id: album.artist_id.clone(),
        cover_art: Some(album.id.clone()),
        cover_art_data: None,
        song_count: album.song_count,
        duration: album.duration,
        year: album.year,
        genre: album.genre,
        created: format_datetime_iso_ms(album.created_at),
        starred: album_starred_map.get(&album.id).cloned(),
        user_rating: album_ratings_map.get(&album.id).copied(),
        song: song_responses,
    })
}

/// Get song details (for getSong endpoint)
pub async fn get_song_logic(
    pool: &SqlitePool,
    user_id: i64,
    song_id: &str,
) -> crate::error::Result<SongResponse> {
    let song_with_folder = crate::db::queries::get_song_by_id_with_folder(pool, song_id)
        .await?
        .ok_or_else(|| crate::error::Error::NotFound(format!("Song {} not found", song_id)))?;

    let folder_path = song_with_folder.folder_path.clone();
    let song = song_with_folder.into_song();

    // Get album info if available
    let album = if let Some(album_id) = &song.album_id {
        crate::db::queries::get_album_by_id(pool, album_id).await?
    } else {
        None
    };

    // Get starred status and rating
    let song_ids_vec = vec![song_id.to_string()];
    let starred_map = get_starred_map(pool, user_id, ItemType::Song, &song_ids_vec).await?;
    let starred = starred_map.get(song_id).cloned();
    let ratings_map = get_ratings_map(pool, user_id, ItemType::Song, &song_ids_vec).await?;
    let user_rating = ratings_map.get(song_id).copied();

    // Get play statistics
    let play_stats = get_song_play_stats(pool, user_id, song_id).await?;

    Ok(song_to_response_with_stats(
        song,
        album.as_ref(),
        starred,
        user_rating,
        Some(play_stats),
        folder_path.as_deref(),
        None,
    ))
}

/// Get all genres (for getGenres endpoint)
pub async fn get_genres_logic(pool: &SqlitePool) -> crate::error::Result<GenresList> {
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
    .fetch_all(pool)
    .await?;

    let json_genres: Vec<GenreResponse> = genres
        .into_iter()
        .map(|(name, song_count, album_count)| GenreResponse {
            name,
            song_count,
            album_count,
        })
        .collect();

    Ok(GenresList { genre: json_genres })
}

/// Get indexes (for getIndexes endpoint)
/// Returns top-level directories grouped by first letter.
/// IDs are returned as "dir-<urlencoded_path>" to support filesystem browsing.
pub async fn get_indexes_logic(
    pool: &SqlitePool,
    user_id: i64,
    folder_id: Option<i64>,
) -> crate::error::Result<(Vec<DirectoryIndex>, i64)> {
    // Get top-level directory names from songs table
    // We assume the first component of file_path is the directory (e.g. "Artist" in "Artist/Album/Song.mp3")
    // Files in the root (no '/') are ignored as they are not folders.
    let directory_names: Vec<String> = if let Some(fid) = folder_id {
        sqlx::query_scalar(
            r#"
            SELECT DISTINCT 
                substr(s.file_path, 1, instr(s.file_path, '/') - 1) as name
            FROM songs s
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE mf.enabled = 1 AND mf.id = ? AND ula.user_id = ? AND instr(s.file_path, '/') > 0
            ORDER BY name COLLATE NOCASE
            "#,
        )
        .bind(fid)
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_scalar(
            r#"
            SELECT DISTINCT 
                substr(s.file_path, 1, instr(s.file_path, '/') - 1) as name
            FROM songs s
            INNER JOIN music_folders mf ON s.music_folder_id = mf.id
            INNER JOIN user_library_access ula ON ula.music_folder_id = mf.id
            WHERE mf.enabled = 1 AND ula.user_id = ? AND instr(s.file_path, '/') > 0
            ORDER BY name COLLATE NOCASE
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    };

    // Group by first letter
    let mut grouped: HashMap<String, Vec<DirectoryArtist>> = HashMap::new();

    for name in directory_names {
        if name.is_empty() {
            continue;
        }

        let first_char = name
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

        // Construct ID compatible with getMusicDirectory (dir-<urlencoded>)
        let id = format!("dir-{}", urlencoding::encode(&name));

        grouped
            .entry(index_name)
            .or_default()
            .push(DirectoryArtist {
                id,
                name,
                starred: None,
                user_rating: None,
            });
    }

    // Sort into index list
    let mut indexes: Vec<DirectoryIndex> = grouped
        .into_iter()
        .map(|(name, mut artists)| {
            artists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            DirectoryIndex {
                name,
                artist: artists,
            }
        })
        .collect();

    indexes.sort_by(|a, b| {
        // Put # at the end
        match (a.name.as_str(), b.name.as_str()) {
            ("#", "#") => std::cmp::Ordering::Equal,
            ("#", _) => std::cmp::Ordering::Greater,
            (_, "#") => std::cmp::Ordering::Less,
            _ => a.name.cmp(&b.name),
        }
    });

    // Get last modification time (use current time as approximation)
    let last_modified = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    Ok((indexes, last_modified))
}

// ===================================
// Helper Functions
// ===================================

/// Get play statistics for a song from scrobbles table
pub async fn get_song_play_stats(
    pool: &SqlitePool,
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
    let content_type = get_content_type_for_format(&song.file_format);

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

    // Use song's own ID for cover art. The cover art endpoint will look up the song's
    // cover_art_hash first, falling back to album cover only if the song has no hash.
    // This enables individual songs to have different cover art than their album.
    let cover_art = song.id.clone();

    // Use album name from Album object if provided, otherwise use song's album_name field
    let album_name = album
        .map(|a| a.name.clone())
        .or_else(|| song.album_name.clone());

    // For ReplayGain, prefer computed values if available, fall back to original tags
    let replay_gain_track_gain = song
        .computed_replaygain_track_gain
        .or(song.original_replaygain_track_gain);
    let replay_gain_track_peak = song
        .computed_replaygain_track_peak
        .or(song.original_replaygain_track_peak);

    // Also expose original and computed values separately for detailed display
    let original_replay_gain_track_gain = song.original_replaygain_track_gain;
    let original_replay_gain_track_peak = song.original_replaygain_track_peak;
    let computed_replay_gain_track_gain = song.computed_replaygain_track_gain;
    let computed_replay_gain_track_peak = song.computed_replaygain_track_peak;

    SongResponse {
        id: song.id.clone(),
        parent: song.album_id.clone(),
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
        cover_art_width: song.cover_art_width,
        cover_art_height: song.cover_art_height,
        size: song.file_size,
        content_type: content_type.to_string(),
        suffix: song.file_format.clone(),
        duration: song.duration,
        bit_rate: song.bitrate,
        path: song.file_path.clone(),
        full_path: folder_path.map(|fp| format!("{}/{}", fp, song.file_path)),
        starred,
        user_rating,
        created: format_datetime_iso_ms(song.created_at),
        media_type: "music".to_string(),
        play_count,
        last_played,
        replay_gain_track_gain,
        replay_gain_track_peak,
        original_replay_gain_track_gain,
        original_replay_gain_track_peak,
        computed_replay_gain_track_gain,
        computed_replay_gain_track_peak,
    }
}
