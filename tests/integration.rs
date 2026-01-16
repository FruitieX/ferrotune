//! Integration tests for ferrotune using hurl scripts.
//!
//! These tests use datatest-stable for auto-discovery of `.hurl` test files.
//! Each `.hurl` file in `tests/hurl/` becomes an individual test case.
//!
//! Test configuration is specified via front-matter comments in each `.hurl` file:
//! - `# @requires_fixtures` - Test requires fixture files to exist
//! - `# @requires_scan` - Test requires a library scan before running
//! - `# @copy_fixtures` - Copy fixtures to temp dir (for tests that modify files)
//! - `# @readonly_tags: false` - Allow tag editing (default is true/readonly)

mod common;

use common::{fixtures_dir, TestServer, TestServerConfig};
use std::path::Path;
use std::process::Command;

/// Front-matter configuration parsed from a hurl file.
#[derive(Debug, Default)]
struct HurlConfig {
    requires_fixtures: bool,
    requires_scan: bool,
    copy_fixtures: bool,
    readonly_tags: Option<bool>,
}

/// Parse front-matter configuration from a hurl file's content.
fn parse_hurl_config(content: &str) -> HurlConfig {
    let mut config = HurlConfig::default();

    // Only look at comment lines at the start of the file
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('#') {
            // Stop at first non-comment line
            break;
        }

        let comment = trimmed.trim_start_matches('#').trim();

        if comment.starts_with("@requires_fixtures") {
            config.requires_fixtures = true;
        }
        if comment.starts_with("@requires_scan") {
            config.requires_scan = true;
        }
        if comment.starts_with("@copy_fixtures") {
            config.copy_fixtures = true;
        }
        if comment.starts_with("@readonly_tags:") {
            let value = comment
                .strip_prefix("@readonly_tags:")
                .unwrap()
                .trim()
                .to_lowercase();
            config.readonly_tags = Some(value != "false");
        }
    }

    config
}

/// Convert a string to hex encoding.
fn to_hex(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect()
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
    let music_dir = fixtures_dir().join("music");
    music_dir.exists()
        && music_dir
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
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
        .arg("--file-root")
        .arg(env!("CARGO_MANIFEST_DIR"))
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

/// The inner test function that performs a single attempt.
fn run_hurl_test_inner(path: &Path, content: &str) -> datatest_stable::Result<()> {
    // Check prerequisites
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return Ok(());
    }

    // Parse configuration from front-matter
    let config = parse_hurl_config(content);

    // Check if fixtures are required but not available
    if config.requires_fixtures && !fixtures_exist() {
        eprintln!("Skipping test: fixtures not generated. Run `moon run generate-fixtures` first.");
        return Ok(());
    }

    // Build server configuration
    let server_config = TestServerConfig {
        readonly_tags: config.readonly_tags,
        copy_fixtures: config.copy_fixtures,
        ..Default::default()
    };

    // Create and start the test server
    let server = TestServer::with_config(server_config)
        .map_err(|e| format!("Failed to start test server: {}", e))?;

    // Scan library if required
    if config.requires_scan {
        server
            .scan_library()
            .map_err(|e| format!("Failed to scan library: {}", e))?;
    }

    // Run the hurl script
    run_hurl_script(&server, path).map_err(|e| e.into())
}

/// The main test function called by datatest-stable for each `.hurl` file.
/// Wraps the inner function with retry logic.
fn run_hurl_test(path: &Path, content: String) -> datatest_stable::Result<()> {
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 1..=max_retries {
        match run_hurl_test_inner(path, &content) {
            Ok(()) => return Ok(()),
            Err(e) => {
                if attempt < max_retries {
                    eprintln!(
                        "Test {} failed attempt {}/{}: {}",
                        path.display(),
                        attempt,
                        max_retries,
                        e
                    );
                    // Add a small backoff between test retries
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap())
}

// Register the test harness with datatest-stable
// This discovers all .hurl files in tests/hurl/ and runs them as individual tests
datatest_stable::harness! {
    { test = run_hurl_test, root = "tests/hurl", pattern = r".*\.hurl$" },
}
