-- Fix listening_sessions.user_id type: TEXT -> INTEGER to match users(id)
-- SQLite doesn't support ALTER COLUMN, so recreate the table.

CREATE TABLE listening_sessions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    listened_at TEXT NOT NULL DEFAULT (datetime('now')),
    skipped BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

INSERT INTO listening_sessions_new (id, user_id, song_id, duration_seconds, listened_at, skipped)
    SELECT id, CAST(user_id AS INTEGER), song_id, duration_seconds, listened_at, skipped
    FROM listening_sessions;

DROP TABLE listening_sessions;
ALTER TABLE listening_sessions_new RENAME TO listening_sessions;

CREATE INDEX idx_listening_sessions_user_time ON listening_sessions(user_id, listened_at);
CREATE INDEX idx_listening_sessions_song ON listening_sessions(song_id);
