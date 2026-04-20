use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use chrono::{Datelike, Utc};
use ferrotune::{
    api::{
        common::{browse, playlist_access, scrobbling, starring},
        ferrotune::{
            check_import_duplicate as ferrotune_check_import_duplicate,
            ferrotune_delete_preference, ferrotune_get_duplicates, ferrotune_get_listening_stats,
            ferrotune_get_period_review, ferrotune_get_preference, ferrotune_get_preferences,
            ferrotune_get_stats, ferrotune_get_waveform, ferrotune_log_listening,
            ferrotune_save_play_queue, ferrotune_scrobble, ferrotune_set_preference,
            ferrotune_update_preferences, get_album_list as ferrotune_get_album_list,
            get_continue_listening as ferrotune_get_continue_listening,
            get_forgotten_favorites as ferrotune_get_forgotten_favorites,
            get_home as ferrotune_get_home, get_lazy_queue_count,
            get_play_counts as ferrotune_get_play_counts,
            get_random_songs as ferrotune_get_random_songs,
            get_songs_by_genre as ferrotune_get_songs_by_genre, history as ferrotune_history,
            import_scrobbles as ferrotune_import_scrobbles,
            import_with_timestamps as ferrotune_import_with_timestamps, lastfm as ferrotune_lastfm,
            materialize_lazy_queue_page, playlists as ferrotune_playlists,
            smart_playlists as ferrotune_smart_playlists, start_queue as ferrotune_start_queue,
            AlbumListParams, AlbumListType, CheckDuplicateParams, ContinueListeningParams,
            FerrotuneScrobbleParams, ForgottenFavoritesParams, GetPlayCountsRequest,
            HomePageParams, ImportMode, ImportScrobbleEntry, ImportScrobblesRequest,
            ImportSongWithPlays, ImportWithTimestampsRequest, LogListeningRequest,
            PeriodReviewQuery, PlayEvent, RandomSongsParams, SavePlayQueueRequest,
            SetPreferenceRequest, SongsByGenreParams, StartQueueRequest, UpdatePreferencesRequest,
        },
        subsonic::{
            auth::{AuthenticatedUser, FerrotuneAuthenticatedUser},
            lists as subsonic_lists, playlists, playqueue as subsonic_playqueue,
            xml::ResponseFormat,
        },
        AppState, QsQuery, SessionManager,
    },
    config::{CacheConfig, Config, DatabaseBackend, DatabaseConfig, MusicConfig, ServerConfig},
    db,
};
use testcontainers_modules::{postgres::Postgres, testcontainers::runners::SyncRunner};

fn postgres_config(host: &str, port: u16) -> DatabaseConfig {
    DatabaseConfig {
        backend: DatabaseBackend::Postgres,
        path: PathBuf::from("/tmp/ferrotune-unused.db"),
        url: Some(format!(
            "postgres://postgres:postgres@{}:{}/postgres",
            host, port
        )),
    }
}

fn postgres_test_app_config(database: DatabaseConfig) -> Config {
    Config {
        server: ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 4040,
            name: "Ferrotune Test".to_string(),
            admin_user: "admin".to_string(),
            admin_password: "secret".to_string(),
        },
        database,
        music: MusicConfig {
            folders: Vec::new(),
            readonly_tags: true,
        },
        cache: CacheConfig {
            path: PathBuf::from("/tmp/ferrotune-test-cache"),
            max_cover_size: 1024,
        },
    }
}

fn docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

async fn seed_postgres_library_sample(
    database: &db::Database,
) -> (db::models::User, String, String, String, String) {
    let folder_id = db::repo::users::create_music_folder(database, "Library", "/music")
        .await
        .expect("postgres bootstrap schema should accept music folders");
    assert!(folder_id > 0, "music folder ids should be positive");

    ferrotune::create_admin_user(database, "admin", "secret")
        .await
        .expect("admin bootstrap should work on postgres");

    let user = db::repo::users::get_user_by_username(database, "admin")
        .await
        .expect("postgres user lookup should succeed")
        .expect("admin user should exist after bootstrap");

    let pool = database
        .postgres_pool()
        .expect("postgres runtime database should expose a PgPool");

    let artist_id = "ar-integration".to_string();
    let album_id = "al-integration".to_string();
    let song_1 = "so-integration-1".to_string();
    let song_2 = "so-integration-2".to_string();

    sqlx::query(
        "INSERT INTO artists (id, name, sort_name, album_count, song_count, cover_art_hash)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&artist_id)
    .bind("Integration Artist")
    .bind(Some("Integration Artist"))
    .bind(1_i64)
    .bind(2_i64)
    .bind(Option::<String>::None)
    .execute(pool)
    .await
    .expect("postgres artist insert should succeed");

    sqlx::query(
        "INSERT INTO albums (id, name, artist_id, year, genre, song_count, duration, cover_art_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())",
    )
    .bind(&album_id)
    .bind("Integration Album")
    .bind(&artist_id)
    .bind(2024_i32)
    .bind(Some("rock"))
    .bind(2_i64)
    .bind(360_i64)
    .bind(Option::<String>::None)
    .execute(pool)
    .await
    .expect("postgres album insert should succeed");

    for (song_id, title, track_number, file_path) in [
        (
            &song_1,
            "Opening Track",
            1_i32,
            "Artist/Album/01 - Opening Track.mp3",
        ),
        (
            &song_2,
            "Closing Track",
            2_i32,
            "Artist/Album/02 - Closing Track.mp3",
        ),
    ] {
        sqlx::query(
            "INSERT INTO songs (
                id, title, album_id, artist_id, music_folder_id, track_number, disc_number, year, genre,
                duration, bitrate, file_path, file_size, file_format, file_mtime, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, NOW(), NOW()
             )",
        )
        .bind(song_id)
        .bind(title)
        .bind(&album_id)
        .bind(&artist_id)
        .bind(folder_id)
        .bind(track_number)
        .bind(1_i32)
        .bind(2024_i32)
        .bind(Some("rock"))
        .bind(180_i64)
        .bind(Some(320_i32))
        .bind(file_path)
        .bind(5_000_000_i64)
        .bind("mp3")
        .bind(Some(1_i64))
        .execute(pool)
        .await
        .expect("postgres song insert should succeed");
    }

    sqlx::query(
        "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
         VALUES ($1, $2, NOW() - INTERVAL '1 day', TRUE, 1, NULL)",
    )
    .bind(user.id)
    .bind(&song_1)
    .execute(pool)
    .await
    .expect("postgres scrobble insert should succeed");

    sqlx::query(
        "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
         VALUES ($1, $2, NOW(), TRUE, 1, NULL)",
    )
    .bind(user.id)
    .bind(&song_1)
    .execute(pool)
    .await
    .expect("postgres scrobble insert should succeed");

    sqlx::query(
        "INSERT INTO starred (user_id, item_type, item_id, starred_at)
         VALUES ($1, 'artist', $2, NOW()), ($1, 'album', $3, NOW()), ($1, 'song', $4, NOW())",
    )
    .bind(user.id)
    .bind(&artist_id)
    .bind(&album_id)
    .bind(&song_1)
    .execute(pool)
    .await
    .expect("postgres starred insert should succeed");

    sqlx::query(
        "INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at)
         VALUES ($1, 'artist', $2, 4, NOW()), ($1, 'album', $3, 5, NOW()), ($1, 'song', $4, 3, NOW())",
    )
    .bind(user.id)
    .bind(&artist_id)
    .bind(&album_id)
    .bind(&song_1)
    .execute(pool)
    .await
    .expect("postgres ratings insert should succeed");

    (user, artist_id, album_id, song_1, song_2)
}

#[test]
fn test_postgres_testcontainer_starts() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("PostgreSQL testcontainer should start");

    let host = container
        .get_host()
        .expect("container host should be available")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("container port should be mapped");

    assert!(!host.is_empty(), "container host should not be empty");
    assert!(port > 0, "container port should be a positive integer");
}

#[test]
fn test_create_pool_supports_postgres_config() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("PostgreSQL testcontainer should start");

    let host = container
        .get_host()
        .expect("container host should be available")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("container port should be mapped");

    let config = postgres_config(&host, port);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime should build");

    runtime.block_on(async {
        let database = db::create_pool(&config)
            .await
            .expect("PostgreSQL config should create a runtime database pool");

        assert_eq!(database.backend(), DatabaseBackend::Postgres);

        let value: i32 = sqlx::query_scalar("SELECT 1")
            .fetch_one(
                database
                    .postgres_pool()
                    .expect("postgres runtime database should expose a PgPool"),
            )
            .await
            .expect("postgres runtime database should execute queries");
        assert_eq!(value, 1);
    });
}

#[test]
fn test_postgres_seaorm_entities_round_trip() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should be mapped");

    let config = postgres_config(&host, port);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime should build");

    runtime.block_on(async {
        use chrono::{FixedOffset, Utc};
        use ferrotune::db::entity;
        use sea_orm::ActiveValue::Set;
        use sea_orm::{ActiveModelTrait, EntityTrait, PaginatorTrait};

        let database = db::create_pool(&config)
            .await
            .expect("postgres config should create a runtime database");
        let conn = database.conn();

        // Count every table via SeaORM to prove the entity metadata matches
        // the live Postgres schema.
        entity::albums::Entity::find().count(conn).await.unwrap();
        entity::artists::Entity::find().count(conn).await.unwrap();
        entity::songs::Entity::find().count(conn).await.unwrap();
        entity::users::Entity::find().count(conn).await.unwrap();
        entity::playlists::Entity::find().count(conn).await.unwrap();
        entity::play_queues::Entity::find()
            .count(conn)
            .await
            .unwrap();
        entity::scrobbles::Entity::find().count(conn).await.unwrap();
        entity::music_folders::Entity::find()
            .count(conn)
            .await
            .unwrap();
        entity::listening_sessions::Entity::find()
            .count(conn)
            .await
            .unwrap();

        // Round-trip a song row to exercise BIGINT, BOOLEAN, TIMESTAMPTZ,
        // DOUBLE and optional columns all together.
        let folder = entity::music_folders::ActiveModel {
            name: Set("Test".to_string()),
            path: Set("/tmp/fake-pg".to_string()),
            enabled: Set(true),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap();
        assert!(folder.enabled);

        entity::artists::ActiveModel {
            id: Set("artist-pg".to_string()),
            name: Set("Test Artist".to_string()),
            sort_name: Set(None),
            album_count: Set(0),
            song_count: Set(0),
            cover_art_hash: Set(None),
        }
        .insert(conn)
        .await
        .unwrap();

        let now: chrono::DateTime<FixedOffset> =
            Utc::now().with_timezone(&FixedOffset::east_opt(0).unwrap());
        entity::songs::ActiveModel {
            id: Set("song-pg".to_string()),
            title: Set("Test Song".to_string()),
            album_id: Set(None),
            artist_id: Set("artist-pg".to_string()),
            music_folder_id: Set(Some(folder.id)),
            track_number: Set(None),
            disc_number: Set(1),
            year: Set(None),
            genre: Set(None),
            duration: Set(180_000),
            bitrate: Set(Some(320)),
            file_path: Set("/tmp/fake-pg/song.mp3".to_string()),
            file_size: Set(4_321_000),
            file_format: Set("mp3".to_string()),
            file_mtime: Set(Some(1_700_000_000)),
            partial_hash: Set(None),
            full_file_hash: Set(None),
            cover_art_hash: Set(None),
            marked_for_deletion_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            cover_art_width: Set(None),
            cover_art_height: Set(None),
            original_replaygain_track_gain: Set(Some(-7.5)),
            original_replaygain_track_peak: Set(Some(0.94)),
            computed_replaygain_track_gain: Set(None),
            computed_replaygain_track_peak: Set(None),
            waveform_data: Set(None),
            bliss_features: Set(None),
            bliss_version: Set(None),
        }
        .insert(conn)
        .await
        .unwrap();

        let refetched = entity::songs::Entity::find_by_id("song-pg".to_string())
            .one(conn)
            .await
            .unwrap()
            .expect("song should round-trip on postgres");
        assert_eq!(refetched.duration, 180_000);
        assert_eq!(refetched.file_size, 4_321_000);
        assert_eq!(refetched.file_mtime, Some(1_700_000_000));
        assert_eq!(refetched.original_replaygain_track_gain, Some(-7.5));
    });
}

#[test]
fn test_postgres_ferrotune_lists_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        sqlx::query(
            "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
              VALUES ($1, $2, NOW() - INTERVAL '121 days', TRUE, 5, NULL),
                  ($1, $2, NOW() - INTERVAL '120 days', TRUE, 5, NULL)",
        )
        .bind(user.id)
        .bind(&song_2)
        .execute(pool)
        .await
        .expect("postgres forgotten-favorites scrobbles should be inserted");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: format!("pg-tagger-test-{}", user.id),
            is_admin: user.is_admin,
        };

        let album_list = ferrotune_get_album_list(
            auth_user(),
            State(state.clone()),
            Query(AlbumListParams {
                list_type: AlbumListType::Newest,
                size: Some(10),
                offset: Some(0),
                from_year: None,
                to_year: None,
                genre: None,
                inline_images: None,
                since: None,
                seed: None,
            }),
        )
        .await
        .expect("postgres ferrotune album-list handler should succeed")
        .0;
        assert_eq!(album_list.album.len(), 1);
        assert_eq!(album_list.total, Some(1));

        let random_songs = ferrotune_get_random_songs(
            auth_user(),
            State(state.clone()),
            Query(RandomSongsParams {
                size: Some(10),
                genre: None,
                from_year: None,
                to_year: None,
            }),
        )
        .await
        .expect("postgres ferrotune random-songs handler should succeed")
        .0;
        assert_eq!(random_songs.song.len(), 2);
        let random_song_ids: std::collections::HashSet<String> =
            random_songs.song.into_iter().map(|song| song.id).collect();
        assert!(random_song_ids.contains(&song_1));
        assert!(random_song_ids.contains(&song_2));

        let songs_by_genre = ferrotune_get_songs_by_genre(
            auth_user(),
            State(state.clone()),
            Query(SongsByGenreParams {
                genre: "rock".to_string(),
                count: Some(10),
                offset: Some(0),
                sort: None,
                sort_dir: None,
                filter: None,
            }),
        )
        .await
        .expect("postgres ferrotune songs-by-genre handler should succeed")
        .0;
        let genre_song_ids: Vec<String> = songs_by_genre.song.into_iter().map(|song| song.id).collect();
        assert_eq!(genre_song_ids, vec![song_2.clone(), song_1.clone()]);

        let forgotten_favorites = ferrotune_get_forgotten_favorites(
            auth_user(),
            State(state),
            Query(ForgottenFavoritesParams {
                size: Some(10),
                offset: Some(0),
                seed: Some(42),
                min_plays: Some(2),
                not_played_since_days: Some(90),
                inline_images: None,
            }),
        )
        .await
        .expect("postgres ferrotune forgotten-favorites handler should succeed")
        .0;
        assert_eq!(forgotten_favorites.total, 1);
        assert_eq!(forgotten_favorites.song.len(), 1);
        assert_eq!(forgotten_favorites.song[0].id, song_2);
        assert_eq!(forgotten_favorites.seed, 42);
    });
}

#[test]
fn test_postgres_subsonic_lists_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || AuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
            format: ResponseFormat::Json,
            client: "postgres-handler-test".to_string(),
        };

        let album_list2 = subsonic_lists::get_album_list2(
            auth_user(),
            State(state.clone()),
            Query(subsonic_lists::AlbumListParams {
                list_type: AlbumListType::Newest,
                size: Some(10),
                offset: Some(0),
                from_year: None,
                to_year: None,
                genre: None,
                music_folder_id: None,
                inline_images: Default::default(),
            }),
        )
        .await
        .expect("postgres getAlbumList2 handler should succeed");
        assert_eq!(album_list2.data.album_list2.album.len(), 1);
        assert_eq!(album_list2.data.album_list2.total, Some(1));

        let album_list = subsonic_lists::get_album_list(
            auth_user(),
            State(state.clone()),
            Query(subsonic_lists::AlbumListParams {
                list_type: AlbumListType::Newest,
                size: Some(10),
                offset: Some(0),
                from_year: None,
                to_year: None,
                genre: None,
                music_folder_id: None,
                inline_images: Default::default(),
            }),
        )
        .await
        .expect("postgres getAlbumList handler should succeed");
        assert_eq!(album_list.data.album_list.album.len(), 1);

        let random_songs = subsonic_lists::get_random_songs(
            auth_user(),
            State(state.clone()),
            Query(subsonic_lists::RandomSongsParams {
                size: Some(10),
                genre: None,
                from_year: None,
                to_year: None,
                music_folder_id: None,
            }),
        )
        .await
        .expect("postgres getRandomSongs handler should succeed");
        assert_eq!(random_songs.data.random_songs.song.len(), 2);
        let random_song_ids: std::collections::HashSet<String> = random_songs
            .data
            .random_songs
            .song
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert!(random_song_ids.contains(&song_1));
        assert!(random_song_ids.contains(&song_2));

        let songs_by_genre = subsonic_lists::get_songs_by_genre(
            auth_user(),
            State(state),
            Query(subsonic_lists::SongsByGenreParams {
                genre: "rock".to_string(),
                count: Some(10),
                offset: Some(0),
                music_folder_id: None,
                sort: None,
                sort_dir: None,
                filter: None,
            }),
        )
        .await
        .expect("postgres getSongsByGenre handler should succeed");
        let genre_song_ids: Vec<String> = songs_by_genre
            .data
            .songs_by_genre
            .song
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert_eq!(genre_song_ids, vec![song_2, song_1]);
    });
}

#[test]
fn test_postgres_scrobble_helper_and_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let initial_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND song_id = $2",
        )
        .bind(user.id)
        .bind(&song_2)
        .fetch_one(pool)
        .await
        .expect("postgres scrobble count should load");

        let base_play = chrono::Utc::now() - chrono::Duration::minutes(10);
        let inserted = scrobbling::insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            user.id,
            &song_2,
            base_play,
            Some("album"),
            Some("album-1"),
        )
        .await
        .expect("postgres scrobble helper should insert the first scrobble");
        assert!(inserted);

        let duplicate = scrobbling::insert_submission_scrobble_if_not_recent_duplicate(
            &database,
            user.id,
            &song_2,
            base_play + chrono::Duration::seconds(3),
            Some("album"),
            Some("album-1"),
        )
        .await
        .expect("postgres scrobble helper should check for duplicates");
        assert!(!duplicate);

        let after_helper_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND song_id = $2",
        )
        .bind(user.id)
        .bind(&song_2)
        .fetch_one(pool)
        .await
        .expect("postgres scrobble count after helper should load");
        assert_eq!(after_helper_count, initial_count + 1);

        ferrotune_lastfm::forward_scrobble(&database, user.id, &song_1, base_play.timestamp())
            .await
            .expect("postgres lastfm scrobble lookup should work without credentials");
        ferrotune_lastfm::update_now_playing(&database, user.id, &song_1)
            .await
            .expect("postgres lastfm now-playing lookup should work without credentials");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        subsonic_lists::scrobble(
            AuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-scrobble-test".to_string(),
            },
            State(state.clone()),
            Query(subsonic_lists::ScrobbleParams {
                id: song_2.clone(),
                time: Some((base_play + chrono::Duration::seconds(60)).timestamp()),
                submission: Some(true),
            }),
        )
        .await
        .expect("postgres subsonic scrobble handler should succeed");

        let after_subsonic_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND song_id = $2",
        )
        .bind(user.id)
        .bind(&song_2)
        .fetch_one(pool)
        .await
        .expect("postgres subsonic scrobble count should load");
        assert_eq!(after_subsonic_count, 2);

        ferrotune_scrobble(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Json(FerrotuneScrobbleParams {
                id: song_2.clone(),
                time: Some((base_play + chrono::Duration::seconds(62)).timestamp_millis()),
                submission: true,
                queue_source_type: Some("album".to_string()),
                queue_source_id: Some("album-1".to_string()),
            }),
        )
        .await
        .expect("postgres ferrotune scrobble handler should succeed");

        let deduped_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND song_id = $2",
        )
        .bind(user.id)
        .bind(&song_2)
        .fetch_one(pool)
        .await
        .expect("postgres deduped scrobble count should load");
        assert_eq!(deduped_count, 2);

        ferrotune_scrobble(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
            },
            State(state),
            Json(FerrotuneScrobbleParams {
                id: song_2.clone(),
                time: Some(
                    (base_play
                        + chrono::Duration::seconds(
                            60 + scrobbling::RECENT_SCROBBLE_DEDUP_WINDOW_SECS + 1,
                        ))
                    .timestamp_millis(),
                ),
                submission: true,
                queue_source_type: Some("album".to_string()),
                queue_source_id: Some("album-1".to_string()),
            }),
        )
        .await
        .expect("postgres ferrotune scrobble handler should insert after the dedupe window");

        let final_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM scrobbles WHERE user_id = $1 AND song_id = $2",
        )
        .bind(user.id)
        .bind(&song_2)
        .fetch_one(pool)
        .await
        .expect("postgres final scrobble count should load");
        assert_eq!(final_count, 3);
    });
}

