-- Add playback sessions support.
-- Each browser tab / client registers as a session. Multiple sessions per user.
-- Queues are now keyed by session_id instead of only user_id.

-- Create playback_sessions table
CREATE TABLE IF NOT EXISTS playback_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    client_name TEXT NOT NULL DEFAULT 'ferrotune-web',
    is_playing INTEGER NOT NULL DEFAULT 0,
    current_song_id TEXT,
    current_song_title TEXT,
    current_song_artist TEXT,
    last_heartbeat TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    created_at TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_id ON playback_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_heartbeat ON playback_sessions(last_heartbeat);

-- Add session_id to play_queues
ALTER TABLE play_queues ADD COLUMN session_id TEXT REFERENCES playback_sessions(id) ON DELETE CASCADE;

-- Add session_id to play_queue_entries
ALTER TABLE play_queue_entries ADD COLUMN session_id TEXT;

-- Migrate existing queues: create a session for each user's existing queue and link them.
-- We generate a deterministic session ID from the user_id for migration purposes.
INSERT INTO playback_sessions (id, user_id, name, client_name, is_playing, last_heartbeat, created_at)
SELECT
    'migrated-session-' || CAST(user_id AS TEXT),
    user_id,
    'Session 1',
    changed_by,
    0,
    updated_at,
    created_at
FROM play_queues;

UPDATE play_queues SET session_id = 'migrated-session-' || CAST(user_id AS TEXT)
WHERE session_id IS NULL;

UPDATE play_queue_entries SET session_id = 'migrated-session-' || CAST(pqe.user_id AS TEXT)
FROM (SELECT DISTINCT user_id FROM play_queue_entries) AS pqe
WHERE play_queue_entries.user_id = pqe.user_id AND play_queue_entries.session_id IS NULL;

-- Create indices on session_id for both tables
CREATE INDEX IF NOT EXISTS idx_play_queues_session_id ON play_queues(session_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_session_id ON play_queue_entries(session_id);
