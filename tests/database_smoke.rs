use ferrotune::{
    api::common::{search::SearchParams, search_utils::execute_search},
    config::{DatabaseBackend, DatabaseConfig},
    db::{self, repo},
};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use testcontainers_modules::{postgres::Postgres, testcontainers::runners::SyncRunner};

fn docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn unique_sqlite_db_path() -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();

    std::env::temp_dir()
        .join(format!("ferrotune-db-smoke-{unique}"))
        .join("ferrotune.db")
}

fn unique_postgres_db_name(prefix: &str) -> String {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();

    format!("{prefix}_{unique}")
}

async fn assert_repository_smoke(database: &db::Database) {
    assert_eq!(
        repo::users::count_users(database)
            .await
            .expect("user count query should succeed"),
        0,
        "smoke database should start without users"
    );

    assert!(
        repo::users::get_music_folders(database)
            .await
            .expect("music folder query should succeed")
            .is_empty(),
        "smoke database should start without music folders"
    );

    let user_id = repo::users::create_user(
        database,
        "smoke-user",
        "hash",
        "token",
        Some("smoke@example.com"),
        true,
    )
    .await
    .expect("user create query should succeed");

    let folder_id = repo::users::create_music_folder(database, "Smoke", "/music/smoke")
        .await
        .expect("music folder create query should succeed");

    repo::users::grant_user_library_access(database, user_id, folder_id)
        .await
        .expect("library access grant should succeed");

    let user = repo::users::get_user_by_username(database, "smoke-user")
        .await
        .expect("user lookup should succeed")
        .expect("created user should exist");
    assert_eq!(user.id, user_id);
    assert!(user.is_admin, "smoke user should preserve admin flag");

    let user_folders = repo::users::get_music_folders_for_user(database, user_id)
        .await
        .expect("user music folder query should succeed");
    assert_eq!(user_folders.len(), 1);
    assert_eq!(user_folders[0].id, folder_id);
    assert_eq!(user_folders[0].path, "/music/smoke");

    let folder_lookup = repo::users::get_music_folder_id_by_path(database, "/music/smoke")
        .await
        .expect("music folder lookup by path should succeed");
    assert_eq!(folder_lookup, Some(folder_id));
}

fn search_params_for_last_played(direction: &str) -> SearchParams {
    SearchParams {
        query: "*".to_string(),
        artist_count: Some(10),
        artist_offset: Some(0),
        album_count: Some(10),
        album_offset: Some(0),
        song_count: Some(0),
        song_offset: Some(0),
        song_sort: None,
        song_sort_dir: None,
        album_sort: Some("lastPlayed".to_string()),
        album_sort_dir: Some(direction.to_string()),
        artist_sort: Some("lastPlayed".to_string()),
        artist_sort_dir: Some(direction.to_string()),
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
    }
}

async fn seed_last_played_search_fixture(database: &db::Database) -> i64 {
    let user_id = repo::users::create_user(
        database,
        "search-sort-user",
        "hash",
        "token",
        Some("search-sort@example.com"),
        true,
    )
    .await
    .expect("search sort user should be created");
    let folder_id = repo::users::create_music_folder(database, "Search Sort", "/music/search-sort")
        .await
        .expect("search sort folder should be created");
    repo::users::grant_user_library_access(database, user_id, folder_id)
        .await
        .expect("search sort user should get library access");

    let pool = database
        .sqlite_pool()
        .expect("search sort fixture uses sqlite");

    for (artist_id, name) in [
        ("artist-recent", "Alpha Integration Recent Artist"),
        ("artist-older", "Zulu Integration Older Artist"),
        ("artist-unplayed", "Middle Integration Unplayed Artist"),
    ] {
        sqlx::query(
            "INSERT INTO artists (id, name, sort_name, album_count, song_count, cover_art_hash)
             VALUES (?, ?, ?, 1, 1, NULL)",
        )
        .bind(artist_id)
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .expect("search sort artist should be inserted");
    }

    for (album_id, name, artist_id) in [
        (
            "album-recent",
            "Alpha Integration Recent Album",
            "artist-recent",
        ),
        (
            "album-older",
            "Zulu Integration Older Album",
            "artist-older",
        ),
        (
            "album-unplayed",
            "Middle Integration Unplayed Album",
            "artist-unplayed",
        ),
    ] {
        sqlx::query(
            "INSERT INTO albums (id, name, artist_id, year, genre, song_count, duration, cover_art_hash)
             VALUES (?, ?, ?, 2024, 'rock', 1, 180, NULL)",
        )
        .bind(album_id)
        .bind(name)
        .bind(artist_id)
        .execute(pool)
        .await
        .expect("search sort album should be inserted");
    }

    for (song_id, title, album_id, artist_id, file_path) in [
        (
            "song-recent",
            "Recent Integration Track",
            "album-recent",
            "artist-recent",
            "recent.mp3",
        ),
        (
            "song-older",
            "Older Integration Track",
            "album-older",
            "artist-older",
            "older.mp3",
        ),
        (
            "song-unplayed",
            "Unplayed Integration Track",
            "album-unplayed",
            "artist-unplayed",
            "unplayed.mp3",
        ),
    ] {
        sqlx::query(
            "INSERT INTO songs (
                id, title, album_id, artist_id, music_folder_id, track_number, disc_number, year, genre,
                duration, bitrate, file_path, file_size, file_format, file_mtime
             ) VALUES (?, ?, ?, ?, ?, 1, 1, 2024, 'rock', 180, 320, ?, 5000000, 'mp3', 1)",
        )
        .bind(song_id)
        .bind(title)
        .bind(album_id)
        .bind(artist_id)
        .bind(folder_id)
        .bind(file_path)
        .execute(pool)
        .await
        .expect("search sort song should be inserted");
    }

    for (song_id, played_at) in [
        ("song-recent", "2024-01-03 00:00:00"),
        ("song-older", "2024-01-02 00:00:00"),
    ] {
        sqlx::query(
            "INSERT INTO scrobbles (user_id, song_id, played_at, submission, play_count)
             VALUES (?, ?, ?, 1, 1)",
        )
        .bind(user_id)
        .bind(song_id)
        .bind(played_at)
        .execute(pool)
        .await
        .expect("search sort scrobble should be inserted");
    }

    user_id
}