#[test]
fn test_postgres_lastfm_config_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let staging_username = format!(
            "pg-tagger-test-{}-{}",
            user.id,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: staging_username.clone(),
            is_admin: user.is_admin,
        };

        let initial_auth_url = ferrotune_lastfm::get_auth_url(
            auth_user(),
            State(state.clone()),
            Query(ferrotune_lastfm::AuthUrlParams {
                callback_url: "https://example.com/callback?source=ferrotune".to_string(),
            }),
        )
        .await
        .expect("postgres lastfm auth-url handler should succeed before configuration")
        .0;
        assert!(!initial_auth_url.enabled);
        assert!(initial_auth_url.url.is_empty());

        let initial_config = ferrotune_lastfm::get_config(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm config handler should succeed before configuration")
            .0;
        assert!(initial_config.api_key.is_empty());
        assert!(initial_config.api_secret.is_empty());

        let initial_status = ferrotune_lastfm::status(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm status handler should succeed before configuration")
            .0;
        assert!(!initial_status.enabled);
        assert!(!initial_status.connected);
        assert!(initial_status.username.is_none());

        let saved_config = ferrotune_lastfm::save_config(
            auth_user(),
            State(state.clone()),
            Json(ferrotune_lastfm::SaveConfigRequest {
                api_key: "pg-lastfm-key".to_string(),
                api_secret: "pg-lastfm-secret".to_string(),
            }),
        )
        .await
        .expect("postgres lastfm save-config handler should succeed")
        .0;
        assert_eq!(saved_config.api_key, "pg-lastfm-key");
        assert_eq!(saved_config.api_secret, "pg-lastfm-secret");

        let configured_auth_url = ferrotune_lastfm::get_auth_url(
            auth_user(),
            State(state.clone()),
            Query(ferrotune_lastfm::AuthUrlParams {
                callback_url: "https://example.com/callback?source=ferrotune".to_string(),
            }),
        )
        .await
        .expect("postgres lastfm auth-url handler should succeed after configuration")
        .0;
        assert!(configured_auth_url.enabled);
        assert!(configured_auth_url.url.contains("pg-lastfm-key"));
        assert!(configured_auth_url
            .url
            .contains("callback%3Fsource%3Dferrotune"));

        let configured_status = ferrotune_lastfm::status(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm status handler should succeed after configuration")
            .0;
        assert!(configured_status.enabled);
        assert!(!configured_status.connected);
        assert!(configured_status.username.is_none());

        sqlx::query("UPDATE users SET lastfm_session_key = $1, lastfm_username = $2 WHERE id = $3")
            .bind("pg-session")
            .bind("pg-user")
            .bind(user.id)
            .execute(pool)
            .await
            .expect("postgres lastfm session should be seeded");

        let connected_status = ferrotune_lastfm::status(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm status handler should report the seeded session")
            .0;
        assert!(connected_status.enabled);
        assert!(connected_status.connected);
        assert_eq!(connected_status.username.as_deref(), Some("pg-user"));

        let disconnected = ferrotune_lastfm::disconnect(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm disconnect handler should succeed")
            .0;
        assert!(disconnected.success);
        assert!(disconnected.username.is_none());

        let final_status = ferrotune_lastfm::status(auth_user(), State(state.clone()))
            .await
            .expect("postgres lastfm status handler should reflect disconnect")
            .0;
        assert!(final_status.enabled);
        assert!(!final_status.connected);
        assert!(final_status.username.is_none());

        let final_config = ferrotune_lastfm::get_config(auth_user(), State(state))
            .await
            .expect("postgres lastfm config handler should preserve credentials after disconnect")
            .0;
        assert_eq!(final_config.api_key, "pg-lastfm-key");
        assert_eq!(final_config.api_secret, "pg-lastfm-secret");
    });
}

#[test]
fn test_postgres_scrobble_import_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        let imported = ferrotune_import_scrobbles(
            auth_user(),
            State(state.clone()),
            Json(ImportScrobblesRequest {
                entries: vec![
                    ImportScrobbleEntry {
                        song_id: song_1.clone(),
                        play_count: 3,
                    },
                    ImportScrobbleEntry {
                        song_id: song_2.clone(),
                        play_count: 2,
                    },
                ],
                mode: ImportMode::Append,
                description: Some("pg import".to_string()),
            }),
        )
        .await
        .expect("postgres scrobble import handler should succeed")
        .0;
        assert_eq!(imported.songs_imported, 2);
        assert_eq!(imported.total_plays_imported, 5);

        let duplicate = ferrotune_check_import_duplicate(
            auth_user(),
            State(state.clone()),
            Query(CheckDuplicateParams {
                description: "pg import".to_string(),
            }),
        )
        .await
        .expect("postgres duplicate-import handler should succeed")
        .0;
        assert!(duplicate.exists);
        assert_eq!(duplicate.song_count, 2);
        assert_eq!(duplicate.total_plays, 5);

        let initial_counts = ferrotune_get_play_counts(
            auth_user(),
            State(state.clone()),
            Json(GetPlayCountsRequest {
                song_ids: vec![song_1.clone(), song_2.clone()],
            }),
        )
        .await
        .expect("postgres play-count lookup should succeed after import")
        .0;
        let count_map: std::collections::HashMap<String, i64> = initial_counts
            .counts
            .into_iter()
            .map(|count| (count.song_id, count.play_count))
            .collect();
        assert_eq!(count_map.get(&song_1), Some(&5));
        assert_eq!(count_map.get(&song_2), Some(&2));

        let replaced = ferrotune_import_scrobbles(
            auth_user(),
            State(state.clone()),
            Json(ImportScrobblesRequest {
                entries: vec![ImportScrobbleEntry {
                    song_id: song_2.clone(),
                    play_count: 4,
                }],
                mode: ImportMode::Replace,
                description: Some("pg replace import".to_string()),
            }),
        )
        .await
        .expect("postgres replace-mode scrobble import handler should succeed")
        .0;
        assert_eq!(replaced.songs_imported, 1);
        assert_eq!(replaced.total_plays_imported, 4);

        let counts_after_replace = ferrotune_get_play_counts(
            auth_user(),
            State(state.clone()),
            Json(GetPlayCountsRequest {
                song_ids: vec![song_2.clone()],
            }),
        )
        .await
        .expect("postgres play-count lookup should succeed after replace import")
        .0;
        assert_eq!(counts_after_replace.counts.len(), 1);
        assert_eq!(counts_after_replace.counts[0].song_id, song_2);
        assert_eq!(counts_after_replace.counts[0].play_count, 4);

        let imported_with_timestamps = ferrotune_import_with_timestamps(
            auth_user(),
            State(state.clone()),
            Json(ImportWithTimestampsRequest {
                songs: vec![
                    ImportSongWithPlays {
                        song_id: song_1.clone(),
                        plays: vec![PlayEvent {
                            played_at: "2024-01-01T12:00:00Z".to_string(),
                            duration_seconds: 180,
                            is_scrobble: true,
                        }],
                    },
                    ImportSongWithPlays {
                        song_id: song_2.clone(),
                        plays: vec![PlayEvent {
                            played_at: "2024-01-02T15:30:00Z".to_string(),
                            duration_seconds: 90,
                            is_scrobble: false,
                        }],
                    },
                ],
                mode: ImportMode::Append,
                description: Some("pg timestamp import".to_string()),
            }),
        )
        .await
        .expect("postgres timestamped scrobble import handler should succeed")
        .0;
        assert_eq!(imported_with_timestamps.songs_imported, 2);
        assert_eq!(imported_with_timestamps.scrobbles_imported, 1);
        assert_eq!(imported_with_timestamps.sessions_imported, 2);

        let timestamp_duplicate = ferrotune_check_import_duplicate(
            auth_user(),
            State(state.clone()),
            Query(CheckDuplicateParams {
                description: "pg timestamp import".to_string(),
            }),
        )
        .await
        .expect("postgres timestamp duplicate lookup should succeed")
        .0;
        assert!(timestamp_duplicate.exists);
        assert_eq!(timestamp_duplicate.song_count, 1);
        assert_eq!(timestamp_duplicate.total_plays, 1);

        let final_counts = ferrotune_get_play_counts(
            auth_user(),
            State(state),
            Json(GetPlayCountsRequest {
                song_ids: vec![song_1.clone(), song_2.clone()],
            }),
        )
        .await
        .expect("postgres final play-count lookup should succeed")
        .0;
        let final_count_map: std::collections::HashMap<String, i64> = final_counts
            .counts
            .into_iter()
            .map(|count| (count.song_id, count.play_count))
            .collect();
        assert_eq!(final_count_map.get(&song_1), Some(&6));
        assert_eq!(final_count_map.get(&song_2), Some(&4));
    });
}

#[test]
fn test_postgres_listening_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        let created = ferrotune_log_listening(
            auth_user(),
            State(state.clone()),
            Json(LogListeningRequest {
                song_id: song_1.clone(),
                duration_seconds: 60,
                session_id: None,
                skipped: false,
            }),
        )
        .await
        .expect("postgres listening create handler should succeed")
        .0;

        let updated = ferrotune_log_listening(
            auth_user(),
            State(state.clone()),
            Json(LogListeningRequest {
                song_id: song_1.clone(),
                duration_seconds: 90,
                session_id: Some(created.session_id),
                skipped: true,
            }),
        )
        .await
        .expect("postgres listening update handler should succeed")
        .0;

        assert_eq!(updated.session_id, created.session_id);

        sqlx::query(
            r#"
            INSERT INTO listening_sessions (user_id, song_id, duration_seconds, skipped, listened_at)
            VALUES
                ($1, $2, $3, $4, CURRENT_TIMESTAMP - INTERVAL '10 days'),
                ($1, $5, $6, $7, CURRENT_TIMESTAMP - INTERVAL '40 days'),
                ($1, $8, $9, $10, CURRENT_TIMESTAMP - INTERVAL '400 days')
            "#,
        )
        .bind(user.id)
        .bind(&song_2)
        .bind(120_i64)
        .bind(false)
        .bind(&song_2)
        .bind(30_i64)
        .bind(true)
        .bind(&song_1)
        .bind(45_i64)
        .bind(false)
        .execute(pool)
        .await
        .expect("postgres listening history seed should succeed");

        let stats = ferrotune_get_listening_stats(auth_user(), State(state.clone()))
            .await
            .expect("postgres listening stats handler should succeed")
            .0;

        assert_eq!(stats.last_7_days.total_seconds, 90);
        assert_eq!(stats.last_7_days.session_count, 1);
        assert_eq!(stats.last_7_days.unique_songs, 1);
        assert_eq!(stats.last_7_days.skip_count, 1);
        assert_eq!(stats.last_7_days.scrobble_count, 2);

        assert_eq!(stats.last_30_days.total_seconds, 210);
        assert_eq!(stats.last_30_days.session_count, 2);
        assert_eq!(stats.last_30_days.unique_songs, 2);
        assert_eq!(stats.last_30_days.skip_count, 1);
        assert_eq!(stats.last_30_days.scrobble_count, 2);

        assert_eq!(stats.all_time.total_seconds, 285);
        assert_eq!(stats.all_time.session_count, 4);
        assert_eq!(stats.all_time.unique_songs, 2);
        assert_eq!(stats.all_time.skip_count, 2);
        assert_eq!(stats.all_time.scrobble_count, 2);

        assert!(stats.this_year.total_seconds >= stats.last_7_days.total_seconds);
        assert!(stats.this_year.session_count >= stats.last_7_days.session_count);
        assert!(stats.all_time.total_seconds >= stats.this_year.total_seconds);

        let current_year = Utc::now().year();
        let current_month = Utc::now().month() as i32;
        let review = ferrotune_get_period_review(
            auth_user(),
            State(state),
            Query(PeriodReviewQuery {
                year: Some(current_year),
                month: Some(current_month),
                inline_images: Default::default(),
            }),
        )
        .await
        .expect("postgres period review handler should succeed")
        .0;

        assert_eq!(review.review.year, current_year);
        assert_eq!(review.review.month, Some(current_month));
        assert!(review.review.total_play_count >= 1);
        assert!(review.review.total_listening_secs >= 90);
        assert!(review
            .review
            .top_tracks
            .iter()
            .any(|track| track.track_id == song_1));
        assert!(review
            .available_periods
            .iter()
            .any(|period| period.year == current_year && period.month.is_none()));
        assert!(review.available_periods.iter().any(|period| {
            period.year == current_year && period.month == Some(current_month)
        }));
    });
}

#[test]
fn test_postgres_playqueue_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let ferrotune_response = ferrotune_save_play_queue(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Json(SavePlayQueueRequest {
                song_ids: vec![song_1.clone(), song_2.clone()],
                current: Some(song_2.clone()),
                position: Some(12_345),
            }),
        )
        .await
        .expect("postgres ferrotune playqueue save should succeed");

        assert_eq!(ferrotune_response.0, axum::http::StatusCode::OK);
        assert!(ferrotune_response.1 .0.success);

        let session_id = format!("playqueue-{}", user.id);
        let ferrotune_queue =
            db::queries::get_play_queue_by_session(&database, &session_id, user.id)
                .await
                .expect("postgres ferrotune playqueue lookup should succeed")
                .expect("postgres ferrotune playqueue should exist");
        assert_eq!(ferrotune_queue.current_index, 1);
        assert_eq!(ferrotune_queue.position_ms, 12_345);
        assert_eq!(ferrotune_queue.changed_by, "ferrotune");

        let subsonic_auth = || AuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
            format: ResponseFormat::Json,
            client: "postgres-playqueue-test".to_string(),
        };

        let subsonic_params: subsonic_playqueue::SavePlayQueueParams =
            serde_json::from_value(serde_json::json!({
                "id": [song_2.clone(), song_1.clone()],
                "current": song_1.clone(),
                "position": 777,
            }))
            .expect("subsonic playqueue params should deserialize");

        subsonic_playqueue::save_play_queue(
            subsonic_auth(),
            State(state.clone()),
            QsQuery(subsonic_params),
        )
        .await
        .expect("postgres subsonic playqueue save should succeed");

        let restored = subsonic_playqueue::get_play_queue(subsonic_auth(), State(state))
            .await
            .expect("postgres subsonic playqueue restore should succeed");

        assert_eq!(
            restored.data.play_queue.current.as_deref(),
            Some(song_1.as_str())
        );
        assert_eq!(restored.data.play_queue.position, Some(777));
        assert_eq!(
            restored.data.play_queue.changed_by.as_deref(),
            Some("postgres-playqueue-test")
        );

        let restored_song_ids: Vec<String> = restored
            .data
            .play_queue
            .entry
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert_eq!(restored_song_ids, vec![song_2.clone(), song_1.clone()]);

        let subsonic_queue =
            db::queries::get_play_queue_by_session(&database, &session_id, user.id)
                .await
                .expect("postgres subsonic playqueue lookup should succeed")
                .expect("postgres subsonic playqueue should exist");
        assert_eq!(subsonic_queue.current_index, 1);
        assert_eq!(subsonic_queue.position_ms, 777);
        assert_eq!(subsonic_queue.changed_by, "postgres-playqueue-test");
    });
}

#[test]
fn test_postgres_preferences_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        let defaults = ferrotune_get_preferences(auth_user(), State(state.clone()))
            .await
            .expect("postgres get preferences handler should return defaults")
            .0;
        assert_eq!(defaults.accent_color, "rust");
        assert!(defaults.preferences.is_empty());

        let updated = ferrotune_update_preferences(
            auth_user(),
            State(state.clone()),
            Json(UpdatePreferencesRequest {
                accent_color: "teal".to_string(),
                custom_accent_hue: Some(180.0),
                custom_accent_lightness: Some(0.6),
                custom_accent_chroma: Some(0.2),
            }),
        )
        .await
        .expect("postgres update preferences handler should succeed")
        .0;
        assert_eq!(updated.accent_color, "teal");
        assert_eq!(updated.custom_accent_hue, Some(180.0));

        let set_response = ferrotune_set_preference(
            auth_user(),
            State(state.clone()),
            Path("queue.volume".to_string()),
            Json(SetPreferenceRequest {
                value: serde_json::json!(42),
            }),
        )
        .await
        .expect("postgres set preference handler should succeed")
        .0;
        assert_eq!(set_response.value, Some(serde_json::json!(42)));

        let single_preference = ferrotune_get_preference(
            auth_user(),
            State(state.clone()),
            Path("queue.volume".to_string()),
        )
        .await
        .expect("postgres get single preference handler should succeed")
        .0;
        assert_eq!(single_preference.value, Some(serde_json::json!(42)));

        let all_preferences = ferrotune_get_preferences(auth_user(), State(state.clone()))
            .await
            .expect("postgres get preferences handler should read stored values")
            .0;
        assert_eq!(all_preferences.accent_color, "teal");
        assert_eq!(
            all_preferences.preferences.get("queue.volume"),
            Some(&serde_json::json!(42))
        );

        let delete_status = ferrotune_delete_preference(
            auth_user(),
            State(state.clone()),
            Path("queue.volume".to_string()),
        )
        .await
        .expect("postgres delete preference handler should succeed");
        assert_eq!(delete_status, axum::http::StatusCode::NO_CONTENT);

        let deleted_preference = ferrotune_get_preference(
            auth_user(),
            State(state.clone()),
            Path("queue.volume".to_string()),
        )
        .await
        .expect("postgres get single preference handler should succeed after delete")
        .0;
        assert_eq!(deleted_preference.value, None);

        let remaining_preferences = ferrotune_get_preferences(auth_user(), State(state))
            .await
            .expect("postgres get preferences handler should preserve accent settings")
            .0;
        assert_eq!(remaining_preferences.accent_color, "teal");
        assert!(remaining_preferences.preferences.is_empty());
    });
}

#[test]
fn test_postgres_duplicates_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (_user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        sqlx::query("UPDATE songs SET full_file_hash = $1 WHERE id = $2 OR id = $3")
            .bind("duplicate-hash")
            .bind(&song_1)
            .bind(&song_2)
            .execute(pool)
            .await
            .expect("postgres duplicate hash seed should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_get_duplicates(State(state))
            .await
            .expect("postgres duplicates handler should succeed")
            .0;

        assert_eq!(response.group_count, 1);
        assert_eq!(response.total_duplicates, 2);
        assert_eq!(response.total_wasted_bytes, 5_000_000);
        assert_eq!(response.groups.len(), 1);
        assert_eq!(response.groups[0].hash, "duplicate-hash");
        assert_eq!(response.groups[0].count, 2);
        assert_eq!(response.groups[0].wasted_bytes, 5_000_000);

        let duplicate_ids: Vec<String> = response.groups[0]
            .files
            .iter()
            .map(|file| file.id.clone())
            .collect();
        assert_eq!(duplicate_ids, vec![song_1, song_2]);
    });
}

#[test]
fn test_postgres_setup_and_match_dictionary_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        // Setup: before completion
        let status = ferrotune::api::ferrotune::get_setup_status(State(state.clone()))
            .await
            .expect("postgres get_setup_status should succeed")
            .0;
        assert!(!status.setup_complete);
        assert!(status.has_users);
        assert!(status.has_music_folders);

        // Setup: complete it
        let _ = ferrotune::api::ferrotune::complete_setup(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
        )
        .await
        .expect("postgres complete_setup should succeed");

        let status = ferrotune::api::ferrotune::get_setup_status(State(state.clone()))
            .await
            .expect("postgres get_setup_status should succeed after complete")
            .0;
        assert!(status.setup_complete);

        // Match dictionary: save entry
        let save_response = ferrotune::api::ferrotune::save_match_dictionary(
            State(state.clone()),
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            Json(ferrotune::api::ferrotune::SaveMatchDictionaryRequest {
                entries: vec![ferrotune::api::ferrotune::MatchDictionaryEntry {
                    title: Some("Opening Track".to_string()),
                    artist: Some("Integration Artist".to_string()),
                    album: Some("Integration Album".to_string()),
                    duration: Some(180_000),
                    song_id: song_1.clone(),
                }],
            }),
        )
        .await
        .expect("postgres save_match_dictionary should succeed");
        assert_eq!(save_response.1 .0.saved, 1);

        // Match dictionary: read back
        let get_response = ferrotune::api::ferrotune::get_match_dictionary(
            State(state),
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
            },
        )
        .await
        .expect("postgres get_match_dictionary should succeed")
        .0;
        assert_eq!(get_response.entries.len(), 1);
        assert_eq!(get_response.entries[0].song_id, song_1);
        assert_eq!(
            get_response.entries[0].title.as_deref(),
            Some("Opening Track")
        );
    });
}

#[test]
fn test_postgres_recycle_bin_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        // Mark song_1 for deletion
        let mark_response = ferrotune::api::ferrotune::recycle_bin::mark_for_deletion(
            auth(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::recycle_bin::MarkForDeletionRequest {
                    song_ids: vec![song_1.clone(), song_2.clone()],
                },
            ),
        )
        .await
        .expect("mark_for_deletion should succeed")
        .0;
        assert_eq!(mark_response.marked_count, 2);

        // List recycle bin
        let list_response = ferrotune::api::ferrotune::recycle_bin::list_recycle_bin(
            auth(),
            State(state.clone()),
            axum::extract::Query(ferrotune::api::ferrotune::recycle_bin::RecycleBinParams {
                offset: None,
                limit: None,
            }),
        )
        .await
        .expect("list_recycle_bin should succeed")
        .0;
        assert_eq!(list_response.total_count, 2);
        assert_eq!(list_response.songs.len(), 2);

        // Restore song_1
        let restore_response = ferrotune::api::ferrotune::recycle_bin::restore_songs(
            auth(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::recycle_bin::RestoreSongsRequest {
                    song_ids: vec![song_1.clone()],
                },
            ),
        )
        .await
        .expect("restore_songs should succeed")
        .0;
        assert_eq!(restore_response.restored_count, 1);

        // Verify only song_2 remains in recycle bin
        let list_response = ferrotune::api::ferrotune::recycle_bin::list_recycle_bin(
            auth(),
            State(state.clone()),
            axum::extract::Query(ferrotune::api::ferrotune::recycle_bin::RecycleBinParams {
                offset: None,
                limit: None,
            }),
        )
        .await
        .expect("list_recycle_bin should succeed")
        .0;
        assert_eq!(list_response.total_count, 1);
        assert_eq!(list_response.songs[0].id, song_2);

        // Exercise delete_song via direct query to verify PG branch works.
        let deleted = ferrotune::db::queries::delete_song(&database, &song_2)
            .await
            .expect("delete_song should succeed on postgres");
        assert!(deleted);

        // Recycle bin should now be empty
        let list_response = ferrotune::api::ferrotune::recycle_bin::list_recycle_bin(
            auth(),
            State(state),
            axum::extract::Query(ferrotune::api::ferrotune::recycle_bin::RecycleBinParams {
                offset: None,
                limit: None,
            }),
        )
        .await
        .expect("list_recycle_bin should succeed")
        .0;
        assert_eq!(list_response.total_count, 0);
    });
}

