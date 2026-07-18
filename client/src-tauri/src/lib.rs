use std::sync::Mutex;

const NATIVE_AUDIO_PLATFORM_FLAG: &str = "__FERROTUNE_NATIVE_AUDIO__";

fn native_audio_initialization_script(enabled: bool) -> String {
    format!(
        "Object.defineProperty(window, '{NATIVE_AUDIO_PLATFORM_FLAG}', {{ value: {enabled}, configurable: false }});"
    )
}

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

    let builder = tauri::Builder::default()
        // Publish the native-audio capability before the web bundle executes.
        // Browser heuristics such as viewport size and touch support are not a
        // reliable way to distinguish an Android WebView from desktop Tauri.
        .append_invoke_initialization_script(native_audio_initialization_script(cfg!(
            target_os = "android"
        )))
        .plugin(tauri_plugin_native_audio::init())
        .manage(server_state)
        .invoke_handler(tauri::generate_handler![
            get_embedded_admin_password,
            is_embedded_server,
            is_desktop,
        ]);

    // Register custom protocol for embedded server on desktop
    #[cfg(not(target_os = "android"))]
    let builder = embedded_server::register_protocol(builder);

    builder
        .setup(|app| {
            // Enable logging on Android always so Rust log::info! appears in logcat.
            // On other platforms, only enable in debug builds.
            if cfg!(target_os = "android") || cfg!(debug_assertions) {
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

#[cfg(test)]
mod tests {
    use super::native_audio_initialization_script;

    #[test]
    fn platform_script_publishes_native_audio_capability() {
        assert!(native_audio_initialization_script(true)
            .contains("__FERROTUNE_NATIVE_AUDIO__', { value: true"));
        assert!(native_audio_initialization_script(false)
            .contains("__FERROTUNE_NATIVE_AUDIO__', { value: false"));
    }
}
