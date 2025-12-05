//! Integration tests for ferrotune using hurl scripts.
//!
//! These tests spawn a ferrotune server instance and run hurl scripts against it.

mod common;

use common::TestServer;
use std::path::Path;
use std::process::Command;

/// Convert a string to hex.
fn to_hex(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect()
}

/// Run a hurl script against a test server.
fn run_hurl_script(server: &TestServer, script_path: &Path) -> Result<(), String> {
    let password_hex = to_hex(&server.admin_password);

    // Create Base64-encoded Basic auth credential
    use base64::{engine::general_purpose, Engine as _};
    let auth_basic = general_purpose::STANDARD
        .encode(format!("{}:{}", server.admin_user, server.admin_password));

    let output = Command::new("hurl")
        .arg("--test")
        .arg("--variable")
        .arg(format!("base_url={}", server.base_url))
        .arg("--variable")
        .arg(format!("username={}", server.admin_user))
        .arg("--variable")
        .arg(format!("password={}", server.admin_password))
        .arg("--variable")
        .arg(format!("password_hex={}", password_hex))
        .arg("--variable")
        .arg(format!("auth_basic={}", auth_basic))
        .arg(script_path)
        .output()
        .map_err(|e| format!("Failed to run hurl: {}", e))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Print the actual output with proper newlines
        eprintln!("\n=== Hurl script failed: {} ===", script_path.display());
        eprintln!("--- stdout ---");
        eprintln!("{}", stdout);
        eprintln!("--- stderr ---");
        eprintln!("{}", stderr);
        eprintln!("===");
        return Err(format!(
            "Hurl script {} failed",
            script_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
    }

    Ok(())
}

/// Get the path to a hurl script in the tests/hurl directory.
fn hurl_script(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("hurl")
        .join(name)
}

/// Check if hurl is available.
fn hurl_available() -> bool {
    Command::new("hurl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if test fixtures exist.
fn fixtures_exist() -> bool {
    let music_dir = common::fixtures_dir().join("music");
    music_dir.exists()
        && music_dir
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
}

// ============================================================================
// SYSTEM TESTS
// ============================================================================

#[test]
fn test_system_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    run_hurl_script(&server, &hurl_script("01_system.hurl")).expect("System endpoint tests failed");
}

// ============================================================================
// AUTH TESTS
// ============================================================================

#[test]
fn test_auth_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    run_hurl_script(&server, &hurl_script("02_auth.hurl")).expect("Auth endpoint tests failed");
}

// ============================================================================
// BROWSE TESTS (require scanned library)
// ============================================================================

#[test]
fn test_browse_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("03_browse.hurl")).expect("Browse endpoint tests failed");
}

// ============================================================================
// STREAMING TESTS (require scanned library)
// ============================================================================

#[test]
fn test_streaming_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("04_streaming.hurl"))
        .expect("Streaming endpoint tests failed");
}

// ============================================================================
// SEARCH TESTS (require scanned library)
// ============================================================================

#[test]
fn test_search_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("05_search.hurl")).expect("Search endpoint tests failed");
}

// ============================================================================
// STARRING TESTS (require scanned library)
// ============================================================================

#[test]
fn test_starring_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("06_starring.hurl"))
        .expect("Starring endpoint tests failed");
}

// ============================================================================
// PLAYLIST TESTS (require scanned library)
// ============================================================================

#[test]
fn test_playlist_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("07_playlists.hurl"))
        .expect("Playlist endpoint tests failed");
}

// ============================================================================
// LIST TESTS (require scanned library)
// ============================================================================

#[test]
fn test_list_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("08_lists.hurl")).expect("List endpoint tests failed");
}

// ============================================================================
// PLAY QUEUE TESTS (require scanned library)
// ============================================================================

#[test]
fn test_playqueue_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("09_playqueue.hurl"))
        .expect("Play queue endpoint tests failed");
}

// ============================================================================
// PREFERENCES TESTS
// ============================================================================

#[test]
fn test_preferences_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    run_hurl_script(&server, &hurl_script("11_preferences.hurl"))
        .expect("Preferences endpoint tests failed");
}

// ============================================================================
// DUPLICATES TESTS (require scanned library)
// ============================================================================

#[test]
fn test_duplicates_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("12_duplicates.hurl"))
        .expect("Duplicates endpoint tests failed");
}

// ============================================================================
// SONG IDS TESTS (require scanned library)
// ============================================================================

#[test]
fn test_song_ids_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("13_song_ids.hurl"))
        .expect("Song IDs endpoint tests failed");
}