#[test]
fn test_postgres_list_music_folders_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune::api::ferrotune::music_folders::list_music_folders(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
        )
        .await
        .expect("list_music_folders should succeed on postgres")
        .0;
        assert!(!response.music_folders.is_empty());
        let seeded_folder_id = response.music_folders[0].id;
        let stats = &response.music_folders[0].stats;
        assert!(stats.song_count >= 2);

        let admin_auth = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        let new_folder_path = std::env::temp_dir().join(format!(
            "ferrotune-pg-music-folder-{}-{}",
            user.id,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&new_folder_path)
            .expect("postgres music folder test directory should be created");

        let create_response = ferrotune::api::ferrotune::music_folders::create_music_folder(
            admin_auth(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::music_folders::CreateMusicFolderRequest {
                    name: "Imported Folder".to_string(),
                    path: new_folder_path.to_string_lossy().to_string(),
                    watch_enabled: true,
                },
            ),
        )
        .await
        .expect("create_music_folder should succeed on postgres")
        .into_response();
        assert_eq!(create_response.status(), axum::http::StatusCode::CREATED);
        let create_bytes = axum::body::to_bytes(create_response.into_body(), usize::MAX)
            .await
            .expect("create_music_folder response body should decode");
        let create_json: serde_json::Value = serde_json::from_slice(&create_bytes)
            .expect("create_music_folder response should be valid json");
        let created_folder_id = create_json["id"]
            .as_i64()
            .expect("create_music_folder response should include a numeric id");

        let update_response = ferrotune::api::ferrotune::music_folders::update_music_folder(
            admin_auth(),
            State(state.clone()),
            Path(created_folder_id),
            Json(
                ferrotune::api::ferrotune::music_folders::UpdateMusicFolderRequest {
                    name: Some("Imported Folder Renamed".to_string()),
                    enabled: Some(false),
                    watch_enabled: Some(false),
                },
            ),
        )
        .await
        .expect("update_music_folder should succeed on postgres")
        .into_response();
        assert_eq!(update_response.status(), axum::http::StatusCode::OK);

        let folder = ferrotune::api::ferrotune::music_folders::get_music_folder(
            admin_auth(),
            State(state.clone()),
            Path(created_folder_id),
        )
        .await
        .expect("get_music_folder should succeed on postgres")
        .0;
        assert_eq!(folder.name, "Imported Folder Renamed");
        assert!(!folder.enabled);
        assert!(!folder.watch_enabled);
        assert_eq!(folder.path, new_folder_path.to_string_lossy());

        let folder_stats = ferrotune::api::ferrotune::music_folders::get_music_folder_stats(
            admin_auth(),
            State(state.clone()),
            Path(created_folder_id),
        )
        .await
        .expect("get_music_folder_stats should succeed on postgres")
        .0;
        assert_eq!(folder_stats.song_count, 0);
        assert_eq!(folder_stats.album_count, 0);
        assert_eq!(folder_stats.artist_count, 0);

        let delete_created_response =
            ferrotune::api::ferrotune::music_folders::delete_music_folder(
                admin_auth(),
                State(state.clone()),
                Path(created_folder_id),
            )
            .await
            .expect("delete_music_folder for created folder should succeed on postgres")
            .into_response();
        assert_eq!(
            delete_created_response.status(),
            axum::http::StatusCode::NO_CONTENT
        );

        let delete_seeded_response = ferrotune::api::ferrotune::music_folders::delete_music_folder(
            admin_auth(),
            State(state.clone()),
            Path(seeded_folder_id),
        )
        .await
        .expect("delete_music_folder for seeded folder should succeed on postgres")
        .into_response();
        assert_eq!(
            delete_seeded_response.status(),
            axum::http::StatusCode::NO_CONTENT
        );

        let remaining_seeded_songs: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM songs WHERE music_folder_id = $1")
                .bind(seeded_folder_id)
                .fetch_one(pool)
                .await
                .expect("seeded folder song count query should succeed after delete");
        assert_eq!(remaining_seeded_songs, 0);

        let remaining_folder: Option<i64> =
            sqlx::query_scalar("SELECT id FROM music_folders WHERE id = $1")
                .bind(seeded_folder_id)
                .fetch_optional(pool)
                .await
                .expect("seeded folder existence query should succeed after delete");
        assert!(remaining_folder.is_none());

        let _ = std::fs::remove_dir_all(&new_folder_path);
    });
}

#[test]
fn test_postgres_directory_paged_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let library_id: i64 = sqlx::query_scalar("SELECT music_folder_id FROM songs WHERE id = $1")
            .bind(&song_1)
            .fetch_one(pool)
            .await
            .expect("postgres directory library id lookup should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: user.username.clone(),
            is_admin: user.is_admin,
        };

        let root_response = ferrotune::api::ferrotune::directory::get_directory_paged(
            auth_user(),
            State(state.clone()),
            Query(
                ferrotune::api::ferrotune::directory::GetDirectoryPagedParams {
                    library_id: Some(library_id),
                    path: None,
                    count: Some(50),
                    offset: Some(0),
                    sort: None,
                    sort_dir: None,
                    filter: None,
                    folders_only: None,
                    files_only: None,
                    inline_images:
                        ferrotune::api::subsonic::inline_thumbnails::InlineImagesParam::default(),
                },
            ),
        )
        .await
        .expect("postgres directory root handler should succeed")
        .0;
        assert_eq!(root_response.library_id, library_id);
        assert_eq!(root_response.folder_count, 1);
        assert_eq!(root_response.file_count, 0);
        assert_eq!(root_response.total, 1);
        assert_eq!(root_response.children.len(), 1);
        assert!(root_response.children[0].is_dir);
        assert_eq!(root_response.children[0].title, "Artist");
        assert_eq!(root_response.children[0].path.as_deref(), Some("Artist"));

        let album_response = ferrotune::api::ferrotune::directory::get_directory_paged(
            auth_user(),
            State(state),
            Query(
                ferrotune::api::ferrotune::directory::GetDirectoryPagedParams {
                    library_id: Some(library_id),
                    path: Some("Artist/Album".to_string()),
                    count: Some(50),
                    offset: Some(0),
                    sort: Some("name".to_string()),
                    sort_dir: Some("asc".to_string()),
                    filter: None,
                    folders_only: None,
                    files_only: None,
                    inline_images:
                        ferrotune::api::subsonic::inline_thumbnails::InlineImagesParam::default(),
                },
            ),
        )
        .await
        .expect("postgres directory nested handler should succeed")
        .0;
        assert_eq!(album_response.folder_count, 0);
        assert_eq!(album_response.file_count, 2);
        assert_eq!(album_response.total, 2);
        let titles: Vec<&str> = album_response
            .children
            .iter()
            .map(|child| child.title.as_str())
            .collect();
        assert!(titles.contains(&"Opening Track"));
        assert!(titles.contains(&"Closing Track"));
        assert!(album_response.children.iter().all(|child| !child.is_dir));
    });
}

#[test]
fn test_postgres_scan_specific_files_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");

        let library_dir = std::env::temp_dir().join(format!(
            "ferrotune-pg-scan-specific-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let song_path = library_dir.join("Artist/Album/01 - Simple.mp3");
        std::fs::create_dir_all(
            song_path
                .parent()
                .expect("scanned song path should have a parent directory"),
        )
        .expect("scan-specific test directories should be created");
        std::fs::copy(
            "/home/rasse/ferrotune/tests/fixtures/music/simple.mp3",
            &song_path,
        )
        .expect("scan-specific fixture should be copied into the temp library");

        let folder_id = db::repo::users::create_music_folder(
            &database,
            "Scanner Library",
            &library_dir.to_string_lossy(),
        )
        .await
        .expect("postgres scan-specific music folder should be created");

        ferrotune::scanner::scan_specific_files(&database, folder_id, vec![song_path.clone()])
            .await
            .expect("postgres scan_specific_files should insert scanned song");

        let scanned_song: Option<(String, i64, String)> = sqlx::query_as(
            "SELECT file_path, music_folder_id, file_format FROM songs WHERE music_folder_id = $1",
        )
        .bind(folder_id)
        .fetch_optional(pool)
        .await
        .expect("postgres scanned song lookup should succeed");

        let (relative_path, scanned_folder_id, file_format) =
            scanned_song.expect("scan_specific_files should create a song row");
        assert_eq!(relative_path, "Artist/Album/01 - Simple.mp3");
        assert_eq!(scanned_folder_id, folder_id);
        assert_eq!(file_format, "mp3");

        std::fs::remove_file(&song_path).expect("scanned song fixture should be removable");

        ferrotune::scanner::scan_specific_files(&database, folder_id, vec![song_path.clone()])
            .await
            .expect("postgres scan_specific_files should delete missing song row");

        let remaining_songs: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM songs WHERE music_folder_id = $1")
                .bind(folder_id)
                .fetch_one(pool)
                .await
                .expect("postgres remaining scanned song count should succeed");
        assert_eq!(remaining_songs, 0);

        let _ = std::fs::remove_dir_all(&library_dir);
    });
}

#[test]
fn test_postgres_scan_library_with_progress_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");

        let library_dir = std::env::temp_dir().join(format!(
            "ferrotune-pg-scan-library-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let song_path = library_dir.join("Artist/Album/01 - Simple.mp3");
        std::fs::create_dir_all(
            song_path
                .parent()
                .expect("scanned song path should have a parent directory"),
        )
        .expect("scan-library test directories should be created");
        std::fs::copy(
            "/home/rasse/ferrotune/tests/fixtures/music/simple.mp3",
            &song_path,
        )
        .expect("scan-library fixture should be copied into the temp library");

        let folder_id = db::repo::users::create_music_folder(
            &database,
            "Scanner Library",
            &library_dir.to_string_lossy(),
        )
        .await
        .expect("postgres scan-library music folder should be created");

        let scan_options = ferrotune::scanner::ScanOptions {
            full: true,
            folder_id: Some(folder_id),
            dry_run: false,
            analyze_replaygain: false,
            analyze_bliss: false,
            analyze_waveform: false,
            skip: None,
        };

        ferrotune::scanner::scan_library_with_progress(&database, scan_options, None)
            .await
            .expect("postgres scan_library_with_progress should insert scanned songs");

        let scanned_song: Option<(String, i64)> = sqlx::query_as(
            "SELECT file_path, music_folder_id FROM songs WHERE music_folder_id = $1",
        )
        .bind(folder_id)
        .fetch_optional(pool)
        .await
        .expect("postgres scan-library song lookup should succeed");

        let (relative_path, scanned_folder_id) =
            scanned_song.expect("scan_library_with_progress should create a song row");
        assert_eq!(relative_path, "Artist/Album/01 - Simple.mp3");
        assert_eq!(scanned_folder_id, folder_id);

        let folder_scanned: bool = sqlx::query_scalar(
            "SELECT last_scanned_at IS NOT NULL FROM music_folders WHERE id = $1",
        )
        .bind(folder_id)
        .fetch_one(pool)
        .await
        .expect("postgres scan-library folder timestamp lookup should succeed");
        assert!(folder_scanned);

        std::fs::remove_file(&song_path).expect("scanned song fixture should be removable");

        ferrotune::scanner::scan_library_with_progress(
            &database,
            ferrotune::scanner::ScanOptions {
                full: true,
                folder_id: Some(folder_id),
                dry_run: false,
                analyze_replaygain: false,
                analyze_bliss: false,
                analyze_waveform: false,
                skip: None,
            },
            None,
        )
        .await
        .expect("postgres scan_library_with_progress should delete missing songs");

        let remaining_songs: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM songs WHERE music_folder_id = $1")
                .bind(folder_id)
                .fetch_one(pool)
                .await
                .expect("postgres remaining scan-library song count should succeed");
        assert_eq!(remaining_songs, 0);

        let _ = std::fs::remove_dir_all(&library_dir);
    });
}

#[test]
fn test_postgres_users_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (admin_user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let folder_id = db::repo::users::get_music_folders(&database)
            .await
            .expect("postgres folder lookup should succeed")
            .first()
            .expect("seeded postgres library should have a music folder")
            .id;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let admin_auth = || FerrotuneAuthenticatedUser {
            user_id: admin_user.id,
            username: admin_user.username.clone(),
            is_admin: admin_user.is_admin,
        };

        let create_response = ferrotune::api::ferrotune::users::create_user(
            admin_auth(),
            State(state.clone()),
            Json(ferrotune::api::ferrotune::users::CreateUserRequest {
                username: "collab".to_string(),
                password: "secret123".to_string(),
                email: Some("collab@example.com".to_string()),
                is_admin: false,
                library_access: vec![folder_id],
            }),
        )
        .await
        .expect("postgres create_user handler should succeed")
        .into_response();
        assert_eq!(create_response.status(), axum::http::StatusCode::CREATED);

        let created_user = db::repo::users::get_user_by_username(&database, "collab")
            .await
            .expect("postgres user lookup should succeed")
            .expect("created user should exist");

        let library_access = ferrotune::api::ferrotune::users::get_library_access(
            admin_auth(),
            State(state.clone()),
            Path(created_user.id),
        )
        .await
        .expect("postgres get_library_access handler should succeed")
        .0;
        assert_eq!(library_access.folder_ids, vec![folder_id]);

        let api_key_response = ferrotune::api::ferrotune::users::create_api_key(
            admin_auth(),
            State(state.clone()),
            Path(created_user.id),
            Json(ferrotune::api::ferrotune::users::CreateApiKeyRequest {
                name: "desktop".to_string(),
            }),
        )
        .await
        .expect("postgres create_api_key handler should succeed")
        .into_response();
        assert_eq!(api_key_response.status(), axum::http::StatusCode::CREATED);

        let api_keys = ferrotune::api::ferrotune::users::list_api_keys(
            admin_auth(),
            State(state.clone()),
            Path(created_user.id),
        )
        .await
        .expect("postgres list_api_keys handler should succeed")
        .0;
        assert_eq!(api_keys.api_keys.len(), 1);
        assert_eq!(api_keys.api_keys[0].name, "desktop");

        let updated_user = ferrotune::api::ferrotune::users::update_user(
            admin_auth(),
            State(state.clone()),
            Path(created_user.id),
            Json(ferrotune::api::ferrotune::users::UpdateUserRequest {
                username: Some("collab-renamed".to_string()),
                password: Some("newsecret123".to_string()),
                email: Some("renamed@example.com".to_string()),
                is_admin: Some(true),
                library_access: Some(vec![]),
            }),
        )
        .await
        .expect("postgres update_user handler should succeed")
        .0;
        assert_eq!(updated_user.username, "collab-renamed");
        assert_eq!(updated_user.email.as_deref(), Some("renamed@example.com"));
        assert!(updated_user.is_admin);
        assert!(updated_user.library_access.is_empty());

        let _ = ferrotune::api::ferrotune::users::delete_api_key(
            admin_auth(),
            State(state.clone()),
            Path((created_user.id, "desktop".to_string())),
        )
        .await
        .expect("postgres delete_api_key handler should succeed")
        .into_response();

        let api_keys = ferrotune::api::ferrotune::users::list_api_keys(
            admin_auth(),
            State(state.clone()),
            Path(created_user.id),
        )
        .await
        .expect("postgres list_api_keys after delete should succeed")
        .0;
        assert!(api_keys.api_keys.is_empty());

        let delete_response = ferrotune::api::ferrotune::users::delete_user(
            admin_auth(),
            State(state),
            Path(created_user.id),
        )
        .await
        .expect("postgres delete_user handler should succeed")
        .into_response();
        assert_eq!(delete_response.status(), axum::http::StatusCode::NO_CONTENT);

        assert!(
            db::repo::users::get_user_by_username(&database, "collab-renamed")
                .await
                .expect("postgres lookup after delete should succeed")
                .is_none()
        );
    });
}

