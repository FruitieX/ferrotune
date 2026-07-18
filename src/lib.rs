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
use axum::{http::HeaderValue, Router};
use tokio::sync::oneshot;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
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
    /// Owns the shared maintenance tasks for the lifetime of the listener.
    _runtime: ServerRuntime,
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

/// CORS is the only intentional transport policy difference between launch modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorsPolicy {
    Configured,
    AllowAny,
    Disabled,
}

#[derive(Debug, Clone, Copy)]
pub struct ServerRuntimeOptions {
    pub cors: CorsPolicy,
}

impl Default for ServerRuntimeOptions {
    fn default() -> Self {
        Self {
            cors: CorsPolicy::Configured,
        }
    }
}

/// Fully initialized server state shared by standalone and embedded launchers.
pub struct ServerRuntime {
    state: Arc<api::AppState>,
    router: Router,
    maintenance_tasks: Vec<tokio::task::JoinHandle<()>>,
    library_watcher_handle: Option<watcher::LibraryWatcherHandle>,
    _library_watcher: Arc<watcher::LibraryWatcher>,
}

impl ServerRuntime {
    pub async fn bootstrap(config: Config, options: ServerRuntimeOptions) -> Result<Self> {
        tracing::info!("Initializing Ferrotune v{}", env!("CARGO_PKG_VERSION"));
        tracing::info!(
            "Connecting to database: {}",
            config.database.connection_label()
        );
        let database = db::create_pool(&config.database).await?;
        Self::bootstrap_with_database(database, config, options).await
    }

    pub async fn bootstrap_with_database(
        database: db::Database,
        config: Config,
        options: ServerRuntimeOptions,
    ) -> Result<Self> {
        if db::repo::users::count_users(&database).await? == 0 {
            tracing::info!("No users found. Creating admin user...");
            create_admin_user(
                &database,
                &config.server.admin_user,
                &config.server.admin_password,
            )
            .await?;
        }

        match db::queries::cleanup_orphaned_queues(&database, 7).await {
            Ok(0) => {}
            Ok(count) => tracing::info!("Cleaned up {} orphaned queue rows", count),
            Err(error) => tracing::warn!("Failed to clean up orphaned queues: {}", error),
        }

        let scan_state = api::create_scan_state();
        let session_manager = Arc::new(api::SessionManager::new());
        let state = Arc::new(api::AppState {
            database: database.clone(),
            config: config.clone(),
            scan_state: scan_state.clone(),
            shuffle_cache: Default::default(),
            session_manager: session_manager.clone(),
        });

        let library_watcher = Arc::new(watcher::LibraryWatcher::new(database.clone(), scan_state));
        let library_watcher_handle = match library_watcher.clone().start().await {
            Ok(handle) => Some(handle),
            Err(error) => {
                tracing::warn!("Failed to start file watcher: {}", error);
                None
            }
        };

        let maintenance_tasks = vec![
            spawn_inactive_owner_cleanup(database, session_manager.clone()),
            spawn_stale_client_sweep(session_manager),
        ];
        let router = build_server_router(state.clone(), &config, options.cors);

        Ok(Self {
            state,
            router,
            maintenance_tasks,
            library_watcher_handle,
            _library_watcher: library_watcher,
        })
    }

    pub fn state(&self) -> &Arc<api::AppState> {
        &self.state
    }

    pub fn router(&self) -> &Router {
        &self.router
    }
}

impl Drop for ServerRuntime {
    fn drop(&mut self) {
        if let Some(handle) = &self.library_watcher_handle {
            handle.shutdown();
        }
        for task in &self.maintenance_tasks {
            task.abort();
        }
    }
}

fn build_server_router(
    state: Arc<api::AppState>,
    config: &Config,
    cors_policy: CorsPolicy,
) -> Router {
    let app = api::create_router(state);

    #[cfg(feature = "embedded-ui")]
    let app = if api::embedded_ui::has_embedded_ui() {
        tracing::info!("Embedded UI assets found, serving web client from /");
        app.fallback(api::embedded_ui::serve_embedded_ui)
    } else {
        app.fallback(api::fallback_handler)
    };

    #[cfg(not(feature = "embedded-ui"))]
    let app = app.fallback(api::fallback_handler);

    let app = app.layer(
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
                                || param.starts_with("urlToken=")
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
    );

    match cors_policy {
        CorsPolicy::Configured => app.layer(build_cors_layer(config)),
        CorsPolicy::AllowAny => app.layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any),
        ),
        CorsPolicy::Disabled => app,
    }
}

fn spawn_inactive_owner_cleanup(
    database: db::Database,
    session_manager: Arc<api::SessionManager>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        const INACTIVITY_SECONDS: i64 = 300;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            match db::queries::get_sessions_with_inactive_owners(&database, INACTIVITY_SECONDS)
                .await
            {
                Ok(sessions) => {
                    for session in sessions {
                        if let Err(error) =
                            db::queries::clear_session_owner(&database, &session.id).await
                        {
                            tracing::warn!(
                                "Failed to clear inactive owner for session {}: {}",
                                session.id,
                                error
                            );
                            continue;
                        }
                        session_manager
                            .broadcast(
                                &session.id,
                                api::SessionEvent::OwnerChanged {
                                    owner_client_id: None,
                                    owner_client_name: None,
                                    resume_playback: None,
                                    position_ms: None,
                                },
                            )
                            .await;
                    }
                }
                Err(error) => {
                    tracing::warn!("Failed to check for inactive session owners: {}", error)
                }
            }
        }
    })
}

fn spawn_stale_client_sweep(
    session_manager: Arc<api::SessionManager>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            for session_id in session_manager.sweep_stale_clients().await {
                session_manager
                    .broadcast(&session_id, api::SessionEvent::ClientListChanged)
                    .await;
            }
        }
    })
}

