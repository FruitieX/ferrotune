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
    ];

    for script in &scripts {
        println!("Running {}...", script);
        run_hurl_script(&server, &hurl_script(script))
            .unwrap_or_else(|e| panic!("{} failed: {}", script, e));
    }
}