#[test]
fn test_postgres_tagger_core_helpers_and_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let session_id =
            ferrotune::api::ferrotune::tagger_session::get_or_create_session(&database, user.id)
                .await
                .expect("postgres get_or_create_session should succeed");
        assert!(session_id > 0);

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let seeded_script_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM tagger_scripts WHERE user_id = $1")
                .bind(user.id)
                .fetch_one(pool)
                .await
                .expect("postgres tagger_scripts count should succeed");
        assert_eq!(seeded_script_count, 5);

        let staged_track_ids =
            ferrotune::api::ferrotune::tagger_session::get_session_track_ids(&database, user.id)
                .await
                .expect("postgres get_session_track_ids should succeed");
        assert!(staged_track_ids.is_empty());

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let staging_username = format!(
            "pg-tagger-test-{}-{}",
            user.id,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let auth_user = || FerrotuneAuthenticatedUser {
            user_id: user.id,
            username: staging_username.clone(),
            is_admin: user.is_admin,
        };

        let update_status = ferrotune::api::ferrotune::tagger_session::update_session(
            auth_user(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::UpdateTaggerSessionRequest {
                    visible_columns: Some(vec!["TITLE".to_string(), "ARTIST".to_string()]),
                    active_rename_script_id: Some(format!("default-rename-{}", user.id)),
                    active_tag_script_id: Some(format!("default-trim-{}", user.id)),
                    target_library_id: Some("1".to_string()),
                    show_library_prefix: Some(true),
                    show_computed_path: Some(false),
                    column_widths: Some(HashMap::from([("TITLE".to_string(), 320)])),
                    file_column_width: Some(512),
                    details_panel_open: Some(false),
                    dangerous_char_mode: Some("strip".to_string()),
                    dangerous_char_replacement: Some("-".to_string()),
                },
            ),
        )
        .await
        .expect("postgres tagger update_session should succeed");
        assert_eq!(update_status, axum::http::StatusCode::NO_CONTENT);

        let set_tracks_status = ferrotune::api::ferrotune::tagger_session::set_session_tracks(
            auth_user(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::SetTaggerTracksRequest {
                    tracks: vec![
                        ferrotune::api::ferrotune::tagger_session::TaggerTrackEntry {
                            id: song_1.clone(),
                            track_type: "library".to_string(),
                        },
                        ferrotune::api::ferrotune::tagger_session::TaggerTrackEntry {
                            id: song_2.clone(),
                            track_type: "library".to_string(),
                        },
                    ],
                },
            ),
        )
        .await
        .expect("postgres tagger set_session_tracks should succeed");
        assert_eq!(set_tracks_status, axum::http::StatusCode::NO_CONTENT);

        let session = ferrotune::api::ferrotune::tagger_session::get_session(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres tagger get_session should succeed")
        .0;
        assert_eq!(session.visible_columns, vec!["TITLE", "ARTIST"]);
        assert_eq!(
            session.active_rename_script_id,
            Some(format!("default-rename-{}", user.id))
        );
        assert_eq!(
            session.active_tag_script_id,
            Some(format!("default-trim-{}", user.id))
        );
        assert_eq!(session.target_library_id.as_deref(), Some("1"));
        assert!(session.show_library_prefix);
        assert!(!session.show_computed_path);
        assert_eq!(session.column_widths.get("TITLE"), Some(&320));
        assert_eq!(session.file_column_width, 512);
        assert!(!session.details_panel_open);
        assert_eq!(session.dangerous_char_mode, "strip");
        assert_eq!(session.dangerous_char_replacement, "-");
        assert_eq!(session.tracks.len(), 2);
        assert_eq!(session.tracks[0].id, song_1);
        assert_eq!(session.tracks[1].id, song_2);

        let orphaned = ferrotune::api::ferrotune::tagger::discover_orphaned_files(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres discover_orphaned_files should succeed")
        .0;
        assert_eq!(orphaned.count, 0);
        assert!(orphaned.file_ids.is_empty());

        let song_paths =
            ferrotune::api::ferrotune::tagger::get_song_paths(auth_user(), State(state.clone()))
                .await
                .expect("postgres get_song_paths should succeed")
                .0;
        assert_eq!(song_paths.songs.len(), 2);
        assert!(song_paths
            .songs
            .iter()
            .any(|song| song.file_path.ends_with("Opening Track.mp3")));

        let scripts_response = ferrotune::api::ferrotune::tagger_session::get_scripts(
            auth_user(),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(scripts_response.status(), axum::http::StatusCode::OK);
        let scripts_bytes = axum::body::to_bytes(scripts_response.into_body(), usize::MAX)
            .await
            .expect("postgres tagger get_scripts response body should decode");
        let scripts_json: serde_json::Value = serde_json::from_slice(&scripts_bytes)
            .expect("postgres tagger get_scripts response should be valid json");
        assert_eq!(
            scripts_json["scripts"]
                .as_array()
                .expect("postgres tagger get_scripts should return an array")
                .len(),
            5
        );

        let save_scripts_status = ferrotune::api::ferrotune::tagger_session::save_scripts(
            auth_user(),
            State(state.clone()),
            Json(vec![
                ferrotune::api::ferrotune::tagger_session::TaggerScriptData {
                    id: "custom-rename".to_string(),
                    name: "Custom Rename".to_string(),
                    script_type: "rename".to_string(),
                    script: "return TITLE;".to_string(),
                },
            ]),
        )
        .await
        .expect("postgres tagger save_scripts should succeed");
        assert_eq!(save_scripts_status, axum::http::StatusCode::NO_CONTENT);

        let saved_scripts_response = ferrotune::api::ferrotune::tagger_session::get_scripts(
            auth_user(),
            State(state.clone()),
        )
        .await
        .into_response();
        let saved_scripts_bytes =
            axum::body::to_bytes(saved_scripts_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger saved scripts response body should decode");
        let saved_scripts_json: serde_json::Value = serde_json::from_slice(&saved_scripts_bytes)
            .expect("postgres tagger saved scripts response should be valid json");
        let saved_scripts = saved_scripts_json["scripts"]
            .as_array()
            .expect("postgres tagger saved scripts should return an array");
        assert_eq!(saved_scripts.len(), 1);
        assert_eq!(saved_scripts[0]["id"], "custom-rename");

        let delete_script_status = ferrotune::api::ferrotune::tagger_session::delete_script(
            auth_user(),
            State(state.clone()),
            Path("custom-rename".to_string()),
        )
        .await
        .expect("postgres tagger delete_script should succeed");
        assert_eq!(delete_script_status, axum::http::StatusCode::NO_CONTENT);

        let deleted_scripts_response = ferrotune::api::ferrotune::tagger_session::get_scripts(
            auth_user(),
            State(state.clone()),
        )
        .await
        .into_response();
        let deleted_scripts_bytes =
            axum::body::to_bytes(deleted_scripts_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger deleted scripts response body should decode");
        let deleted_scripts_json: serde_json::Value =
            serde_json::from_slice(&deleted_scripts_bytes)
                .expect("postgres tagger deleted scripts response should be valid json");
        assert!(deleted_scripts_json["scripts"]
            .as_array()
            .expect("postgres tagger deleted scripts should return an array")
            .is_empty());

        let update_edit_status = ferrotune::api::ferrotune::tagger_session::update_edit(
            auth_user(),
            State(state.clone()),
            Path(song_1.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::UpdatePendingEditRequest {
                    edited_tags: HashMap::from([(
                        "TITLE".to_string(),
                        "Retagged Opening".to_string(),
                    )]),
                    computed_path: Some(
                        "Artist One/Album One/01 - Retagged Opening.mp3".to_string(),
                    ),
                    cover_art_removed: true,
                },
            ),
        )
        .await
        .expect("postgres tagger update_edit should succeed");
        assert_eq!(update_edit_status, axum::http::StatusCode::NO_CONTENT);

        let pending_edits_response = ferrotune::api::ferrotune::tagger_session::get_pending_edits(
            auth_user(),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(pending_edits_response.status(), axum::http::StatusCode::OK);
        let pending_edits_bytes =
            axum::body::to_bytes(pending_edits_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger get_pending_edits response body should decode");
        let pending_edits_json: serde_json::Value = serde_json::from_slice(&pending_edits_bytes)
            .expect("postgres tagger get_pending_edits response should be valid json");
        let song_1_edit = pending_edits_json["edits"]
            .get(song_1.as_str())
            .expect("postgres tagger pending edits should contain song_1");
        assert_eq!(song_1_edit["editedTags"]["TITLE"], "Retagged Opening");
        assert_eq!(
            song_1_edit["computedPath"],
            "Artist One/Album One/01 - Retagged Opening.mp3"
        );
        assert_eq!(song_1_edit["coverArtRemoved"], true);

        let remove_track_status = ferrotune::api::ferrotune::tagger_session::remove_track(
            auth_user(),
            State(state.clone()),
            Path(song_2.clone()),
        )
        .await
        .expect("postgres tagger remove_track should succeed");
        assert_eq!(remove_track_status, axum::http::StatusCode::NO_CONTENT);

        let session_after_remove = ferrotune::api::ferrotune::tagger_session::get_session(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres tagger get_session after remove_track should succeed")
        .0;
        assert_eq!(session_after_remove.tracks.len(), 1);
        assert_eq!(session_after_remove.tracks[0].id, song_1);

        let add_tracks_status = ferrotune::api::ferrotune::tagger_session::add_tracks(
            auth_user(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::AddTracksRequest {
                    tracks: vec![
                        ferrotune::api::ferrotune::tagger_session::TaggerTrackEntry {
                            id: song_1.clone(),
                            track_type: "library".to_string(),
                        },
                        ferrotune::api::ferrotune::tagger_session::TaggerTrackEntry {
                            id: song_2.clone(),
                            track_type: "library".to_string(),
                        },
                    ],
                },
            ),
        )
        .await
        .expect("postgres tagger add_tracks should succeed");
        assert_eq!(add_tracks_status, axum::http::StatusCode::NO_CONTENT);

        let session_after_add = ferrotune::api::ferrotune::tagger_session::get_session(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres tagger get_session after add_tracks should succeed")
        .0;
        assert_eq!(session_after_add.tracks.len(), 2);
        assert_eq!(session_after_add.tracks[0].id, song_1);
        assert_eq!(session_after_add.tracks[1].id, song_2);

        let tagger_staging_dir = ferrotune::config::get_data_dir()
            .join("staging")
            .join(&staging_username);
        let cover_art_dir = tagger_staging_dir.join("cover_art");
        let replacement_audio_dir = tagger_staging_dir.join("replacement_audio");
        std::fs::create_dir_all(&cover_art_dir)
            .expect("postgres tagger cover_art directory should be created");
        std::fs::create_dir_all(&replacement_audio_dir)
            .expect("postgres tagger replacement_audio directory should be created");

        let song_1_cover_filename = "song-1-cover.png";
        let song_1_replacement_filename = "song-1-replacement.mp3";
        let song_2_cover_filename = "song-2-cover.png";
        let song_2_replacement_filename = "song-2-replacement.mp3";
        std::fs::write(cover_art_dir.join(song_1_cover_filename), b"\x89PNGsong1")
            .expect("postgres tagger song_1 cover art should be written");
        std::fs::write(
            replacement_audio_dir.join(song_1_replacement_filename),
            b"01234",
        )
        .expect("postgres tagger song_1 replacement audio should be written");
        std::fs::write(cover_art_dir.join(song_2_cover_filename), b"\x89PNGsong2")
            .expect("postgres tagger song_2 cover art should be written");
        std::fs::write(
            replacement_audio_dir.join(song_2_replacement_filename),
            b"abcde",
        )
        .expect("postgres tagger song_2 replacement audio should be written");

        let now = chrono::Utc::now();
        sqlx::query(
            r#"
            INSERT INTO tagger_pending_edits
                (session_id, track_id, track_type, edited_tags, cover_art_filename, cover_art_removed,
                 replacement_audio_filename, replacement_audio_original_name, created_at, updated_at)
            VALUES ($1, $2, 'library', $3, $4, FALSE, $5, $6, $7, $8)
            ON CONFLICT(session_id, track_id) DO UPDATE SET
                edited_tags = EXCLUDED.edited_tags,
                cover_art_filename = EXCLUDED.cover_art_filename,
                cover_art_removed = EXCLUDED.cover_art_removed,
                replacement_audio_filename = EXCLUDED.replacement_audio_filename,
                replacement_audio_original_name = EXCLUDED.replacement_audio_original_name,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(session_id)
        .bind(&song_1)
        .bind(r#"{"TITLE":"Retagged Opening"}"#)
        .bind(song_1_cover_filename)
        .bind(song_1_replacement_filename)
        .bind("Opening Replacement.mp3")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .expect("postgres tagger pending edit insert for song_1 should succeed");

        sqlx::query(
            r#"
            INSERT INTO tagger_pending_edits
                (session_id, track_id, track_type, edited_tags, cover_art_filename, cover_art_removed,
                 replacement_audio_filename, replacement_audio_original_name, created_at, updated_at)
            VALUES ($1, $2, 'library', $3, $4, FALSE, $5, $6, $7, $8)
            ON CONFLICT(session_id, track_id) DO UPDATE SET
                edited_tags = EXCLUDED.edited_tags,
                cover_art_filename = EXCLUDED.cover_art_filename,
                cover_art_removed = EXCLUDED.cover_art_removed,
                replacement_audio_filename = EXCLUDED.replacement_audio_filename,
                replacement_audio_original_name = EXCLUDED.replacement_audio_original_name,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(session_id)
        .bind(&song_2)
        .bind("{}")
        .bind(song_2_cover_filename)
        .bind(song_2_replacement_filename)
        .bind("Second Replacement.mp3")
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .expect("postgres tagger pending edit insert for song_2 should succeed");

        let cover_art_response = ferrotune::api::ferrotune::tagger_session::get_cover_art(
            auth_user(),
            State(state.clone()),
            Path(song_1.clone()),
        )
        .await
        .expect("postgres tagger get_cover_art should succeed")
        .into_response();
        assert_eq!(cover_art_response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            cover_art_response.headers().get(axum::http::header::CONTENT_TYPE),
            Some(&axum::http::HeaderValue::from_static("image/png"))
        );
        let cover_art_bytes = axum::body::to_bytes(cover_art_response.into_body(), usize::MAX)
            .await
            .expect("postgres tagger get_cover_art response body should decode");
        assert_eq!(cover_art_bytes.as_ref(), b"\x89PNGsong1");

        let mut range_headers = axum::http::HeaderMap::new();
        range_headers.insert(
            axum::http::header::RANGE,
            axum::http::HeaderValue::from_static("bytes=1-3"),
        );
        let stream_response = ferrotune::api::ferrotune::tagger_session::stream_replacement_audio(
            auth_user(),
            State(state.clone()),
            Path(song_1.clone()),
            range_headers,
        )
        .await
        .expect("postgres tagger stream_replacement_audio should succeed");
        assert_eq!(stream_response.status(), axum::http::StatusCode::PARTIAL_CONTENT);
        let stream_bytes = axum::body::to_bytes(stream_response.into_body(), usize::MAX)
            .await
            .expect("postgres tagger stream_replacement_audio body should decode");
        assert_eq!(stream_bytes.as_ref(), b"123");

        let delete_cover_art_status = ferrotune::api::ferrotune::tagger_session::delete_cover_art(
            auth_user(),
            State(state.clone()),
            Path(song_1.clone()),
        )
        .await
        .expect("postgres tagger delete_cover_art should succeed");
        assert_eq!(delete_cover_art_status, axum::http::StatusCode::NO_CONTENT);
        assert!(!cover_art_dir.join(song_1_cover_filename).exists());

        let delete_replacement_audio_status =
            ferrotune::api::ferrotune::tagger_session::delete_replacement_audio(
                auth_user(),
                State(state.clone()),
                Path(song_1.clone()),
            )
            .await
            .expect("postgres tagger delete_replacement_audio should succeed");
        assert_eq!(
            delete_replacement_audio_status,
            axum::http::StatusCode::NO_CONTENT
        );
        assert!(!replacement_audio_dir.join(song_1_replacement_filename).exists());

        let pending_after_asset_delete_response =
            ferrotune::api::ferrotune::tagger_session::get_pending_edits(
                auth_user(),
                State(state.clone()),
            )
            .await
            .into_response();
        let pending_after_asset_delete_bytes =
            axum::body::to_bytes(pending_after_asset_delete_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger pending edits after asset delete should decode");
        let pending_after_asset_delete_json: serde_json::Value =
            serde_json::from_slice(&pending_after_asset_delete_bytes)
                .expect("postgres tagger pending edits after asset delete should be valid json");
        let song_1_edit_after_asset_delete = pending_after_asset_delete_json["edits"]
            .get(song_1.as_str())
            .expect("postgres tagger song_1 edit should still exist after asset delete");
        assert_eq!(song_1_edit_after_asset_delete["hasCoverArt"], false);
        assert_eq!(song_1_edit_after_asset_delete["coverArtRemoved"], true);
        assert_eq!(song_1_edit_after_asset_delete["hasReplacementAudio"], false);
        assert!(song_1_edit_after_asset_delete["replacementAudioFilename"].is_null());
        assert!(song_1_edit_after_asset_delete["replacementAudioOriginalName"].is_null());

        let staged_track_id = "staged-track.mp3".to_string();
        std::fs::write(tagger_staging_dir.join(&staged_track_id), b"staged-audio")
            .expect("postgres tagger staged track file should be written");
        let add_staged_track_status = ferrotune::api::ferrotune::tagger_session::add_tracks(
            auth_user(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::AddTracksRequest {
                    tracks: vec![ferrotune::api::ferrotune::tagger_session::TaggerTrackEntry {
                        id: staged_track_id.clone(),
                        track_type: "staged".to_string(),
                    }],
                },
            ),
        )
        .await
        .expect("postgres tagger add staged track should succeed");
        assert_eq!(add_staged_track_status, axum::http::StatusCode::NO_CONTENT);

        let remove_tracks_status = ferrotune::api::ferrotune::tagger_session::remove_tracks(
            auth_user(),
            State(state.clone()),
            Json(
                ferrotune::api::ferrotune::tagger_session::RemoveTracksRequest {
                    track_ids: vec![song_2.clone(), staged_track_id.clone()],
                },
            ),
        )
        .await
        .expect("postgres tagger remove_tracks should succeed");
        assert_eq!(remove_tracks_status, axum::http::StatusCode::NO_CONTENT);
        assert!(!cover_art_dir.join(song_2_cover_filename).exists());
        assert!(!replacement_audio_dir.join(song_2_replacement_filename).exists());
        assert!(!tagger_staging_dir.join(&staged_track_id).exists());

        let session_after_bulk_remove = ferrotune::api::ferrotune::tagger_session::get_session(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres tagger get_session after remove_tracks should succeed")
        .0;
        assert_eq!(session_after_bulk_remove.tracks.len(), 1);
        assert_eq!(session_after_bulk_remove.tracks[0].id, song_1);

        let pending_after_bulk_remove_response =
            ferrotune::api::ferrotune::tagger_session::get_pending_edits(
                auth_user(),
                State(state.clone()),
            )
            .await
            .into_response();
        let pending_after_bulk_remove_bytes =
            axum::body::to_bytes(pending_after_bulk_remove_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger pending edits after remove_tracks should decode");
        let pending_after_bulk_remove_json: serde_json::Value =
            serde_json::from_slice(&pending_after_bulk_remove_bytes)
                .expect("postgres tagger pending edits after remove_tracks should be valid json");
        assert!(pending_after_bulk_remove_json["edits"]
            .get(song_2.as_str())
            .is_none());

        let save_library_dir = std::env::temp_dir().join(format!(
            "ferrotune-pg-tagger-save-{}-{}",
            user.id,
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let save_song_path = save_library_dir.join("Artist/Album/01 - Opening Track.mp3");
        std::fs::create_dir_all(
            save_song_path
                .parent()
                .expect("postgres tagger save song path should have a parent directory"),
        )
        .expect("postgres tagger save library directory should be created");
        std::fs::copy(
            "/home/rasse/ferrotune/tests/fixtures/music/simple.mp3",
            &save_song_path,
        )
        .expect("postgres tagger save fixture should be copied into the temp library");

        let seeded_music_folder_id: i64 =
            sqlx::query_scalar("SELECT music_folder_id FROM songs WHERE id = $1")
                .bind(&song_1)
                .fetch_one(pool)
                .await
                .expect("postgres tagger seeded music folder lookup should succeed");
        sqlx::query("UPDATE music_folders SET path = $1 WHERE id = $2")
            .bind(save_library_dir.to_string_lossy().to_string())
            .bind(seeded_music_folder_id)
            .execute(pool)
            .await
            .expect("postgres tagger seeded music folder path update should succeed");

        let save_pending_edits_response =
            ferrotune::api::ferrotune::tagger_session::save_pending_edits(
                auth_user(),
                State(state.clone()),
                Json(
                    ferrotune::api::ferrotune::tagger_session::SavePendingEditsRequest {
                        track_ids: vec![song_1.clone()],
                        path_overrides: HashMap::new(),
                        target_music_folder_id: None,
                    },
                ),
            )
            .await
            .expect("postgres tagger save_pending_edits should succeed");
        assert_eq!(
            save_pending_edits_response.status(),
            axum::http::StatusCode::OK
        );
        let save_pending_edits_bytes =
            axum::body::to_bytes(save_pending_edits_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger save_pending_edits response body should decode");
        let save_pending_edits_json: serde_json::Value =
            serde_json::from_slice(&save_pending_edits_bytes)
                .expect("postgres tagger save_pending_edits response should be valid json");
        assert_eq!(save_pending_edits_json["success"], true);
        assert_eq!(save_pending_edits_json["savedCount"], 1);
        assert_eq!(save_pending_edits_json["rescanRecommended"], true);

        let saved_title = {
            use lofty::prelude::*;
            use lofty::probe::Probe;

            let renamed_save_song_path = save_library_dir.join("Artist One/Album One/01 - Retagged Opening.mp3");
            let tagged_file = Probe::open(&renamed_save_song_path)
                .and_then(|probe| probe.read())
                .expect("postgres tagger saved audio file should be readable");
            tagged_file
                .primary_tag()
                .and_then(|tag| tag.title())
                .map(|title| title.to_string())
                .expect("postgres tagger saved audio file should have a title tag")
        };
        assert_eq!(saved_title, "Retagged Opening");

        let pending_after_save_response =
            ferrotune::api::ferrotune::tagger_session::get_pending_edits(
                auth_user(),
                State(state.clone()),
            )
            .await
            .into_response();
        let pending_after_save_bytes =
            axum::body::to_bytes(pending_after_save_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger pending edits after save should decode");
        let pending_after_save_json: serde_json::Value =
            serde_json::from_slice(&pending_after_save_bytes)
                .expect("postgres tagger pending edits after save should be valid json");
        assert!(pending_after_save_json["edits"]
            .as_object()
            .expect("postgres tagger pending edits after save should be an object")
            .is_empty());

        let clear_pending_edits_status =
            ferrotune::api::ferrotune::tagger_session::clear_pending_edits(
                auth_user(),
                State(state.clone()),
            )
            .await
            .expect("postgres tagger clear_pending_edits should succeed");
        assert_eq!(
            clear_pending_edits_status,
            axum::http::StatusCode::NO_CONTENT
        );

        let cleared_pending_edits_response =
            ferrotune::api::ferrotune::tagger_session::get_pending_edits(
                auth_user(),
                State(state.clone()),
            )
            .await
            .into_response();
        let cleared_pending_edits_bytes =
            axum::body::to_bytes(cleared_pending_edits_response.into_body(), usize::MAX)
                .await
                .expect("postgres tagger cleared pending edits response body should decode");
        let cleared_pending_edits_json: serde_json::Value =
            serde_json::from_slice(&cleared_pending_edits_bytes)
                .expect("postgres tagger cleared pending edits response should be valid json");
        assert!(cleared_pending_edits_json["edits"]
            .as_object()
            .expect("postgres tagger cleared pending edits should be an object")
            .is_empty());

        let clear_session_status = ferrotune::api::ferrotune::tagger_session::clear_session(
            auth_user(),
            State(state.clone()),
        )
        .await
        .expect("postgres tagger clear_session should succeed");
        assert_eq!(clear_session_status, axum::http::StatusCode::NO_CONTENT);

        let cleared_session =
            ferrotune::api::ferrotune::tagger_session::get_session(auth_user(), State(state))
                .await
                .expect("postgres tagger get_session after clear_session should succeed")
                .0;
        assert!(cleared_session.tracks.is_empty());

        let _ = std::fs::remove_dir_all(&save_library_dir);
        let _ = std::fs::remove_dir_all(&tagger_staging_dir);
    });
}

#[test]
fn test_postgres_stats_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let stats = ferrotune_get_stats(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
            },
            State(state),
        )
        .await
        .expect("postgres stats handler should succeed")
        .0;

        assert_eq!(stats.song_count, 2);
        assert_eq!(stats.album_count, 1);
        assert_eq!(stats.artist_count, 1);
        assert_eq!(stats.genre_count, 1);
        assert_eq!(stats.playlist_count, 0);
        assert_eq!(stats.total_duration_seconds, 360);
        assert_eq!(stats.total_size_bytes, 10_000_000);
        assert_eq!(stats.total_plays, 2);
    });
}

#[test]
fn test_postgres_waveform_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let expected_heights = vec![0.2_f32, 0.8_f32, 1.0_f32];
        let waveform_blob = ferrotune::analysis::waveform_to_blob(&expected_heights);
        sqlx::query("UPDATE songs SET waveform_data = $1 WHERE id = $2")
            .bind(waveform_blob)
            .bind(&song_1)
            .execute(pool)
            .await
            .expect("postgres waveform blob should be stored");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_get_waveform(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
            },
            State(state),
            Path(song_1),
        )
        .await
        .expect("postgres waveform handler should succeed")
        .0;

        assert_eq!(response.heights.len(), expected_heights.len());
        for (actual, expected) in response.heights.iter().zip(expected_heights.iter()) {
            assert!((actual - expected).abs() < f32::EPSILON);
        }
    });
}

#[test]
fn test_postgres_home_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, album_id, _song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        sqlx::query(
            "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
              VALUES ($1, $2, NOW() - INTERVAL '121 days', TRUE, 5, NULL),
                  ($1, $2, NOW() - INTERVAL '120 days', TRUE, 5, NULL)",
        )
        .bind(user.id)
        .bind(&song_2)
        .execute(pool)
        .await
        .expect("postgres forgotten-favorites scrobbles should be inserted");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_get_home(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
            },
            State(state),
            Query(HomePageParams {
                size: Some(10),
                inline_images: None,
                discover_seed: Some(7),
                forgotten_fav_seed: Some(42),
            }),
        )
        .await
        .expect("postgres ferrotune home handler should succeed")
        .0;

        assert!(response.continue_listening.total >= 1);
        assert_eq!(response.most_played_recently.total, Some(1));
        assert_eq!(response.recently_added.total, Some(1));
        assert_eq!(response.discover.total, Some(1));
        assert_eq!(response.most_played_recently.album.len(), 1);
        assert_eq!(response.recently_added.album.len(), 1);
        assert_eq!(response.discover.album.len(), 1);
        assert_eq!(response.most_played_recently.album[0].id, album_id);
        assert_eq!(response.recently_added.album[0].id, album_id);
        assert_eq!(response.discover.album[0].id, album_id);
        assert_eq!(response.forgotten_favorites.total, 1);
        assert_eq!(response.forgotten_favorites.song.len(), 1);
        assert_eq!(response.forgotten_favorites.song[0].id, song_2);
        assert_eq!(response.forgotten_favorites.seed, 42);
    });
}

#[test]
fn test_postgres_auth_bootstrap_queries_work() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("PostgreSQL testcontainer should start");

    let host = container
        .get_host()
        .expect("container host should be available")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("container port should be mapped");

    let config = postgres_config(&host, port);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime should build");

    runtime.block_on(async {
        let database = db::create_pool(&config)
            .await
            .expect("PostgreSQL config should create a runtime database pool");

        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;
        assert!(user.is_admin, "bootstrap admin should be marked admin");

        let folders = db::repo::users::get_music_folders_for_user(&database, user.id)
            .await
            .expect("postgres library access lookup should succeed");
        assert_eq!(
            folders.len(),
            1,
            "admin should be granted existing folder access"
        );
        assert_eq!(folders[0].path, "/music");

        sqlx::query(
            "INSERT INTO api_keys (token, user_id, name, created_at) VALUES ($1, $2, $3, NOW())",
        )
        .bind("test-token")
        .bind(user.id)
        .bind("integration")
        .execute(
            database
                .postgres_pool()
                .expect("postgres runtime database should expose a PgPool"),
        )
        .await
        .expect("postgres api_keys insert should succeed");

        let api_key_user = db::repo::users::get_user_by_api_key(&database, "test-token")
            .await
            .expect("postgres api key lookup should succeed")
            .expect("api key lookup should return the linked user");
        assert_eq!(api_key_user.id, user.id);

        let updated = db::repo::users::update_user_password(
            &database,
            "admin",
            "updated-password-hash",
            "updated-subsonic-token",
        )
        .await
        .expect("postgres password updates should succeed");
        assert!(updated, "existing postgres user should be updated");

        let reloaded_user = db::repo::users::get_user_by_username(&database, "admin")
            .await
            .expect("postgres user lookup should still succeed")
            .expect("updated postgres user should still exist");
        assert_eq!(reloaded_user.password_hash, "updated-password-hash");
        assert_eq!(
            reloaded_user.subsonic_token.as_deref(),
            Some("updated-subsonic-token")
        );
    });
}

#[test]
fn test_postgres_browse_library_reads_work() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("PostgreSQL testcontainer should start");

    let host = container
        .get_host()
        .expect("container host should be available")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("container port should be mapped");

    let config = postgres_config(&host, port);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime should build");

    runtime.block_on(async {
        let database = db::create_pool(&config)
            .await
            .expect("PostgreSQL config should create a runtime database pool");

        let (user, artist_id, album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let artists = browse::get_artists_logic(&database, user.id)
            .await
            .expect("postgres artist browse should succeed");
        assert_eq!(artists.index.len(), 1);
        assert_eq!(artists.index[0].artist.len(), 1);
        assert_eq!(artists.index[0].artist[0].id, artist_id);
        assert_eq!(artists.index[0].artist[0].user_rating, Some(4));

        let artist_detail =
            browse::get_artist_logic(&database, user.id, &artist_id, None, None, None)
                .await
                .expect("postgres artist detail should succeed");
        assert_eq!(artist_detail.album.len(), 1);
        assert_eq!(artist_detail.song.len(), 2);
        assert_eq!(artist_detail.user_rating, Some(4));
        assert_eq!(artist_detail.album[0].id, album_id);
        assert_eq!(artist_detail.album[0].user_rating, Some(5));
        assert_eq!(artist_detail.song[0].id, song_1);
        assert_eq!(artist_detail.song[0].play_count, Some(2));
        assert_eq!(artist_detail.song[0].user_rating, Some(3));

        let album_detail = browse::get_album_logic(&database, user.id, &album_id, None, None, None)
            .await
            .expect("postgres album detail should succeed");
        assert_eq!(album_detail.song.len(), 2);
        assert_eq!(album_detail.user_rating, Some(5));
        assert_eq!(album_detail.song[0].id, song_1);
        assert_eq!(album_detail.song[0].play_count, Some(2));

        let song_detail = browse::get_song_logic(&database, user.id, &song_1)
            .await
            .expect("postgres song detail should succeed");
        assert_eq!(song_detail.id, song_1);
        assert_eq!(song_detail.user_rating, Some(3));
        assert_eq!(song_detail.play_count, Some(2));
        assert_eq!(
            song_detail.full_path.as_deref(),
            Some("/music/Artist/Album/01 - Opening Track.mp3")
        );
    });
}

#[test]
fn test_postgres_genres_indexes_and_starring_work() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("PostgreSQL testcontainer should start");

    let host = container
        .get_host()
        .expect("container host should be available")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("container port should be mapped");

    let config = postgres_config(&host, port);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime should build");

    runtime.block_on(async {
        let database = db::create_pool(&config)
            .await
            .expect("PostgreSQL config should create a runtime database pool");

        let (user, artist_id, album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let genres = browse::get_genres_logic(&database, user.id)
            .await
            .expect("postgres genres browse should succeed");
        assert_eq!(genres.genre.len(), 1);
        assert_eq!(genres.genre[0].name, "rock");
        assert_eq!(genres.genre[0].song_count, 2);
        assert_eq!(genres.genre[0].album_count, 1);

        let (indexes, _last_modified) = browse::get_indexes_logic(&database, user.id, None)
            .await
            .expect("postgres indexes browse should succeed");
        assert_eq!(indexes.len(), 1);
        assert_eq!(indexes[0].name, "A");
        assert_eq!(indexes[0].artist.len(), 1);
        assert_eq!(indexes[0].artist[0].name, "Artist");

        let (artists, albums, songs) = starring::fetch_starred_content(&database, user.id)
            .await
            .expect("postgres starred content fetch should succeed");
        assert_eq!(artists.len(), 1);
        assert_eq!(albums.len(), 1);
        assert_eq!(songs.len(), 1);
        assert_eq!(artists[0].id, artist_id);
        assert_eq!(albums[0].id, album_id);
        assert_eq!(songs[0].id, song_1);

        let empty_ids: &[String] = &[];
        starring::star_items(
            &database,
            user.id,
            std::slice::from_ref(&song_2),
            empty_ids,
            empty_ids,
        )
        .await
        .expect("postgres star writes should succeed");

        starring::set_item_rating(&database, user.id, &song_2, 4)
            .await
            .expect("postgres ratings writes should succeed");

        let ratings = starring::get_ratings_map(
            &database,
            user.id,
            db::models::ItemType::Song,
            &[song_1.clone(), song_2.clone()],
        )
        .await
        .expect("postgres ratings lookup should succeed");
        assert_eq!(ratings.get(&song_2), Some(&4));

        let (_artists, _albums, songs) = starring::fetch_starred_content(&database, user.id)
            .await
            .expect("postgres starred content fetch should still succeed");
        assert_eq!(songs.len(), 2);
        assert!(songs.iter().any(|song| song.id == song_2));

        let now = Utc::now();
        let favorites_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "favorites".to_string(),
            source_id: None,
            source_name: Some("Favorites".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: None,
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let favorites_count = get_lazy_queue_count(&database, &favorites_queue, user.id)
            .await
            .expect("postgres favorites queue count should materialize");
        assert_eq!(favorites_count, 2);

        let favorites_page =
            materialize_lazy_queue_page(&database, &favorites_queue, user.id, 0, 10)
                .await
                .expect("postgres favorites queue page should materialize");
        assert_eq!(favorites_page.len(), 2);
        assert!(favorites_page.iter().any(|song| song.id == song_1));
        assert!(favorites_page.iter().any(|song| song.id == song_2));

        starring::unstar_items(
            &database,
            user.id,
            std::slice::from_ref(&song_2),
            empty_ids,
            empty_ids,
        )
        .await
        .expect("postgres unstar writes should succeed");

        starring::set_item_rating(&database, user.id, &song_2, 0)
            .await
            .expect("postgres rating removal should succeed");

        let ratings = starring::get_ratings_map(
            &database,
            user.id,
            db::models::ItemType::Song,
            std::slice::from_ref(&song_2),
        )
        .await
        .expect("postgres ratings lookup should still succeed");
        assert!(!ratings.contains_key(&song_2));

        let (_artists, _albums, songs) = starring::fetch_starred_content(&database, user.id)
            .await
            .expect("postgres starred content fetch should succeed after unstar");
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, song_1);

        let favorites_count = get_lazy_queue_count(&database, &favorites_queue, user.id)
            .await
            .expect("postgres favorites queue count should shrink after unstar");
        assert_eq!(favorites_count, 1);
    });
}

#[test]
fn test_postgres_explicit_song_id_queue_page_materializes_in_order() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let now = Utc::now();
        let explicit_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "other".to_string(),
            source_id: None,
            source_name: Some("Explicit queue".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: None,
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: Some(2),
            is_lazy: true,
            song_ids_json: Some(
                serde_json::to_string(&vec![song_2.clone(), song_1.clone()])
                    .expect("song ids should serialize"),
            ),
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let page = materialize_lazy_queue_page(&database, &explicit_queue, user.id, 0, 10)
            .await
            .expect("postgres explicit-id queue page should materialize");
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].id, song_2);
        assert_eq!(page[1].id, song_1);
    });
}

