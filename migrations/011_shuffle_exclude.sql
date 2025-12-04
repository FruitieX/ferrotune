-- Add field to mark songs as excluded from shuffle playback
-- Per-user setting stored in a separate table to avoid modifying songs table

CREATE TABLE IF NOT EXISTS shuffle_excludes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_shuffle_excludes_user_song ON shuffle_excludes(user_id, song_id);