// ============================================================================
// MUSIC FOLDERS TESTS (require scanned library)
// ============================================================================

#[test]
fn test_music_folders_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library first
    server.scan_library().expect("Failed to scan library");

    run_hurl_script(&server, &hurl_script("14_music_folders.hurl"))
        .expect("Music folders endpoint tests failed");
}

// ============================================================================
// USER MANAGEMENT TESTS (admin API)
// ============================================================================

#[test]
fn test_user_management_endpoints() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    let server = TestServer::new().expect("Failed to start test server");

    run_hurl_script(&server, &hurl_script("15_users.hurl"))
        .expect("User management endpoint tests failed");
}

// ============================================================================
// SCANNER TESTS
// ============================================================================

/// Test that a full rescan of one folder doesn't delete songs from other folders.
/// This is a regression test for a bug where clean_missing_files would query ALL
/// songs but check them against only the current folder's base path.
#[test]
fn test_multi_folder_rescan_preserves_other_folders() {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return;
    }

    if !fixtures_exist() {
        eprintln!(
            "Skipping test: fixtures not generated. Run scripts/generate-test-fixtures.sh first."
        );
        return;
    }

    // Create two separate music directories with different files
    let temp_dir = std::env::temp_dir().join("ferrotune_multi_folder_test");
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }

    let folder_a = temp_dir.join("folder_a");
    let folder_b = temp_dir.join("folder_b");
    std::fs::create_dir_all(&folder_a).unwrap();
    std::fs::create_dir_all(&folder_b).unwrap();

    // Copy fixtures to both folders (copy entire directory structure)
    let fixtures_music = common::fixtures_dir().join("music");
    if fixtures_music.exists() {
        // Copy to folder_a
        copy_dir_recursive(&fixtures_music, &folder_a).expect("Failed to copy to folder_a");
        // Copy to folder_b
        copy_dir_recursive(&fixtures_music, &folder_b).expect("Failed to copy to folder_b");
    }

    // Create server with two music folders
    let extra_config = format!(
        r#"
[[music.folders]]
name = "Folder B"
path = "{}"
"#,
        folder_b.display()
    );

    let config = common::TestServerConfig {
        music_path: Some(folder_a.clone()),
        copy_fixtures: false,
        extra_config: Some(extra_config),
        ..Default::default()
    };

    let server = common::TestServer::with_config(config).expect("Failed to start test server");

    // Initial scan
    server.scan_library().expect("Initial scan failed");

    // Count songs via API
    let response = reqwest::blocking::get(&server.api_url("getRandomSongs?size=1000"))
        .expect("Failed to get songs");
    let initial_count = response.text().unwrap().matches("<song ").count();

    eprintln!("Initial song count: {}", initial_count);
    assert!(initial_count > 0, "Should have songs after initial scan");

    // Do a full rescan (this should NOT delete songs from folder_b)
    server.scan_library().expect("Full rescan failed");

    // Count songs again
    let response = reqwest::blocking::get(&server.api_url("getRandomSongs?size=1000"))
        .expect("Failed to get songs after rescan");
    let final_count = response.text().unwrap().matches("<song ").count();

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

// ============================================================================
// FULL INTEGRATION TEST
// ============================================================================

/// Run all hurl scripts in sequence against a single server instance.
/// This is useful for testing the full flow and is faster than individual tests.
#[test]
#[ignore] // Run with --ignored flag
fn test_full_integration() {
    if !hurl_available() {
        panic!("hurl not available - cannot run integration tests");
    }

    if !fixtures_exist() {
        panic!("Fixtures not generated. Run scripts/generate-test-fixtures.sh first.");
    }

    let server = TestServer::new().expect("Failed to start test server");

    // Scan the library
    server.scan_library().expect("Failed to scan library");

    // Run all scripts in order
    let scripts = [
        "01_system.hurl",
        "02_auth.hurl",
        "03_browse.hurl",
        "04_streaming.hurl",
        "05_search.hurl",
        "06_starring.hurl",
        "07_playlists.hurl",
        "08_lists.hurl",
        "09_playqueue.hurl",
        "10_admin_media.hurl",
        "11_preferences.hurl",
        "12_duplicates.hurl",
        "13_song_ids.hurl",
    ];

    for script in &scripts {
        println!("Running {}...", script);
        run_hurl_script(&server, &hurl_script(script))
            .unwrap_or_else(|e| panic!("{} failed: {}", script, e));
    }
}
