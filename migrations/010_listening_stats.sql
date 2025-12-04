-- Track listening sessions for statistics
-- Each row represents a completed or partial listening session for a song
CREATE TABLE listening_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    -- Duration listened in seconds (may be less than song duration if skipped)
    duration_seconds INTEGER NOT NULL,
    -- When this listening session occurred
    listened_at TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- Index for querying by user and time range
CREATE INDEX idx_listening_sessions_user_time ON listening_sessions(user_id, listened_at);
-- Index for querying by song
CREATE INDEX idx_listening_sessions_song ON listening_sessions(song_id);
