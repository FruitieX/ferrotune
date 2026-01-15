const COMMANDS: &[&str] = &[
    "play",
    "pause",
    "stop",
    "seek",
    "set_track",
    "get_state",
    "set_volume",
    "set_queue",
    "next_track",
    "previous_track",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
