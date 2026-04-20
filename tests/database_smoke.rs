use ferrotune::{
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
