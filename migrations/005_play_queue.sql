-- Play queue persistence
-- Stores the current play queue for each user

CREATE TABLE IF NOT EXISTS play_queues (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_song_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,  -- position in milliseconds
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT NOT NULL DEFAULT 'ferrotune-web'
);

CREATE TABLE IF NOT EXISTS play_queue_entries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    queue_position INTEGER NOT NULL,
    PRIMARY KEY (user_id, queue_position)
);

CREATE INDEX IF NOT EXISTS idx_play_queue_entries_user ON play_queue_entries(user_id);