#[tokio::test]
async fn test_sqlite_create_pool_runs_migrations_and_repository_smoke() {
    let database_path = unique_sqlite_db_path();
    let temp_dir = database_path
        .parent()
        .expect("sqlite smoke database path should have a parent")
        .to_path_buf();

    let database = db::create_pool(&DatabaseConfig::sqlite(database_path.clone()))
        .await
        .expect("sqlite smoke database should initialize");

    assert_repository_smoke(&database).await;

    drop(database);
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[tokio::test]
async fn test_sqlite_search_sorts_albums_and_artists_by_last_played_tracks() {
    let database_path = unique_sqlite_db_path();
    let temp_dir = database_path
        .parent()
        .expect("sqlite search sort database path should have a parent")
        .to_path_buf();

    let database = db::create_pool(&DatabaseConfig::sqlite(database_path.clone()))
        .await
        .expect("sqlite search sort database should initialize");
    let user_id = seed_last_played_search_fixture(&database).await;
    let params = search_params_for_last_played("desc");

    let results = execute_search(
        &database,
        user_id,
        &params.query,
        &params,
        10,
        0,
        10,
        0,
        0,
        0,
        None,
    )
    .await
    .expect("sqlite search should sort by aggregate last played");

    let album_ids: Vec<&str> = results
        .album_responses
        .iter()
        .map(|album| album.id.as_str())
        .collect();
    let artist_ids: Vec<&str> = results
        .artist_responses
        .iter()
        .map(|artist| artist.id.as_str())
        .collect();

    assert_eq!(
        album_ids,
        vec!["album-recent", "album-older", "album-unplayed"]
    );
    assert_eq!(
        artist_ids,
        vec!["artist-recent", "artist-older", "artist-unplayed"]
    );

    drop(database);
    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn test_postgres_create_pool_runs_migrations_and_repository_smoke() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres host should resolve")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should resolve");

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("postgres smoke runtime should build");

    runtime.block_on(async move {
        let database = db::create_pool(&DatabaseConfig {
            backend: DatabaseBackend::Postgres,
            path: PathBuf::new(),
            url: Some(format!(
                "postgres://postgres:postgres@{}:{}/postgres",
                host, port
            )),
        })
        .await
        .expect("postgres smoke database should initialize");

        assert_repository_smoke(&database).await;
    });
}

#[test]
fn test_postgres_create_pool_creates_missing_database_then_runs_migrations_and_repository_smoke() {
    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return;
    }

    let container = Postgres::default()
        .start()
        .expect("postgres container should start");
    let host = container
        .get_host()
        .expect("postgres host should resolve")
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .expect("postgres port should resolve");
    let database_name = unique_postgres_db_name("ferrotune_missing_db_smoke");

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("postgres smoke runtime should build");

    runtime.block_on(async move {
        let database = db::create_pool(&DatabaseConfig {
            backend: DatabaseBackend::Postgres,
            path: PathBuf::new(),
            url: Some(format!(
                "postgres://postgres:postgres@{}:{}/{}",
                host, port, database_name
            )),
        })
        .await
        .expect("postgres create_pool should create a missing database and initialize it");

        assert_repository_smoke(&database).await;
    });
}
