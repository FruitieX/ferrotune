CREATE TABLE playback_starts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES playback_sessions(id) ON DELETE SET NULL,
    source_type TEXT,
    source_id TEXT,
    client_name TEXT,
    trigger_type TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_playback_starts_song ON playback_starts(song_id);
