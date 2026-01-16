//! Common test utilities and harness for integration tests.
//!
//! This module provides a `TestServer` struct that manages the lifecycle of a
//! ferrotune instance for testing purposes.

#![allow(dead_code)]

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// Counter for generating unique test instance IDs.
/// Combined with process ID to ensure uniqueness across parallel test processes.
static TEST_INSTANCE_COUNTER: AtomicU32 = AtomicU32::new(0);

/// A test server instance that manages a ferrotune process.
pub struct TestServer {
    /// The child process running ferrotune
    process: Option<Child>,
    /// The port the OpenSubsonic API is running on
    pub port: u16,
    /// The port the Ferrotune Admin API is running on
    pub admin_port: u16,
    /// Temporary directory containing test data
    pub temp_dir: PathBuf,
    /// Path to the test database
    pub db_path: PathBuf,
    /// Path to the test config file
    pub config_path: PathBuf,
    /// Path to the music directory
    pub music_dir: PathBuf,
    /// Path to the cache directory
    pub cache_dir: PathBuf,
    /// Admin credentials
    pub admin_user: String,
    pub admin_password: String,
    /// Base URL for API calls
    pub base_url: String,
}

/// Configuration for creating a test server
#[derive(Default)]
pub struct TestServerConfig {
    /// Custom admin username (default: "testadmin")
    pub admin_user: Option<String>,
    /// Custom admin password (default: "testpass")
    pub admin_password: Option<String>,
    /// Custom music folder path (if None, uses fixtures/music)
    pub music_path: Option<PathBuf>,
    /// Whether to copy fixtures to temp dir (default: true)
    pub copy_fixtures: bool,
    /// Additional configuration options to append
    pub extra_config: Option<String>,
    /// Whether to allow tag editing (default: false - aka readonly)
    /// Note: Default config sets this to true (readonly), so set this to Some(false) to enable editing.
    pub readonly_tags: Option<bool>,
}

impl TestServer {
    /// Create and start a new test server with default configuration.
    pub fn new() -> Result<Self, TestServerError> {
        Self::with_config(TestServerConfig::default())
    }

