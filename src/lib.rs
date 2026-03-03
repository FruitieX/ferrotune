//! Ferrotune Core Library
//!
//! This module exposes the core server functionality for embedding
//! in other applications like the Tauri desktop app.

pub mod analysis;
pub mod api;
#[cfg(feature = "bliss")]
pub mod bliss;
pub mod config;
pub mod db;
pub mod error;
pub mod password;
pub mod replaygain;
pub mod scanner;
pub mod thumbnails;
pub mod watcher;

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub use config::Config;
pub use db::create_pool;

/// Socket mode for the server - TCP or Unix socket
#[derive(Debug, Clone)]
pub enum SocketMode {
    /// Bind to a TCP address
    Tcp { host: String, port: u16 },
    /// Bind to a Unix domain socket (or Windows named pipe)
    #[cfg(any(unix, windows))]
    Unix { path: std::path::PathBuf },
}

impl Default for SocketMode {
    fn default() -> Self {
        Self::Tcp {
            host: "127.0.0.1".to_string(),
            port: 4040,
        }
    }
}

/// Configuration for the embedded server
#[derive(Debug, Clone)]
pub struct EmbeddedServerConfig {
    /// Socket mode (TCP or Unix)
    pub socket_mode: SocketMode,
    /// Ferrotune configuration
    pub config: Config,
}

/// Handle to a running embedded server
pub struct EmbeddedServerHandle {
    /// Shutdown signal sender
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// The URL or path where the server is listening
    pub address: String,
}

impl EmbeddedServerHandle {
    /// Shutdown the embedded server gracefully
    pub fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for EmbeddedServerHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Create the axum router with all API routes.
///
/// This is useful for embedding the server in other applications
/// (like Tauri) where you want to call the router directly via IPC
/// instead of going through a TCP listener.
pub fn create_router(state: Arc<api::AppState>) -> Router {
    // Build combined API router (OpenSubsonic + Ferrotune Admin)
    let app =
        api::subsonic::create_router(state.clone()).merge(api::ferrotune::create_router(state));

    // Set up fallback handler
    #[cfg(feature = "embedded-ui")]
    let app = if api::embedded_ui::has_embedded_ui() {
        app.fallback(api::embedded_ui::serve_embedded_ui)
    } else {
        app.fallback(api::subsonic::fallback_handler)
    };

    #[cfg(not(feature = "embedded-ui"))]
    let app = app.fallback(api::subsonic::fallback_handler);

    app
}

/// Create the axum router with tracing and CORS layers applied.
pub fn create_router_with_layers(state: Arc<api::AppState>) -> Router {
    let app = create_router(state);

    // CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    app.layer(
        TraceLayer::new_for_http()
            .make_span_with(|request: &axum::http::Request<_>| {
                let uri = request.uri();
                let client = uri
                    .query()
                    .and_then(|q| serde_urlencoded::from_str::<api::CommonParams>(q).ok())
                    .map(|p| format!("{}@{}", p.u.unwrap_or_default(), p.c))
                    .unwrap_or_else(|| "unknown".to_string());
                tracing::info_span!(
                    "api",
                    method = %request.method(),
                    path = %uri.path(),
                    client = %client,
                )
            })
            .on_request(|request: &axum::http::Request<_>, _span: &tracing::Span| {
                let uri = request.uri();
                tracing::info!("→ {} {}", request.method(), uri.path());
                if let Some(query) = uri.query() {
                    let redacted = query
                        .split('&')
                        .map(|param| {
                            if param.starts_with("p=")
                                || param.starts_with("t=")
                                || param.starts_with("apiKey=")
                            {
                                let key = param.split('=').next().unwrap_or("");
                                format!("{}=[REDACTED]", key)
                            } else {
                                param.to_string()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("&");
                    tracing::debug!("  query: {}", redacted);
                }
            })
            .on_response(
                |response: &axum::http::Response<_>,
                 latency: std::time::Duration,
                 _span: &tracing::Span| {
                    tracing::info!("← {} {:?}", response.status(), latency);
                },
            ),
    )
    .layer(cors)
}

/// Initialize the database and create the app state.
///
/// This handles:
/// - Creating the database pool
/// - Running migrations
/// - Creating the initial admin user if needed
/// - Initializing music folders from config
/// - Starting the file watcher
pub async fn initialize_app_state(config: Config) -> Result<Arc<api::AppState>> {
    tracing::info!("Initializing Ferrotune v{}", env!("CARGO_PKG_VERSION"));

    // Ensure database directory exists
    if let Some(parent) = config.database.path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Create database connection pool
    tracing::info!("Connecting to database: {}", config.database.path.display());
    let pool = db::create_pool(&config.database.path).await?;

    // Check if we need to create initial admin user
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await?;

    if user_count == 0 {
        tracing::info!("No users found. Creating admin user...");
        create_admin_user(
            &pool,
            &config.server.admin_user,
            &config.server.admin_password,
        )
        .await?;
    }

    // Initialize music folders
    init_music_folders(&pool, &config).await?;

    // Create shared app state
    let scan_state = api::create_scan_state();
    let state = Arc::new(api::AppState {
        pool: pool.clone(),
        config: config.clone(),
        scan_state: scan_state.clone(),
    });

    // Start the file watcher for directories with watch_enabled=true
    let (watcher, watcher_rx) = watcher::LibraryWatcher::new(pool, scan_state);
    let library_watcher = Arc::new(watcher);
    if let Err(e) = library_watcher.start(watcher_rx).await {
        tracing::warn!("Failed to start file watcher: {}", e);
    }

    Ok(state)
}

/// Start the embedded server with the given configuration.
///
/// Returns a handle that can be used to shut down the server.
pub async fn start_embedded_server(
    embedded_config: EmbeddedServerConfig,
) -> Result<EmbeddedServerHandle> {
    let config = embedded_config.config;
    let state = initialize_app_state(config).await?;
    let app = create_router_with_layers(state);

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Start the server based on socket mode
    let address = match embedded_config.socket_mode {
        SocketMode::Tcp { ref host, port } => {
            let addr = format!("{}:{}", host, port);
            let listener = tokio::net::TcpListener::bind(&addr).await?;
            let bound_addr = listener.local_addr()?;
            let address = format!("http://{}", bound_addr);

            tracing::info!("Embedded server listening on {}", address);

            tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                        tracing::info!("Embedded server shutting down...");
                    })
                    .await
                    .ok();
            });

            address
        }
        #[cfg(unix)]
        SocketMode::Unix { ref path } => {
            use hyper_util::rt::TokioIo;
            use hyper_util::server::conn::auto::Builder;
            use hyper_util::service::TowerToHyperService;

            // Remove existing socket file if it exists
            if path.exists() {
                tokio::fs::remove_file(path).await?;
            }

            // Ensure parent directory exists
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            let listener = tokio::net::UnixListener::bind(path)?;
            let address = path.display().to_string();

            tracing::info!("Embedded server listening on Unix socket: {}", address);

            // Spawn server task
            let socket_path = path.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        result = listener.accept() => {
                            match result {
                                Ok((stream, _)) => {
                                    let app = app.clone();
                                    tokio::spawn(async move {
                                        let io = TokioIo::new(stream);
                                        let service = TowerToHyperService::new(app);
                                        let builder = Builder::new(hyper_util::rt::TokioExecutor::new());
                                        if let Err(e) = builder.serve_connection(io, service).await {
                                            tracing::debug!("Connection error: {}", e);
                                        }
                                    });
                                }
                                Err(e) => {
                                    tracing::error!("Failed to accept connection: {}", e);
                                }
                            }
                        }
                        _ = async {
                            // This will never complete, we check shutdown differently
                            std::future::pending::<()>().await
                        } => {
                            break;
                        }
                    }
                }
                // Cleanup socket file
                let _ = std::fs::remove_file(&socket_path);
                tracing::info!("Embedded server shut down");
            });

            address
        }
        #[cfg(windows)]
        SocketMode::Unix { ref path } => {
            // On Windows, use named pipes or fall back to TCP with random port
            // For now, fall back to TCP on localhost with random port
            tracing::warn!(
                "Unix sockets not fully supported on Windows, falling back to localhost TCP"
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
            let bound_addr = listener.local_addr()?;
            let address = format!("http://{}", bound_addr);

            tracing::info!("Embedded server listening on {}", address);

            tokio::spawn(async move {
                axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_rx.await;
                        tracing::info!("Embedded server shutting down...");
                    })
                    .await
                    .ok();
            });

            address
        }
    };

    Ok(EmbeddedServerHandle {
        shutdown_tx: Some(shutdown_tx),
        address,
    })
}