#[test]
fn test_postgres_session_queue_queries_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let session = db::queries::get_or_create_session(&database, user.id)
            .await
            .expect("postgres session bootstrap should succeed");
        let same_session = db::queries::get_or_create_session(&database, user.id)
            .await
            .expect("postgres session lookup should return the existing session");
        assert_eq!(same_session.id, session.id);

        let user_session = db::queries::get_user_session(&database, user.id)
            .await
            .expect("postgres user session lookup should succeed")
            .expect("postgres user session should exist after bootstrap");
        assert_eq!(user_session.id, session.id);

        let updated_owner =
            db::queries::update_session_owner(&database, &session.id, Some("client-a"), "Client A")
                .await
                .expect("postgres owner update should succeed");
        assert!(updated_owner);

        db::queries::create_queue_for_session(
            &database,
            user.id,
            &session.id,
            "other",
            None,
            Some("Integration queue"),
            &[song_1.clone(), song_2.clone()],
            None,
            0,
            false,
            None,
            None,
            "off",
            None,
            None,
            "postgres-container-test",
        )
        .await
        .expect("postgres queue creation should succeed");

        let queue = db::queries::get_play_queue_by_session(&database, &session.id, user.id)
            .await
            .expect("postgres queue lookup should succeed")
            .expect("postgres queue should exist after creation");
        assert_eq!(queue.current_index, 0);
        assert_eq!(queue.total_count, Some(2));

        let entries = db::queries::get_queue_entries_with_songs_by_session(&database, &session.id)
            .await
            .expect("postgres queue entry lookup should succeed");
        let entry_ids: Vec<String> = entries.iter().map(|entry| entry.id.clone()).collect();
        assert_eq!(entry_ids, vec![song_1.clone(), song_2.clone()]);

        db::queries::update_session_heartbeat_with_position(
            &database,
            &session.id,
            true,
            Some(&song_2),
            Some("Closing Track"),
            Some("Integration Artist"),
            Some(1),
            Some(42_000),
        )
        .await
        .expect("postgres heartbeat update should succeed");

        let session_after_heartbeat = db::queries::get_session(&database, &session.id, user.id)
            .await
            .expect("postgres session lookup should succeed")
            .expect("postgres session should still exist");
        assert!(session_after_heartbeat.is_playing);
        assert_eq!(
            session_after_heartbeat.current_song_id.as_deref(),
            Some(song_2.as_str())
        );

        let queue = db::queries::get_play_queue_by_session(&database, &session.id, user.id)
            .await
            .expect("postgres queue lookup should still succeed")
            .expect("postgres queue should still exist");
        assert_eq!(queue.current_index, 1);
        assert_eq!(queue.position_ms, 42_000);

        let new_len = db::queries::add_to_queue_by_session(
            &database,
            user.id,
            &session.id,
            std::slice::from_ref(&song_1),
            1,
        )
        .await
        .expect("postgres queue insert should succeed");
        assert_eq!(new_len, 3);

        let song_ids = db::queries::get_queue_song_ids_by_session(&database, &session.id)
            .await
            .expect("postgres queue song id lookup should succeed");
        assert_eq!(
            song_ids,
            vec![song_1.clone(), song_1.clone(), song_2.clone()]
        );

        let moved = db::queries::move_in_queue_by_session(&database, &session.id, 2, 0)
            .await
            .expect("postgres queue move should succeed");
        assert!(moved);

        let song_ids = db::queries::get_queue_song_ids_by_session(&database, &session.id)
            .await
            .expect("postgres queue song id lookup should still succeed");
        assert_eq!(
            song_ids,
            vec![song_2.clone(), song_1.clone(), song_1.clone()]
        );

        let removed = db::queries::remove_from_queue_by_session(&database, &session.id, 1)
            .await
            .expect("postgres queue removal should succeed");
        assert!(removed);

        let song_ids = db::queries::get_queue_song_ids_by_session(&database, &session.id)
            .await
            .expect("postgres queue song id lookup should still succeed after removal");
        assert_eq!(song_ids, vec![song_2.clone(), song_1.clone()]);

        let queue_before_shuffle =
            db::queries::get_play_queue_by_session(&database, &session.id, user.id)
                .await
                .expect("postgres queue lookup should succeed before shuffle")
                .expect("postgres queue should still exist before shuffle");
        let updated_shuffle = db::queries::update_queue_shuffle_by_session(
            &database,
            &session.id,
            true,
            Some(123),
            Some("[1,0]"),
            0,
            9_000,
            Some(queue_before_shuffle.version),
        )
        .await
        .expect("postgres shuffle update should succeed");
        assert!(updated_shuffle);

        let updated_repeat =
            db::queries::update_queue_repeat_mode_by_session(&database, &session.id, "all")
                .await
                .expect("postgres repeat-mode update should succeed");
        assert!(updated_repeat);

        let cached_ids_json = serde_json::to_string(&vec![song_2.clone(), song_1.clone()])
            .expect("cached song ids should serialize");
        let updated_song_ids = db::queries::update_queue_song_ids_by_session(
            &database,
            &session.id,
            Some(&cached_ids_json),
        )
        .await
        .expect("postgres song-id cache update should succeed");
        assert!(updated_song_ids);

        let queue_after_updates =
            db::queries::get_play_queue_by_session(&database, &session.id, user.id)
                .await
                .expect("postgres queue lookup should succeed after updates")
                .expect("postgres queue should still exist after updates");
        assert!(queue_after_updates.is_shuffled);
        assert_eq!(queue_after_updates.repeat_mode, "all");
        assert_eq!(
            queue_after_updates.song_ids_json.as_deref(),
            Some(cached_ids_json.as_str())
        );
        assert_eq!(queue_after_updates.position_ms, 9_000);
        assert_eq!(
            queue_after_updates.version,
            queue_before_shuffle.version + 1
        );

        let range_entries =
            db::queries::get_queue_entries_range_by_session(&database, &session.id, 0, 2)
                .await
                .expect("postgres queue range lookup should succeed");
        let range_ids: Vec<String> = range_entries.iter().map(|entry| entry.id.clone()).collect();
        assert_eq!(range_ids, vec![song_2.clone(), song_1.clone()]);

        let position_entries =
            db::queries::get_queue_entries_at_positions_by_session(&database, &session.id, &[1])
                .await
                .expect("postgres queue position lookup should succeed");
        assert_eq!(position_entries.len(), 1);
        assert_eq!(position_entries[0].id, song_1);

        let touched = db::queries::touch_session_last_playing_at(&database, &session.id)
            .await
            .expect("postgres last_playing touch should succeed");
        assert!(touched);

        sqlx::query(
            "UPDATE playback_sessions
             SET is_playing = FALSE, last_playing_at = NOW() - INTERVAL '5 minutes'
             WHERE id = $1",
        )
        .bind(&session.id)
        .execute(pool)
        .await
        .expect("postgres session aging should succeed");

        let inactive = db::queries::get_sessions_with_inactive_owners(&database, 60)
            .await
            .expect("postgres inactive owner lookup should succeed");
        assert!(inactive.iter().any(|candidate| candidate.id == session.id));

        let cleared_owner = db::queries::clear_session_owner(&database, &session.id)
            .await
            .expect("postgres owner clear should succeed");
        assert!(cleared_owner);

        let session_after_clear = db::queries::get_session(&database, &session.id, user.id)
            .await
            .expect("postgres session lookup should succeed after clear")
            .expect("postgres session should still exist after clear");
        assert!(session_after_clear.owner_client_id.is_none());

        sqlx::query(
            "INSERT INTO play_queues (user_id, session_id, updated_at)
             VALUES ($1, $2, NOW() - INTERVAL '10 days')",
        )
        .bind(user.id)
        .bind("orphan-session")
        .execute(pool)
        .await
        .expect("postgres orphan queue insert should succeed");

        sqlx::query(
            "INSERT INTO play_queue_entries (user_id, song_id, queue_position, session_id)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(user.id)
        .bind(&song_2)
        .bind(0_i64)
        .bind("orphan-session")
        .execute(pool)
        .await
        .expect("postgres orphan queue entry insert should succeed");

        let cleaned_rows = db::queries::cleanup_orphaned_queues(&database, 7)
            .await
            .expect("postgres orphan queue cleanup should succeed");
        assert_eq!(cleaned_rows, 2);

        db::queries::clear_queue_by_session(&database, &session.id)
            .await
            .expect("postgres queue clear should succeed");
        assert!(
            db::queries::get_play_queue_by_session(&database, &session.id, user.id)
                .await
                .expect("postgres queue lookup should succeed after clear")
                .is_none()
        );
        assert_eq!(
            db::queries::get_queue_length_by_session(&database, &session.id)
                .await
                .expect("postgres queue length lookup should succeed after clear"),
            0
        );
    });
}

#[test]
fn test_postgres_song_flag_queries_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        sqlx::query(
            "INSERT INTO shuffle_excludes (user_id, song_id) VALUES ($1, $2)
             ON CONFLICT (user_id, song_id) DO NOTHING",
        )
        .bind(user.id)
        .bind(&song_2)
        .execute(pool)
        .await
        .expect("postgres shuffle exclude insert should succeed");

        sqlx::query(
            "INSERT INTO disabled_songs (user_id, song_id) VALUES ($1, $2)
             ON CONFLICT (user_id, song_id) DO NOTHING",
        )
        .bind(user.id)
        .bind(&song_1)
        .execute(pool)
        .await
        .expect("postgres disabled song insert should succeed");

        let disabled_rows = db::queries::get_disabled_song_ids_for_user(&database, user.id)
            .await
            .expect("postgres disabled songs helper should succeed");
        assert_eq!(disabled_rows, vec![song_1]);

        let shuffle_rows = db::queries::get_shuffle_excluded_song_ids_for_user(&database, user.id)
            .await
            .expect("postgres shuffle excludes helper should succeed");
        assert_eq!(shuffle_rows, vec![song_2]);
    });
}

#[test]
fn test_postgres_library_queue_materialization_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let now = Utc::now();
        let library_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "library".to_string(),
            source_id: None,
            source_name: Some("Library".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: Some(
                serde_json::json!({ "field": "trackNumber", "direction": "asc" }).to_string(),
            ),
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let total = get_lazy_queue_count(&database, &library_queue, user.id)
            .await
            .expect("postgres library queue count should succeed");
        assert_eq!(total, 2);

        let page = materialize_lazy_queue_page(&database, &library_queue, user.id, 0, 10)
            .await
            .expect("postgres library queue page should materialize");
        let page_ids: Vec<String> = page.into_iter().map(|song| song.id).collect();
        assert_eq!(page_ids, vec![song_1, song_2]);
    });
}

#[test]
fn test_postgres_playlist_queue_materialization_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let playlist_id = "pl-queue-materialize".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Queue Source Playlist",
            user.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres queue source playlist should be created");
        db::queries::add_songs_to_playlist(
            &database,
            &playlist_id,
            &[song_1.clone(), song_2.clone()],
        )
        .await
        .expect("postgres queue source playlist songs should be inserted");

        let now = Utc::now();
        let playlist_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "playlist".to_string(),
            source_id: Some(playlist_id),
            source_name: Some("Queue Source Playlist".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: Some(
                serde_json::json!({ "field": "trackNumber", "direction": "asc" }).to_string(),
            ),
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let total = get_lazy_queue_count(&database, &playlist_queue, user.id)
            .await
            .expect("postgres playlist queue count should succeed");
        assert_eq!(total, 2);

        let page = materialize_lazy_queue_page(&database, &playlist_queue, user.id, 0, 10)
            .await
            .expect("postgres playlist queue page should materialize");
        let page_ids: Vec<String> = page.into_iter().map(|song| song.id).collect();
        assert_eq!(page_ids, vec![song_1, song_2]);
    });
}

#[test]
fn test_postgres_history_queue_materialization_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        sqlx::query(
            "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description)
             VALUES ($1, $2, NOW() - INTERVAL '2 hours', TRUE, 1, NULL)",
        )
        .bind(user.id)
        .bind(&song_2)
        .execute(pool)
        .await
        .expect("postgres extra history scrobble insert should succeed");

        let now = Utc::now();
        let history_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "history".to_string(),
            source_id: None,
            source_name: Some("History".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: None,
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let total = get_lazy_queue_count(&database, &history_queue, user.id)
            .await
            .expect("postgres history queue count should succeed");
        assert_eq!(total, 2);

        let page = materialize_lazy_queue_page(&database, &history_queue, user.id, 0, 10)
            .await
            .expect("postgres history queue page should materialize");
        let page_ids: Vec<String> = page.into_iter().map(|song| song.id).collect();
        assert_eq!(page_ids, vec![song_1, song_2]);
    });
}

#[test]
fn test_postgres_directory_queue_materialization_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;
        let library_id = db::repo::users::get_music_folders_for_user(&database, user.id)
            .await
            .expect("postgres music folder lookup should succeed")
            .into_iter()
            .next()
            .expect("seeded postgres library should expose one music folder")
            .id;

        let now = Utc::now();
        let directory_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "directory".to_string(),
            source_id: Some(format!("{library_id}:Artist")),
            source_name: Some("Artist directory".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: None,
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let total = get_lazy_queue_count(&database, &directory_queue, user.id)
            .await
            .expect("postgres directory queue count should succeed");
        assert_eq!(total, 2);

        let page = materialize_lazy_queue_page(&database, &directory_queue, user.id, 0, 10)
            .await
            .expect("postgres directory queue page should materialize");
        let page_ids: Vec<String> = page.into_iter().map(|song| song.id).collect();
        assert_eq!(page_ids, vec![song_1.clone(), song_2.clone()]);

        let directory_flat_queue = db::models::PlayQueue {
            source_type: "directoryFlat".to_string(),
            source_id: Some(format!("{library_id}:Artist")),
            source_name: Some("Artist directory flat".to_string()),
            ..directory_queue
        };

        let total = get_lazy_queue_count(&database, &directory_flat_queue, user.id)
            .await
            .expect("postgres flat directory queue count should succeed");
        assert_eq!(total, 0);

        let page = materialize_lazy_queue_page(&database, &directory_flat_queue, user.id, 0, 10)
            .await
            .expect("postgres flat directory queue page should materialize");
        assert!(page.is_empty());
    });
}

