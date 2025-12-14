-- Enhance scrobbles table for imported play counts
-- - Make played_at nullable (imported entries have no timestamp)
-- - Add play_count column for bulk imports (optimization: one row per song instead of N)
-- - Add description column for user-provided import labels

-- SQLite doesn't support ALTER COLUMN, must recreate table
ALTER TABLE scrobbles RENAME TO scrobbles_old;

CREATE TABLE scrobbles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submission BOOLEAN NOT NULL DEFAULT 1,
    play_count INTEGER NOT NULL DEFAULT 1,
    description TEXT
);

-- Migrate existing data (all existing scrobbles have play_count = 1)
INSERT INTO scrobbles (id, user_id, song_id, played_at, submission, play_count)
    SELECT id, user_id, song_id, played_at, submission, 1 FROM scrobbles_old;

DROP TABLE scrobbles_old;

-- Recreate indices
CREATE INDEX idx_scrobbles_user_time ON scrobbles(user_id, played_at DESC);
CREATE INDEX idx_scrobbles_song ON scrobbles(song_id);
