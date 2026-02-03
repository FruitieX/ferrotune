use std::sync::Mutex;

// Embedded server module (desktop only)
#[cfg(not(target_os = "android"))]
mod embedded_server;

// State to store the embedded server info
#[derive(Default)]
pub struct EmbeddedServerState {
    #[cfg(not(target_os = "android"))]
    pub admin_password: Option<String>,
}

/// Get the embedded server admin password (if running on desktop)
#[tauri::command]
fn get_embedded_admin_password(
    state: tauri::State<'_, Mutex<EmbeddedServerState>>,
) -> Option<String> {
    #[cfg(not(target_os = "android"))]
    {
        state.lock().ok()?.admin_password.clone()
    }

    #[cfg(target_os = "android")]
    {
        let _ = state;
        None
    }
}

/// Check if the app is running with an embedded server
#[tauri::command]
fn is_embedded_server() -> bool {
    cfg!(not(target_os = "android"))
}

/// Check if we're running on a desktop platform
#[tauri::command]
fn is_desktop() -> bool {
    cfg!(not(target_os = "android"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = Mutex::new(EmbeddedServerState::default());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_native_audio::init())
        .manage(server_state)
        .invoke_handler(tauri::generate_handler![
            get_embedded_admin_password,
            is_embedded_server,
            is_desktop,
        ]);

    // Register custom protocol for embedded server on desktop
    #[cfg(not(target_os = "android"))]
    {
        builder = embedded_server::register_protocol(builder);
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize embedded server state on desktop
            #[cfg(not(target_os = "android"))]
            {
                let handle = app.handle().clone();
                embedded_server::initialize_server(handle)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