#[test]
fn test_postgres_playlist_start_queue_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let playlist_id = "pl-start-queue-postgres".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Queue Start Playlist",
            user.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres queue start playlist should be created");
        db::queries::add_entries_to_playlist(
            &database,
            &playlist_id,
            &[
                db::queries::PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(db::models::MissingEntryData {
                        title: Some("Missing opener".to_string()),
                        artist: Some("Unknown artist".to_string()),
                        album: Some("Unknown album".to_string()),
                        duration: Some(100_000),
                        raw: "Unknown artist - Missing opener".to_string(),
                    }),
                    missing_search_text: Some("Unknown artist - Missing opener".to_string()),
                },
                db::queries::PlaylistEntry {
                    song_id: Some(song_1.clone()),
                    missing_entry_data: None,
                    missing_search_text: None,
                },
                db::queries::PlaylistEntry {
                    song_id: Some(song_2.clone()),
                    missing_entry_data: None,
                    missing_search_text: None,
                },
            ],
        )
        .await
        .expect("postgres queue start playlist entries should be inserted");

        let session = db::queries::get_or_create_session(&database, user.id)
            .await
            .expect("postgres playback session should exist for queue start");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_start_queue(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Json(StartQueueRequest {
                session_id: Some(session.id.clone()),
                source_type: "playlist".to_string(),
                source_id: Some(playlist_id.clone()),
                source_name: Some("Queue Start Playlist".to_string()),
                start_index: 2,
                start_song_id: Some(song_2.clone()),
                shuffle: false,
                repeat_mode: None,
                filters: None,
                sort: None,
                song_ids: None,
                inline_images: None,
                client_id: None,
                keep_playing: false,
            }),
        )
        .await
        .expect("postgres start_queue playlist handler should succeed")
        .0;

        assert_eq!(response.total_count, 2);
        assert_eq!(response.current_index, 1);
        let window_song_ids: Vec<String> = response
            .window
            .songs
            .iter()
            .map(|entry| entry.song.id.clone())
            .collect();
        assert_eq!(window_song_ids, vec![song_1.clone(), song_2.clone()]);
        assert!(response
            .window
            .songs
            .iter()
            .all(|entry| entry.source_entry_id.is_some()));

        let queue = db::queries::get_play_queue_by_session(&database, &session.id, user.id)
            .await
            .expect("postgres queue lookup after start_queue should succeed")
            .expect("postgres queue should exist after start_queue");
        assert_eq!(queue.current_index, 1);

        let last_played_set: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM playlists WHERE id = $1 AND last_played_at IS NOT NULL)",
        )
        .bind(&playlist_id)
        .fetch_one(
            database
                .postgres_pool()
                .expect("postgres runtime database should expose a PgPool"),
        )
        .await
        .expect("postgres playlist last_played_at lookup should succeed");
        assert!(last_played_set);
    });
}

#[test]
fn test_postgres_smart_playlist_start_queue_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let smart_playlist_id = "sp-start-queue-postgres".to_string();
        let rules_json = serde_json::json!({
            "conditions": [
                {
                    "field": "title",
                    "operator": "contains",
                    "value": "Opening"
                }
            ],
            "logic": "and"
        })
        .to_string();

        sqlx::query(
            "INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&smart_playlist_id)
        .bind("Queue Start Smart Playlist")
        .bind(Option::<String>::None)
        .bind(user.id)
        .bind(false)
        .bind(&rules_json)
        .bind(Some("title"))
        .bind(Some("asc"))
        .bind(Option::<i64>::None)
        .bind(Option::<String>::None)
        .execute(pool)
        .await
        .expect("postgres smart playlist insert should succeed");

        let session = db::queries::get_or_create_session(&database, user.id)
            .await
            .expect("postgres playback session should exist for smart queue start");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_start_queue(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Json(StartQueueRequest {
                session_id: Some(session.id.clone()),
                source_type: "smartPlaylist".to_string(),
                source_id: Some(smart_playlist_id.clone()),
                source_name: Some("Queue Start Smart Playlist".to_string()),
                start_index: 0,
                start_song_id: Some(song_1.clone()),
                shuffle: false,
                repeat_mode: None,
                filters: None,
                sort: None,
                song_ids: None,
                inline_images: None,
                client_id: None,
                keep_playing: false,
            }),
        )
        .await
        .expect("postgres start_queue smart playlist handler should succeed")
        .0;

        assert_eq!(response.total_count, 1);
        assert_eq!(response.current_index, 0);
        assert_eq!(response.window.songs.len(), 1);
        assert_eq!(response.window.songs[0].song.id, song_1);

        let queue = db::queries::get_play_queue_by_session(&database, &session.id, user.id)
            .await
            .expect("postgres queue lookup after smart start_queue should succeed")
            .expect("postgres queue should exist after smart start_queue");
        assert_eq!(queue.current_index, 0);
        assert_eq!(queue.source_type, "smartPlaylist".to_string());

        let last_played_set: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM smart_playlists WHERE id = $1 AND last_played_at IS NOT NULL)",
        )
        .bind(&smart_playlist_id)
        .fetch_one(pool)
        .await
        .expect("postgres smart playlist last_played_at lookup should succeed");
        assert!(last_played_set);
    });
}

#[test]
fn test_postgres_smart_playlist_read_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let smart_playlist_id = "sp-read-postgres".to_string();
        let rules_json = serde_json::json!({
            "conditions": [
                {
                    "field": "title",
                    "operator": "contains",
                    "value": "Opening"
                }
            ],
            "logic": "and"
        })
        .to_string();

        sqlx::query(
            "INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&smart_playlist_id)
        .bind("Read Smart Playlist")
        .bind(Some("postgres smart playlist".to_string()))
        .bind(user.id)
        .bind(false)
        .bind(&rules_json)
        .bind(Some("title"))
        .bind(Some("asc"))
        .bind(Option::<i64>::None)
        .bind(Option::<String>::None)
        .execute(pool)
        .await
        .expect("postgres smart playlist insert should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let list_response = ferrotune_smart_playlists::list_smart_playlists(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
        )
        .await
        .expect("postgres smart playlist list handler should succeed")
        .0;
        assert_eq!(list_response.smart_playlists.len(), 1);
        assert_eq!(list_response.smart_playlists[0].id, smart_playlist_id);
        assert_eq!(list_response.smart_playlists[0].song_count, 1);

        let playlist_response = ferrotune_smart_playlists::get_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Path(smart_playlist_id.clone()),
        )
        .await
        .expect("postgres smart playlist get handler should succeed")
        .0;
        assert_eq!(playlist_response.id, smart_playlist_id);
        assert_eq!(playlist_response.song_count, 1);

        let songs_response = ferrotune_smart_playlists::get_smart_playlist_songs(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Path(smart_playlist_id.clone()),
            Query(ferrotune_smart_playlists::SmartPlaylistSongsParams {
                offset: 0,
                count: 10,
                inline_images: None,
                filter: Some("Opening".to_string()),
                sort_field: None,
                sort_direction: None,
            }),
        )
        .await
        .expect("postgres smart playlist songs handler should succeed")
        .0;
        assert_eq!(songs_response.total_count, 1);
        assert_eq!(songs_response.songs.len(), 1);
        assert_eq!(songs_response.songs[0].id, song_1);

        let materialize_response = ferrotune_smart_playlists::materialize_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Path(smart_playlist_id),
            Json(ferrotune_smart_playlists::MaterializeSmartPlaylistRequest {
                name: Some("Materialized From Smart".to_string()),
                comment: Some("snapshot".to_string()),
            }),
        )
        .await
        .expect("postgres smart playlist materialize handler should succeed")
        .into_response();
        assert_eq!(materialize_response.status(), axum::http::StatusCode::CREATED);

        let materialize_bytes = axum::body::to_bytes(materialize_response.into_body(), usize::MAX)
            .await
            .expect("materialize response body should be readable");
        let materialized: serde_json::Value = serde_json::from_slice(&materialize_bytes)
            .expect("materialize response JSON should decode");
        let materialized_playlist_id = materialized
            .get("playlistId")
            .and_then(|value| value.as_str())
            .expect("materialize response should include playlistId")
            .to_string();
        let materialized_song_count = materialized
            .get("songCount")
            .and_then(|value| value.as_i64())
            .expect("materialize response should include songCount");
        assert_eq!(materialized_song_count, 1);

        let materialized_playlist = db::queries::get_playlist_by_id(&database, &materialized_playlist_id)
            .await
            .expect("materialized playlist lookup should succeed")
            .expect("materialized playlist should exist");
        assert_eq!(materialized_playlist.name, "Materialized From Smart");
        let materialized_songs = db::queries::get_playlist_songs(&database, &materialized_playlist_id, user.id)
            .await
            .expect("materialized playlist songs lookup should succeed");
        assert_eq!(materialized_songs.len(), 1);
        assert_eq!(materialized_songs[0].id, song_1);
    });
}

#[test]
fn test_postgres_smart_playlist_write_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, _song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let create_response = ferrotune_smart_playlists::create_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Json(ferrotune_smart_playlists::CreateSmartPlaylistRequest {
                name: "Writable Smart Playlist".to_string(),
                comment: Some("initial comment".to_string()),
                is_public: Some(false),
                rules: ferrotune_smart_playlists::SmartPlaylistRulesApi {
                    conditions: vec![ferrotune_smart_playlists::SmartPlaylistConditionApi {
                        field: "title".to_string(),
                        operator: "contains".to_string(),
                        value: serde_json::Value::String("Opening".to_string()),
                    }],
                    logic: "and".to_string(),
                },
                sort_field: Some("title".to_string()),
                sort_direction: Some("asc".to_string()),
                max_songs: Some(1),
                folder_id: None,
            }),
        )
        .await
        .expect("postgres smart playlist create handler should succeed")
        .into_response();
        assert_eq!(create_response.status(), axum::http::StatusCode::CREATED);

        let create_bytes = axum::body::to_bytes(create_response.into_body(), usize::MAX)
            .await
            .expect("create response body should be readable");
        let create_json: serde_json::Value =
            serde_json::from_slice(&create_bytes).expect("create response JSON should decode");
        let smart_playlist_id = create_json
            .get("id")
            .and_then(|value| value.as_str())
            .expect("create response should include smart playlist id")
            .to_string();

        let update_response = ferrotune_smart_playlists::update_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Path(smart_playlist_id.clone()),
            Json(ferrotune_smart_playlists::UpdateSmartPlaylistRequest {
                name: Some("Updated Smart Playlist".to_string()),
                comment: Some("updated comment".to_string()),
                is_public: Some(true),
                rules: Some(ferrotune_smart_playlists::SmartPlaylistRulesApi {
                    conditions: vec![ferrotune_smart_playlists::SmartPlaylistConditionApi {
                        field: "title".to_string(),
                        operator: "contains".to_string(),
                        value: serde_json::Value::String("Track".to_string()),
                    }],
                    logic: "and".to_string(),
                }),
                sort_field: Some("artist".to_string()),
                sort_direction: Some("desc".to_string()),
                max_songs: Some(Some(5)),
                folder_id: Some(None),
            }),
        )
        .await
        .expect("postgres smart playlist update handler should succeed")
        .into_response();
        assert_eq!(update_response.status(), axum::http::StatusCode::NO_CONTENT);

        let playlist_response = ferrotune_smart_playlists::get_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state.clone()),
            Path(smart_playlist_id.clone()),
        )
        .await
        .expect("postgres smart playlist get after update should succeed")
        .0;
        assert_eq!(playlist_response.name, "Updated Smart Playlist");
        assert_eq!(
            playlist_response.comment.as_deref(),
            Some("updated comment")
        );
        assert!(playlist_response.is_public);
        assert_eq!(playlist_response.sort_field.as_deref(), Some("artist"));
        assert_eq!(playlist_response.sort_direction.as_deref(), Some("desc"));
        assert_eq!(playlist_response.max_songs, Some(5));

        let delete_response = ferrotune_smart_playlists::delete_smart_playlist(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Path(smart_playlist_id.clone()),
        )
        .await
        .expect("postgres smart playlist delete handler should succeed")
        .into_response();
        assert_eq!(delete_response.status(), axum::http::StatusCode::NO_CONTENT);

        let deleted_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM smart_playlists WHERE id = $1)")
                .bind(&smart_playlist_id)
                .fetch_one(
                    database
                        .postgres_pool()
                        .expect("postgres runtime database should expose a PgPool"),
                )
                .await
                .expect("deleted smart playlist existence lookup should succeed");
        assert!(!deleted_exists);
    });
}

#[test]
fn test_postgres_continue_listening_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let smart_playlist_id = "sp-continue-listening-postgres".to_string();
        let rules_json = serde_json::json!({
            "conditions": [
                {
                    "field": "title",
                    "operator": "contains",
                    "value": "Opening"
                }
            ],
            "logic": "and"
        })
        .to_string();

        sqlx::query(
            "INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field, sort_direction, max_songs, folder_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&smart_playlist_id)
        .bind("Continue Listening Smart Playlist")
        .bind(Option::<String>::None)
        .bind(user.id)
        .bind(false)
        .bind(&rules_json)
        .bind(Some("title"))
        .bind(Some("asc"))
        .bind(Option::<i64>::None)
        .bind(Option::<String>::None)
        .execute(pool)
        .await
        .expect("postgres smart playlist insert should succeed");

        sqlx::query(
            "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count, description, queue_source_type, queue_source_id)
             VALUES ($1, $2, NOW() + INTERVAL '1 second', TRUE, 1, NULL, $3, $4)",
        )
        .bind(user.id)
        .bind(&song_1)
        .bind("smartPlaylist")
        .bind(&smart_playlist_id)
        .execute(pool)
        .await
        .expect("postgres smart playlist scrobble insert should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_get_continue_listening(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Query(ContinueListeningParams {
                size: Some(10),
                offset: Some(0),
                inline_images: None,
            }),
        )
        .await
        .expect("postgres continue listening handler should succeed")
        .0;

        assert_eq!(response.total, 2);
        assert_eq!(response.entries.len(), 2);
        assert_eq!(response.entries[0].entry_type, "smartPlaylist");
        assert_eq!(
            response.entries[0]
                .playlist
                .as_ref()
                .expect("smart playlist entry should include playlist payload")
                .id,
            smart_playlist_id
        );
        assert_eq!(
            response.entries[0]
                .playlist
                .as_ref()
                .expect("smart playlist entry should include playlist payload")
                .song_count,
            1
        );
        assert!(response
            .entries
            .iter()
            .any(|entry| entry.album.as_ref().is_some_and(|album| album.id == album_id)));
    });
}

#[test]
fn test_postgres_continue_listening_start_queue_handler_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let session = db::queries::get_or_create_session(&database, user.id)
            .await
            .expect("postgres playback session should exist for continue listening queue start");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let response = ferrotune_start_queue(
            FerrotuneAuthenticatedUser {
                user_id: user.id,
                username: user.username.clone(),
                is_admin: user.is_admin,
            },
            State(state),
            Json(StartQueueRequest {
                session_id: Some(session.id.clone()),
                source_type: "continueListening".to_string(),
                source_id: None,
                source_name: Some("Continue Listening".to_string()),
                start_index: 0,
                start_song_id: Some(song_1.clone()),
                shuffle: false,
                repeat_mode: None,
                filters: None,
                sort: None,
                song_ids: None,
                inline_images: None,
                client_id: None,
                keep_playing: false,
            }),
        )
        .await
        .expect("postgres start_queue continue listening handler should succeed")
        .0;

        assert_eq!(response.total_count, 2);
        assert_eq!(response.current_index, 0);
        let window_song_ids: Vec<String> = response
            .window
            .songs
            .iter()
            .map(|entry| entry.song.id.clone())
            .collect();
        assert_eq!(window_song_ids, vec![song_1.clone(), song_2.clone()]);

        let queue = db::queries::get_play_queue_by_session(&database, &session.id, user.id)
            .await
            .expect("postgres queue lookup after continue listening start_queue should succeed")
            .expect("postgres queue should exist after continue listening start_queue");
        assert_eq!(queue.current_index, 0);
        assert_eq!(queue.source_type, "continueListening".to_string());
    });
}

#[test]
fn test_postgres_search_queue_materialization_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, _song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let now = Utc::now();
        let search_queue = db::models::PlayQueue {
            user_id: user.id,
            source_type: "search".to_string(),
            source_id: Some("closing".to_string()),
            source_name: Some("Search".to_string()),
            current_index: 0,
            position_ms: 0,
            is_shuffled: false,
            shuffle_seed: None,
            shuffle_indices_json: None,
            repeat_mode: "off".to_string(),
            filters_json: None,
            sort_json: Some(serde_json::json!({ "field": "name", "direction": "asc" }).to_string()),
            created_at: now,
            updated_at: now,
            changed_by: "postgres-container-test".to_string(),
            total_count: None,
            is_lazy: true,
            song_ids_json: None,
            instance_id: None,
            session_id: None,
            version: 0,
            source_api: "ferrotune".to_string(),
        };

        let total = get_lazy_queue_count(&database, &search_queue, user.id)
            .await
            .expect("postgres search queue count should succeed");
        assert_eq!(total, 1);

        let page = materialize_lazy_queue_page(&database, &search_queue, user.id, 0, 10)
            .await
            .expect("postgres search queue page should materialize");
        let page_ids: Vec<String> = page.into_iter().map(|song| song.id).collect();
        assert_eq!(page_ids, vec![song_2]);
    });
}

#[test]
fn test_postgres_execute_search_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let params = ferrotune::api::common::search::SearchParams {
            query: "integration".to_string(),
            artist_count: Some(5),
            artist_offset: Some(0),
            album_count: Some(5),
            album_offset: Some(0),
            song_count: Some(5),
            song_offset: Some(0),
            song_sort: Some("trackNumber".to_string()),
            song_sort_dir: Some("asc".to_string()),
            album_sort: Some("name".to_string()),
            album_sort_dir: Some("asc".to_string()),
            artist_sort: Some("name".to_string()),
            artist_sort_dir: Some("asc".to_string()),
            inline_images: None,
            min_year: None,
            max_year: None,
            genre: None,
            min_duration: None,
            max_duration: None,
            min_rating: None,
            max_rating: None,
            starred_only: None,
            min_play_count: None,
            max_play_count: None,
            shuffle_excluded_only: None,
            disabled_only: None,
            min_bitrate: None,
            max_bitrate: None,
            added_after: None,
            added_before: None,
            missing_cover_art: None,
            file_format: None,
            artist_filter: None,
            album_filter: None,
            title_filter: None,
            last_played_after: None,
            last_played_before: None,
            music_folder_id: None,
        };

        let results = ferrotune::api::common::search_utils::execute_search(
            &database,
            user.id,
            &params.query,
            &params,
            5,
            0,
            5,
            0,
            5,
            0,
            None,
        )
        .await
        .expect("postgres shared search should succeed");

        assert_eq!(results.artist_total, Some(1));
        assert_eq!(results.album_total, Some(1));
        assert_eq!(results.song_total, Some(2));
        assert_eq!(results.artist_responses.len(), 1);
        assert_eq!(results.album_responses.len(), 1);

        let song_ids: Vec<String> = results
            .song_responses
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert_eq!(song_ids, vec![song_1.clone(), song_2]);

        let typo_results = ferrotune::api::common::search_utils::execute_search(
            &database, user.id, "tegrat", &params, 5, 0, 5, 0, 5, 0, None,
        )
        .await
        .expect("postgres shared fuzzy artist/album search should succeed");
        assert_eq!(typo_results.artist_responses.len(), 1);
        assert_eq!(typo_results.album_responses.len(), 1);

        let song_typo_results = ferrotune::api::common::search_utils::execute_search(
            &database, user.id, "pening", &params, 5, 0, 5, 0, 5, 0, None,
        )
        .await
        .expect("postgres shared fuzzy song search should succeed");
        let typo_song_ids: Vec<String> = song_typo_results
            .song_responses
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert_eq!(typo_song_ids, vec![song_1]);
    });
}

#[test]
fn test_postgres_thumbnail_helpers_and_inline_reads_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (_user, _artist_id, album_id, song_1, _song_2) =
            seed_postgres_library_sample(&database).await;

        let image = image::DynamicImage::ImageRgb8(image::ImageBuffer::from_pixel(
            1,
            1,
            image::Rgb([12, 34, 56]),
        ));
        let mut encoded = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .expect("test image should encode as png");
        let png_data = encoded.into_inner();

        let result = ferrotune::thumbnails::ensure_cover_art_with_dimensions(&database, &png_data)
            .await
            .expect("postgres thumbnail helper should store thumbnails and compute dimensions");
        assert_eq!(result.width, 1);
        assert_eq!(result.height, 1);
        assert!(!result.hash.is_empty());

        let small_thumbnail = ferrotune::thumbnails::get_thumbnail(
            &database,
            &result.hash,
            ferrotune::thumbnails::ThumbnailSize::Small,
        )
        .await
        .expect("postgres small thumbnail lookup should succeed")
        .expect("postgres small thumbnail should be stored");
        assert!(!small_thumbnail.is_empty());

        let medium_thumbnail = ferrotune::thumbnails::get_thumbnail(
            &database,
            &result.hash,
            ferrotune::thumbnails::ThumbnailSize::Medium,
        )
        .await
        .expect("postgres medium thumbnail lookup should succeed")
        .expect("postgres medium thumbnail should be stored");
        assert!(!medium_thumbnail.is_empty());

        sqlx::query("UPDATE albums SET cover_art_hash = $1 WHERE id = $2")
            .bind(&result.hash)
            .bind(&album_id)
            .execute(pool)
            .await
            .expect("postgres album cover hash update should succeed");

        let album_thumbnail =
            ferrotune::api::subsonic::inline_thumbnails::get_album_thumbnail_base64(
                &database,
                &album_id,
                ferrotune::thumbnails::ThumbnailSize::Small,
            )
            .await
            .expect("postgres inline album thumbnail should be available");

        use base64::Engine;
        let decoded_album_thumbnail = base64::engine::general_purpose::STANDARD
            .decode(album_thumbnail)
            .expect("postgres inline album thumbnail should decode");
        assert_eq!(decoded_album_thumbnail, small_thumbnail);

        let song_thumbnails =
            ferrotune::api::subsonic::inline_thumbnails::get_song_thumbnails_base64(
                &database,
                &[(song_1.clone(), Some(album_id.clone()))],
                ferrotune::thumbnails::ThumbnailSize::Small,
            )
            .await;
        let decoded_song_thumbnail = base64::engine::general_purpose::STANDARD
            .decode(
                song_thumbnails
                    .get(&song_1)
                    .expect("postgres song thumbnail should fall back to album art"),
            )
            .expect("postgres inline song thumbnail should decode");
        assert_eq!(decoded_song_thumbnail, small_thumbnail);
    });
}