/// Create the admin user
async fn create_admin_user(pool: &sqlx::SqlitePool, username: &str, password: &str) -> Result<()> {
    let password_hash = password::hash_password(password)
        .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;
    let subsonic_token = password::create_subsonic_token(password);

    let user_id =
        db::queries::create_user(pool, username, &password_hash, &subsonic_token, None, true)
            .await?;
    tracing::info!("Admin user '{}' created successfully", username);

    // Grant access to all existing music folders
    let folders: Vec<(i64,)> = sqlx::query_as("SELECT id FROM music_folders")
        .fetch_all(pool)
        .await?;

    for (folder_id,) in folders {
        sqlx::query(
            "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
        )
        .bind(user_id)
        .bind(folder_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Initialize music folders from config into the database
async fn init_music_folders(pool: &sqlx::SqlitePool, config: &config::Config) -> Result<()> {
    for folder in &config.music.folders {
        if !folder.path.exists() {
            tracing::warn!("Music folder does not exist: {}", folder.path.display());
        } else {
            let existing: Option<(i64,)> =
                sqlx::query_as("SELECT id FROM music_folders WHERE path = ?")
                    .bind(folder.path.to_string_lossy().as_ref())
                    .fetch_optional(pool)
                    .await?;

            if existing.is_none() {
                let folder_id = db::queries::create_music_folder(
                    pool,
                    &folder.name,
                    &folder.path.to_string_lossy(),
                )
                .await?;
                tracing::info!(
                    "Added music folder: {} -> {}",
                    folder.name,
                    folder.path.display()
                );

                let users: Vec<(i64,)> = sqlx::query_as("SELECT id FROM users")
                    .fetch_all(pool)
                    .await?;

                for (user_id,) in users {
                    sqlx::query(
                        "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)",
                    )
                    .bind(user_id)
                    .bind(folder_id)
                    .execute(pool)
                    .await?;
                }
            }
        }
    }
    Ok(())
}

/// Set the data directory environment variable.
/// Call this before creating any Config or database connections.
pub fn set_data_dir(path: &Path) {
    std::env::set_var(config::DATA_DIR_ENV, path);
}

/// Initialize tracing for the embedded server
pub fn init_tracing(verbose: bool) {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let log_level = if verbose {
        "ferrotune=debug,tower_http=debug"
    } else {
        "ferrotune=info,tower_http=info"
    };

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| log_level.into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}