fn build_cors_layer(config: &Config) -> CorsLayer {
    if config.server.host == "127.0.0.1" || config.server.host == "localhost" {
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
            .expose_headers(Any);
    }

    let allow_any = std::env::var("FERROTUNE_CORS_ALLOW_ANY")
        .map(|value| value.eq_ignore_ascii_case("true") || value == "1")
        .unwrap_or(false);
    if allow_any {
        tracing::warn!(
            "CORS is configured to allow any origin (FERROTUNE_CORS_ALLOW_ANY=true). This is unsafe for production."
        );
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
            .expose_headers(Any);
    }

    let mut origins = [
        "http://ferrotune.localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "ferrotune://localhost",
    ]
    .into_iter()
    .filter_map(|origin| origin.parse::<HeaderValue>().ok())
    .collect::<Vec<_>>();

    if let Ok(origin_csv) = std::env::var("FERROTUNE_CORS_ALLOWED_ORIGINS") {
        for origin in origin_csv
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            match origin.parse::<HeaderValue>() {
                Ok(value) => origins.push(value),
                Err(_) => tracing::warn!(origin = %origin, "Ignoring invalid CORS origin"),
            }
        }
    } else {
        let mut defaults = vec![format!(
            "http://{}:{}",
            config.server.host, config.server.port
        )];
        if config.server.host == "127.0.0.1" || config.server.host == "localhost" {
            for port in [config.server.port, 3000, 13000] {
                defaults.push(format!("http://localhost:{port}"));
                defaults.push(format!("http://127.0.0.1:{port}"));
            }
        }
        defaults.sort();
        defaults.dedup();
        origins.extend(
            defaults
                .into_iter()
                .filter_map(|origin| origin.parse::<HeaderValue>().ok()),
        );
    }

    let mut cors = CorsLayer::new()
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any);
    if !origins.is_empty() {
        cors = cors.allow_origin(AllowOrigin::list(origins));
    }
    cors
}

#[cfg(unix)]
async fn serve_unix_socket(
    listener: tokio::net::UnixListener,
    app: Router,
    mut shutdown_rx: oneshot::Receiver<()>,
    socket_path: std::path::PathBuf,
) {
    use hyper_util::rt::TokioIo;
    use hyper_util::server::conn::auto::Builder;
    use hyper_util::service::TowerToHyperService;

    let mut connections = tokio::task::JoinSet::new();

    loop {
        tokio::select! {
            biased;

            _ = &mut shutdown_rx => {
                tracing::info!("Embedded server shutting down...");
                break;
            }
            result = connections.join_next(), if !connections.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::debug!(%error, "Unix socket connection task failed");
                }
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, _)) => {
                        let app = app.clone();
                        connections.spawn(async move {
                            let io = TokioIo::new(stream);
                            let service = TowerToHyperService::new(app);
                            let builder = Builder::new(hyper_util::rt::TokioExecutor::new());
                            if let Err(error) = builder.serve_connection(io, service).await {
                                tracing::debug!(%error, "Unix socket connection error");
                            }
                        });
                    }
                    Err(error) => {
                        tracing::error!(%error, "Failed to accept Unix socket connection");
                    }
                }
            }
        }
    }

    connections.abort_all();
    while connections.join_next().await.is_some() {}

    if let Err(error) = tokio::fs::remove_file(&socket_path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(%error, path = %socket_path.display(), "Failed to remove Unix socket");
        }
    }
    tracing::info!("Embedded server shut down");
}

/// Start the embedded server with the given configuration.
///
/// Returns a handle that can be used to shut down the server.
pub async fn start_embedded_server(
    embedded_config: EmbeddedServerConfig,
) -> Result<EmbeddedServerHandle> {
    let config = embedded_config.config;
    let runtime = ServerRuntime::bootstrap(
        config,
        ServerRuntimeOptions {
            cors: CorsPolicy::AllowAny,
        },
    )
    .await?;
    let app = runtime.router().clone();

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
                axum::serve(
                    listener,
                    app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
                )
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
            tokio::spawn(serve_unix_socket(listener, app, shutdown_rx, socket_path));

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
                axum::serve(
                    listener,
                    app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
                )
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
        _runtime: runtime,
    })
}

/// Create the admin user
pub async fn create_admin_user(pool: &db::Database, username: &str, password: &str) -> Result<()> {
    let password_hash = password::hash_password(password)
        .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;

    let user_id = db::repo::users::create_user(pool, username, &password_hash, None, true).await?;
    tracing::info!("Admin user '{}' created successfully", username);

    // Grant access to all existing music folders
    for folder_id in db::repo::users::get_music_folder_ids(pool).await? {
        db::repo::users::grant_user_library_access(pool, user_id, folder_id).await?;
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
        .try_init()
        .ok();
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_SOCKET_ID: AtomicU64 = AtomicU64::new(0);

    #[tokio::test]
    async fn unix_embedded_listener_honors_shutdown_and_removes_socket() {
        let socket_id = NEXT_SOCKET_ID.fetch_add(1, Ordering::Relaxed);
        let socket_path = std::env::temp_dir().join(format!(
            "ferrotune-unix-shutdown-{}-{socket_id}.sock",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&socket_path);

        let listener = match tokio::net::UnixListener::bind(&socket_path) {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                eprintln!("Skipping Unix socket test: listener creation is not permitted");
                return;
            }
            Err(error) => panic!("failed to bind test Unix socket: {error}"),
        };
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let server_task = tokio::spawn(serve_unix_socket(
            listener,
            Router::new(),
            shutdown_rx,
            socket_path.clone(),
        ));

        shutdown_tx.send(()).unwrap();
        server_task.await.unwrap();

        assert!(!socket_path.exists());
    }
}
