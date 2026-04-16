-- Disabled songs table (per-user, like shuffle_excludes)
-- Disabled songs are not automatically included in playback queues
-- They can still be played by explicitly starting playback of the track
CREATE TABLE IF NOT EXISTS disabled_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_disabled_songs_user_id ON disabled_songs(user_id);
CREATE INDEX IF NOT EXISTS idx_disabled_songs_song_id ON disabled_songs(song_id);
