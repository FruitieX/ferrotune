-- Fix play_queues primary key to support multi-session playback.
-- The original PK (user_id) prevents multiple sessions per user from having
-- separate queues. Change to (user_id, session_id) composite PK.

-- Recreate table with composite primary key
CREATE TABLE play_queues_new (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL DEFAULT 'other',
    source_id TEXT,
    source_name TEXT,
    current_index INTEGER NOT NULL DEFAULT 0,
    position_ms INTEGER NOT NULL DEFAULT 0,
    is_shuffled INTEGER NOT NULL DEFAULT 0,
    shuffle_seed INTEGER,
    shuffle_indices_json TEXT,
    repeat_mode TEXT NOT NULL DEFAULT 'off',
    filters_json TEXT,
    sort_json TEXT,
    total_count INTEGER DEFAULT NULL,
    is_lazy INTEGER NOT NULL DEFAULT 0,
    song_ids_json TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT NOT NULL DEFAULT 'ferrotune-web',
    instance_id TEXT,
    session_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, session_id)
);

-- Copy data from old table, converting NULL session_id to empty string
INSERT INTO play_queues_new (user_id, source_type, source_id, source_name, current_index,
    position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
    filters_json, sort_json, total_count, is_lazy, song_ids_json,
    created_at, updated_at, changed_by, instance_id, session_id)
SELECT user_id, source_type, source_id, source_name, current_index,
    position_ms, is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode,
    filters_json, sort_json, total_count, is_lazy, song_ids_json,
    created_at, updated_at, changed_by, instance_id, COALESCE(session_id, '')
FROM play_queues;

-- Drop old table and rename
DROP TABLE play_queues;
ALTER TABLE play_queues_new RENAME TO play_queues;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_play_queues_session_id ON play_queues(session_id);