#[test]
fn test_postgres_bliss_similarity_query_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (user, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let seed_features = ferrotune::bliss::features_to_blob(&[0.0; 23]);
        let candidate_features = ferrotune::bliss::features_to_blob(&[0.2; 23]);

        sqlx::query("UPDATE songs SET bliss_features = $1, bliss_version = $2 WHERE id = $3")
            .bind(seed_features)
            .bind(2i32)
            .bind(&song_1)
            .execute(pool)
            .await
            .expect("postgres seed song bliss update should succeed");

        sqlx::query("UPDATE songs SET bliss_features = $1, bliss_version = $2 WHERE id = $3")
            .bind(candidate_features)
            .bind(2i32)
            .bind(&song_2)
            .execute(pool)
            .await
            .expect("postgres candidate song bliss update should succeed");

        let similar = ferrotune::bliss::find_similar_songs(&database, &song_1, user.id, 5)
            .await
            .expect("postgres bliss similarity query should succeed");
        assert_eq!(similar.len(), 1);
        assert_eq!(similar[0].0, song_2);
        assert!(similar[0].1 > 0.05);
    });
}

#[test]
fn test_postgres_playlist_queries_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (owner, _artist_id, album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let collaborator_id = db::repo::users::create_user(
            &database,
            "playlist-viewer",
            "password-hash",
            "subsonic-token",
            Some("viewer@example.com"),
            false,
        )
        .await
        .expect("postgres collaborator user should be created");

        let folder_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO playlist_folders (id, name, parent_id, owner_id, position) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&folder_id)
        .bind("Mixes")
        .bind(Option::<String>::None)
        .bind(owner.id)
        .bind(0_i64)
        .execute(pool)
        .await
        .expect("postgres playlist folder insert should succeed");

        let playlist_id = "pl-integration".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Integration Playlist",
            owner.id,
            Some("integration comment"),
            true,
            Some(&folder_id),
        )
        .await
        .expect("postgres playlist create should succeed");

        db::queries::add_songs_to_playlist(&database, &playlist_id, &[song_1.clone(), song_2.clone()])
            .await
            .expect("postgres playlist song insert should succeed");

        db::queries::add_entries_to_playlist(
            &database,
            &playlist_id,
            &[db::queries::PlaylistEntry {
                song_id: None,
                missing_entry_data: Some(db::models::MissingEntryData {
                    title: Some("Missing Track".to_string()),
                    artist: Some("Missing Artist".to_string()),
                    album: Some("Missing Album".to_string()),
                    duration: Some(123_000),
                    raw: "Missing Artist - Missing Track".to_string(),
                }),
                missing_search_text: Some("Missing Artist - Missing Track".to_string()),
            }],
        )
        .await
        .expect("postgres playlist missing entry insert should succeed");

        let playlist = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres playlist lookup should succeed")
            .expect("postgres playlist should exist");
        assert_eq!(playlist.name, "Integration Playlist");
        assert_eq!(playlist.song_count, 3);
        assert_eq!(playlist.duration, 360);

        let owner_access = playlist_access::get_playlist_access(
            &database,
            owner.id,
            owner.id,
            &playlist_id,
            playlist.is_public,
        )
        .await
        .expect("postgres owner playlist access should resolve");
        assert!(owner_access.is_owner);
        assert!(owner_access.can_edit);

        let public_access = playlist_access::get_playlist_access(
            &database,
            collaborator_id,
            owner.id,
            &playlist_id,
            playlist.is_public,
        )
        .await
        .expect("postgres public playlist access should resolve");
        assert!(public_access.can_read);
        assert!(!public_access.can_edit);

        let visible_playlists = db::queries::get_playlists_for_user(&database, collaborator_id)
            .await
            .expect("postgres playlist list should resolve for public playlist");
        assert!(visible_playlists.iter().any(|candidate| candidate.id == playlist_id));

        let full_name = db::queries::get_playlist_full_name(
            &database,
            "Integration Playlist",
            Some(&folder_id),
        )
        .await
        .expect("postgres playlist full-name lookup should succeed");
        assert_eq!(full_name, "Mixes/Integration Playlist");

        let playlist_songs = db::queries::get_playlist_songs(&database, &playlist_id, owner.id)
            .await
            .expect("postgres playlist song lookup should succeed");
        let playlist_song_ids: Vec<String> = playlist_songs.iter().map(|song| song.id.clone()).collect();
        assert_eq!(playlist_song_ids, vec![song_1.clone(), song_2.clone()]);

        let songs_with_positions =
            db::queries::get_playlist_songs_with_positions(&database, &playlist_id, owner.id)
                .await
                .expect("postgres playlist song positions should resolve");
        assert_eq!(songs_with_positions.len(), 2);
        assert_eq!(songs_with_positions[0].0, 0);
        assert_eq!(songs_with_positions[0].2.id, song_1);
        assert_eq!(songs_with_positions[1].0, 1);
        assert_eq!(songs_with_positions[1].2.id, song_2);

        let album_ids = db::queries::get_playlist_album_ids(&database, &playlist_id, 4)
            .await
            .expect("postgres playlist album lookup should succeed");
        assert_eq!(album_ids, vec![album_id]);

        let entries = db::queries::get_playlist_entries(&database, &playlist_id)
            .await
            .expect("postgres playlist entry lookup should succeed");
        assert_eq!(entries.len(), 3);
        let missing_entry = entries
            .iter()
            .find(|entry| entry.song_id.is_none())
            .expect("playlist should contain one missing entry");
        let missing_entry_id = missing_entry
            .entry_id
            .clone()
            .expect("playlist entry ids should be populated");
        assert_eq!(missing_entry.position, 2);

        db::queries::match_missing_entry(&database, &playlist_id, 2, &song_2)
            .await
            .expect("postgres positional match should succeed");
        db::queries::unmatch_entry(&database, &playlist_id, 2)
            .await
            .expect("postgres positional unmatch should succeed");

        let matched = db::queries::match_missing_entry_by_id(
            &database,
            &playlist_id,
            &missing_entry_id,
            &song_1,
        )
        .await
        .expect("postgres entry-id match should succeed");
        assert!(matched);

        let unmatched =
            db::queries::unmatch_entry_by_id(&database, &playlist_id, &missing_entry_id)
                .await
                .expect("postgres entry-id unmatch should succeed");
        assert!(unmatched);

        let batch_count = db::queries::batch_match_entries(
            &database,
            &playlist_id,
            &[(missing_entry_id.clone(), song_2.clone())],
        )
        .await
        .expect("postgres batch match should succeed");
        assert_eq!(batch_count, 1);

        let rematched_entries = db::queries::get_playlist_entries(&database, &playlist_id)
            .await
            .expect("postgres playlist entry lookup should still succeed");
        let rematched_entry = rematched_entries
            .iter()
            .find(|entry| entry.entry_id.as_deref() == Some(missing_entry_id.as_str()))
            .expect("matched entry should still exist");
        assert_eq!(rematched_entry.song_id.as_deref(), Some(song_2.as_str()));

        db::queries::remove_songs_by_position(&database, &playlist_id, &[1])
            .await
            .expect("postgres playlist removal should succeed");

        let playlist_after_remove = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres playlist lookup should still succeed")
            .expect("postgres playlist should still exist after removal");
        assert_eq!(playlist_after_remove.song_count, 2);
        assert_eq!(playlist_after_remove.duration, 360);

        db::queries::update_playlist_metadata(
            &database,
            &playlist_id,
            Some("Renamed Playlist"),
            Some("updated comment"),
            Some(false),
        )
        .await
        .expect("postgres playlist metadata update should succeed");

        sqlx::query(
            "INSERT INTO playlist_shares (playlist_id, shared_with_user_id, can_edit) VALUES ($1, $2, $3)",
        )
        .bind(&playlist_id)
        .bind(collaborator_id)
        .bind(true)
        .execute(pool)
        .await
        .expect("postgres playlist share insert should succeed");

        let shared_access = playlist_access::get_playlist_access(
            &database,
            collaborator_id,
            owner.id,
            &playlist_id,
            false,
        )
        .await
        .expect("postgres shared playlist access should resolve");
        assert!(shared_access.can_read);
        assert!(shared_access.can_edit);

        let updated_playlist = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres renamed playlist lookup should succeed")
            .expect("postgres renamed playlist should exist");
        assert_eq!(updated_playlist.name, "Renamed Playlist");
        assert_eq!(updated_playlist.comment.as_deref(), Some("updated comment"));
        assert!(!updated_playlist.is_public);

        let visible_playlists = db::queries::get_playlists_for_user(&database, collaborator_id)
            .await
            .expect("postgres playlist list should resolve for shared playlist");
        assert!(visible_playlists.iter().any(|candidate| candidate.id == playlist_id));

        db::queries::delete_playlist(&database, &playlist_id)
            .await
            .expect("postgres playlist delete should succeed");
        assert!(
            db::queries::get_playlist_by_id(&database, &playlist_id)
                .await
                .expect("postgres deleted playlist lookup should succeed")
                .is_none()
        );
    });
}

#[test]
fn test_postgres_subsonic_playlist_read_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let folder_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO playlist_folders (id, name, parent_id, owner_id, position) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&folder_id)
        .bind("Mixes")
        .bind(Option::<String>::None)
        .bind(owner.id)
        .bind(0_i64)
        .execute(pool)
        .await
        .expect("postgres playlist folder insert should succeed");

        let playlist_id = "pl-subsonic-handlers".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Integration Playlist",
            owner.id,
            Some("integration comment"),
            false,
            Some(&folder_id),
        )
        .await
        .expect("postgres playlist create should succeed");

        db::queries::add_songs_to_playlist(&database, &playlist_id, &[song_1.clone(), song_2.clone()])
            .await
            .expect("postgres playlist song insert should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let list_response = playlists::get_playlists(
            State(state.clone()),
            AuthenticatedUser {
                user_id: owner.id,
                username: owner.username.clone(),
                is_admin: owner.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-handler-test".to_string(),
            },
        )
        .await
        .expect("postgres getPlaylists handler should succeed");

        assert_eq!(list_response.data.playlists.playlist.len(), 1);
        assert_eq!(list_response.data.playlists.playlist[0].id, playlist_id);
        assert_eq!(
            list_response.data.playlists.playlist[0].name,
            "Mixes/Integration Playlist"
        );

        let params = serde_json::from_value(serde_json::json!({ "id": playlist_id.clone() }))
            .expect("playlist params should deserialize from JSON test input");
        let detail_response = playlists::get_playlist(
            State(state),
            AuthenticatedUser {
                user_id: owner.id,
                username: owner.username,
                is_admin: owner.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-handler-test".to_string(),
            },
            Query(params),
        )
        .await
        .expect("postgres getPlaylist handler should succeed");

        assert_eq!(detail_response.data.playlist.id, playlist_id);
        assert_eq!(detail_response.data.playlist.name, "Mixes/Integration Playlist");
        assert_eq!(detail_response.data.playlist.song_total, Some(2));

        let detail_song_ids: Vec<String> = detail_response
            .data
            .playlist
            .entry
            .into_iter()
            .map(|song| song.id)
            .collect();
        assert_eq!(detail_song_ids, vec![song_1, song_2]);
    });
}

#[test]
fn test_postgres_subsonic_playlist_write_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let create_params = serde_json::from_value(serde_json::json!({
            "name": "Mixes/Integration Playlist",
            "songId": [song_1.clone()],
        }))
        .expect("create playlist params should deserialize from JSON test input");
        let created = playlists::create_playlist(
            State(state.clone()),
            AuthenticatedUser {
                user_id: owner.id,
                username: owner.username.clone(),
                is_admin: owner.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-handler-test".to_string(),
            },
            QsQuery(create_params),
        )
        .await
        .expect("postgres createPlaylist handler should succeed");

        let playlist_id = created.data.playlist.id.clone();
        assert_eq!(created.data.playlist.name, "Mixes/Integration Playlist");
        assert_eq!(created.data.playlist.entry.len(), 1);
        assert_eq!(created.data.playlist.entry[0].id, song_1);

        let created_playlist = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres created playlist lookup should succeed")
            .expect("created playlist should exist");
        assert!(created_playlist.folder_id.is_some());
        assert_eq!(created_playlist.song_count, 1);

        let update_params = serde_json::from_value(serde_json::json!({
            "playlistId": playlist_id,
            "name": "Renamed Playlist",
            "comment": "updated comment",
            "public": true,
            "songIdToAdd": [song_2.clone()],
            "songIndexToRemove": ["0"],
        }))
        .expect("update playlist params should deserialize from JSON test input");
        playlists::update_playlist(
            State(state.clone()),
            AuthenticatedUser {
                user_id: owner.id,
                username: owner.username.clone(),
                is_admin: owner.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-handler-test".to_string(),
            },
            QsQuery(update_params),
        )
        .await
        .expect("postgres updatePlaylist handler should succeed");

        let updated_playlist = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres updated playlist lookup should succeed")
            .expect("updated playlist should exist");
        assert_eq!(updated_playlist.name, "Renamed Playlist");
        assert_eq!(updated_playlist.comment.as_deref(), Some("updated comment"));
        assert!(updated_playlist.is_public);
        assert_eq!(updated_playlist.song_count, 1);

        let full_name = db::queries::get_playlist_full_name(
            &database,
            &updated_playlist.name,
            updated_playlist.folder_id.as_deref(),
        )
        .await
        .expect("postgres updated playlist full-name lookup should succeed");
        assert_eq!(full_name, "Mixes/Renamed Playlist");

        let updated_songs = db::queries::get_playlist_songs(&database, &playlist_id, owner.id)
            .await
            .expect("postgres updated playlist songs should resolve");
        let updated_song_ids: Vec<String> = updated_songs.into_iter().map(|song| song.id).collect();
        assert_eq!(updated_song_ids, vec![song_2]);

        let delete_params = serde_json::from_value(serde_json::json!({
            "id": playlist_id,
        }))
        .expect("delete playlist params should deserialize from JSON test input");
        playlists::delete_playlist(
            State(state),
            AuthenticatedUser {
                user_id: owner.id,
                username: owner.username,
                is_admin: owner.is_admin,
                format: ResponseFormat::Json,
                client: "postgres-handler-test".to_string(),
            },
            Query(delete_params),
        )
        .await
        .expect("postgres deletePlaylist handler should succeed");

        assert!(db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres deleted playlist lookup should succeed")
            .is_none());
    });
}

#[test]
fn test_postgres_ferrotune_playlist_folder_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let collaborator_id = db::repo::users::create_user(
            &database,
            "playlist-viewer",
            "password-hash",
            "subsonic-token",
            Some("viewer@example.com"),
            false,
        )
        .await
        .expect("postgres collaborator user should be created");

        let owned_playlist_id = "pl-ferrotune-owned".to_string();
        db::queries::create_playlist(
            &database,
            &owned_playlist_id,
            "Owned Playlist",
            owner.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres owned playlist should be created");
        db::queries::add_songs_to_playlist(&database, &owned_playlist_id, std::slice::from_ref(&song_1))
            .await
            .expect("postgres owned playlist songs should be inserted");

        let shared_playlist_id = "pl-ferrotune-shared".to_string();
        db::queries::create_playlist(
            &database,
            &shared_playlist_id,
            "Shared Playlist",
            owner.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres shared playlist should be created");
        db::queries::add_songs_to_playlist(&database, &shared_playlist_id, std::slice::from_ref(&song_2))
            .await
            .expect("postgres shared playlist songs should be inserted");
        sqlx::query(
            "INSERT INTO playlist_shares (playlist_id, shared_with_user_id, can_edit) VALUES ($1, $2, $3)",
        )
        .bind(&shared_playlist_id)
        .bind(collaborator_id)
        .bind(false)
        .execute(pool)
        .await
        .expect("postgres playlist share insert should succeed");

        let public_playlist_id = "pl-ferrotune-public".to_string();
        db::queries::create_playlist(
            &database,
            &public_playlist_id,
            "Public Playlist",
            owner.id,
            None,
            true,
            None,
        )
        .await
        .expect("postgres public playlist should be created");
        db::queries::add_songs_to_playlist(&database, &public_playlist_id, std::slice::from_ref(&song_1))
            .await
            .expect("postgres public playlist songs should be inserted");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let owner_user = || FerrotuneAuthenticatedUser {
            user_id: owner.id,
            username: owner.username.clone(),
            is_admin: owner.is_admin,
        };
        let collaborator_user = || FerrotuneAuthenticatedUser {
            user_id: collaborator_id,
            username: "playlist-viewer".to_string(),
            is_admin: false,
        };

        let owner_folder = ferrotune_playlists::create_playlist_folder(
            State(state.clone()),
            owner_user(),
            Json(ferrotune_playlists::CreateFolderRequest {
                name: "Mixes".to_string(),
                parent_id: None,
            }),
        )
        .await
        .expect("postgres owner playlist folder create should succeed")
        .0;
        let owner_folder_id = owner_folder.id.clone();

        let archive_folder = ferrotune_playlists::create_playlist_folder(
            State(state.clone()),
            owner_user(),
            Json(ferrotune_playlists::CreateFolderRequest {
                name: "Archive".to_string(),
                parent_id: None,
            }),
        )
        .await
        .expect("postgres archive folder create should succeed")
        .0;

        ferrotune_playlists::upload_playlist_folder_cover(
            State(state.clone()),
            owner_user(),
            Path(owner_folder_id.clone()),
            axum::body::Bytes::from_static(b"\x89PNG"),
        )
        .await
        .expect("postgres folder cover upload should succeed");

        let updated_owner_folder = ferrotune_playlists::update_playlist_folder(
            State(state.clone()),
            owner_user(),
            Path(owner_folder_id.clone()),
            Json(ferrotune_playlists::UpdateFolderRequest {
                name: Some("Favorites".to_string()),
                parent_id: Some(Some(archive_folder.id.clone())),
            }),
        )
        .await
        .expect("postgres playlist folder update should succeed")
        .0;
        assert_eq!(updated_owner_folder.name, "Favorites");
        assert_eq!(
            updated_owner_folder.parent_id.as_deref(),
            Some(archive_folder.id.as_str())
        );
        assert!(updated_owner_folder.has_cover_art);

        ferrotune_playlists::move_playlist(
            State(state.clone()),
            owner_user(),
            Path(owned_playlist_id.clone()),
            Json(ferrotune_playlists::MovePlaylistRequest {
                folder_id: Some(owner_folder_id.clone()),
            }),
        )
        .await
        .expect("postgres owner playlist move should succeed");

        let owner_listing = ferrotune_playlists::get_playlist_folders(State(state.clone()), owner_user())
            .await
            .expect("postgres owner playlist folders should list")
            .0;
        let listed_owner_folder = owner_listing
            .folders
            .iter()
            .find(|folder| folder.id == owner_folder_id)
            .expect("owner folder should appear in folder listing");
        assert_eq!(listed_owner_folder.name, "Favorites");
        assert!(listed_owner_folder.has_cover_art);

        let listed_owned_playlist = owner_listing
            .playlists
            .iter()
            .find(|playlist| playlist.id == owned_playlist_id)
            .expect("owned playlist should appear in listing");
        assert_eq!(
            listed_owned_playlist.folder_id.as_deref(),
            Some(owner_folder_id.as_str())
        );
        assert!(!listed_owned_playlist.shared_with_me);
        assert!(listed_owned_playlist.can_edit);

        ferrotune_playlists::delete_playlist_folder_cover(
            State(state.clone()),
            owner_user(),
            Path(owner_folder_id.clone()),
        )
        .await
        .expect("postgres folder cover delete should succeed");

        let owner_listing_after_cover_delete =
            ferrotune_playlists::get_playlist_folders(State(state.clone()), owner_user())
                .await
                .expect("postgres owner folder listing after cover delete should succeed")
                .0;
        let listed_owner_folder = owner_listing_after_cover_delete
            .folders
            .iter()
            .find(|folder| folder.id == owner_folder_id)
            .expect("owner folder should still appear after cover delete");
        assert!(!listed_owner_folder.has_cover_art);

        let collaborator_folder = ferrotune_playlists::create_playlist_folder(
            State(state.clone()),
            collaborator_user(),
            Json(ferrotune_playlists::CreateFolderRequest {
                name: "Incoming".to_string(),
                parent_id: None,
            }),
        )
        .await
        .expect("postgres collaborator folder create should succeed")
        .0;

        ferrotune_playlists::move_playlist(
            State(state.clone()),
            collaborator_user(),
            Path(shared_playlist_id.clone()),
            Json(ferrotune_playlists::MovePlaylistRequest {
                folder_id: Some(collaborator_folder.id.clone()),
            }),
        )
        .await
        .expect("postgres shared playlist move override should succeed");

        ferrotune_playlists::move_playlist(
            State(state.clone()),
            collaborator_user(),
            Path(public_playlist_id.clone()),
            Json(ferrotune_playlists::MovePlaylistRequest {
                folder_id: Some(collaborator_folder.id.clone()),
            }),
        )
        .await
        .expect("postgres public playlist move override should succeed");

        ferrotune_playlists::move_playlist(
            State(state.clone()),
            collaborator_user(),
            Path(public_playlist_id.clone()),
            Json(ferrotune_playlists::MovePlaylistRequest { folder_id: None }),
        )
        .await
        .expect("postgres public playlist move-to-root override should succeed");

        let collaborator_listing =
            ferrotune_playlists::get_playlist_folders(State(state.clone()), collaborator_user())
                .await
                .expect("postgres collaborator playlist folders should list")
                .0;
        let listed_shared_playlist = collaborator_listing
            .playlists
            .iter()
            .find(|playlist| playlist.id == shared_playlist_id)
            .expect("shared playlist should appear for collaborator");
        assert_eq!(
            listed_shared_playlist.folder_id.as_deref(),
            Some(collaborator_folder.id.as_str())
        );
        assert!(listed_shared_playlist.shared_with_me);
        assert!(!listed_shared_playlist.can_edit);
        assert_eq!(listed_shared_playlist.owner.as_deref(), Some(owner.username.as_str()));

        let listed_public_playlist = collaborator_listing
            .playlists
            .iter()
            .find(|playlist| playlist.id == public_playlist_id)
            .expect("public playlist should appear for collaborator");
        assert_eq!(listed_public_playlist.folder_id, None);
        assert!(!listed_public_playlist.shared_with_me);
        assert!(!listed_public_playlist.can_edit);

        ferrotune_playlists::delete_playlist_folder(
            State(state.clone()),
            owner_user(),
            Path(owner_folder_id.clone()),
        )
        .await
        .expect("postgres playlist folder delete should succeed");

        let owned_playlist = db::queries::get_playlist_by_id(&database, &owned_playlist_id)
            .await
            .expect("postgres owned playlist lookup after folder delete should succeed")
            .expect("owned playlist should still exist after folder delete");
        assert_eq!(owned_playlist.folder_id, None);
    });
}

