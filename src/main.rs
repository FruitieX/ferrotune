use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use ferrotune::{config, db, error, password, scanner};

/// Ferrotune music server
#[derive(Parser)]
#[command(name = "ferrotune")]
#[command(author, version, about, long_about = None)]
struct Cli {
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

    let config = config::Config::from_env()?;
    tracing::info!("Data directory: {}", config::get_data_dir().display());
    tracing::info!("Cache:          {}", config::get_cache_dir().display());

    tracing::info!(
        "Starting Ferrotune Music Server v{}",
        env!("CARGO_PKG_VERSION")
    );

    // Create database connection pool
    tracing::info!(
        "Connecting to database: {}",
        config.database.connection_label()
    );
    let pool = db::create_pool(&config.database).await?;

    // Handle subcommands
    match cli.command {
        Some(Commands::Scan {
            full,
            folder,
            dry_run,
        }) => {
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

            db::repo::users::create_user(&pool, &username, &password_hash, email.as_deref(), admin)
                .await?;
            tracing::info!("User '{}' created successfully", username);
            return Ok(());
        }
        Some(Commands::SetPassword { username, password }) => {
            // Hash the password using argon2
            let password_hash = password::hash_password(&password)
                .map_err(|e| error::Error::Internal(format!("Failed to hash password: {}", e)))?;

            let updated =
                db::repo::users::update_user_password(&pool, &username, &password_hash).await?;
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
        None => {
            // Default to serve
            run_server(pool, config).await?;
        }
    }

    Ok(())
}

async fn run_server(pool: db::Database, config: config::Config) -> Result<()> {
    tracing::info!(
        "Starting server on {}:{}",
        config.server.host,
        config.server.port
    );

    let runtime = ferrotune::ServerRuntime::bootstrap_with_database(
        pool,
        config.clone(),
        ferrotune::ServerRuntimeOptions::default(),
    )
    .await?;

    let app = runtime.router().clone();

    // Create listener
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    tracing::info!("Ferrotune server listening on http://{}", addr);
    tracing::info!("  API: /api/*");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
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
