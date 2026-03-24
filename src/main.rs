use anyhow::Result;
use axum::http::HeaderValue;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use ferrotune::{api, config, db, error, password, scanner, watcher};

/// Ferrotune - OpenSubsonic-compatible music server
#[derive(Parser)]
#[command(name = "ferrotune")]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, env = "FERROTUNE_CONFIG")]
    config: Option<PathBuf>,

    /// Enable verbose logging (debug level)
    #[arg(short, long)]
    verbose: bool,

    /// Subcommand to run
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the music server
    Serve {
        /// Server bind address
        #[arg(long, env = "FERROTUNE_HOST")]
        host: Option<String>,

        /// Server port
        #[arg(long, env = "FERROTUNE_PORT")]
        port: Option<u16>,
    },

    /// Scan music library for new/changed files
    Scan {
        /// Scan all folders (default: scan only changed files)
        #[arg(long)]
        full: bool,

        /// Music folder ID to scan (default: all folders)
        #[arg(long)]
        folder: Option<i64>,

        /// Show what would be removed without actually deleting
        #[arg(long)]
        dry_run: bool,
    },

    /// Create a new user
    CreateUser {
        /// Username for the new user
        #[arg(long)]
        username: String,

        /// Password for the new user
        #[arg(long)]
        password: String,

        /// Email address (optional)
        #[arg(long)]
        email: Option<String>,

        /// Make this user an admin
        #[arg(long)]
        admin: bool,
    },

    /// Set a user's password
    SetPassword {
        /// Username of the user
        #[arg(long)]
        username: String,

        /// New password
        #[arg(long)]
        password: String,
    },

    /// Generate example configuration file
    GenerateConfig,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize tracing
    let log_level = if cli.verbose {
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

    // Handle generate-config command early
    if let Some(Commands::GenerateConfig) = cli.command {
        println!("{}", config::Config::example());
        return Ok(());
    }

    // Load configuration
    // Priority: CLI arg > env var > default path > configless mode
    let config = if let Some(config_path) = cli.config {
        // Explicit config file path provided
        config::Config::load_from(&config_path)?
    } else if let Ok(config_path) = std::env::var("FERROTUNE_CONFIG") {
        // Config path from environment variable
        config::Config::load_from(&PathBuf::from(config_path))?
    } else {
        // Try default location, fall back to configless mode
        match config::Config::load()? {
            Some(config) => config,
            None => {
                tracing::info!("No config file found, running in configless mode");
                tracing::info!("  Data directory: {}", config::get_data_dir().display());
                tracing::info!(
                    "  Database: {}",
                    config::get_data_dir().join("ferrotune.db").display()
                );
                tracing::info!("  Cache: {}", config::get_cache_dir().display());
                tracing::info!("Use the web UI at /setup to configure your server");
                config::Config::default_configless()
            }
        }
    };

    tracing::info!(
        "Starting Ferrotune Music Server v{}",
        env!("CARGO_PKG_VERSION")
    );

    // Create database connection pool
    tracing::info!("Connecting to database: {}", config.database.path.display());
    let pool = db::create_pool(&config.database.path).await?;

    // Handle subcommands
    match cli.command {
        Some(Commands::Scan {
            full,
            folder,
            dry_run,
        }) => {
            // Initialize music folders before scanning
            init_music_folders(&pool, &config).await?;
            if dry_run {
                tracing::info!("Starting music library scan (dry-run mode)...");
            } else {
                tracing::info!("Starting music library scan...");
            }
            scanner::scan_library(&pool, full, folder, dry_run, false).await?;
            tracing::info!("Scan completed successfully");
            return Ok(());
        }
        Some(Commands::CreateUser {
            username,
            password,
            email,
            admin,
        }) => {
            // Hash the password using argon2
            let password_hash = password::hash_password(&password)
                .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;
            // Create subsonic token for legacy token+salt authentication
            let subsonic_token = password::create_subsonic_token(&password);

            db::queries::create_user(
                &pool,
                &username,
                &password_hash,
                &subsonic_token,
                email.as_deref(),
                admin,
            )
            .await?;
            tracing::info!("User '{}' created successfully", username);
            return Ok(());
        }
        Some(Commands::SetPassword { username, password }) => {
            // Hash the password using argon2
            let password_hash = password::hash_password(&password)
                .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;
            // Create subsonic token for token+salt authentication
            let subsonic_token = password::create_subsonic_token(&password);

            let updated = db::queries::update_user_password(
                &pool,
                &username,
                &password_hash,
                &subsonic_token,
            )
            .await?;
            if updated {
                tracing::info!("Password updated for user '{}'", username);
            } else {
                tracing::error!("User '{}' not found", username);
                return Err(
                    error::Error::NotFound(format!("User '{}' not found", username)).into(),
                );
            }
            return Ok(());
        }
        Some(Commands::Serve { host, port }) => {
            // Override config with CLI args if provided
            let mut config = config;
            if let Some(h) = host {
                config.server.host = h;
            }
            if let Some(p) = port {
                config.server.port = p;
            }
            run_server(pool, config).await?;
        }
        Some(Commands::GenerateConfig) => unreachable!(), // Handled earlier
        None => {
            // Default to serve
            run_server(pool, config).await?;
        }
    }

    Ok(())
}

