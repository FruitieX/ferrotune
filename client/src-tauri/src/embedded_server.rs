//! Embedded server management for Tauri desktop app.
//!
//! This module handles starting the Ferrotune server within
//! the Tauri application on desktop platforms using Tauri's
//! custom protocol handler for IPC.

use std::path::PathBuf;
use std::sync::{mpsc, Mutex, OnceLock};

use axum::body::Body;
use axum::Router;
use ferrotune::config::DatabaseConfig;
use ferrotune::Config;
use http::{Request, Response};
use rand::Rng;
use tauri::Manager;
use tower::ServiceExt;

use crate::EmbeddedServerState;

/// Global state for the embedded server router
/// We use OnceLock + Arc for thread-safe lazy initialization
static ROUTER: OnceLock<Router> = OnceLock::new();

/// Generate a random password for the embedded admin user
fn generate_random_password() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Get the data directory for the embedded server
fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ferrotune-desktop")
    })
}

fn build_embedded_config(data_dir: &std::path::Path, admin_password: &str) -> Config {
    let mut config = Config::default_configless();
    config.server.admin_user = "admin".to_string();
    config.server.admin_password = admin_password.to_string();
    config.database = DatabaseConfig::sqlite(data_dir.join("ferrotune.db"));
    config.cache.path = data_dir.join("cache");
    config
}

/// Register the custom protocol handler for the embedded server.
/// This must be called before Builder::run().
pub fn register_protocol<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("ferrotune", |_ctx, request, responder| {
        tauri::async_runtime::spawn(async move {
            let response = handle_request(request).await;
            responder.respond(response);
        });
    })
}

/// Handle an incoming request through the custom protocol
async fn handle_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Get the router (must be initialized by now)
    let Some(router) = ROUTER.get() else {
        log::error!("Router not initialized!");
        return Response::builder()
            .status(500)
            .body(b"Server not initialized".to_vec())
            .unwrap();
    };

    // Convert the request body from Vec<u8> to axum's Body
    let (parts, body) = request.into_parts();
    let axum_request = Request::from_parts(parts, Body::from(body));

    // Call the router
    let router = router.clone();
    match router.oneshot(axum_request).await {
        Ok(response) => {
            // Convert axum response body back to Vec<u8>
            let (parts, body) = response.into_parts();
            match axum::body::to_bytes(body, usize::MAX).await {
                Ok(bytes) => Response::from_parts(parts, bytes.to_vec()),
                Err(e) => {
                    log::error!("Failed to read response body: {}", e);
                    Response::builder()
                        .status(500)
                        .body(format!("Failed to read response: {}", e).into_bytes())
                        .unwrap()
                }
            }
        }
        Err(e) => {
            // Infallible error type, but we handle it anyway
            log::error!("Router error: {}", e);
            Response::builder()
                .status(500)
                .body(format!("Router error: {}", e).into_bytes())
                .unwrap()
        }
    }
}

/// Initialize the embedded server (database, app state, router).
/// Called during Tauri setup.
pub fn initialize_server(app_handle: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = get_data_dir(&app_handle);
    let admin_password = generate_random_password();
    let config = build_embedded_config(&data_dir, &admin_password);

    log::info!("Initializing embedded Ferrotune server");
    log::info!("  Data directory: {}", data_dir.display());
    log::info!("  Database backend: sqlite (embedded desktop mode)");

    // Set the data directory environment variable
    ferrotune::set_data_dir(&data_dir);

    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let app_handle_clone = app_handle.clone();
    std::thread::Builder::new()
        .name("ferrotune-embedded-server".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!(
                        "failed to create embedded Tokio runtime: {error}"
                    )));
                    return;
                }
            };

            rt.block_on(async move {
                ferrotune::init_tracing(false);

                let runtime = match ferrotune::ServerRuntime::bootstrap(
                    config,
                    ferrotune::ServerRuntimeOptions {
                        cors: ferrotune::CorsPolicy::Disabled,
                    },
                )
                .await
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_tx.send(Err(format!(
                            "failed to initialize embedded server: {error}"
                        )));
                        return;
                    }
                };

                if ROUTER.set(runtime.router().clone()).is_err() {
                    let _ = ready_tx.send(Err("embedded router was already initialized".into()));
                    return;
                }

                let password_stored = app_handle_clone
                    .try_state::<Mutex<EmbeddedServerState>>()
                    .and_then(|state| state.lock().ok().map(|mut guard| {
                        guard.admin_password = Some(admin_password);
                    }))
                    .is_some();
                if !password_stored {
                    let _ = ready_tx.send(Err(
                        "failed to publish embedded admin credentials".into(),
                    ));
                    return;
                }

                log::info!("Embedded server initialized successfully");
                if ready_tx.send(Ok(())).is_err() {
                    return;
                }

                let _runtime = runtime;
                std::future::pending::<()>().await;
            });
        })?;

    wait_for_readiness(ready_rx).map_err(|message| {
        Box::new(std::io::Error::new(std::io::ErrorKind::Other, message))
            as Box<dyn std::error::Error>
    })
}

fn wait_for_readiness(receiver: mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
    receiver
        .recv()
        .map_err(|_| "embedded server initializer exited before reporting readiness".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{build_embedded_config, wait_for_readiness};
    use ferrotune::config::DatabaseBackend;
    use std::path::PathBuf;
    use std::sync::mpsc;

    #[test]
    fn embedded_server_config_stays_sqlite_only() {
        let data_dir = PathBuf::from("/tmp/api-embedded-test");
        let config = build_embedded_config(&data_dir, "secret");

        assert_eq!(config.database.backend, DatabaseBackend::Sqlite);
        assert_eq!(config.database.path, data_dir.join("ferrotune.db"));
        assert!(config.database.url.is_none());
        assert_eq!(config.cache.path, data_dir.join("cache"));
        assert_eq!(config.server.admin_user, "admin");
        assert_eq!(config.server.admin_password, "secret");
    }

    #[test]
    fn readiness_waits_for_success_signal() {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (result_tx, result_rx) = mpsc::sync_channel(1);

        let waiter = std::thread::spawn(move || {
            result_tx
                .send(wait_for_readiness(ready_rx))
                .expect("test result receiver should stay connected");
        });

        assert!(matches!(result_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
        ready_tx
            .send(Ok(()))
            .expect("readiness waiter should stay connected");
        assert_eq!(
            result_rx.recv().expect("waiter should report a result"),
            Ok(())
        );
        waiter.join().expect("readiness waiter should not panic");
    }

    #[test]
    fn readiness_propagates_initialization_failure() {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        ready_tx
            .send(Err("database unavailable".to_string()))
            .expect("readiness receiver should stay connected");

        assert_eq!(
            wait_for_readiness(ready_rx),
            Err("database unavailable".to_string())
        );
    }
}
