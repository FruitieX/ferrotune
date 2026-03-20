-- Fix play_queue_entries primary key to support multi-session playback.
-- The original PK (user_id, queue_position) prevents multiple sessions per user
-- from having entries at the same queue_position. Include session_id in the PK.

-- Recreate table with session_id in the primary key
CREATE TABLE play_queue_entries_new (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    queue_position INTEGER NOT NULL,
    entry_id TEXT NOT NULL DEFAULT '',
    source_entry_id TEXT,
    session_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, session_id, queue_position)
);

-- Copy data from old table, converting NULL session_id to empty string
INSERT INTO play_queue_entries_new (user_id, song_id, queue_position, entry_id, source_entry_id, session_id)
SELECT user_id, song_id, queue_position, entry_id, source_entry_id, COALESCE(session_id, '')
FROM play_queue_entries;

-- Drop old table and rename
DROP TABLE play_queue_entries;
ALTER TABLE play_queue_entries_new RENAME TO play_queue_entries;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_user ON play_queue_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_song ON play_queue_entries(song_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_entry_id ON play_queue_entries(user_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_session_id ON play_queue_entries(session_id);