async fn run_server(pool: sqlx::SqlitePool, config: config::Config) -> Result<()> {
    tracing::info!(
        "Starting server on {}:{}",
        config.server.host,
        config.server.port
    );

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
    let session_manager = Arc::new(api::SessionManager::new());
    let state = Arc::new(api::AppState {
        pool: pool.clone(),
        config: config.clone(),
        scan_state: scan_state.clone(),
        shuffle_cache: Default::default(),
        session_manager: session_manager.clone(),
    });

    // Spawn background task to clean up stale playback sessions (every 30s, 2min timeout)
    // Preserves the most recent session per user to prevent queue loss on server restarts.
    {
        let pool = pool.clone();
        let sm = session_manager.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                // Find sessions with heartbeat older than 2 minutes,
                // EXCLUDING the most recent session per user (to preserve queue)
                let stale: Vec<(String,)> = match sqlx::query_as(
                    "SELECT id FROM playback_sessions \
                     WHERE last_heartbeat < datetime('now', '-2 minutes') \
                     AND id NOT IN ( \
                         SELECT id FROM playback_sessions ps2 \
                         WHERE ps2.user_id = playback_sessions.user_id \
                         ORDER BY ps2.last_heartbeat DESC \
                         LIMIT 1 \
                     )",
                )
                .fetch_all(&pool)
                .await
                {
                    Ok(rows) => rows,
                    Err(e) => {
                        tracing::warn!("Failed to query stale sessions: {}", e);
                        continue;
                    }
                };

                // Collect affected user IDs before deleting stale sessions
                let affected_user_ids: Vec<(i64,)> = if !stale.is_empty() {
                    sqlx::query_as(
                        "SELECT DISTINCT user_id FROM playback_sessions \
                         WHERE last_heartbeat < datetime('now', '-2 minutes') \
                         AND id NOT IN ( \
                             SELECT id FROM playback_sessions ps2 \
                             WHERE ps2.user_id = playback_sessions.user_id \
                             ORDER BY ps2.last_heartbeat DESC \
                             LIMIT 1 \
                         )",
                    )
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default()
                } else {
                    Vec::new()
                };

                for (session_id,) in &stale {
                    // Broadcast SessionEnded to any listeners
                    sm.broadcast(session_id, api::SessionEvent::SessionEnded)
                        .await;
                    sm.remove(session_id).await;
                }

                if !stale.is_empty() {
                    let ids: Vec<&str> = stale.iter().map(|(id,)| id.as_str()).collect();
                    tracing::debug!("Cleaning up {} stale sessions: {:?}", ids.len(), ids);

                    if let Err(e) = sqlx::query(
                        "DELETE FROM playback_sessions \
                         WHERE last_heartbeat < datetime('now', '-2 minutes') \
                         AND id NOT IN ( \
                             SELECT id FROM playback_sessions ps2 \
                             WHERE ps2.user_id = playback_sessions.user_id \
                             ORDER BY ps2.last_heartbeat DESC \
                             LIMIT 1 \
                         )",
                    )
                    .execute(&pool)
                    .await
                    {
                        tracing::warn!("Failed to clean stale sessions: {}", e);
                    }

                    // Recompute session names for affected users
                    for (user_id,) in &affected_user_ids {
                        let _ = db::queries::recompute_session_names(&pool, *user_id).await;
                    }
                }

                // Hard expiry: delete any session older than 30 days (even preserved ones)
                if let Err(e) = sqlx::query(
                    "DELETE FROM playback_sessions WHERE last_heartbeat < datetime('now', '-30 days')",
                )
                .execute(&pool)
                .await
                {
                    tracing::warn!("Failed to clean expired sessions: {}", e);
                }
            }
        });
    }

    // Start the file watcher for directories with watch_enabled=true
    let (watcher, watcher_rx) = watcher::LibraryWatcher::new(pool, scan_state);
    let library_watcher = Arc::new(watcher);
    if let Err(e) = library_watcher.start(watcher_rx).await {
        tracing::warn!("Failed to start file watcher: {}", e);
    }

    // CORS layer - must be applied first (added last) to handle preflight requests
    // before the router rejects OPTIONS method
    let cors = build_cors_layer(&config);

    // Build combined API router (OpenSubsonic + Ferrotune Admin)
    // Both APIs are served on the same port:
    // - /rest/* - OpenSubsonic API
    // - /api/ferrotune/* - Ferrotune Admin API
    // If embedded UI is available, it's served from / (set up in subsonic::create_router)
    let app =
        api::subsonic::create_router(state.clone()).merge(api::ferrotune::create_router(state));

    // Set up fallback handler:
    // - If embedded UI is available, serve static files
    // - Otherwise, return "endpoint not implemented" error
    #[cfg(feature = "embedded-ui")]
    let app = if api::embedded_ui::has_embedded_ui() {
        tracing::info!("Embedded UI assets found, serving web client from /");
        app.fallback(api::embedded_ui::serve_embedded_ui)
    } else {
        app.fallback(api::subsonic::fallback_handler)
    };

    #[cfg(not(feature = "embedded-ui"))]
    let app = app.fallback(api::subsonic::fallback_handler);

    let app = app
        .layer(
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
                    // Log full query string at debug level (excluding sensitive params)
                    if let Some(query) = uri.query() {
                        // Redact password and token from logs
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
        // CORS must be the outermost layer to handle OPTIONS preflight before routing
        .layer(cors);

    // Create listener
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("Ferrotune server listening on http://{}", addr);
    tracing::info!("  OpenSubsonic API: /rest/*");
    tracing::info!("  Ferrotune API: /ferrotune/*");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let ctrl_c = tokio::signal::ctrl_c();
            #[cfg(unix)]
            {
                let mut sigterm =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("failed to install SIGTERM handler");
                tokio::select! {
                    _ = ctrl_c => {},
                    _ = sigterm.recv() => {},
                }
            }
            #[cfg(not(unix))]
            ctrl_c.await.ok();
            tracing::info!("Shutdown signal received, finishing in-flight requests…");
        })
        .await?;

    Ok(())
}

