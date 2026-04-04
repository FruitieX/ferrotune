const COMMANDS: &[&str] = &[
    "play",
    "pause",
    "stop",
    "seek",
    "get_state",
    "set_volume",
    "set_replay_gain",
    "next_track",
    "play_at_index",
    "previous_track",
    "set_repeat_mode",
    "update_starred_state",
    "get_safe_area_insets",
    "init_session",
    "update_settings",
    "start_playback",
    "invalidate_queue",
    "soft_invalidate_queue",
    "toggle_shuffle",
    "debug_log",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
