//! Integration tests for ferrotune using hurl scripts against PostgreSQL.
//!
//! These tests mirror the SQLite hurl harness but provision an isolated
//! PostgreSQL container for each test case so the full server surface can be
//! exercised against the PostgreSQL backend.

mod common;

use common::{fixtures_dir, TestDatabaseConfig, TestServer, TestServerConfig};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use testcontainers_modules::{postgres::Postgres, testcontainers::runners::SyncRunner};

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

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('#') {
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

fn to_hex(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect()
}

fn hurl_available() -> bool {
    Command::new("hurl")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
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

fn fixtures_exist() -> bool {
    let music_dir = fixtures_dir().join("music");
    music_dir.exists()
        && music_dir
            .read_dir()
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
}

fn run_hurl_script(server: &TestServer, script_path: &Path) -> Result<(), String> {
    let password_hex = to_hex(&server.admin_password);

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

fn scan_library_via_api(server: &TestServer) -> Result<(), String> {
    let client = reqwest::blocking::Client::new();

    client
        .post(format!("{}/ferrotune/scan", server.base_url))
        .basic_auth(&server.admin_user, Some(&server.admin_password))
        .json(&serde_json::json!({}))
        .send()
        .map_err(|e| format!("Failed to start scan via API: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Scan start request failed: {}", e))?;

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let status: serde_json::Value = client
            .get(format!("{}/ferrotune/scan/full", server.base_url))
            .basic_auth(&server.admin_user, Some(&server.admin_password))
            .send()
            .map_err(|e| format!("Failed to poll scan status: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Scan status request failed: {}", e))?
            .json()
            .map_err(|e| format!("Failed to decode scan status: {}", e))?;

        if !status["scanning"].as_bool().unwrap_or(false) {
            if let Some(error) = status["error"].as_str() {
                return Err(format!(
                    "PostgreSQL API scan failed: {error}; full status: {status}"
                ));
            }
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for PostgreSQL API scan to finish: {status}"
            ));
        }

        std::thread::sleep(Duration::from_millis(200));
    }
}

fn run_hurl_test_inner(path: &Path, content: &str) -> datatest_stable::Result<()> {
    if !hurl_available() {
        eprintln!("Skipping test: hurl not available");
        return Ok(());
    }

    if !docker_available() {
        eprintln!("Skipping test: docker not available");
        return Ok(());
    }

    let config = parse_hurl_config(content);

    if config.requires_fixtures && !fixtures_exist() {
        eprintln!("Skipping test: fixtures not generated. Run `moon run generate-fixtures` first.");
        return Ok(());
    }

    let container = Postgres::default()
        .start()
        .map_err(|e| format!("Failed to start PostgreSQL container: {}", e))?;
    let host = container
        .get_host()
        .map_err(|e| format!("Failed to get PostgreSQL container host: {}", e))?
        .to_string();
    let port = container
        .get_host_port_ipv4(5432)
        .map_err(|e| format!("Failed to get PostgreSQL container port: {}", e))?;

    let server_config = TestServerConfig {
        readonly_tags: config.readonly_tags,
        copy_fixtures: config.copy_fixtures,
        database: TestDatabaseConfig::Postgres {
            url: format!("postgres://postgres:postgres@{}:{}/postgres", host, port),
        },
        ..Default::default()
    };

    let server = TestServer::with_config(server_config)
        .map_err(|e| format!("Failed to start test server: {}", e))?;

    if config.requires_scan {
        scan_library_via_api(&server).map_err(|e| format!("Failed to scan library: {}", e))?;
    }

    run_hurl_script(&server, path).map_err(|e| e.into())
}

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
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                last_error = Some(e);
            }
        }
    }

    Err(last_error.unwrap())
}

datatest_stable::harness! {
    { test = run_hurl_test, root = "tests/hurl", pattern = r".*\.hurl$" },
}
