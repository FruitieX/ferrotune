mod api;
mod config;
mod db;
mod error;
mod scanner;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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
    let config = if let Some(config_path) = cli.config {
        config::Config::load_from(&config_path)?
    } else {
        config::Config::load().map_err(|e| {
            if matches!(e, error::Error::Config(_)) {
                eprintln!("Configuration error: {}", e);
                eprintln!("\nExample configuration file:");
                eprintln!("---------------------------");
                eprintln!("{}", config::Config::example());
                eprintln!("---------------------------");
                eprintln!("\nPlease create a config file at: ~/.config/ferrotune/config.toml");
                eprintln!("Or generate one with: ferrotune generate-config > ~/.config/ferrotune/config.toml");
            }
            e
        })?
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
            scanner::scan_library(&pool, &config, full, folder, dry_run).await?;
            tracing::info!("Scan completed successfully");
            return Ok(());
        }
        Some(Commands::CreateUser {
            username,
            password,
            email,
            admin,
        }) => {
            db::queries::create_user(&pool, &username, &password, email.as_deref(), admin).await?;
            tracing::info!("User '{}' created successfully", username);
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
    let state = Arc::new(api::AppState {
        pool,
        config: config.clone(),
        scan_state,
    });

    // CORS layer - must be applied first (added last) to handle preflight requests
    // before the router rejects OPTIONS method
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

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

    axum::serve(listener, app).await?;

    Ok(())
}

async fn create_admin_user(pool: &sqlx::SqlitePool, username: &str, password: &str) -> Result<()> {
    db::queries::create_user(pool, username, password, None, true).await?;
    tracing::info!("Admin user '{}' created successfully", username);
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
                db::queries::create_music_folder(
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
            }
        }
    }
    Ok(())
}