fn build_cors_layer(config: &config::Config) -> CorsLayer {
    if config.server.host == "127.0.0.1" || config.server.host == "localhost" {
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
            .expose_headers(Any);
    }

    let allow_any = std::env::var("FERROTUNE_CORS_ALLOW_ANY")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
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

    let mut origins: Vec<HeaderValue> = Vec::new();

    // Always allow Tauri app origins
    for tauri_origin in &[
        "http://ferrotune.localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "ferrotune://localhost",
    ] {
        if let Ok(value) = tauri_origin.parse::<HeaderValue>() {
            origins.push(value);
        }
    }

    if let Ok(origin_csv) = std::env::var("FERROTUNE_CORS_ALLOWED_ORIGINS") {
        for origin in origin_csv
            .split(',')
            .map(str::trim)
            .filter(|o| !o.is_empty())
        {
            match origin.parse::<HeaderValue>() {
                Ok(value) => origins.push(value),
                Err(_) => tracing::warn!(origin = %origin, "Ignoring invalid CORS origin"),
            }
        }
    } else {
        let mut default_origins = vec![format!(
            "http://{}:{}",
            config.server.host, config.server.port
        )];

        if config.server.host == "127.0.0.1" || config.server.host == "localhost" {
            for port in [config.server.port, 3000, 13000] {
                default_origins.push(format!("http://localhost:{}", port));
                default_origins.push(format!("http://127.0.0.1:{}", port));
            }
        }

        default_origins.sort();
        default_origins.dedup();

        for origin in default_origins {
            if let Ok(value) = origin.parse::<HeaderValue>() {
                origins.push(value);
            }
        }
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

async fn create_admin_user(pool: &sqlx::SqlitePool, username: &str, password: &str) -> Result<()> {
    // Hash the password using argon2
    let password_hash = password::hash_password(password)
        .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;
    // Create subsonic token for legacy token+salt authentication
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
            // Ensure folder is in database
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

                // Grant access to all existing users for new music folders
                let users: Vec<(i64,)> = sqlx::query_as("SELECT id FROM users")
                    .fetch_all(pool)
                    .await?;

                for (user_id,) in users {
                    sqlx::query(
                        "INSERT OR IGNORE INTO user_library_access (user_id, music_folder_id) VALUES (?, ?)"
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