#[test]
fn test_postgres_ferrotune_playlist_entry_mutation_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let owner_user = || FerrotuneAuthenticatedUser {
            user_id: owner.id,
            username: owner.username.clone(),
            is_admin: owner.is_admin,
        };

        let reorder_playlist_id = "pl-ferrotune-reorder".to_string();
        db::queries::create_playlist(
            &database,
            &reorder_playlist_id,
            "Reorder Playlist",
            owner.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres reorder playlist should be created");
        db::queries::add_songs_to_playlist(
            &database,
            &reorder_playlist_id,
            &[song_1.clone(), song_2.clone()],
        )
        .await
        .expect("postgres reorder playlist songs should be inserted");

        ferrotune_playlists::reorder_playlist_songs(
            State(state.clone()),
            owner_user(),
            Path(reorder_playlist_id.clone()),
            Json(ferrotune_playlists::ReorderPlaylistRequest {
                song_ids: vec![song_2.clone(), song_1.clone()],
            }),
        )
        .await
        .expect("postgres reorder playlist handler should succeed");

        let reordered_song_ids: Vec<String> = db::queries::get_playlist_songs_with_positions(
            &database,
            &reorder_playlist_id,
            owner.id,
        )
        .await
        .expect("postgres reordered playlist songs should resolve")
        .into_iter()
        .map(|(_, _, song)| song.id)
        .collect();
        assert_eq!(reordered_song_ids, vec![song_2.clone(), song_1.clone()]);

        let reorder_entries = db::queries::get_playlist_entries(&database, &reorder_playlist_id)
            .await
            .expect("postgres reorder playlist entries should resolve");
        let entry_id_to_move = reorder_entries
            .iter()
            .find(|entry| entry.song_id.as_deref() == Some(song_1.as_str()))
            .and_then(|entry| entry.entry_id.clone())
            .expect("playlist entry id should exist for song move");

        ferrotune_playlists::move_playlist_entry(
            State(state.clone()),
            owner_user(),
            Path(reorder_playlist_id.clone()),
            Json(ferrotune_playlists::MovePlaylistEntryRequest {
                entry_id: entry_id_to_move,
                to_position: 0,
            }),
        )
        .await
        .expect("postgres move playlist entry handler should succeed");

        let moved_song_ids: Vec<String> = db::queries::get_playlist_songs_with_positions(
            &database,
            &reorder_playlist_id,
            owner.id,
        )
        .await
        .expect("postgres moved playlist songs should resolve")
        .into_iter()
        .map(|(_, _, song)| song.id)
        .collect();
        assert_eq!(moved_song_ids, vec![song_1.clone(), song_2.clone()]);

        let missing_playlist_id = "pl-ferrotune-missing-mutations".to_string();
        db::queries::create_playlist(
            &database,
            &missing_playlist_id,
            "Missing Playlist",
            owner.id,
            None,
            false,
            None,
        )
        .await
        .expect("postgres missing playlist should be created");
        db::queries::add_entries_to_playlist(
            &database,
            &missing_playlist_id,
            &[
                db::queries::PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(db::models::MissingEntryData {
                        title: Some("Missing Track One".to_string()),
                        artist: Some("Missing Artist".to_string()),
                        album: Some("Missing Album".to_string()),
                        duration: Some(123_000),
                        raw: "Missing Artist - Missing Track One".to_string(),
                    }),
                    missing_search_text: Some("Missing Artist - Missing Track One".to_string()),
                },
                db::queries::PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(db::models::MissingEntryData {
                        title: Some("Missing Track Two".to_string()),
                        artist: Some("Missing Artist".to_string()),
                        album: Some("Missing Album".to_string()),
                        duration: Some(124_000),
                        raw: "Missing Artist - Missing Track Two".to_string(),
                    }),
                    missing_search_text: Some("Missing Artist - Missing Track Two".to_string()),
                },
            ],
        )
        .await
        .expect("postgres missing playlist entries should be inserted");

        let initial_missing_entries =
            db::queries::get_playlist_entries(&database, &missing_playlist_id)
                .await
                .expect("postgres missing playlist entries should resolve");
        let first_missing_entry_id = initial_missing_entries[0]
            .entry_id
            .clone()
            .expect("first missing playlist entry should have an entry id");
        let second_missing_entry_id = initial_missing_entries[1]
            .entry_id
            .clone()
            .expect("second missing playlist entry should have an entry id");

        ferrotune_playlists::match_missing_entry(
            State(state.clone()),
            owner_user(),
            Path(missing_playlist_id.clone()),
            Json(ferrotune_playlists::MatchMissingEntryRequest {
                entry_id: first_missing_entry_id.clone(),
                song_id: song_1.clone(),
            }),
        )
        .await
        .expect("postgres match missing entry handler should succeed");

        let matched_entries = db::queries::get_playlist_entries(&database, &missing_playlist_id)
            .await
            .expect("postgres matched playlist entries should resolve");
        let matched_entry = matched_entries
            .iter()
            .find(|entry| entry.entry_id.as_deref() == Some(first_missing_entry_id.as_str()))
            .expect("matched entry should still exist");
        assert_eq!(matched_entry.song_id.as_deref(), Some(song_1.as_str()));

        ferrotune_playlists::unmatch_entry(
            State(state.clone()),
            owner_user(),
            Path(missing_playlist_id.clone()),
            Json(ferrotune_playlists::UnmatchEntryRequest {
                entry_id: first_missing_entry_id.clone(),
            }),
        )
        .await
        .expect("postgres unmatch entry handler should succeed");

        let unmatched_entries = db::queries::get_playlist_entries(&database, &missing_playlist_id)
            .await
            .expect("postgres unmatched playlist entries should resolve");
        let unmatched_entry = unmatched_entries
            .iter()
            .find(|entry| entry.entry_id.as_deref() == Some(first_missing_entry_id.as_str()))
            .expect("unmatched entry should still exist");
        assert_eq!(unmatched_entry.song_id, None);

        let batch_response = ferrotune_playlists::batch_match_entries(
            State(state.clone()),
            owner_user(),
            Path(missing_playlist_id.clone()),
            Json(ferrotune_playlists::BatchMatchEntriesRequest {
                entries: vec![
                    ferrotune_playlists::BatchMatchEntry {
                        entry_id: first_missing_entry_id.clone(),
                        song_id: song_1.clone(),
                    },
                    ferrotune_playlists::BatchMatchEntry {
                        entry_id: second_missing_entry_id.clone(),
                        song_id: song_2.clone(),
                    },
                ],
            }),
        )
        .await
        .expect("postgres batch match entries handler should succeed")
        .0;
        assert_eq!(batch_response.matched_count, 2);
        assert_eq!(batch_response.failed_count, 0);

        let final_entries = db::queries::get_playlist_entries(&database, &missing_playlist_id)
            .await
            .expect("postgres final playlist entries should resolve");
        let first_final = final_entries
            .iter()
            .find(|entry| entry.entry_id.as_deref() == Some(first_missing_entry_id.as_str()))
            .expect("first final entry should exist");
        let second_final = final_entries
            .iter()
            .find(|entry| entry.entry_id.as_deref() == Some(second_missing_entry_id.as_str()))
            .expect("second final entry should exist");
        assert_eq!(first_final.song_id.as_deref(), Some(song_1.as_str()));
        assert_eq!(second_final.song_id.as_deref(), Some(song_2.as_str()));
    });
}

#[test]
fn test_postgres_ferrotune_playlist_write_admin_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let collaborator_id = db::repo::users::create_user(
            &database,
            "playlist-editor",
            "password-hash",
            "subsonic-token",
            Some("editor@example.com"),
            false,
        )
        .await
        .expect("postgres collaborator user should be created");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let owner_user = || FerrotuneAuthenticatedUser {
            user_id: owner.id,
            username: owner.username.clone(),
            is_admin: owner.is_admin,
        };
        let collaborator_user = || FerrotuneAuthenticatedUser {
            user_id: collaborator_id,
            username: "playlist-editor".to_string(),
            is_admin: false,
        };

        let playlist_id = "pl-ferrotune-admin-write".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Admin Playlist",
            owner.id,
            Some("initial comment"),
            false,
            None,
        )
        .await
        .expect("postgres admin playlist should be created");
        db::queries::add_songs_to_playlist(&database, &playlist_id, std::slice::from_ref(&song_1))
            .await
            .expect("postgres admin playlist songs should be inserted");

        let shares_response = ferrotune_playlists::set_playlist_shares(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Json(ferrotune_playlists::SetPlaylistSharesRequest {
                shares: vec![ferrotune_playlists::ShareEntry {
                    user_id: collaborator_id,
                    can_edit: true,
                }],
            }),
        )
        .await
        .expect("postgres set playlist shares handler should succeed")
        .0;
        assert_eq!(shares_response.shares.len(), 1);
        assert_eq!(shares_response.shares[0].user_id, collaborator_id);
        assert!(shares_response.shares[0].can_edit);

        let listed_shares = ferrotune_playlists::get_playlist_shares(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
        )
        .await
        .expect("postgres get playlist shares handler should succeed")
        .0;
        assert_eq!(listed_shares.shares.len(), 1);
        assert_eq!(listed_shares.shares[0].username, "playlist-editor");

        let update_response = ferrotune_playlists::update_playlist(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Json(ferrotune_playlists::UpdatePlaylistRequest {
                name: Some("Renamed Admin Playlist".to_string()),
                comment: Some("updated comment".to_string()),
                public: Some(true),
            }),
        )
        .await
        .expect("postgres update playlist handler should succeed")
        .0;
        assert_eq!(update_response.name, "Renamed Admin Playlist");
        assert_eq!(update_response.comment.as_deref(), Some("updated comment"));
        assert!(update_response.public);

        ferrotune_playlists::add_playlist_songs(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Json(ferrotune_playlists::AddPlaylistSongsRequest {
                song_ids: vec![song_2.clone()],
            }),
        )
        .await
        .expect("postgres add playlist songs handler should succeed");

        let songs_after_add = db::queries::get_playlist_songs(&database, &playlist_id, owner.id)
            .await
            .expect("postgres playlist songs after add should resolve");
        let song_ids_after_add: Vec<String> =
            songs_after_add.into_iter().map(|song| song.id).collect();
        assert_eq!(song_ids_after_add, vec![song_1.clone(), song_2.clone()]);

        ferrotune_playlists::remove_playlist_songs(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Json(ferrotune_playlists::RemovePlaylistSongsRequest { indexes: vec![0] }),
        )
        .await
        .expect("postgres remove playlist songs handler should succeed");

        let songs_after_remove = db::queries::get_playlist_songs(&database, &playlist_id, owner.id)
            .await
            .expect("postgres playlist songs after remove should resolve");
        let song_ids_after_remove: Vec<String> =
            songs_after_remove.into_iter().map(|song| song.id).collect();
        assert_eq!(song_ids_after_remove, vec![song_2.clone()]);

        let import_response = ferrotune_playlists::import_playlist(
            State(state.clone()),
            owner_user(),
            Json(ferrotune_playlists::ImportPlaylistRequest {
                name: "Imported Playlist".to_string(),
                comment: Some("imported".to_string()),
                entries: vec![
                    ferrotune_playlists::ImportPlaylistEntry {
                        song_id: Some(song_1.clone()),
                        missing: None,
                    },
                    ferrotune_playlists::ImportPlaylistEntry {
                        song_id: None,
                        missing: Some(ferrotune_playlists::ImportMissingEntry {
                            title: Some("Imported Missing".to_string()),
                            artist: Some("Imported Artist".to_string()),
                            album: Some("Imported Album".to_string()),
                            duration: Some(111),
                            raw: "Imported Artist - Imported Missing".to_string(),
                        }),
                    },
                ],
                folder_id: None,
            }),
        )
        .await
        .expect("postgres import playlist handler should succeed")
        .0;
        assert_eq!(import_response.matched_count, 1);
        assert_eq!(import_response.missing_count, 1);
        let imported_entries =
            db::queries::get_playlist_entries(&database, &import_response.playlist_id)
                .await
                .expect("postgres imported playlist entries should resolve");
        assert_eq!(imported_entries.len(), 2);

        ferrotune_playlists::transfer_playlist_ownership(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Json(ferrotune_playlists::TransferPlaylistOwnershipRequest {
                new_owner_id: collaborator_id,
            }),
        )
        .await
        .expect("postgres transfer playlist ownership handler should succeed");

        let transferred_playlist = db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres transferred playlist lookup should succeed")
            .expect("transferred playlist should still exist");
        assert_eq!(transferred_playlist.owner_id, collaborator_id);

        let shares_after_transfer = ferrotune_playlists::get_playlist_shares(
            State(state.clone()),
            collaborator_user(),
            Path(playlist_id.clone()),
        )
        .await
        .expect("postgres get playlist shares after transfer should succeed")
        .0;
        assert!(shares_after_transfer.shares.is_empty());

        ferrotune_playlists::delete_playlist(
            State(state.clone()),
            collaborator_user(),
            Path(playlist_id.clone()),
        )
        .await
        .expect("postgres delete playlist handler should succeed");

        assert!(db::queries::get_playlist_by_id(&database, &playlist_id)
            .await
            .expect("postgres deleted playlist lookup should succeed")
            .is_none());
    });
}

#[test]
fn test_postgres_ferrotune_playlist_read_handlers_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let playlist_id = "pl-ferrotune-read".to_string();
        db::queries::create_playlist(
            &database,
            &playlist_id,
            "Read Playlist",
            owner.id,
            Some("read comment"),
            false,
            None,
        )
        .await
        .expect("postgres read playlist should be created");
        db::queries::add_entries_to_playlist(
            &database,
            &playlist_id,
            &[
                db::queries::PlaylistEntry {
                    song_id: Some(song_1.clone()),
                    missing_entry_data: None,
                    missing_search_text: None,
                },
                db::queries::PlaylistEntry {
                    song_id: None,
                    missing_entry_data: Some(db::models::MissingEntryData {
                        title: Some("Missing Song".to_string()),
                        artist: Some("Missing Artist".to_string()),
                        album: Some("Missing Album".to_string()),
                        duration: Some(123),
                        raw: "Missing Artist - Missing Song".to_string(),
                    }),
                    missing_search_text: Some("Missing Artist - Missing Song".to_string()),
                },
                db::queries::PlaylistEntry {
                    song_id: Some(song_2.clone()),
                    missing_entry_data: None,
                    missing_search_text: None,
                },
            ],
        )
        .await
        .expect("postgres read playlist entries should be inserted");

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        sqlx::query("UPDATE playlists SET last_played_at = NOW() WHERE id = $1")
            .bind(&playlist_id)
            .execute(pool)
            .await
            .expect("postgres last_played_at update should succeed");

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let owner_user = || FerrotuneAuthenticatedUser {
            user_id: owner.id,
            username: owner.username.clone(),
            is_admin: owner.is_admin,
        };

        let playlist_songs = ferrotune_playlists::get_playlist_songs(
            State(state.clone()),
            owner_user(),
            Path(playlist_id.clone()),
            Query(ferrotune_playlists::GetPlaylistSongsParams {
                offset: Some(0),
                count: Some(10),
                sort: Some("custom".to_string()),
                sort_dir: Some("asc".to_string()),
                filter: None,
                entry_type: None,
                inline_images: Default::default(),
            }),
        )
        .await
        .expect("postgres get playlist songs handler should succeed")
        .0;
        assert_eq!(playlist_songs.total_entries, 3);
        assert_eq!(playlist_songs.matched_count, 2);
        assert_eq!(playlist_songs.missing_count, 1);
        assert_eq!(playlist_songs.filtered_count, 3);
        assert_eq!(playlist_songs.entries.len(), 3);
        assert_eq!(playlist_songs.entries[0].entry_type, "song");
        assert_eq!(playlist_songs.entries[0].song_index, Some(0));
        assert_eq!(
            playlist_songs.entries[0]
                .song
                .as_ref()
                .map(|song| song.id.as_str()),
            Some(song_1.as_str())
        );
        assert_eq!(playlist_songs.entries[1].entry_type, "missing");
        assert_eq!(
            playlist_songs.entries[1]
                .missing
                .as_ref()
                .and_then(|missing| missing.title.as_deref()),
            Some("Missing Song")
        );
        assert_eq!(playlist_songs.entries[2].entry_type, "song");
        assert_eq!(playlist_songs.entries[2].song_index, Some(1));
        assert_eq!(
            playlist_songs.entries[2]
                .song
                .as_ref()
                .map(|song| song.id.as_str()),
            Some(song_2.as_str())
        );

        let containing_playlists = ferrotune_playlists::get_playlists_for_songs(
            State(state.clone()),
            owner_user(),
            QsQuery(ferrotune_playlists::SongPlaylistsQuery {
                song_ids: vec![song_1.clone(), song_2.clone()],
            }),
        )
        .await
        .expect("postgres get playlists for songs handler should succeed")
        .0;
        assert_eq!(
            containing_playlists
                .playlists_by_song
                .get(&song_1)
                .expect("song 1 should be mapped to containing playlists")[0]
                .playlist_id,
            playlist_id
        );
        assert_eq!(
            containing_playlists
                .playlists_by_song
                .get(&song_2)
                .expect("song 2 should be mapped to containing playlists")[0]
                .playlist_name,
            "Read Playlist"
        );

        let recent_playlists =
            ferrotune_playlists::get_recently_played_playlists(State(state.clone()), owner_user())
                .await
                .expect("postgres recently played playlists handler should succeed")
                .0;
        assert_eq!(recent_playlists.playlists.len(), 1);
        assert_eq!(recent_playlists.playlists[0].id, playlist_id);
        assert_eq!(recent_playlists.playlists[0].playlist_type, "playlist");
        assert_eq!(recent_playlists.playlists[0].song_count, 3);
        assert_eq!(recent_playlists.playlists[0].duration, 360);
        assert!(!recent_playlists.playlists[0].last_played_at.is_empty());
    });
}

#[test]
fn test_postgres_initialize_app_state_works() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_test_app_config(postgres_config(&host.to_string(), port));

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let state = ferrotune::initialize_app_state(config)
            .await
            .expect("postgres app state initialization should succeed");

        assert!(matches!(state.database, db::Database::Postgres { .. }));
        assert_eq!(
            db::repo::users::count_users(&state.database)
                .await
                .expect("postgres user count should resolve after app state init"),
            1
        );
    });
}

#[test]
fn test_postgres_ferrotune_history_handler_work() {
    if !docker_available() {
        eprintln!("Skipping PostgreSQL container test because Docker is unavailable");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres container host should resolve");
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres container port should resolve");
    let config = postgres_config(&host.to_string(), port);

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
    runtime.block_on(async move {
        let database = db::create_pool(&config)
            .await
            .expect("postgres database pool should connect");
        let (owner, _artist_id, _album_id, song_1, song_2) =
            seed_postgres_library_sample(&database).await;

        let pool = database
            .postgres_pool()
            .expect("postgres runtime database should expose a PgPool");
        let first_play = Utc::now() - chrono::Duration::minutes(20);
        let second_play = Utc::now() - chrono::Duration::minutes(10);
        let latest_play = Utc::now() - chrono::Duration::minutes(5);

        for (song_id, played_at) in [
            (&song_1, first_play),
            (&song_1, second_play),
            (&song_2, latest_play),
        ] {
            sqlx::query(
                "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count) VALUES ($1, $2, $3, TRUE, $4)",
            )
            .bind(owner.id)
            .bind(song_id)
            .bind(played_at)
            .bind(1_i64)
            .execute(pool)
            .await
            .expect("postgres scrobble insert should succeed");
        }

        let state = Arc::new(AppState {
            database: database.clone(),
            config: postgres_test_app_config(config.clone()),
            scan_state: ferrotune::api::create_scan_state(),
            shuffle_cache: Default::default(),
            session_manager: Arc::new(SessionManager::new()),
        });

        let history = ferrotune_history::get_play_history(
            FerrotuneAuthenticatedUser {
                user_id: owner.id,
                username: owner.username.clone(),
                is_admin: owner.is_admin,
            },
            State(state),
            Query(ferrotune_history::PlayHistoryParams {
                size: Some(10),
                offset: Some(0),
                sort: Some("lastPlayed".to_string()),
                sort_dir: Some("desc".to_string()),
                filter: None,
                inline_images: None,
            }),
        )
        .await
        .expect("postgres history handler should succeed")
        .0;

        assert_eq!(history.total, Some(2));
        assert_eq!(history.entry.len(), 2);
        let song_1_entry = history
            .entry
            .iter()
            .find(|entry| entry.song.id == song_1)
            .expect("history should include song 1");
        let song_2_entry = history
            .entry
            .iter()
            .find(|entry| entry.song.id == song_2)
            .expect("history should include song 2");
        assert!(song_1_entry.song.play_count.unwrap_or_default() > 0);
        assert!(song_2_entry.song.play_count.unwrap_or_default() > 0);
        assert!(
            song_1_entry.song.play_count.unwrap_or_default()
                > song_2_entry.song.play_count.unwrap_or_default()
        );
        assert!(!song_1_entry.played_at.is_empty());
        assert!(!song_2_entry.played_at.is_empty());
    });
}
