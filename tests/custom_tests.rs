//! Custom integration tests that don't fit the hurl pattern.
//!
//! These tests have special requirements like multi-folder setup
//! that can't be easily expressed in hurl scripts.

mod common;

use common::{fixtures_dir, TestMusicFolderConfig, TestServer, TestServerConfig};
use flate2::{write::GzEncoder, Compression};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

/// Check if test fixtures exist.
fn fixtures_exist() -> bool {
    let music_dir = fixtures_dir().join("music");
    music_dir.exists()
        && music_dir
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

fn random_song_count(server: &TestServer) -> usize {
    let client = reqwest::blocking::Client::new();
    let response = client
        .get(server.api_url("songs/random?size=1000"))
        .basic_auth(&server.admin_user, Some(&server.admin_password))
        .send()
        .expect("Failed to get random songs");

    assert!(
        response.status().is_success(),
        "random songs request failed with {}",
        response.status()
    );

    let body: Value = response
        .json()
        .expect("random songs response should be JSON");
    body.get("song")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

/// Test that a full rescan of one folder doesn't delete songs from other folders.
/// This is a regression test for a bug where clean_missing_files would query ALL
/// songs but check them against only the current folder's base path.
#[test]
fn test_multi_folder_rescan_preserves_other_folders() {
    if !fixtures_exist() {
        eprintln!("Skipping test: fixtures not generated. Run `moon run generate-fixtures` first.");
        return;
    }

    // Create two separate music directories with different files
    // Use process ID and timestamp to ensure unique directory even in parallel runs
    let unique_id = format!(
        "{}_{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let temp_dir = std::env::temp_dir().join(format!("ferrotune_multi_folder_test_{}", unique_id));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }

    let folder_a = temp_dir.join("folder_a");
    let folder_b = temp_dir.join("folder_b");
    std::fs::create_dir_all(&folder_a).unwrap();
    std::fs::create_dir_all(&folder_b).unwrap();

    // Copy fixtures to both folders (copy entire directory structure)
    let fixtures_music = fixtures_dir().join("music");
    if fixtures_music.exists() {
        // Copy to folder_a
        copy_dir_recursive(&fixtures_music, &folder_a).expect("Failed to copy to folder_a");
        // Copy to folder_b
        copy_dir_recursive(&fixtures_music, &folder_b).expect("Failed to copy to folder_b");
    }

    let config = TestServerConfig {
        music_path: Some(folder_a.clone()),
        copy_fixtures: false,
        additional_music_folders: vec![TestMusicFolderConfig {
            name: "Folder B".to_string(),
            path: folder_b.clone(),
        }],
        ..Default::default()
    };

    let server = TestServer::with_config(config).expect("Failed to start test server");

    // Initial scan
    server.scan_library().expect("Initial scan failed");

    // Count songs via API
    let initial_count = random_song_count(&server);

    eprintln!("Initial song count: {}", initial_count);
    assert!(initial_count > 0, "Should have songs after initial scan");

    // Do a full rescan (this should NOT delete songs from folder_b)
    server.scan_library().expect("Full rescan failed");

    // Count songs again
    let final_count = random_song_count(&server);

    eprintln!("Final song count after rescan: {}", final_count);

    // Clean up
    std::fs::remove_dir_all(&temp_dir).ok();

    // The counts should be equal - no songs should have been deleted
    assert_eq!(
        initial_count, final_count,
        "Full rescan should not delete songs from other folders! Had {} songs, now have {}",
        initial_count, final_count
    );
}

/// A diagnostics pull reaches an Android app over its open session stream,
/// and the app's gzipped upload completes the pull and stays retrievable.
#[test]
fn test_diagnostics_pull_reaches_the_app_over_its_session_stream() {
    if !fixtures_exist() {
        eprintln!("Skipping test: fixtures not found");
        return;
    }
    let server = TestServer::new().expect("Failed to start test server");
    let client = reqwest::blocking::Client::new();
    let user = server.admin_user.clone();
    let password = server.admin_password.clone();

    let session: Value = client
        .post(server.api_url("sessions"))
        .basic_auth(&user, Some(&password))
        .json(&json!({ "clientName": "ferrotune-mobile", "clientId": "diag-phone" }))
        .send()
        .and_then(|response| response.json())
        .expect("session should connect");
    let session_id = session["id"].as_str().expect("session id").to_string();

    let stream = client
        .get(server.api_url(&format!(
            "sessions/{session_id}/events?clientId=diag-phone&clientName=ferrotune-mobile"
        )))
        .basic_auth(&user, Some(&password))
        .send()
        .expect("session stream should open");
    assert!(stream.status().is_success());

    // The phone: wait for the request on the stream, then upload gzipped.
    let upload_url = server.api_url(&format!("sessions/{session_id}/diagnostics"));
    let phone = {
        let (client, user, password) = (client.clone(), user.clone(), password.clone());
        std::thread::spawn(move || {
            let request = BufReader::new(stream)
                .lines()
                .map(|line| line.expect("stream should stay readable"))
                .filter_map(|line| {
                    serde_json::from_str::<Value>(line.strip_prefix("data:")?.trim()).ok()
                })
                .find(|event| event["type"] == "diagnosticsRequest")
                .expect("diagnostics request should arrive on the stream");
            let request_id = request["requestId"]
                .as_str()
                .expect("request id")
                .to_string();
            let bundle = json!({
                "requestId": request_id,
                "clientId": "diag-phone",
                "collectedAt": "2026-10-14T12:00:00.000Z",
                "storageKind": "external",
                "files": [{ "name": "native-audio-current.jsonl", "bytes": 3, "content": "{}\n" }],
            });
            let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
            gzip.write_all(bundle.to_string().as_bytes())
                .expect("gzip should encode");
            let uploaded = client
                .post(format!("{upload_url}/{request_id}"))
                .basic_auth(&user, Some(&password))
                .header("Content-Type", "application/json")
                .header("Content-Encoding", "gzip")
                .body(gzip.finish().expect("gzip should finish"))
                .send()
                .expect("upload should be sent");
            assert!(
                uploaded.status().is_success(),
                "upload: {}",
                uploaded.status()
            );
            request
        })
    };

    let pulled = client
        .post(server.api_url(&format!("sessions/{session_id}/diagnostics")))
        .basic_auth(&user, Some(&password))
        .json(&json!({ "waitSecs": 20, "maxBytes": 4096 }))
        .send()
        .expect("pull should answer");
    assert_eq!(pulled.status().as_u16(), 200);
    let pulled: Value = pulled.json().expect("pull response should be JSON");
    let request = phone.join().expect("phone thread should finish");

    assert_eq!(request["clientId"], "diag-phone");
    assert_eq!(request["maxBytes"], 4096);
    assert_eq!(pulled["status"], "complete");
    assert_eq!(pulled["clientId"], "diag-phone");
    assert_eq!(pulled["deliveredVia"], json!(["stream"]));
    assert_eq!(pulled["bundle"]["files"][0]["content"], "{}\n");

    let request_id = pulled["requestId"].as_str().expect("request id");
    let later: Value = client
        .get(server.api_url(&format!("sessions/{session_id}/diagnostics/{request_id}")))
        .basic_auth(&user, Some(&password))
        .send()
        .and_then(|response| response.json())
        .expect("retained upload should be readable");
    assert_eq!(later["status"], "complete");
    assert_eq!(later["bundle"]["requestId"], request_id);
}