    /// Create and start a new test server with custom configuration.
    pub fn with_config(config: TestServerConfig) -> Result<Self, TestServerError> {
        let instance_id = TEST_INSTANCE_COUNTER.fetch_add(1, Ordering::SeqCst);

        // Use process ID and instance counter to guarantee unique temp directories
        // even when tests run in parallel across multiple processes
        let pid = std::process::id();

        // Create temporary directory structure with process ID to avoid collisions
        let temp_dir = std::env::temp_dir().join(format!("ferrotune_test_{}_{}", pid, instance_id));
        if temp_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&temp_dir) {
                eprintln!("[test] Warning: failed to clear existing temp dir: {}", e);
            }
        }
        std::fs::create_dir_all(&temp_dir)?;

        let db_path = temp_dir.join("ferrotune.db");
        let config_path = temp_dir.join("config.toml");
        let cache_dir = temp_dir.join("cache");
        std::fs::create_dir_all(&cache_dir)?;

        // Set up music directory
        let music_dir = if let Some(ref music_path) = config.music_path {
            music_path.clone()
        } else if config.copy_fixtures {
            let dest = temp_dir.join("music");
            let fixtures_music = fixtures_dir().join("music");
            if fixtures_music.exists() {
                copy_dir_recursive(&fixtures_music, &dest)?;
            } else {
                std::fs::create_dir_all(&dest)?;
            }
            dest
        } else {
            fixtures_dir().join("music")
        };

        // Use unique credentials for each test instance to prevent cross-talk
        // if a port collision accidentally connects to another test's server.
        let admin_user = config
            .admin_user
            .unwrap_or_else(|| format!("testadmin_{}", instance_id));
        let admin_password = config
            .admin_password
            .unwrap_or_else(|| format!("testpass_{}", instance_id));

        let binary = find_binary()?;
        let mut process: Option<Child> = None;
        let mut final_port = 0;
        let mut final_admin_port = 0;
        let mut final_base_url = String::new();

        // Retry loop to handle port race conditions
        let max_retries = 5;
        for attempt in 0..max_retries {
            if attempt > 0 {
                eprintln!("[test] Retry attempt {} of {}", attempt + 1, max_retries);
                std::thread::sleep(Duration::from_millis(100 * (attempt as u64 + 1)));
            }

            // Reserve ports by keeping the listeners alive until after writing config
            let (listener, port) = reserve_port()?;
            let (admin_listener, admin_port) = reserve_port()?;

            // Generate config file
            let config_content = generate_config(
                port,
                admin_port,
                &db_path,
                &music_dir,
                &cache_dir,
                &admin_user,
                &admin_password,
                config.extra_config.as_deref(),
                config.readonly_tags.unwrap_or(true),
            );

            if let Err(e) = std::fs::write(&config_path, &config_content) {
                return Err(TestServerError::Io(e));
            }

            // Drop the listeners just before starting the server to minimize the race window
            drop(listener);
            drop(admin_listener);

            /*
            eprintln!(
                "[test] Starting server (attempt {}): {:?} --config {:?} serve",
                attempt + 1,
                binary,
                config_path
            );
            */

            let mut child = match Command::new(&binary)
                .arg("--config")
                .arg(&config_path)
                .arg("serve")
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(e) => {
                    eprintln!("[test] Failed to spawn process: {}", e);
                    continue;
                }
            };

            let base_url = format!("http://127.0.0.1:{}", port);
            let timeout = Duration::from_secs(10); // Reduced timeout for retries

            match wait_for_ready(&mut child, &base_url, &admin_user, &admin_password, timeout) {
                Ok(()) => {
                    // Success!
                    // eprintln!("[test] Server ready at {}", base_url);
                    process = Some(child);
                    final_port = port;
                    final_admin_port = admin_port;
                    final_base_url = base_url;
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[test] Server failed to start on attempt {}: {}",
                        attempt + 1,
                        e
                    );
                    // Extract stderr
                    if let Some(stderr) = child.stderr.take() {
                        let mut stderr_content = String::new();
                        use std::io::Read;
                        if let Ok(bytes) = std::io::BufReader::new(stderr)
                            .take(4096)
                            .read_to_string(&mut stderr_content)
                        {
                            if bytes > 0 {
                                eprintln!("[test] Server stderr: {}", stderr_content);
                            }
                        }
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    // Continue to next attempt
                }
            }
        }

        if let Some(child) = process {
            Ok(TestServer {
                process: Some(child),
                port: final_port,
                admin_port: final_admin_port,
                temp_dir,
                db_path,
                config_path,
                music_dir,
                cache_dir,
                admin_user,
                admin_password,
                base_url: final_base_url,
            })
        } else {
            // Cleanup temp dir if we failed to start
            let _ = std::fs::remove_dir_all(&temp_dir);
            Err(TestServerError::ProcessStart(
                "Failed to start server after max retries".to_string(),
            ))
        }
    }

    /// Stop the server process.
    pub fn stop(&mut self) {
        if let Some(mut process) = self.process.take() {
            // Send SIGTERM
            let _ = process.kill();
            let _ = process.wait();
        }
    }

    /// Get the auth query string for API calls.
    pub fn auth_params(&self) -> String {
        format!(
            "u={}&p={}&v=1.16.1&c=test",
            self.admin_user, self.admin_password
        )
    }

    /// Get the full URL for an API endpoint.
    pub fn api_url(&self, endpoint: &str) -> String {
        let sep = if endpoint.contains('?') { "&" } else { "?" };
        format!(
            "{}/rest/{}{}{}",
            self.base_url,
            endpoint,
            sep,
            self.auth_params()
        )
    }

    /// Run a scan of the music library.
    pub fn scan_library(&self) -> Result<(), TestServerError> {
        let binary = find_binary()?;

        let output = Command::new(&binary)
            .arg("--config")
            .arg(&self.config_path)
            .arg("scan")
            .output()
            .map_err(|e| TestServerError::ProcessStart(e.to_string()))?;

        if !output.status.success() {
            return Err(TestServerError::ScanFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        Ok(())
    }

    /// Create an API key for the admin user and return it.
    pub fn create_api_key(&self, _name: &str) -> Result<String, TestServerError> {
        // For now, we'll use the REST API if available, or direct DB access
        // This is a placeholder - the actual implementation depends on
        // whether ferrotune has an API for creating API keys
        Err(TestServerError::NotImplemented(
            "API key creation not yet implemented".to_string(),
        ))
    }
}

/// Wait for the server to become ready by polling the ping endpoint.
fn wait_for_ready(
    child: &mut Child,
    base_url: &str,
    user: &str,
    pass: &str,
    timeout: Duration,
) -> Result<(), TestServerError> {
    let start_time = Instant::now();
    let ping_url = format!(
        "{}/rest/ping?u={}&p={}&v=1.16.1&c=test",
        base_url, user, pass
    );

    loop {
        if start_time.elapsed() > timeout {
            return Err(TestServerError::Timeout(
                "Server did not become ready within timeout".to_string(),
            ));
        }

        // Check if process is still running
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(TestServerError::ProcessStart(format!(
                    "Server process exited unexpectedly with status: {}",
                    status
                )));
            }
            Ok(None) => {
                // Process still running, continue
            }
            Err(e) => {
                return Err(TestServerError::ProcessStart(format!(
                    "Failed to check process status: {}",
                    e
                )));
            }
        }

        // Try to connect
        match reqwest::blocking::get(&ping_url) {
            Ok(response) if response.status().is_success() => {
                return Ok(());
            }
            _ => {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop();
        // Clean up temp directory
        if self.temp_dir.exists() {
            let _ = std::fs::remove_dir_all(&self.temp_dir);
        }
    }
}

/// Find an available TCP port and return the listener to keep it reserved.
/// The caller must drop the listener just before starting the server that will use the port.
/// This minimizes the race window where another process could grab the same port.
fn reserve_port() -> Result<(TcpListener, u16), TestServerError> {
    // Bind to port 0 to get an OS-assigned available port
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| TestServerError::PortAllocation(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| TestServerError::PortAllocation(e.to_string()))?
        .port();
    // Return the listener so it stays bound until caller is ready to use the port
    Ok((listener, port))
}

/// Find the ferrotune binary.
fn find_binary() -> Result<PathBuf, TestServerError> {
    // First try the debug build
    let debug_binary = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("ferrotune");

    if debug_binary.exists() {
        return Ok(debug_binary);
    }

    // Try release build
    let release_binary = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("release")
        .join("ferrotune");

    if release_binary.exists() {
        return Ok(release_binary);
    }

    // Try PATH
    if let Ok(path) = which::which("ferrotune") {
        return Ok(path);
    }

    Err(TestServerError::BinaryNotFound(
        "ferrotune binary not found. Run `cargo build` first.".to_string(),
    ))
}

/// Get the fixtures directory path.
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

/// Generate a test configuration file.
#[allow(clippy::too_many_arguments)]
fn generate_config(
    port: u16,
    admin_port: u16,
    db_path: &Path,
    music_dir: &Path,
    cache_dir: &Path,
    admin_user: &str,
    admin_password: &str,
    extra_config: Option<&str>,
    readonly_tags: bool,
) -> String {
    let mut config = format!(
        r#"[server]
host = "127.0.0.1"
port = {port}
admin_port = {admin_port}
name = "Ferrotune Test"
admin_user = "{admin_user}"
admin_password = "{admin_password}"

[database]
path = "{db_path}"

[music]
readonly_tags = {readonly_tags}

[[music.folders]]
name = "Test Music"
path = "{music_dir}"

[cache]
path = "{cache_dir}"
max_cover_size = 512
"#,
        port = port,
        admin_port = admin_port,
        admin_user = admin_user,
        admin_password = admin_password,
        db_path = db_path.display(),
        music_dir = music_dir.display(),
        cache_dir = cache_dir.display(),
        readonly_tags = readonly_tags,
    );

    if let Some(extra) = extra_config {
        config.push('\n');
        config.push_str(extra);
    }

    config
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

/// Errors that can occur when managing a test server.
#[derive(Debug)]
pub enum TestServerError {
    Io(std::io::Error),
    PortAllocation(String),
    BinaryNotFound(String),
    ProcessStart(String),
    Timeout(String),
    ScanFailed(String),
    NotImplemented(String),
}

impl std::fmt::Display for TestServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TestServerError::Io(e) => write!(f, "IO error: {}", e),
            TestServerError::PortAllocation(e) => write!(f, "Port allocation error: {}", e),
            TestServerError::BinaryNotFound(e) => write!(f, "Binary not found: {}", e),
            TestServerError::ProcessStart(e) => write!(f, "Process start error: {}", e),
            TestServerError::Timeout(e) => write!(f, "Timeout: {}", e),
            TestServerError::ScanFailed(e) => write!(f, "Scan failed: {}", e),
            TestServerError::NotImplemented(e) => write!(f, "Not implemented: {}", e),
        }
    }
}

impl std::error::Error for TestServerError {}

impl From<std::io::Error> for TestServerError {
    fn from(e: std::io::Error) -> Self {
        TestServerError::Io(e)
    }
}
