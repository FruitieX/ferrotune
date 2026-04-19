mod common;

use common::{TestDatabaseConfig, TestServer, TestServerConfig};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
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

fn find_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("ferrotune")
}

fn scan_library_via_api(server: &TestServer) -> Value {
    let client = Client::new();

    client
        .post(format!("{}/ferrotune/scan", server.base_url))
        .basic_auth(&server.admin_user, Some(&server.admin_password))
        .json(&json!({}))
        .send()
        .expect("api scan request should succeed")
        .error_for_status()
        .expect("api scan response should be successful");

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let status: Value = client
            .get(format!("{}/ferrotune/scan/full", server.base_url))
            .basic_auth(&server.admin_user, Some(&server.admin_password))
            .send()
            .expect("scan status request should succeed")
            .error_for_status()
            .expect("scan status response should be successful")
            .json()
            .expect("scan status should be valid json");

        if !status["scanning"].as_bool().unwrap_or(false) {
            assert!(status["error"].is_null(), "api scan failed: {status}");
            return status;
        }

        assert!(Instant::now() < deadline, "api scan timed out: {status}");
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn assert_song_matching_smoke(server: &TestServer) {
    let client = Client::new();

    let match_list: Value = client
        .get(format!("{}/ferrotune/songs/match-list", server.base_url))
        .basic_auth(&server.admin_user, Some(&server.admin_password))
        .send()
        .expect("match-list request should succeed")
        .error_for_status()
        .expect("match-list response should be successful")
        .json()
        .expect("match-list response should be valid json");

    let songs = match_list["songs"]
        .as_array()
        .expect("match-list should return a songs array");
    let first_song = songs.iter().find(|song| song["title"] == "First Song");
    assert!(
        first_song.is_some(),
        "postgres match-list missing First Song; total songs: {}; first few titles: {:?}",
        songs.len(),
        songs
            .iter()
            .take(10)
            .map(|song| song["title"].as_str().unwrap_or("<missing>").to_string())
            .collect::<Vec<_>>(),
    );

    let response: Value = client
        .post(format!("{}/ferrotune/songs/match", server.base_url))
        .basic_auth(&server.admin_user, Some(&server.admin_password))
        .json(&json!({
            "tracks": [
                {
                    "title": "First Song",
                    "artist": "Test Artist",
                    "album": "Test Album",
                    "duration": null,
                    "raw": null
                }
            ],
            "useTitle": true,
            "useArtist": true,
            "useAlbum": true
        }))
        .send()
        .expect("song match request should succeed")
        .error_for_status()
        .expect("song match response should be successful")
        .json()
        .expect("song match response should be valid json");

    assert_eq!(
        response["results"].as_array().map(|items| items.len()),
        Some(1)
    );
    assert_eq!(response["results"][0]["song"]["title"], "First Song");
    assert_eq!(response["results"][0]["song"]["artist"], "Test Artist");
    assert!(
        response["results"][0]["score"]
            .as_f64()
            .expect("song match score should be numeric")
            >= 0.9,
        "unexpected postgres song match response: {response}",
    );
}

#[test]
fn test_postgres_song_matching_smoke() {
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

    let server = TestServer::with_config(TestServerConfig {
        database: TestDatabaseConfig::Postgres {
            url: format!("postgres://postgres:postgres@{}:{}/postgres", host, port),
        },
        ..Default::default()
    })
    .expect("postgres-backed test server should start");
    let scan_output = Command::new(find_binary())
        .arg("--config")
        .arg(&server.config_path)
        .arg("scan")
        .output()
        .expect("postgres-backed scan command should start");
    assert!(
        scan_output.status.success(),
        "postgres-backed scan command failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&scan_output.stdout),
        String::from_utf8_lossy(&scan_output.stderr)
    );
    let scan_stderr = String::from_utf8_lossy(&scan_output.stderr).to_string();

    assert_song_matching_smoke(&server);
    assert!(
        scan_stderr.is_empty(),
        "unexpected scan stderr: {scan_stderr}"
    );
}

#[test]
fn test_postgres_song_matching_smoke_via_api_scan() {
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

    let server = TestServer::with_config(TestServerConfig {
        database: TestDatabaseConfig::Postgres {
            url: format!("postgres://postgres:postgres@{}:{}/postgres", host, port),
        },
        ..Default::default()
    })
    .expect("postgres-backed test server should start");

    let final_status = scan_library_via_api(&server);
    assert_eq!(
        final_status["errors"].as_u64(),
        Some(0),
        "api scan completed with per-file errors: {final_status}"
    );
    assert_song_matching_smoke(&server);
}
