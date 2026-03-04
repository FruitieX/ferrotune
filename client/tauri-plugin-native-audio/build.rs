const COMMANDS: &[&str] = &[
    "play",
    "request_playback",
    "pause",
    "stop",
    "seek",
    "set_track",
    "get_state",
    "set_volume",
    "set_replay_gain",
    "set_queue",
    "next_track",
    "previous_track",
    "set_repeat_mode",
    "append_to_queue",
    "update_starred_state",
    "get_safe_area_insets",
    "init_session",
    "update_settings",
    "start_autonomous_playback",
    "invalidate_queue",
    "toggle_shuffle",
    "debug_log",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
